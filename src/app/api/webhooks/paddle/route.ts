import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { clientIp } from "@/lib/clientIp";
import {
  constructWebhookEvent,
  isPaddleWebhookIp,
  paddleEnvironment,
  priceIdFor,
  transactionPriceIds,
  type PaddleAdjustment,
} from "@/lib/paddle";
import { PLANS } from "@/lib/credits";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The address the delivery came from: the real sender even with
 * Cloudflare in front (see src/lib/clientIp.ts). PADDLE_WEBHOOK_IP_HEADER,
 * if set, names a header to read instead, for other proxies. */
function sourceIp(request: NextRequest): string | null {
  const header = process.env.PADDLE_WEBHOOK_IP_HEADER?.trim();
  if (!header) return clientIp(request.headers);
  return request.headers.get(header)?.split(",")[0].trim() || null;
}

export async function POST(request: NextRequest) {
  // Trimmed: a secret pasted into Vercel with a trailing space or newline
  // would otherwise never match any signature.
  const secret = process.env.PADDLE_WEBHOOK_SECRET?.trim();
  const environment = paddleEnvironment();
  if (!secret || !environment) {
    // Fails closed: without a configured secret we cannot verify the
    // request came from Paddle, so refuse rather than trust it.
    return NextResponse.json({ error: "Paddle webhook not configured." }, { status: 501 });
  }

  const ip = sourceIp(request);
  if (!(await isPaddleWebhookIp(ip, environment))) {
    console.warn(`Paddle webhook rejected: ${ip ?? "no IP"} is not one of Paddle's ${environment} webhook IPs.`);
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const rawBody = await request.text();
  const verified = constructWebhookEvent(rawBody, request.headers.get("paddle-signature"), secret);
  if ("error" in verified) {
    console.warn("Paddle webhook rejected:", verified.error);
    return NextResponse.json({ error: verified.error }, { status: 400 });
  }
  const { event } = verified;

  if (event.event_type === "adjustment.created" || event.event_type === "adjustment.updated") {
    return handleAdjustment(event.data as unknown as PaddleAdjustment);
  }

  if (event.event_type !== "transaction.completed") {
    // Only completed transactions grant anything; acknowledge the rest so
    // Paddle doesn't retry them.
    return NextResponse.json({ ok: true, skipped: event.event_type });
  }

  const txn = event.data;
  const orderId = txn.custom_data?.order_id;
  if (typeof orderId !== "string" || !UUID_RE.test(orderId)) {
    // Not created through /api/checkout (e.g. a payment link made in the
    // dashboard) - no account to credit, so acknowledge and move on.
    return NextResponse.json({ ok: true, skipped: "no order reference" });
  }

  const supabase = createServiceClient();
  const { data: order } = await supabase
    .from("payment_orders")
    .select("id, user_id, plan, credits, provider")
    .eq("id", orderId)
    .single();

  if (!order || order.provider !== "paddle") {
    return NextResponse.json({ ok: true, skipped: "unknown order" });
  }

  const def = Object.hasOwn(PLANS, order.plan) ? PLANS[order.plan as keyof typeof PLANS] : null;
  const expectedPrice = def ? priceIdFor(order.plan as keyof typeof PLANS) : undefined;
  if (!expectedPrice || !transactionPriceIds(txn).includes(expectedPrice)) {
    // The price is set server side when the transaction is created, so this
    // should never happen - refuse to grant rather than give away a plan.
    return NextResponse.json({ error: "Transaction price does not match the order's plan." }, { status: 422 });
  }

  // Same pass model as Payments.lk: grant the credits and the tier for the
  // plan's days. Keyed on the transaction, not the event, so a transaction
  // delivered under two event ids still grants once.
  const { error } = await supabase.rpc("grant_paid_credits", {
    p_user_id: order.user_id,
    p_amount: order.credits,
    p_event_id: `paddle:${txn.id}`,
    p_plan: def?.tier ?? null,
    p_plan_days: def?.days ?? null,
  });
  if (error) {
    // Non-2xx makes Paddle retry; the grant is idempotent on the id.
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The order was recorded in USD, but a buyer in a country with a local
  // price override pays in that currency - keep what was actually charged.
  const grandTotal = Number(txn.details?.totals?.grand_total);
  await supabase
    .from("payment_orders")
    .update({
      status: "paid",
      payment_id: txn.id,
      paid_at: new Date().toISOString(),
      ...(txn.currency_code && Number.isInteger(grandTotal) ? { currency: txn.currency_code, amount_cents: grandTotal } : {}),
    })
    .eq("id", order.id);

  // Remembered so later checkouts reuse the same Paddle customer and
  // Paddle.js can pass it to Retain as pwCustomer.
  if (txn.customer_id) {
    await supabase
      .from("profiles")
      .update({ paddle_customer_id: txn.customer_id })
      .eq("id", order.user_id)
      .is("paddle_customer_id", null);
  }

  return NextResponse.json({ ok: true });
}

/** A refund or chargeback on a purchase: takes back what it granted, so a
 * buyer can't pay, spend the credits, then get the money back and keep
 * them. Refunds arrive as adjustment.created (pending_approval) and then
 * adjustment.updated (approved); chargebacks arrive already approved. Only
 * an approved adjustment revokes anything, once per adjustment id. */
async function handleAdjustment(adj: PaddleAdjustment) {
  if (adj.action !== "refund" && adj.action !== "chargeback") {
    return NextResponse.json({ ok: true, skipped: `adjustment ${adj.action}` });
  }
  if (adj.status !== "approved") {
    return NextResponse.json({ ok: true, skipped: `adjustment ${adj.status}` });
  }

  const supabase = createServiceClient();
  const { data: order } = await supabase
    .from("payment_orders")
    .select("id, user_id, credits, amount_cents")
    .eq("provider", "paddle")
    .eq("payment_id", adj.transaction_id)
    .single();
  if (!order) {
    return NextResponse.json({ ok: true, skipped: "unknown transaction" });
  }

  // A partial refund takes back its share of the credits and leaves the
  // pass running; a full refund or any chargeback takes everything back.
  const full = adj.type !== "partial" || adj.action === "chargeback";
  const refunded = Number(adj.totals?.total);
  const credits =
    full || !Number.isFinite(refunded) || order.amount_cents <= 0
      ? order.credits
      : Math.min(order.credits, Math.ceil((order.credits * refunded) / order.amount_cents));

  const { error } = await supabase.rpc("revoke_paid_credits", {
    p_user_id: order.user_id,
    p_amount: credits,
    p_event_id: `paddle_adjustment:${adj.id}`,
    p_end_plan: full,
  });
  if (error) {
    // Non-2xx makes Paddle retry; the revoke is idempotent on the id.
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (full) {
    await supabase
      .from("payment_orders")
      .update({ status: adj.action === "chargeback" ? "charged_back" : "refunded" })
      .eq("id", order.id);
  }
  return NextResponse.json({ ok: true });
}
