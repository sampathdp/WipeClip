# SEO implementation report

Branch `feat/eu-localization`, 2026-10-24. Findings and their numbers are in `seo-audit.md`.

## Changes

### Performance
- `next.config.ts`: removed `experimental.inlineCss` (audit #1). The stylesheet is now a cached file instead of ~480 KB embedded in every HTML response.
- `next.config.ts`: long `Cache-Control` for public `mp4/webp/png/svg/vtt` (audit #9).

| Page (HTML bytes) | Live before | Local build after |
|---|---:|---:|
| `/` | 623,509 | 151,141 |
| `/remove-background` | 535,212 | 70,905 |

Compressed transfer of the live homepage was ~50 KB, so the main win is less HTML to parse on phones, plus CSS that stays cached across page views. Field Core Web Vitals need about 28 days of real traffic to show any change (Speed Insights / Search Console).

### Discoverability and internal links
- `src/lib/site-pages.ts` (new): single registry of tools (title, description, category, where it runs, related guides) and guides (title, description, dates). Respects the AI cleanup flag.
- `src/app/tools/page.tsx` (new): `/tools` directory, grouped into Video and Photos, with "Free in browser / Pro, in browser / Windows & Mac app" badges. ItemList and BreadcrumbList JSON-LD.
- `src/app/guides/page.tsx` (new): `/guides` hub. CollectionPage JSON-LD. Returns 404 when no guides are enabled.
- `src/components/RelatedTools.tsx` (new): "More tools" block on `/remove-background`, `/sharpen-image`, `/extract-video-frame` and `/image-cleanup`.
- `src/components/FreeTools.tsx`: homepage cards read from the registry and link to `/tools`.
- `src/components/Navbar.tsx`: "Free Tools" pill goes to `/tools` instead of `/#tools`.
- `src/components/Footer.tsx`: "All tools" and "Guides" links (plus the language links added earlier).
- Guide pages: title, description and dates come from the registry; breadcrumbs are now Home › Guides › Article.
- `src/app/sitemap.ts`: adds `/tools`, plus `/guides` when the flag is on.
- `src/app/llms.txt/route.ts`: lists `/tools`.

### Structured data
- `webApplicationJsonLd()` in `src/lib/seo.ts`; added to the four tool pages next to their existing FAQPage JSON-LD.

### Tooling
- `scripts/seo-check.mjs` + `npm run seo:check`: crawls a running build from its sitemap. Fails on non-200 pages, missing or duplicate titles or descriptions, a canonical that doesn't match the sitemap, noindex on a sitemap URL, H1 count ≠ 1, JSON-LD that doesn't parse, hreflang targets missing from the sitemap, and internal links that return ≥ 400. Needs no external services.

### Earlier on this branch (same release)
German, French, Spanish, Italian, Dutch and Polish versions of `/download` and the three free tools, with hreflang, `og:locale`, sitemap entries and footer links. Also a "VAT included" note on localized prices and a GDPR mention in the privacy policy.

## Decisions affecting URLs
- **New:** `/tools`, `/guides`, and the 24 translated URLs.
- **Unchanged:** every existing URL keeps its path and canonical.
- **Kept as 404:** the old "watermark" landing pages (audit #4). Not redirected, because no equivalent page exists and the use case is against current policy.
- `/editor` keeps its 308 to `/download`.

## Tests run
| Check | Result |
|---|---|
| `tsc --noEmit` | Pass |
| `eslint` on changed files | Pass |
| `next build` (flag on, as in production) | Pass; `/tools` and `/guides` prerendered static |
| `npm run seo:check` on local production build | Pass: 41 sitemap URLs, 42 internal links |
| `npm run seo:check` on live site | 1 problem: Cloudflare email-obfuscation link (audit #8, dashboard fix) |
| 390 px viewport overflow check (Chrome DevTools Protocol) on 12 pages | No page-level horizontal scroll |
| Translated routes, unknown locales and slugs | 200 / 404 as expected |

Not run: there is no unit or e2e suite for the website (`tests/` covers only the desktop app), so tool upload and processing flows were not exercised end to end. The tool components themselves were not modified, only the pages around them. No billable AI processing was triggered.

## Remaining limitations
- The production build was made with your uncommitted editor and recorder changes in the working tree. They are not part of these commits.
- The tools' own controls (upload box, buttons) are English on the translated pages.
- Search Console, Cloudflare and Paddle tasks need your access; see `search-console-checklist.md` and `seo-growth-plan.md`.
