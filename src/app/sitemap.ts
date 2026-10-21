import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
import { AI_CLEANUP_ENABLED } from "@/lib/features";

const siteUrl = SITE_URL;

// Pages that 404 while the AI cleanup feature is switched off.
const CLEANUP_PATHS = [
  "/image-cleanup",
  "/guides/does-ai-cleanup-reduce-video-quality",
  "/guides/how-ai-video-inpainting-works",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [
    {
      url: siteUrl,
      lastModified: "2026-10-21",
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/pricing`,
      lastModified: "2026-10-21",
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/about`,
      lastModified: "2026-10-21",
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/download`,
      lastModified: "2026-10-21",
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/image-cleanup`,
      lastModified: "2026-10-01",
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/remove-background`,
      lastModified: "2026-10-21",
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/extract-video-frame`,
      lastModified: "2026-10-21",
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/sharpen-image`,
      lastModified: "2026-10-21",
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/guides/does-ai-cleanup-reduce-video-quality`,
      lastModified: "2026-10-01",
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${siteUrl}/guides/how-ai-video-inpainting-works`,
      lastModified: "2026-10-01",
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${siteUrl}/feedback`,
      lastModified: "2026-10-01",
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${siteUrl}/terms`,
      lastModified: "2026-10-21",
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/refund-policy`,
      lastModified: "2026-10-01",
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/privacy`,
      lastModified: "2026-10-21",
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
  if (AI_CLEANUP_ENABLED) return entries;
  return entries.filter((e) => !CLEANUP_PATHS.some((p) => e.url === `${siteUrl}${p}`));
}
