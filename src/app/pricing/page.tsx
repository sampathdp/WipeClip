import type { Metadata } from "next";
import PricingClient from "./PricingClient";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Pricing",
  description:
    "Free 720p video cleanup with 2 credits a day. Upgrade to Starter, Pro or a one-time Pay-As-You-Go pack for 4K exports, batch processing and priority rendering.",
  path: "/pricing",
  ogTitle: "WipeClip.co Pricing: Free & Paid Plans",
  ogDescription:
    "Free 720p video cleanup with 2 credits a day. Upgrade for 4K exports, batch processing and priority rendering.",
});

export default function PricingPage() {
  return <PricingClient />;
}
