import type { Metadata } from "next";
import WatermarkLandingTemplate from "@/components/WatermarkLandingTemplate";
import { getWatermarkPlatform } from "@/lib/watermarkPlatforms";
import { buildPageMetadata } from "@/lib/seo";

const content = getWatermarkPlatform("remove-kapwing-watermark")!;

export const metadata: Metadata = buildPageMetadata({
  title: content.metaTitle,
  description: content.metaDescription,
  path: `/${content.slug}`,
});

export default function Page() {
  return <WatermarkLandingTemplate content={content} />;
}
