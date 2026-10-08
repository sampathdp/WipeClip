import type { Resolution } from "./toolsApi";

export const RESOLUTION_CREDIT_COST: Record<Resolution, number> = {
  "720p": 1,
  "1080p": 2,
  "4k": 4,
};

export const FREE_DAILY_CREDITS = 2;

// Flat cost for the image tool - no resolution tiers, unlike video.
export const IMAGE_CREDIT_COST = 1;

// Editor auto captions (speech-to-text over the whole timeline).
export const CAPTIONS_CREDIT_COST = 1;

// Sri Lankan visitors pay through Payments.lk, which only charges in rupees:
// amountCents is what its hosted checkout bills (whole cents of LKR - Rs.
// 600 is 60000). Everyone else pays through Paddle, which bills the price
// set in the Paddle catalog (PADDLE_PRICE_<PLAN>, see src/lib/paddle.ts);
// usdCents records that price on the order and must match it, as must the
// display-only priceLabel. Keep all of them in sync when changing any.
//
// Subscriptions (`tier` set) unlock that tier's editor features (see
// src/lib/entitlements.ts) for `days` and grant their AI credits up front.
// Payments.lk has no recurring billing, and the Paddle prices are one-time
// (no billing cycle) to match, so each one is a pass that the customer
// renews themselves; a renewal before expiry stacks on the time
// left. Credit packs only add AI credits and never change the tier.
export const PLANS = {
  lite: {
    label: "Lite",
    priceLabel: "$1.99",
    usdCents: 199,
    amountCents: 60000,
    credits: 15,
    tier: "lite",
    period: "month",
    days: 30,
  },
  lite_yearly: {
    label: "Lite",
    priceLabel: "$17.99",
    usdCents: 1799,
    amountCents: 540000,
    credits: 180,
    tier: "lite",
    period: "year",
    days: 365,
  },
  starter: {
    label: "Starter",
    priceLabel: "$8.99",
    usdCents: 899,
    amountCents: 270000,
    credits: 60,
    tier: "starter",
    period: "month",
    days: 30,
  },
  starter_yearly: {
    label: "Starter",
    priceLabel: "$79.99",
    usdCents: 7999,
    amountCents: 2400000,
    credits: 720,
    tier: "starter",
    period: "year",
    days: 365,
  },
  pro: {
    label: "Pro",
    priceLabel: "$23.99",
    usdCents: 2399,
    amountCents: 720000,
    credits: 200,
    tier: "pro",
    period: "month",
    days: 30,
  },
  pro_yearly: {
    label: "Pro",
    priceLabel: "$199.99",
    usdCents: 19999,
    amountCents: 6000000,
    credits: 2400,
    tier: "pro",
    period: "year",
    days: 365,
  },
  payg: { label: "AI Credit Pack", priceLabel: "$5.99", usdCents: 599, amountCents: 180000, credits: 30, tier: null, period: null, days: null },
  creator: { label: "Mini Credit Pack", priceLabel: "$1.99", usdCents: 199, amountCents: 60000, credits: 15, tier: null, period: null, days: null },
} as const;

/** "Rs. 2,700" from 270000 cents. */
export function formatLkr(amountCents: number): string {
  return `Rs. ${(amountCents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export type PlanKey = keyof typeof PLANS;
