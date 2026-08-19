import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// Events that mean "grant the credits from custom_data.credits" - covers
// both a one-time PAYG order and the first payment of a new subscription.
const GRANT_EVENTS = new Set(["order_created", "subscription_payment_success"]);

// Events that mean the subscription is no longer active. We don't claw
// back credits already granted - only stop future renewal grants - since
// the customer already paid for what they've received.
const DOWNGRADE_EVENTS = new Set(["subscription_cancelled", "subscription_expired"]);

function isValidSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    // Fails closed: without a configured secret we cannot verify the
    // request came from Lemon Squeezy, so refuse rather than trust it.
    return NextResponse.json({ error: "Webhook secret not configured." }, { status: 501 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-signature");

  if (!isValidSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const eventName: string | undefined = payload?.meta?.event_name;
  const customData = payload?.meta?.custom_data ?? {};
  const eventId: string | undefined = payload?.data?.id ? `${eventName}:${payload.data.id}` : undefined;

  const userId = customData.user_id as string | undefined;
  const plan = customData.plan as string | undefined;
  const credits = customData.credits ? Number(customData.credits) : undefined;

  if (!eventName || !eventId) {
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  const supabase = createServiceClient();

  if (GRANT_EVENTS.has(eventName)) {
    if (!userId || !credits) {
      // No custom_data means this checkout wasn't created through our
      // /api/checkout route (e.g. a manually shared product link) - there's
      // no account to credit, so acknowledge and move on rather than error.
      return NextResponse.json({ ok: true, skipped: "no custom_data" });
    }
    const { error } = await supabase.rpc("grant_paid_credits", {
      p_user_id: userId,
      p_amount: credits,
      p_event_id: eventId,
      p_plan: plan === "starter" || plan === "pro" ? plan : null,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else if (DOWNGRADE_EVENTS.has(eventName) && userId) {
    await supabase.from("profiles").update({ plan: "free" }).eq("id", userId);
  }

  return NextResponse.json({ ok: true });
}
