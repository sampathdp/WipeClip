import type { Metadata } from "next";
import PricingClient from "./PricingClient";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Pricing",
  description:
    "WipeClip's video editor is free forever. Paid passes from $1.99 for 30 days unlock premium transitions, filters and effects, up to 4K resolution and more AI credits. One-time payments, 30 days or 1 year, no subscription.",
  path: "/pricing",
  ogTitle: "WipeClip.co Pricing: Free & Paid Plans",
  ogDescription:
    "Free video editor for Windows and Mac. Upgrade for premium effects, 4K exports and more AI credits.",
});

export default function PricingPage() {
  return <PricingClient />;
}
