import type { Resolution } from "./toolsApi";
import type { Tier } from "./entitlements";

/** Video AI cleanup is charged per started minute of the part processed,
 * times this per-resolution multiplier: a 20s 720p clip costs 1 credit, a
 * 10-minute 1080p video 20. Compute grows with both length and resolution,
 * so a flat per-job price let one credit buy a 10-minute job. */
export const RESOLUTION_CREDIT_COST: Record<Resolution, number> = {
  "720p": 1,
  "1080p": 2,
  "4k": 4,
};

/** Longest single video cleanup job per plan, in seconds; "anon" is the
 * signed-out free preview. The backend's MAX_VIDEO_DURATION_SECONDS (600)
 * stays the absolute ceiling. */
export const MAX_CLEANUP_SECONDS: Record<Tier | "anon", number> = {
  anon: 30,
  free: 60,
  lite: 180,
  starter: 300,
  pro: 600,
};

/** Started minutes billed for `seconds` of video, at least 1. Half a second
 * of slack so rounding (browser vs ffprobe durations) right at a whole
 * minute doesn't start a new one. */
export function billedMinutes(seconds: number): number {
  return Math.max(1, Math.ceil((seconds - 0.5) / 60));
}

/** Credits for cleaning `seconds` of video at `resolution`. */
export function videoCreditCost(resolution: Resolution, seconds: number): number {
  return billedMinutes(seconds) * RESOLUTION_CREDIT_COST[resolution];
}

/** "30 s", "1 min", "10 min" for a MAX_CLEANUP_SECONDS value. */
export function formatCleanupLimit(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : `${seconds / 60} min`;
}

export const FREE_DAILY_CREDITS = 2;

// Flat cost for the image tool - no resolution tiers, unlike video.
export const IMAGE_CREDIT_COST = 1;

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
    priceLabel: "$2.99",
    usdCents: 299,
    amountCents: 90000,
    credits: 30,
    tier: "lite",
    period: "month",
    days: 30,
  },
  lite_yearly: {
    label: "Lite",
    priceLabel: "$24.99",
    usdCents: 2499,
    amountCents: 750000,
    credits: 360,
    tier: "lite",
    period: "year",
    days: 365,
  },
  starter: {
    label: "Starter",
    priceLabel: "$7.99",
    usdCents: 799,
    amountCents: 240000,
    credits: 100,
    tier: "starter",
    period: "month",
    days: 30,
  },
  starter_yearly: {
    label: "Starter",
    priceLabel: "$69.99",
    usdCents: 6999,
    amountCents: 2100000,
    credits: 1200,
    tier: "starter",
    period: "year",
    days: 365,
  },
  pro: {
    label: "Pro",
    priceLabel: "$16.99",
    usdCents: 1699,
    amountCents: 510000,
    credits: 300,
    tier: "pro",
    period: "month",
    days: 30,
  },
  pro_yearly: {
    label: "Pro",
    priceLabel: "$149.99",
    usdCents: 14999,
    amountCents: 4500000,
    credits: 3600,
    tier: "pro",
    period: "year",
    days: 365,
  },
  // For buyers who only need the AI tools: about $0.08 a credit, cheaper
  // than Lite, without a plan's editor features.
  payg: { label: "AI Credit Pack", priceLabel: "$4.99", usdCents: 499, amountCents: 150000, credits: 60, tier: null, period: null, days: null },
  // Retired: no longer offered. Kept so orders already recorded under this
  // key still resolve in the webhooks and the admin panel.
  creator: { label: "Mini Credit Pack", priceLabel: "$1.99", usdCents: 199, amountCents: 60000, credits: 15, tier: null, period: null, days: null },
} as const;

/** "Rs. 2,700" from 270000 cents. */
export function formatLkr(amountCents: number): string {
  return `Rs. ${(amountCents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export type PlanKey = keyof typeof PLANS;
