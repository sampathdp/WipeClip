import type { Metadata } from "next";
import WatermarkLandingTemplate from "@/components/WatermarkLandingTemplate";
import { getWatermarkPlatform } from "@/lib/watermarkPlatforms";

const content = getWatermarkPlatform("remove-inshot-watermark")!;

export const metadata: Metadata = {
  title: content.metaTitle,
  description: content.metaDescription,
  alternates: { canonical: `/${content.slug}` },
  openGraph: {
    title: content.metaTitle,
    description: content.metaDescription,
    url: `/${content.slug}`,
  },
  twitter: {
    title: content.metaTitle,
    description: content.metaDescription,
  },
};

export default function Page() {
  return <WatermarkLandingTemplate content={content} />;
}
