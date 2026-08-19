import type { Metadata } from "next";
import PricingClient from "./PricingClient";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Free 720p watermark removal with 2 credits a day. Upgrade to Starter, Pro or a one-time Pay-As-You-Go pack for 4K exports, batch processing and priority rendering.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "WipeClip.co Pricing — Free & Paid Plans",
    description:
      "Free 720p watermark removal with 2 credits a day. Upgrade for 4K exports, batch processing and priority rendering.",
    url: "/pricing",
  },
  twitter: {
    title: "WipeClip.co Pricing — Free & Paid Plans",
    description:
      "Free 720p watermark removal with 2 credits a day. Upgrade for 4K exports, batch processing and priority rendering.",
  },
};

export default function PricingPage() {
  return <PricingClient />;
}
