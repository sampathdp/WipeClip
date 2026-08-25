# WipeClip SEO Audit

Audit date: 2026-08-25. Read-only — no production code, packages, or content were changed while producing this report. All findings are backed by direct repository evidence (`file:line` citations). Where a claim could not be verified from code alone (e.g. live env var values, rendered HTML, GSC/DNS configuration), that is stated explicitly rather than assumed.

---

## Current Architecture

**Framework:** Next.js `16.3.1` (App Router), React `19.2.8`, TypeScript `^5` with `strict: true` (`tsconfig.json:7`), Tailwind CSS `^4` using the CSS-first config pattern (`@import "tailwindcss"` in `src/app/globals.css:1`, no `tailwind.config.js`).

**Router:** App Router rooted at `src/app`. Only **one** layout file exists in the entire project — `src/app/layout.tsx` — confirmed by recursive search; there are no nested/segment layouts under any route, including the 9 watermark platform routes, `auth/`, or `api/`. Every route shares the single root layout and its metadata defaults.

**Styling:** Tailwind v4, dark mode via a custom variant keyed on `data-theme` (`globals.css:3`) rather than the default `class`/`media` strategy, toggled by an inline script in `layout.tsx:98` reading `localStorage`, with `suppressHydrationWarning` on `<html>` (`layout.tsx:139`).

**Fonts:** `next/font/google` — `Inter` and `Plus_Jakarta_Sans` (`layout.tsx:2,8-19`), both `display: "swap"`, no external `<link>` requests.

**Reusable components** (`src/components/`): `Navbar`, `Footer`, `Hero`, `HowItWorks`, `Features`, `Faq`, `CtaBanner`, `FreeTools`, `FreeToolsBanner`, `WatermarkLandingTemplate` (the shared shell for all 9 platform pages), plus tool-specific demo widgets (`UploadDemo`, `BackgroundRemoverDemo`, `PhotoSharpenerDemo`, `ImageEditorDemo`, `VideoFrameGrabberDemo`, `ImageCompareSlider`, `VideoCompareSlider`, `RegionSelector`), and auth/account components (`AuthStatus`, `SignInModal`, `CopyReferralLink`, `ReferralCapture`).

**Auth:** Supabase (`@supabase/ssr`, `@supabase/supabase-js`) — `src/lib/supabase/client.ts` (browser client), `server.ts` (server client + `createServiceClient()` for privileged writes), `isSupabaseConfigured()` guard. Auth state in the navbar is determined **client-side** (`AuthStatus.tsx:41,53`); `/history` and `/referrals` additionally enforce auth **server-side** via `redirect()` (see Technical SEO Findings).

**Request interception:** No `middleware.ts` exists anywhere. Instead `src/proxy.ts` (73 lines) is Next.js 16's renamed convention for the same mechanism — it (a) refreshes the Supabase session cookie on every matched request, and (b) implements a site-wide maintenance-mode **rewrite** to `/under-construction` when `SITE_UNDER_CONSTRUCTION=true` (`proxy.ts:11-18`), gated by `SITE_BYPASS_SECRET`.

**Payment:** Lemon Squeezy (not Stripe — no Stripe reference anywhere in the repo). `src/app/api/checkout/route.ts` creates a hosted checkout session and redirects off-site; `src/app/api/webhooks/lemonsqueezy/route.ts` verifies an HMAC signature and grants/revokes credits via Supabase RPC.

**Upload/processing workflow:** All processing API routes (`api/process`, `api/process-image`, `api/remove-background`, `api/sharpen-image`) are thin Next.js Route Handlers that authenticate, rate-limit (Upstash Redis, `src/lib/rateLimit.ts`), debit credits, and proxy to a **separate Python/FastAPI backend** (`backend/app/main.py:73`, `FastAPI(title="WipeClip.co API")`) over HTTP via `TOOLS_API_URL`/`NEXT_PUBLIC_TOOLS_API_URL`. The backend uses OpenCV, `rembg`/`onnxruntime`, and `nudenet`, and deploys independently via Docker or `passenger_wsgi.py`. None of this executes during SSR or blocks page load.

**Analytics/observability:** `@vercel/analytics` and `@vercel/speed-insights` are imported and actually rendered in `layout.tsx:153-154`. `@sentry/nextjs` is wired via the modern `instrumentation.ts` / `instrumentation-client.ts` hooks (not legacy `sentry.*.config.ts` files), DSN-gated (`enabled: Boolean(process.env.SENTRY_DSN)`), 10% trace sample rate, and **not** wrapped with `withSentryConfig` in `next.config.ts` (no build-time source-map/tunnel integration).

**Deployment:** No `vercel.json` anywhere in the repo. `package.json` scripts are stock (`next build` / `next start`, no static export, no custom flags).

**Image optimization:** `next/image` is used **nowhere** in the codebase (zero matches for `from "next/image"`). `next.config.ts` (34 lines, full file read) has no `images` config, no `redirects()`, no `rewrites()`, and no `experimental` block — it only sets security headers.

---

## Existing SEO Pages

| Page | Route | Indexable? |
|---|---|---|
| Homepage | `/` | Yes |
| Pricing | `/pricing` | Yes |
| TikTok watermark removal | `/remove-tiktok-watermark` | Yes |
| CapCut watermark removal | `/remove-capcut-watermark` | Yes |
| Canva watermark removal | `/remove-canva-watermark` | Yes |
| Instagram watermark removal | `/remove-instagram-watermark` | Yes |
| Snapchat watermark removal | `/remove-snapchat-watermark` | Yes |
| Facebook watermark removal | `/remove-facebook-watermark` | Yes |
| Kapwing watermark removal | `/remove-kapwing-watermark` | Yes |
| InShot watermark removal | `/remove-inshot-watermark` | Yes |
| Image watermark removal (Pro) | `/remove-image-watermark` | Yes |
| Background remover | `/remove-background` | Yes |
| Photo sharpener | `/sharpen-image` | Yes |
| Video frame extractor | `/extract-video-frame` | Yes |
| Terms | `/terms` | Yes |
| Privacy | `/privacy` | Yes |
| DMCA | `/dmca` | Yes |
| Job history | `/history` | No — `robots: { index: false }` (`history/page.tsx:10`) |
| Referrals | `/referrals` | No — `robots: { index: false }` (`referrals/page.tsx:10`) |
| Sign in | `/sign-in` | No — `robots: { index: false, follow: true }` |
| Under construction | `/under-construction` | No — `robots: { index: false, follow: false }`, unlinked from any page |
| Auth callback/reset/sign-out | `/auth/*` | No metadata export; excluded from sitemap |

The 8 platform pages under `remove-*-watermark` (excluding image) are driven by a single data array, `src/lib/watermarkPlatforms.ts` (238 lines), rendered through the shared `WatermarkLandingTemplate.tsx` component — this is the site's core programmatic-SEO pattern.

---

## Technical SEO Findings

**Metadata:** Root layout defines a complete default metadata object — title template (`layout.tsx:25-27`), description, `keywords`, `metadataBase`, `alternates.canonical: "/"`, full OpenGraph, Twitter card, and `robots` (`layout.tsx:23-89`). All 17 sitemap-listed pages export their own page-level metadata except the homepage (`src/app/page.tsx`), which correctly inherits root metadata with no override.

**Google Search Console verification:** Not found anywhere in code. Grep for `verification|google-site-verification|GOOGLE_SITE_VERIFICATION` across `src/` returns zero matches, and no verification HTML file exists under `public/`. This may be handled via DNS outside the repo — the audit cannot confirm either way from code.

**Canonical implementation:** `metadataBase: new URL("https://wipeclip.co")` is set once (`layout.tsx:21,24`), and every audited page sets `alternates.canonical`. However, the canonical/`siteUrl` value `"https://wipeclip.co"` is **hardcoded independently as a literal string in at least 4 separate files** rather than a shared constant: `layout.tsx:21`, `robots.ts:3`, `sitemap.ts:4`, `referrals/page.tsx:13`. All four are currently consistent, but this is a maintenance/drift risk.

**robots.txt** (`src/app/robots.ts`, full file): `allow: "/"`, `disallow: "/api/"` only. No `host` field. **`/sign-in`, `/history`, `/referrals`, and `/under-construction` are not disallowed at the crawl level** — they rely solely on per-page `robots: noindex` meta, a weaker and slower-acting signal since crawlers still fetch and parse the page before honoring it.

**sitemap.xml** (`src/app/sitemap.ts`, full file): Generates exactly 17 URLs. Cross-checked against every actual route in the app — **this set is complete**; all indexable content pages are present and all non-indexable routes (`history`, `referrals`, `sign-in`, `under-construction`, `auth/*`, `api/*`) are correctly omitted. One gap: every `lastModified` value is a **hardcoded static date string** (e.g. `"2026-08-20"`), not derived from actual content changes, so it will not auto-update.

**Structured data / JSON-LD:** Sitewide `Organization` + `WebSite` + `SoftwareApplication` graph injected in every page's `<head>` via the root layout (`layout.tsx:100-132,144`). Homepage adds `HowTo` (`HowItWorks.tsx:22-31`) and `FAQPage` (`Faq.tsx:34-42`). All 9 platform pages add a `FAQPage` block from their own `content.faqs` (`WatermarkLandingTemplate.tsx:13-21`) and inherit the same `HowTo` schema via the shared `HowItWorks` component. The 4 tool pages (`remove-image-watermark`, `remove-background`, `sharpen-image`, `extract-video-frame`) each add their own inline `FAQPage`. **No `BreadcrumbList`, `VideoObject`, or `Product`/`AggregateRating` schema exists anywhere**, despite this being a video-processing product site with a pricing page.

**OpenGraph/Twitter completeness gap:** The 9 platform pages and `/pricing` set only `title`/`description`/`url` for OpenGraph and only `title`/`description` for Twitter — no `type`, `siteName`, `locale`, `images`, or `twitter.card` (e.g. `remove-tiktok-watermark/page.tsx:11-19`, `pricing/page.tsx:9-19`). By contrast, `remove-image-watermark`, `remove-background`, `sharpen-image`, and `extract-video-frame` all set the full object including a card image (e.g. `remove-image-watermark/page.tsx:14-28`). Practical effect: social/messaging shares of the platform pages and the pricing page likely render without a preview image.

**Image optimization / alt text:** No `next/image` usage anywhere. Only 3 files use raw `<img>` (`VideoFrameGrabberDemo.tsx:404,444`, `RegionSelector.tsx:166-168`, `ImageCompareSlider.tsx:55,63`), each explicitly opted out with an ESLint disable comment because they render dynamic/blob-URL content. **All of these have populated, non-empty `alt` attributes** — no missing or empty alt text was found on any audited page. The site's brand mark is inline SVG (`Logo.tsx`), sidestepping the optimization gap for the logo specifically. Static marketing images (screenshots, hero art) are absent site-wide — there simply aren't static content images to optimize yet.

**Heading hierarchy:** No pages with zero or multiple H1s were found. All 9 platform pages: exactly 1 H1 / 5 H2 / 3 H3, identical structure. The 4 tool pages: 1 H1 / 2 H2 / 0 H3 each. `/pricing`: **1 H1 / 0 H2 / 0 H3** — plan cards use styled `<div>`/`<span>` instead of headings (`PricingClient.tsx:100-198`), so the page has no subheading hierarchy at all. Homepage: 1 H1 / 6 H2 / 12 H3.

**Indexable pages that should not be indexed:** None found — `/history`, `/referrals`, `/sign-in`, `/under-construction` all correctly declare `robots: { index: false }`.

**Pages blocked accidentally:** None found in current `robots.ts`/metadata state. However, `src/proxy.ts:11-18` contains a **conditional site-wide risk**: if `SITE_UNDER_CONSTRUCTION=true` in production, every route except `/under-construction`, `/api/*`, and `/auth/*` is **rewritten** (not redirected) to under-construction content while returning **HTTP 200 at the original URL**. Because it's a rewrite, there is no 3xx signal to crawlers — every one of the 17 sitemap URLs would appear to serve "Coming Soon" content with a 200 status and no indication to de-index. This audit did not and could not inspect the live value of `SITE_UNDER_CONSTRUCTION` (env values were intentionally not read).

**Orphan pages:** Cross-referencing every route against `Navbar.tsx`, `Footer.tsx`, `FreeTools.tsx`, and `FreeToolsBanner.tsx`: all 8 `WATERMARK_PLATFORMS` pages are linked from the footer on every page load. **`/remove-image-watermark` is the one exception — it is only linked from `FreeTools.tsx:41` (a homepage-only section) and is absent from the footer's platform list** (`watermarkPlatforms.ts` array does not include it; `Footer.tsx:44` loops only over that array). This gives it materially less internal link equity than the other 8 platform pages. `/history`, `/referrals`, and `/sign-in` are not linked from these 4 components' own markup but are reachable through the child `AuthStatus` component conditionally on auth state — for an anonymous crawler, `/sign-in` is reachable but `/history` and `/referrals` never are, which is consistent with their intentional `noindex` + server-redirect gating rather than a bug. `/under-construction` has zero inbound links anywhere in `src/` — it is reached only via the `proxy.ts` rewrite.

**Broken internal links:** None found in the audited navigation/footer/tools components.

---

## Content Duplication Risks

The 9 platform pages (`remove-tiktok-watermark` through `remove-inshot-watermark`) render through one shared component, `WatermarkLandingTemplate.tsx`, driven entirely by string fields in `watermarkPlatforms.ts`. This produces:

- **Identical page skeleton on all 9 pages**: 1 H1 (`Remove the {platform} watermark`), 5 H2s, 3 H3s, in the same order, with ~168 words of byte-for-byte identical boilerplate (the `HowItWorks` 3-step copy, `CtaBanner` copy, and the "not affiliated with {platform}" disclaimer).
- **Verbatim-duplicated FAQ answers** between specific platform pairs — not just similar phrasing, exact string matches:
  - Canva ↔ InShot: all 3 audited FAQ answers are identical or near-identical (`watermarkPlatforms.ts:86,90,94` vs `226,230,234`).
  - TikTok / Snapchat / Kapwing: near-identical "does it affect quality" answer (`:38,150,206`).
  - CapCut ↔ Facebook: identical file-size/format answer (`:66` vs `178`).
  - Instagram ↔ Snapchat: near-identical "why remove it" sentence template, only the brand noun swapped (`:109-110` vs `137-138`).
- **Two shared components reused verbatim across 10 pages**: `HowItWorks` and `CtaBanner` render identical copy on the homepage and all 9 platform pages — the single most-repeated block of text on the site.
- **Lower-risk structural duplication**: the 4 tool pages (`remove-image-watermark`, `remove-background`, `sharpen-image`, `extract-video-frame`) share a page shell/skeleton pattern but do **not** duplicate FAQ or hero copy verbatim between each other — each has genuinely distinct prose.

---

## Keyword Cannibalization Risks

- All 9 platform-page titles follow the identical formula `Remove {Platform} Watermark From Video — Free` — a template with the brand name as the only variable (`watermarkPlatforms.ts:17,45,73,101,129,157,185,213`). Several description pairs open with near-identical phrasing (TikTok/Snapchat, CapCut/Kapwing, Canva/InShot).
- The sitewide `keywords` meta array (`layout.tsx:31-38`) is generic ("remove watermark from video", "video watermark remover", etc.) and contains **no brand terms** — it is inherited unchanged by every page, including all 9 platform pages, since none override it. No page has a platform-specific `keywords` value.
- The homepage's core positioning ("Erase the watermark. Keep the footage.", plus an embedded `UploadDemo` H2 "Try it now: Inpaint Video") targets the exact same generic "remove watermark from video" intent that the 9 platform pages also target for their brand-qualified variants — a defensible hub-and-spoke pattern in principle, but the platform pages' heavy template overlap with each other (see above) weakens their differentiation more than their differentiation from the homepage.
- `/remove-image-watermark`'s title, `"Remove Image Watermark — Pro Tool"`, leads with the paid-feature framing rather than the generic search term, which may undersell it for users/crawlers evaluating generic "remove image watermark" intent.

---

## Analytics Findings

- **Vercel Analytics and Speed Insights** are correctly imported and rendered (not just imported) in the root layout: `layout.tsx:3-4,153-154`.
- **No Google Analytics / GA4 / gtag.js / Google Tag Manager** integration exists anywhere in the repo. A precision grep for `gtag(`, `GTM-[A-Z0-9]`, `googletagmanager.com`, `google-analytics.com`, and GA4 measurement-ID patterns returned zero matches.
- **No Google Search Console verification** mechanism (meta tag or file) found in code (see Technical SEO Findings).
- **Sentry** is wired at runtime only via `instrumentation.ts` (server/edge) and `instrumentation-client.ts` (client), both DSN-gated and disabled unless `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` are set. `next.config.ts` is **not** wrapped with `withSentryConfig`, so there is no build-time source-map upload or tunneling route configured.
- The canonical production domain `https://wipeclip.co` is duplicated as a literal string across `layout.tsx`, `robots.ts`, `sitemap.ts`, and `referrals/page.tsx` rather than driven by the one `NEXT_PUBLIC_SITE_URL` env var that exists (which is only actually consumed once, in the checkout redirect).

---

## Conversion Tracking Findings

- **Payment provider is Lemon Squeezy**, not Stripe. `src/app/api/checkout/route.ts` creates a hosted Lemon Squeezy checkout session (embedding `user_id`/`plan`/`credits` in `custom_data`) and returns a redirect URL that the client navigates to via `window.location.href` (`PricingClient.tsx:50`) — a full off-site redirect, not an embedded widget.
- `src/app/api/webhooks/lemonsqueezy/route.ts` verifies an HMAC-SHA256 signature, grants credits via Supabase RPC on `order_created`/`subscription_payment_success`, and downgrades the plan on cancellation/expiry.
- **No conversion or purchase event is fired anywhere in the purchase flow.** A repo-wide grep for `track(`, `analytics.track`, `fbq(`, and `gtag(` returned zero matches in the checkout route, the webhook handler, and the `/pricing?success=1` success-redirect target. Purchase success is reflected only as a credited Supabase balance and a `?success=1` query parameter — there is no client- or server-side conversion event fired to Vercel Analytics, GA, or any ad pixel. This means **there is currently no way to measure purchase conversion rate, funnel drop-off, or channel-level ROI** from the codebase as it stands.
- Referral links are constructed as `{siteUrl}/?ref={code}` — the homepage with a query parameter (`referrals/page.tsx:58`). The homepage declares `alternates.canonical: "/"` at the layout level and `page.tsx` has no override, so `/?ref=xyz` should inherit that canonical and consolidate ranking signals to the bare `/` URL — this was verified from the metadata source only, not from actual rendered HTML output, and is flagged as an assumption worth spot-checking.

---

## Performance Findings

- **No `next/dynamic` usage exists anywhere in the repository.** Five sizable `"use client"` demo components — `UploadDemo.tsx` (631 lines, on the homepage), `VideoFrameGrabberDemo.tsx` (483 lines), `ImageEditorDemo.tsx` (404 lines), `PhotoSharpenerDemo.tsx` (372 lines), and `BackgroundRemoverDemo.tsx` (346 lines) — are all statically imported directly into their respective pages (home, `remove-background`, `sharpen-image`, `remove-image-watermark`, `extract-video-frame`) with no `dynamic(() => import(...), { ssr: false })` wrapper and no loading fallback. Their JS ships and hydrates unconditionally on every page load rather than being deferred until the user actually interacts with the upload widget — a direct risk to LCP/TBT/INP on exactly the pages meant to convert visitors.
- Mitigating factor: the dependency tree is lean — no heavy third-party canvas/video/chart libraries are installed — so the bundle weight comes from hand-written component logic (drag-and-drop, canvas region selection, compare sliders), not vendored packages.
- No `next/image` usage anywhere means no automatic responsive `srcset` or format negotiation (WebP/AVIF) for any image on the site — though as noted, the only raster images in scope are dynamic/blob-URL content where `next/image` doesn't cleanly apply, and the primary brand mark is already inline SVG.
- The homepage is the heaviest page on the site: ~700–750 words of visible copy, 6 H2s, 12 H3s, and six client components rendered inline (`UploadDemo`, `HowItWorks`, `Features`, `FreeTools`, `Faq`, `CtaBanner`), none behind a dynamic import.
- All actual video/image processing is offloaded to a separate FastAPI backend reached over HTTP — none of it runs during SSR or blocks the Next.js server, so the processing pipeline itself has no page-load performance impact.

---

## Highest Priority Fixes

1. **Verify `SITE_UNDER_CONSTRUCTION` is not left enabled in production.** If it were, `src/proxy.ts:11-18` would silently serve "Coming Soon" content at HTTP 200 across every indexed URL with no redirect signal to crawlers — the single highest-blast-radius risk found in this audit, purely because of what the code *would* do if a flag were mis-set, not because of anything currently broken.
2. **Add conversion/purchase-event tracking.** No analytics event fires anywhere on a successful Lemon Squeezy purchase — there is currently no way to measure paid conversion rate or channel ROI from this codebase.
3. **Confirm Google Search Console verification status.** No verification mechanism exists in code; if the site isn't already verified via DNS, indexing/coverage data is currently invisible.
4. **Complete OpenGraph/Twitter metadata on the 9 platform pages and `/pricing`.** These are the site's highest-commercial-intent pages, and they're currently the ones missing a social preview image/card.
5. **Defer the heavy demo components with `next/dynamic`.** These are unhydrated-JS-on-load on exactly the pages meant to convert, with a direct Core Web Vitals (and thus ranking) impact.

## Medium Priority Fixes

- Reduce template duplication across the 9 platform pages — particularly the verbatim-duplicated FAQ answers between Canva/InShot, TikTok/Snapchat/Kapwing, and CapCut/Facebook.
- Add crawl-level `disallow` rules in `robots.ts` for `/sign-in`, `/history`, `/referrals`, and `/under-construction` to reinforce the existing meta-`noindex` and avoid wasted crawl budget.
- Consolidate the `siteUrl`/canonical-domain literal into one shared constant instead of four independent copies.
- Add `/remove-image-watermark` to the footer's platform link list so it receives the same internal link equity as the other 8 platform pages.
- Make `sitemap.ts` `lastModified` values reflect real content-change dates instead of hardcoded strings.
- Review the marketing-claim language flagged below for accuracy against actual product behavior/limits — this is a product/legal judgment call, not something this audit can resolve from code alone.

## Low Priority Fixes

- Wrap `next.config.ts` with `withSentryConfig` for build-time source-map upload.
- Add supplementary structured data (`BreadcrumbList` for the hub-and-spoke platform pages; consider `VideoObject`) as an enhancement, not a fix.
- Standardize relative vs. absolute URL usage in `openGraph.url` across page groups (currently inconsistent but functionally correct given `metadataBase`).
- Add a caption track or `aria-label` to the homepage hero `<video>` element (`BeforeAfterDemo.tsx:159`), which currently has neither.
- Give `/pricing` a proper H2 hierarchy — its plan cards currently use styled `<div>`/`<span>` instead of headings, leaving the page with zero subheadings.

---

## Marketing Claims Inventory (for product/legal review)

The following phrases were found verbatim in the codebase and are flagged per the audit's scope — this section reports occurrences only; whether each claim is substantiated is a product/legal determination outside this audit.

| Phrase | Locations |
|---|---|
| "zero quality loss" | `Hero.tsx:62` (homepage only) |
| "lossless" / "visually lossless" / "Near-Lossless" / "4K Lossless" / "Lossless Export" | Homepage (`Hero.tsx:7,112`, `Features.tsx:3-4`, `BeforeAfterDemo.tsx:9`, `Faq.tsx:18`) and shared `HowItWorks.tsx:18` (renders on homepage + all 9 platform pages); also in FAQ copy on 5 of 9 platform pages (TikTok, Canva, Snapchat, Kapwing, InShot — `watermarkPlatforms.ts:38,94,150,206,234`) |
| "instant" / "in seconds" / "15 seconds" / "~15s" | Homepage (`Hero.tsx:11,107`, `Features.tsx:42`), shared `CtaBanner.tsx:23` and `HowItWorks.tsx:17` (homepage + all 9 platform pages), `remove-background/page.tsx:8`, `sharpen-image/page.tsx:8`, `PricingClient.tsx:93` ("instant monthly banking") |
| "100%" (private / accurate / in-browser) | `Hero.tsx:80` ("100% private"), `Features.tsx:50` ("100% Private by Design"), `FreeTools.tsx:20` and `VideoFrameGrabberDemo.tsx:269` ("100% in your browser — nothing is uploaded") |
| "perfect" | `PricingClient.tsx:109` ("Perfect to test watermark removal on short clips") |
| "100% accurate" | Not found anywhere in scope |
| "undetectable" | Not found anywhere in scope |
| "no watermark left behind" | Not found verbatim; the closest match (`PricingClient.tsx:117`, "No watermark on output") describes WipeClip's own free-tier export lacking a WipeClip watermark — a different claim, not a removal-completeness guarantee |
| "4K" (capability claim) | `Hero.tsx:7`, `pricing/page.tsx:7,12,18`, `PricingClient.tsx:27,93`, `remove-image-watermark/page.tsx:34` |

---

## Recommended SEO Architecture

- **Shared metadata builder**: introduce one helper function that produces a complete, consistent OpenGraph/Twitter/canonical object for every page type, so platform pages and tool pages stop diverging in metadata completeness.
- **Single source of truth for the canonical domain**: one exported `siteUrl` constant consumed by `layout.tsx`, `robots.ts`, `sitemap.ts`, and `referrals/page.tsx`, instead of four independent literals.
- **Differentiated platform-page content**: keep the hub-and-spoke URL structure (it's a reasonable pattern for this query space), but reduce the shared component's reliance on fully identical FAQ text between platform pairs — even modest per-platform variation would meaningfully reduce duplicate-content exposure.
- **Crawl-level enforcement of non-indexable routes**: add `disallow` entries in `robots.ts` for `/sign-in`, `/history`, `/referrals`, `/under-construction` to back up the existing meta-`noindex` tags.
- **Conversion instrumentation**: fire a purchase/conversion event (at minimum via `@vercel/analytics`'s custom `track()`, since it's already installed) from the Lemon Squeezy webhook's grant path or the `/pricing?success=1` landing.
- **Deferred hydration for interactive tools**: wrap the five heavy demo components in `next/dynamic` with `ssr: false`, since they're purely post-load, user-initiated interactions.
- **Structured data enrichment**: add `BreadcrumbList` for the platform-page hub-and-spoke relationship once the pages themselves are differentiated; consider `VideoObject` for the homepage's demo video.

## Recommended Implementation Order

1. Confirm the live value of `SITE_UNDER_CONSTRUCTION` (and `SITE_BYPASS_SECRET`) in production — a verification step, not a code change.
2. Add purchase-conversion tracking to the checkout/webhook success path.
3. Confirm or add Google Search Console verification.
4. Build and adopt a shared OpenGraph/Twitter metadata helper; apply it to the 9 platform pages and `/pricing` first, since they're the current gap.
5. Add crawl-level `disallow` rules for the four non-indexable routes in `robots.ts`.
6. De-duplicate the platform-page FAQ content identified above (Canva/InShot, TikTok/Snapchat/Kapwing, CapCut/Facebook).
7. Wrap the five heavy demo components in `next/dynamic`.
8. Consolidate the `siteUrl` constant into one shared module.
9. Fix `sitemap.ts` `lastModified` to reflect real dates going forward.
10. Add `/remove-image-watermark` to the footer's platform link list.
11. Add `BreadcrumbList`/`VideoObject` structured data as an enhancement.
12. Route the marketing-claims inventory above to product/legal for a substantiation review — this is a business decision, not an engineering one.
