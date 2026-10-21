import type { Metadata } from "next";
import PricingClient from "./PricingClient";
import PricingFaq from "./PricingFaq";
import { buildPageMetadata } from "@/lib/seo";
import { PLANS } from "@/lib/credits";

export const metadata: Metadata = buildPageMetadata({
  title: `Pricing: Free Video Editor, Passes From ${PLANS.lite.priceLabel}`,
  description:
    `WipeClip is free forever. Optional one-time passes from ${PLANS.lite.priceLabel} for 30 days add premium effects, 4K exports and more AI credits. No subscription.`,
  path: "/pricing",
  ogTitle: "WipeClip.co Pricing: Free & Paid Plans",
  ogDescription:
    "Free video editor for Windows and Mac. Upgrade for premium effects, 4K exports and more AI credits.",
});

export default function PricingPage() {
  return (
    <PricingClient>
      <PricingFaq />
    </PricingClient>
  );
}
