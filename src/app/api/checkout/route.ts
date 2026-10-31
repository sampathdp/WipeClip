import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { PLANS, type PlanKey } from "@/lib/credits";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";
import { effectivePlan } from "@/lib/plan";
import { PAYMENTS_ENABLED } from "@/lib/launch";
import { TIER_LABELS, TIERS, toTier } from "@/lib/entitlements";
import { createCheckout, PaymentsLkError } from "@/lib/paymentsLk";
import { createTransaction, getClientToken, PaddleError, paddleEnvironment, priceIdFor } from "@/lib/paddle";
import { gatewayFor, visitorCountry } from "@/lib/checkoutGateway";
import { currentPromo, discounted, promoBlockedReason, promoFor } from "@/lib/promo";
import { edgeCountry, rememberCountry } from "@/lib/geo";

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

/** The pricing page's promotion code check (GET ?promo=CODE): the offer's
 * percent, plans and end date if the code is the live one, or why not. Only
 * a matching code reveals that a promotion exists. Signed-in visitors also
 * learn here whether they've already used it; checkout checks again. */
async function checkPromoCode(code: string | null) {
  type Result = {
    promo: { percent: number; plans: PlanKey[]; endsAt: string } | null;
    promoError: string | null;
  };
  if (!code?.trim() || !isSupabaseConfigured()) return { promo: null, promoError: null } satisfies Result;
  const admin = createServiceClient();
  const live = await currentPromo(admin);
  if (!live || live.code.toUpperCase() !== code.trim().toUpperCase()) {
    return { promo: null, promoError: "That code isn't valid or has expired." } satisfies Result;
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const blocked = user ? await promoBlockedReason(admin, live, user.id) : null;
  if (blocked) return { promo: null, promoError: blocked } satisfies Result;
  return {
    promo: { percent: live.percent, plans: live.plans, endsAt: live.endsAt.toISOString() },
    promoError: null,
  } satisfies Result;
}

/** Which checkout this visitor gets, and what Paddle.js needs to run it:
 * the public client token, the environment, the price ID of each plan (for
 * Paddle.PricePreview's localized prices), the visitor's country from the
 * edge's geo header - null when there is none, so Paddle detects it from the
 * IP instead - and, for Paddle Retain, the signed-in user's Paddle customer
 * ID (ctm_...), once a purchase has recorded it. */
export async function GET(request: NextRequest) {
  const gateway = gatewayFor(request);
  const { promo, promoError } = await checkPromoCode(request.nextUrl.searchParams.get("promo"));
  if (gateway !== "paddle") return NextResponse.json({ gateway, paddle: null, promo, promoError });

  const priceIds: Partial<Record<PlanKey, string>> = {};
  for (const plan of Object.keys(PLANS) as PlanKey[]) {
    const id = priceIdFor(plan);
    if (id) priceIds[plan] = id;
  }

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
    promo,
    promoError,
    paddle: {
      clientToken: getClientToken(),
      environment: paddleEnvironment(),
      customerId,
      country: visitorCountry(request),
      priceIds,
    },
  });
}

export async function POST(request: NextRequest) {
  // Launch mode (src/lib/launch.ts): the pricing page shows the plans as
  // coming soon, and nothing can be bought until payments open.
  if (!PAYMENTS_ENABLED) {
    return NextResponse.json({ error: "Paid plans open later. Everything you need is free for now." }, { status: 403 });
  }
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
  // Where the buyer is as they press the pay button, kept on the order and
  // the account for the admin panel (Orders, Analytics).
  const country = edgeCountry(request.headers);
  await rememberCountry(admin, user.id, country, null);

  // grant_paid_credits switches the account to the purchased tier, so a
  // lower pass bought during an active higher one would cut it short.
  if (tier) {
    const { data: profile } = await admin.from("profiles").select("plan, plan_expires_at").eq("id", user.id).single();
    const current = profile ? toTier(effectivePlan(profile)) : "free";
    if (TIERS.indexOf(current) > TIERS.indexOf(tier)) {
      const name = TIER_LABELS[current];
      return NextResponse.json(
        { error: `You already have ${name}, which includes everything in ${TIER_LABELS[tier]}. Renew ${name} instead.` },
        { status: 409 }
      );
    }
  }

  // A promotion code from the pricing page (typed in, or from the newsletter
  // link). Checked here, never trusted from the browser: it must be the live
  // code, for this plan, and not already used by this account (once per
  // account). A used code is refused rather than silently charged in full,
  // so the buyer can remove it knowingly. Paddle needs its own discount
  // object, so without one a Paddle buyer pays the list price.
  let promo = await promoFor(admin, plan, body?.promo);
  if (promo && gateway === "paddle" && !promo.paddleDiscountId) promo = null;
  if (promo) {
    const blocked = await promoBlockedReason(admin, promo, user.id);
    if (blocked) return NextResponse.json({ error: blocked, promoBlocked: true }, { status: 409 });
  }
  const chargeCents = promo ? discounted(amountCents, promo.percent) : amountCents;
  const chargeUsdCents = promo ? discounted(usdCents, promo.percent) : usdCents;

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
      promo_code: promo?.code ?? null,
      country,
      ...(gateway === "paddle"
        ? { amount_cents: chargeUsdCents, currency: "USD" }
        : { amount_cents: chargeCents, currency: "LKR" }),
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
        discountId: promo?.paddleDiscountId,
      });
      await admin.from("payment_orders").update({ checkout_id: txn.id }).eq("id", order.id);
      // Paddle.js opens this in its overlay; the email prefills the checkout
      // when Paddle doesn't already know the customer.
      return NextResponse.json({
        paddle: {
          transactionId: txn.id,
          email: profile?.paddle_customer_id ? null : (user.email ?? null),
          successUrl: `${siteUrl}/welcome?plan=${plan}`,
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
        amountCents: chargeCents,
        description:
          (period
            ? `WipeClip ${label} (${period === "year" ? "yearly" : "monthly"}) - ${credits} AI credits`
            : `WipeClip ${label} - ${credits} AI credits`) + (promo ? ` (${promo.percent}% off)` : ""),
        reference: order.id,
        customer: checkoutCustomer(user.email, user.user_metadata),
        successUrl: `${siteUrl}/welcome?plan=${plan}`,
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
