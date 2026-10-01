import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { constructWebhookEvent } from "@/lib/paymentsLk";
import { PLANS } from "@/lib/credits";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  // Trimmed: a secret pasted into Vercel with a trailing space or newline
  // would otherwise never match any signature.
  const secret = process.env.PAYMENTS_LK_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // Fails closed: without a configured secret we cannot verify the
    // request came from Payments.lk, so refuse rather than trust it.
    return NextResponse.json({ error: "Webhook secret not configured." }, { status: 501 });
  }

  const rawBody = await request.text();
  const verified = constructWebhookEvent(rawBody, request.headers.get("payments-signature"), secret);
  if ("error" in verified) {
    console.warn("Payments.lk webhook rejected:", verified.error);
    return NextResponse.json({ error: verified.error }, { status: 400 });
  }
  const { event } = verified;

  const supabase = createServiceClient();

  if (event.type === "payment.succeeded") {
    const payment = event.data;
    if (!payment.reference || !UUID_RE.test(payment.reference)) {
      // Not created through /api/checkout (e.g. a payment link shared from
      // the dashboard) - no account to credit, so acknowledge and move on.
      return NextResponse.json({ ok: true, skipped: "no order reference" });
    }

    const { data: order } = await supabase
      .from("payment_orders")
      .select("id, user_id, plan, credits, amount_cents")
      .eq("id", payment.reference)
      .single();

    if (!order) {
      return NextResponse.json({ ok: true, skipped: "unknown order" });
    }
    if (payment.amountCents < order.amount_cents) {
      // The amount is set server side at checkout creation, so this should
      // never happen - refuse to grant rather than under-charge silently.
      return NextResponse.json({ error: "Paid amount is below the order amount." }, { status: 422 });
    }

    // Subscriptions are sold as monthly or yearly passes: Payments.lk has no
    // subscription object (renewals would need saved cards on Payable's
    // Advanced plan), so each purchase grants the credits and the tier for
    // the plan's days. The order's plan key was fixed server side at checkout.
    const def = Object.hasOwn(PLANS, order.plan) ? PLANS[order.plan as keyof typeof PLANS] : null;
    // Keyed on the payment, not the event, so a payment delivered under two
    // event ids still grants once.
    const { error } = await supabase.rpc("grant_paid_credits", {
      p_user_id: order.user_id,
      p_amount: order.credits,
      p_event_id: `payments_lk:${payment.id}`,
      p_plan: def?.tier ?? null,
      p_plan_days: def?.days ?? null,
    });
    if (error) {
      // Non-2xx makes Payments.lk retry; the grant is idempotent on the id.
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase
      .from("payment_orders")
      .update({ status: "paid", payment_id: payment.id, paid_at: new Date().toISOString() })
      .eq("id", order.id);
  } else if (event.type === "payment.failed") {
    const reference = event.data.reference;
    if (reference && UUID_RE.test(reference)) {
      await supabase.from("payment_orders").update({ status: "failed" }).eq("id", reference).neq("status", "paid");
    }
  } else if (event.type === "checkout.expired") {
    await supabase.from("payment_orders").update({ status: "expired" }).eq("checkout_id", event.data.id).eq("status", "open");
  }

  return NextResponse.json({ ok: true });
}
