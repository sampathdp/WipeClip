import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
import { LATEST_RELEASE } from "@/lib/releases";
import { AI_CLEANUP_ENABLED } from "@/lib/features";
import { languageAlternates, localeHref, LOCALES } from "@/lib/i18n";

const siteUrl = SITE_URL;

// Pages that 404 while the AI cleanup feature is switched off.
const CLEANUP_PATHS = [
  "/image-cleanup",
  "/guides",
  "/guides/does-ai-cleanup-reduce-video-quality",
  "/guides/how-ai-video-inpainting-works",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [
    {
      url: siteUrl,
      lastModified: "2026-11-03",
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
      lastModified: "2026-11-03",
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/whats-new`,
      lastModified: LATEST_RELEASE.date,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${siteUrl}/tools`,
      lastModified: "2026-10-24",
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/guides`,
      lastModified: "2026-10-24",
      changeFrequency: "monthly",
      priority: 0.6,
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
  const live = AI_CLEANUP_ENABLED ? entries : entries.filter((e) => !CLEANUP_PATHS.some((p) => e.url === `${siteUrl}${p}`));
  // Every translated page is listed once per language, and each version
  // lists all of them (hreflang).
  return live.flatMap((entry) => {
    const enPath = entry.url.slice(siteUrl.length) || "/";
    const languages = languageAlternates(enPath);
    if (!languages) return [entry];
    const alternates = {
      languages: Object.fromEntries(Object.entries(languages).map(([l, path]) => [l, `${siteUrl}${path}`])),
    };
    return [
      { ...entry, alternates },
      ...LOCALES.map((l) => ({ ...entry, url: `${siteUrl}${localeHref(l, enPath)}`, alternates })),
    ];
  });
}
