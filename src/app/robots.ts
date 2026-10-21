import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

const siteUrl = SITE_URL;

// Never useful in search or AI answers: API routes, the admin panel and
// sign-in callbacks. Account pages carry noindex instead, so they stay
// crawlable enough for that noindex to be seen.
const PRIVATE = ["/api/", "/admin", "/auth/"];

// AI search and answer engines, named so it's explicit they're welcome on
// the public pages: being quoted in AI answers is how a growing share of
// people find tools like this.
const AI_CRAWLERS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      { userAgent: AI_CRAWLERS, allow: "/", disallow: PRIVATE },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
