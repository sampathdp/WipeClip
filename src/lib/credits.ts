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
export const PLANS = {
  starter: { label: "Starter", priceLabel: "$8.99/mo", amountCents: 270000, credits: 60 },
  pro: { label: "Pro", priceLabel: "$23.99/mo", amountCents: 720000, credits: 200 },
  payg: { label: "Pay-as-you-go", priceLabel: "$5.99", amountCents: 180000, credits: 30 },
  creator: { label: "Creator", priceLabel: "$1.99", amountCents: 60000, credits: 15 },
} as const;

/** "Rs. 2,700" from 270000 cents. */
export function formatLkr(amountCents: number): string {
  return `Rs. ${(amountCents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export type PlanKey = keyof typeof PLANS;
