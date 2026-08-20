import type { MetadataRoute } from "next";
import { WATERMARK_PLATFORMS } from "@/lib/watermarkPlatforms";

const siteUrl = "https://wipeclip.co";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl,
      lastModified: "2026-08-20",
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/pricing`,
      lastModified: "2026-08-20",
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/remove-image-watermark`,
      lastModified: "2026-08-20",
      changeFrequency: "weekly",
      priority: 0.8,
    },
    ...WATERMARK_PLATFORMS.map((p) => ({
      url: `${siteUrl}/${p.slug}`,
      lastModified: "2026-08-20",
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    {
      url: `${siteUrl}/terms`,
      lastModified: "2026-08-19",
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/privacy`,
      lastModified: "2026-08-19",
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/dmca`,
      lastModified: "2026-08-19",
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
