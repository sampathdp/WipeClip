import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { PLANS, type PlanKey } from "@/lib/credits";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";
import { effectivePlan } from "@/lib/plan";
import { TIER_LABELS, TIERS, toTier } from "@/lib/entitlements";
import { createCheckout, getSecretKey, PaymentsLkError } from "@/lib/paymentsLk";

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

  if (!getSecretKey()) {
    return NextResponse.json(
      { error: "Checkout isn't configured yet - set PAYMENTS_LK_SECRET_KEY in the environment." },
      { status: 501 }
    );
  }

  const { amountCents, credits, label, period, tier } = PLANS[plan];
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

  // Payments.lk has no free-form metadata on a checkout, so the order is
  // recorded here first and its id travels as the checkout's `reference`.
  // The webhook reads the reference back to find which account to credit
  // and how much - the plan, credits and price are fixed now, server side,
  // never taken from anything the browser or the redirect sends.
  const { data: order, error: orderError } = await admin
    .from("payment_orders")
    .insert({ user_id: user.id, plan, credits, amount_cents: amountCents })
    .select("id")
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Could not record the order." }, { status: 500 });
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
