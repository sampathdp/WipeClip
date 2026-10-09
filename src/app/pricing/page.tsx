import type { Metadata } from "next";
import PricingClient from "./PricingClient";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Pricing",
  description:
    "WipeClip's video editor is free forever. Paid plans from $1.99 a month unlock premium transitions, filters and effects, up to 4K resolution and more AI credits. Monthly or yearly.",
  path: "/pricing",
  ogTitle: "WipeClip.co Pricing: Free & Paid Plans",
  ogDescription:
    "Free online video editor. Upgrade for premium effects, 4K exports and more AI credits.",
});

export default function PricingPage() {
  return <PricingClient />;
}
