import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

const siteUrl = SITE_URL;

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
      url: `${siteUrl}/about`,
      lastModified: "2026-10-01",
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/editor`,
      lastModified: "2026-09-30",
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/image-cleanup`,
      lastModified: "2026-08-20",
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/remove-background`,
      lastModified: "2026-08-22",
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/extract-video-frame`,
      lastModified: "2026-08-22",
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/sharpen-image`,
      lastModified: "2026-08-22",
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/research`,
      lastModified: "2026-08-25",
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${siteUrl}/research/video-cleanup-test`,
      lastModified: "2026-08-25",
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${siteUrl}/guides/ai-inpainting-vs-blur-vs-crop`,
      lastModified: "2026-08-25",
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${siteUrl}/guides/does-ai-cleanup-reduce-video-quality`,
      lastModified: "2026-08-25",
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${siteUrl}/guides/how-ai-video-inpainting-works`,
      lastModified: "2026-08-25",
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
