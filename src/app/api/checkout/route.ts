import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { PLANS, type PlanKey } from "@/lib/credits";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";
import { effectivePlan } from "@/lib/plan";
import { TIER_LABELS, TIERS, toTier } from "@/lib/entitlements";
import { createCheckout, PaymentsLkError } from "@/lib/paymentsLk";
import { createTransaction, getClientToken, PaddleError, paddleEnvironment, priceIdFor } from "@/lib/paddle";
import { gatewayFor } from "@/lib/checkoutGateway";

// Payments.lk requires customer.name (2 to 80 characters) whenever a
// customer object is sent, and refuses the whole checkout otherwise. Send
// the account's name and email when there is a usable name, so the page
// comes prefilled; with none, leave customer out and the checkout asks.
function checkoutCustomer(email: string | undefined, metadata: Record<string, unknown> | undefined) {
  const raw = metadata?.full_name ?? metadata?.name;
  const name = typeof raw === "string" ? raw.trim().slice(0, 80) : "";
  if (!email || name.length < 2) return undefined;
  return { name, email };
}

/** Which checkout this visitor gets, and what Paddle.js needs to run it:
 * the public client token, the environment, and - for Paddle Retain - the
 * signed-in user's Paddle customer ID (ctm_...), once a purchase has
 * recorded it. */
export async function GET(request: NextRequest) {
  const gateway = gatewayFor(request);
  if (gateway !== "paddle") return NextResponse.json({ gateway, paddle: null });

  let customerId: string | null = null;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase.from("profiles").select("paddle_customer_id").eq("id", user.id).single();
      customerId = data?.paddle_customer_id ?? null;
    }
  }

  return NextResponse.json({
    gateway,
    paddle: { clientToken: getClientToken(), environment: paddleEnvironment(), customerId },
  });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Accounts aren't configured yet." }, { status: 501 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  // 10 checkout attempts/10min/user - generous for legit retries after a
  // declined card, tight enough to stop scripted checkout-creation abuse.
  if (!(await checkRateLimit(`${rateLimitKeyFor(request, user.id)}:checkout`, 10, 10 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const plan = body?.plan as PlanKey | undefined;
  if (!plan || !Object.hasOwn(PLANS, plan)) {
    return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
  }

  const gateway = gatewayFor(request);
  if (!gateway) {
    return NextResponse.json(
      { error: "Checkout isn't configured yet - set PAYMENTS_LK_SECRET_KEY or the PADDLE_* keys in the environment." },
      { status: 501 }
    );
  }
  const priceId = gateway === "paddle" ? priceIdFor(plan) : undefined;
  if (gateway === "paddle" && !priceId) {
    return NextResponse.json(
      { error: `Checkout isn't configured for this plan yet - set PADDLE_PRICE_${plan.toUpperCase()}.` },
      { status: 501 }
    );
  }

  const { amountCents, usdCents, credits, label, period, tier } = PLANS[plan];
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
  const admin = createServiceClient();

  // grant_paid_credits switches the account to the purchased tier, so a
  // lower pass bought during an active higher one would cut it short.
  if (tier) {
    const { data: profile } = await admin.from("profiles").select("plan, plan_expires_at").eq("id", user.id).single();
    const current = profile ? toTier(effectivePlan(profile)) : "free";
    if (TIERS.indexOf(current) > TIERS.indexOf(tier)) {
      const name = TIER_LABELS[current];
      return NextResponse.json(
        { error: `You already have ${name}, which includes everything in ${TIER_LABELS[tier]}. Renew ${name} or buy a credit pack instead.` },
        { status: 409 }
      );
    }
  }

  // The order is recorded here first and its id travels with the checkout
  // (Payments.lk's `reference`, Paddle's custom_data.order_id). The webhook
  // reads it back to find which account to credit and how much - the plan,
  // credits and price are fixed now, server side, never taken from anything
  // the browser or the redirect sends.
  const { data: order, error: orderError } = await admin
    .from("payment_orders")
    .insert({
      user_id: user.id,
      plan,
      credits,
      provider: gateway,
      ...(gateway === "paddle"
        ? { amount_cents: usdCents, currency: "USD" }
        : { amount_cents: amountCents, currency: "LKR" }),
    })
    .select("id")
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Could not record the order." }, { status: 500 });
  }

  if (gateway === "paddle") {
    try {
      const { data: profile } = await admin.from("profiles").select("paddle_customer_id").eq("id", user.id).single();
      const txn = await createTransaction({
        priceId: priceId!,
        customData: { order_id: order.id, user_id: user.id },
        customerId: profile?.paddle_customer_id,
      });
      await admin.from("payment_orders").update({ checkout_id: txn.id }).eq("id", order.id);
      // Paddle.js opens this in its overlay; the email prefills the checkout
      // when Paddle doesn't already know the customer.
      return NextResponse.json({
        paddle: {
          transactionId: txn.id,
          email: profile?.paddle_customer_id ? null : (user.email ?? null),
          successUrl: `${siteUrl}/pricing?success=1&plan=${plan}`,
        },
      });
    } catch (e) {
      await admin.from("payment_orders").update({ status: "failed" }).eq("id", order.id);
      console.error("Paddle transaction creation failed", e);
      const message =
        e instanceof PaddleError
          ? `Paddle checkout creation failed: ${e.message}${e.code ? ` [${e.code}]` : ""}`
          : "Paddle checkout creation failed.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  try {
    const checkout = await createCheckout(
      {
        amountCents,
        description: period
          ? `WipeClip ${label} (${period === "year" ? "yearly" : "monthly"}) - ${credits} AI credits`
          : `WipeClip ${label} - ${credits} AI credits`,
        reference: order.id,
        customer: checkoutCustomer(user.email, user.user_metadata),
        successUrl: `${siteUrl}/pricing?success=1&plan=${plan}`,
        cancelUrl: `${siteUrl}/pricing?canceled=1`,
      },
      `order-${order.id}`
    );

    await admin.from("payment_orders").update({ checkout_id: checkout.id }).eq("id", order.id);

    return NextResponse.json({ url: checkout.url });
  } catch (e) {
    await admin.from("payment_orders").update({ status: "failed" }).eq("id", order.id);
    console.error("Payments.lk checkout creation failed", e);
    const message =
      e instanceof PaymentsLkError
        ? `Payments.lk checkout creation failed: ${e.message}${e.reason ? ` [${e.reason}]` : ""}${e.traceId ? ` (trace ${e.traceId})` : ""}`
        : "Payments.lk checkout creation failed.";
    // 500, not 502: Cloudflare in front of the site swaps an origin 502 for
    // its own HTML error page, which hides this message from the browser.
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
