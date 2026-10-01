import type { Resolution } from "./toolsApi";

export const RESOLUTION_CREDIT_COST: Record<Resolution, number> = {
  "720p": 1,
  "1080p": 2,
  "4k": 4,
};

export const FREE_DAILY_CREDITS = 2;

// Flat cost for the image tool - no resolution tiers, unlike video.
export const IMAGE_CREDIT_COST = 1;

// Payments.lk only charges in Sri Lankan rupees, so amountCents is what the
// hosted checkout actually bills (whole cents of LKR - Rs. 600 is 60000).
// priceLabel is display-only; keep the two in sync when changing either.
//
// Subscriptions (`tier` set) unlock that tier's editor features (see
// src/lib/entitlements.ts) for `days` and grant their AI credits up front.
// Payments.lk has no recurring billing, so each one is a pass that the
// customer renews themselves; a renewal before expiry stacks on the time
// left. Credit packs only add AI credits and never change the tier.
export const PLANS = {
  starter: {
    label: "Starter",
    priceLabel: "$8.99",
    amountCents: 270000,
    credits: 60,
    tier: "starter",
    period: "month",
    days: 30,
  },
  starter_yearly: {
    label: "Starter",
    priceLabel: "$79.99",
    amountCents: 2400000,
    credits: 720,
    tier: "starter",
    period: "year",
    days: 365,
  },
  pro: {
    label: "Pro",
    priceLabel: "$23.99",
    amountCents: 720000,
    credits: 200,
    tier: "pro",
    period: "month",
    days: 30,
  },
  pro_yearly: {
    label: "Pro",
    priceLabel: "$199.99",
    amountCents: 6000000,
    credits: 2400,
    tier: "pro",
    period: "year",
    days: 365,
  },
  payg: { label: "AI Credit Pack", priceLabel: "$5.99", amountCents: 180000, credits: 30, tier: null, period: null, days: null },
  creator: { label: "Mini Credit Pack", priceLabel: "$1.99", amountCents: 60000, credits: 15, tier: null, period: null, days: null },
} as const;

/** "Rs. 2,700" from 270000 cents. */
export function formatLkr(amountCents: number): string {
  return `Rs. ${(amountCents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export type PlanKey = keyof typeof PLANS;
