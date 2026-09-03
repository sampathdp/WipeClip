import type { Resolution } from "./toolsApi";

export const RESOLUTION_CREDIT_COST: Record<Resolution, number> = {
  "720p": 1,
  "1080p": 2,
  "4k": 4,
};

export const FREE_DAILY_CREDITS = 2;

// Flat cost for the image tool - no resolution tiers, unlike video.
export const IMAGE_CREDIT_COST = 1;

export const PLANS = {
  starter: { label: "Starter", priceLabel: "$8.99/mo", credits: 60 },
  pro: { label: "Pro", priceLabel: "$23.99/mo", credits: 200 },
  payg: { label: "Pay-as-you-go", priceLabel: "$5.99", credits: 30 },
  creator: { label: "Creator", priceLabel: "$2.99", credits: 15 },
} as const;

export type PlanKey = keyof typeof PLANS;
