import type { Metadata } from "next";
import PricingClient from "./PricingClient";
import PricingFaq from "./PricingFaq";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Pricing: Free Video Editor, Passes From $1.99",
  description:
    "WipeClip is free forever. Optional one-time passes from $1.99 for 30 days add premium effects, 4K exports and more AI credits. No subscription.",
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
