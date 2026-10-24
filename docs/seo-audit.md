# WipeClip SEO audit

Date: 2026-10-24. Branch: `feat/eu-localization`.
Replaces the August audit in `SEO-AUDIT.md` / `FINAL-SEO-QA.md` at the repo root, which describes routes and a payment provider that no longer exist.

Evidence comes from the repository, a local production build (`next build` + `next start`, with `NEXT_PUBLIC_ENABLE_AI_CLEANUP=true` to match production), and live HTTP requests to `https://www.wipeclip.co` on 2026-10-24. Nothing here is a claim about Google's index; see `search-console-checklist.md` for what needs Search Console to confirm.

## Architecture

| Item | Finding |
|---|---|
| Framework | Next.js 16.4.2, App Router, React 19.2.8, TypeScript strict |
| Rendering | Marketing, tool and guide pages are statically prerendered; account, admin and API routes are dynamic |
| Hosting | Vercel origin behind Cloudflare (Cloudflare RUM beacon and `cf` headers observed live) |
| Request hook | `src/proxy.ts` (Supabase session refresh, maintenance rewrite) |
| Metadata | `buildPageMetadata()` in `src/lib/seo.ts`; root defaults and Organization/WebSite JSON-LD in `src/app/layout.tsx` |
| Robots / sitemap / llms.txt | `src/app/robots.ts`, `src/app/sitemap.ts`, `src/app/llms.txt/route.ts` |
| Feature flag | `NEXT_PUBLIC_ENABLE_AI_CLEANUP` gates `/image-cleanup`, both guides and the homepage cleanup demo; it is on in production |
| Analytics | Vercel Analytics + Speed Insights (cookieless), funnel events in `src/lib/analytics.ts`, Sentry; Cloudflare also injects its own RUM beacon |

## Route inventory (public, indexable)

| URL | Purpose | Rendered content in HTML | Structured data | Notes |
|---|---|---|---|---|
| `/` | Product home (desktop editor + tools) | Yes | Organization, WebSite, SoftwareApplication, FAQ | 623 KB HTML before this work (see P1) |
| `/download` | Desktop app landing + installers | Yes | SoftwareApplication, FAQ | Windows and macOS installers both exist (`src/lib/download.ts`) |
| `/pricing` | Plans | Yes | — | Localized prices client-side |
| `/about` | Company, how files are handled | Yes | — | |
| `/tools` | **New** tool directory | Yes | ItemList, BreadcrumbList | |
| `/remove-background` | Browser tool | Yes (copy + guide + FAQ server-rendered, tool is a client island) | FAQ, **WebApplication** (new) | |
| `/extract-video-frame` | Browser tool, on-device | Yes | FAQ, **WebApplication** (new) | On-device claim verified in `VideoFrameGrabberDemo.tsx` (canvas capture, no upload) |
| `/sharpen-image` | Browser tool | Yes | FAQ, **WebApplication** (new) | |
| `/image-cleanup` | Pro browser tool | Yes | FAQ, **WebApplication** (new) | 404 when the flag is off |
| `/guides` | **New** guides hub | Yes | CollectionPage, BreadcrumbList | 404 when the flag is off |
| `/guides/how-ai-video-inpainting-works` | Article | Yes | Article, BreadcrumbList | |
| `/guides/does-ai-cleanup-reduce-video-quality` | Article | Yes | Article, BreadcrumbList | |
| `/de`, `/fr`, `/es`, `/it`, `/nl`, `/pl` + 3 tool pages each | Translated landing pages | Yes | FAQ (+ SoftwareApplication on index) | Added earlier on this branch |
| `/terms`, `/privacy`, `/refund-policy`, `/dmca`, `/feedback` | Policy / support | Yes | — | |

Noindex or blocked, correctly: `/sign-in`, `/history`, `/referrals`, `/profile`, `/welcome`, `/under-construction`, `/auth/*` (robots-disallowed), `/admin` (robots-disallowed), `/api/` (robots-disallowed; not needed for rendering).

Routes named in the brief that do not exist: `/editor` (308 to `/download` since the online editor was retired; correct) and the competitor-named page under `/remove-…-watermark` (404; see P4). There is no browser-based video editor today, so no "online editor" landing page was created.

## Findings

Severity: **P1** fix now, **P2** fix soon, **P3** improvement.

| # | Sev | Finding | Evidence | Fix | Status |
|---|---|---|---|---|---|
| 1 | P1 | Every page embedded the full stylesheet three times (inline `<style>` plus twice in the RSC payload): ~480 KB of the 623 KB homepage, re-sent on every page view and never cached | Live `/` = 623,509 bytes; `<style>` 156,886 B; two flight chunks of 161–167 KB containing the CSS. Cause: `experimental.inlineCss` in `next.config.ts` | Turned `inlineCss` off; CSS is now an immutable cached file | Done. Local build: `/` 151 KB (−76%), `/remove-background` 71 KB (was 535 KB) |
| 2 | P1 | Guides were orphaned: no `/guides` hub (live 404), only linked from each other and from AI-cleanup sections | `curl` 404 on `/guides`; grep of `href=` | New `/guides` hub; breadcrumbs now Home › Guides › Article; footer link | Done |
| 3 | P1 | No crawlable tool directory: the navbar "Free Tools" pill pointed at `/#tools`, a homepage anchor | `Navbar.tsx` | New `/tools` page grouped by category with "where it runs" badges; navbar, footer, homepage and tool pages link to it | Done |
| 4 | P2 | Old competitor-named and platform-named "watermark" URLs still collect a few clicks/impressions | Search Console data supplied by owner; live 404 | Keep 404. The product no longer offers this, policy forbids it, and no equivalent page exists, so a redirect would mislead. Do not recreate | Decision documented |
| 5 | P2 | Tool pages had no links to sibling tools; each was a dead end apart from the footer | Page source | `RelatedTools` block on all four tool pages (same category first, related guides, link to `/tools`) | Done |
| 6 | P2 | Tool pages described the tool only through FAQ schema | Page source | `WebApplication` JSON-LD (free tools carry a $0 offer, which matches the free daily result; Pro tool doesn't) | Done |
| 7 | P2 | Tool names/descriptions were defined separately in the homepage cards, footer and pages | `FreeTools.tsx` | Single registry `src/lib/site-pages.ts` used by the homepage cards, `/tools`, `RelatedTools`, guide pages and `/guides` | Done (footer text links unchanged) |
| 8 | P2 | Cloudflare email obfuscation rewrites `mailto:` links to `/cdn-cgi/l/email-protection`, which returns 404 to crawlers | `npm run seo:check` against production | Dashboard: Scrape Shield › Email Address Obfuscation › Off | Needs Cloudflare access |
| 9 | P2 | Public media (demo video, images) served with `max-age=0`, so the CDN revalidated a 4.4 MB video on every play | Response headers; Cloudflare "Revalidated" bucket | Long `Cache-Control` for `mp4/webp/png/svg/vtt` | Done earlier on this branch |
| 10 | P2 | Three analytics beacons per page (Vercel Analytics, Speed Insights, Cloudflare RUM) | Cloudflare "Top paths" | Turn off Cloudflare Web Analytics auto-injection | Needs Cloudflare access |
| 11 | P3 | Homepage hero autoplays a 4.4 MB MP4 with no poster | `Hero.tsx` | Re-encode to ~1–1.5 MB 720p H.264 and add a poster frame (no ffmpeg in this environment) | Open |
| 12 | P3 | No automated regression check for metadata, canonicals, JSON-LD or internal links | — | `npm run seo:check` crawls a running build from its sitemap | Done |
| 13 | P3 | Non-English visitors only saw English pages | No i18n | 6 languages × 4 pages with hreflang | Done earlier on this branch |

## Checks that passed without changes

- `wipeclip.co` → `www` (308), `http` → `https` (301), trailing slash → no slash (308): one hop each, no chains.
- Canonicals all use `https://www.wipeclip.co`; no preview or localhost hosts (`SITE_URL` constant).
- robots.txt allows public pages and the CSS/JS needed to render them; sitemap is referenced.
- Every sitemap URL returns 200 with exactly one title, description, canonical (matching the sitemap) and H1, and no noindex (seo:check, 41 URLs).
- All JSON-LD parses; no ratings, reviews or invented statistics anywhere in the code.
- No horizontal page scroll at 390 px on 12 key pages (CDP device emulation). The homepage marquee and pricing table overflow inside intentionally clipped or scrollable containers.
- No third-party brand names and no watermark/logo-removal wording on public pages (repo grep).
- Funnel analytics already covers view → file selected → processing started/completed/failed → download, with error categories and no file names (`src/lib/analytics.ts`).

## Not done, and why

- **Homepage hero repositioning around "AI video cleanup".** The site was deliberately repositioned as a desktop editor and screen recorder for the payment-provider review, and AI cleanup copy is behind a flag. Changing the hero is a business decision, not an SEO fix.
- **New tool landing pages** (video object removal, screen recording, etc.). No browser feature exists for them yet; `/download` already serves the screen-recording intent. See `content-roadmap.md`.
- **Visible breadcrumbs on tool pages.** Would change the tool-page hero layout. The pages link back to `/tools` from the new "More tools" block instead.
