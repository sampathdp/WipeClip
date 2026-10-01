import type { Metadata } from "next";
import PricingClient from "./PricingClient";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Pricing",
  description:
    "WipeClip's video editor is free forever. Starter and Pro unlock premium transitions, filters and effects, 1080p or 4K exports without the WipeClip mark, and more AI credits. Monthly or yearly.",
  path: "/pricing",
  ogTitle: "WipeClip.co Pricing: Free & Paid Plans",
  ogDescription:
    "Free online video editor. Upgrade for premium effects, 4K exports without the WipeClip mark, and more AI credits.",
});

export default function PricingPage() {
  return <PricingClient />;
}
