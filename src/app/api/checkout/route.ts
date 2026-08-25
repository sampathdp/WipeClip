import { NextRequest, NextResponse } from "next/server";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { PLANS, type PlanKey } from "@/lib/credits";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";

const VARIANT_ENV: Record<PlanKey, string | undefined> = {
  starter: process.env.LEMONSQUEEZY_VARIANT_STARTER,
  pro: process.env.LEMONSQUEEZY_VARIANT_PRO,
  payg: process.env.LEMONSQUEEZY_VARIANT_PAYG,
};

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
  if (!plan || !(plan in PLANS)) {
    return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
  }

  const variantId = VARIANT_ENV[plan];
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;

  if (!variantId || !storeId || !apiKey) {
    return NextResponse.json(
      {
        error:
          "Checkout isn't configured yet - set LEMONSQUEEZY_STORE_ID, LEMONSQUEEZY_API_KEY and LEMONSQUEEZY_VARIANT_* in the environment.",
      },
      { status: 501 }
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;

  // custom_data is echoed back verbatim in every webhook event for this
  // checkout (meta.custom_data) - it's how the webhook handler knows which
  // account to credit and by how much, without needing to look up the
  // variant -> plan mapping again at grant time.
  const res = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
    method: "POST",
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email: user.email,
            custom: {
              user_id: user.id,
              plan,
              credits: String(PLANS[plan].credits),
            },
          },
          product_options: {
            redirect_url: `${siteUrl}/pricing?success=1&plan=${plan}`,
          },
        },
        relationships: {
          store: { data: { type: "stores", id: storeId } },
          variant: { data: { type: "variants", id: variantId } },
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Lemon Squeezy checkout creation failed: ${text.slice(0, 300)}` },
      { status: 502 }
    );
  }

  const json = await res.json();
  const url = json?.data?.attributes?.url;
  if (!url) {
    return NextResponse.json({ error: "Lemon Squeezy did not return a checkout URL." }, { status: 502 });
  }

  return NextResponse.json({ url });
}
