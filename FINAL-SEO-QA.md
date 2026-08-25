# WipeClip Final SEO QA

Audited 2026-08-25, against the production repository as it stands after all prior SEO phases (technical foundation, analytics, landing page, platform pages, research infrastructure, guides, internal linking, performance/accessibility). No new pages, articles, or features were added in this pass — audit and targeted bug fixes only.

Verification method: `next build` static output inspection (all 47 routes), direct source reads, and repo-wide `grep`/JSON parsing. This is a sandboxed environment with no running browser — anything requiring a live browser (visual rendering, actual console output, real network requests) is called out explicitly rather than assumed.

---

# Passed Checks

| # | Check | Result |
|---|---|---|
| 1 | Public routes build/return successfully | All 47 routes compile clean (`next build`); 34 prerendered static, 13 server-rendered on demand (API routes + auth + history/referrals, correctly dynamic). No build errors. |
| 2 | No broken internal links | Every static `href` extracted from `src/` cross-checked against the real route list — zero misses (the two apparent misses, `/history` and `/referrals`, are real dynamic routes just not statically prerendered as `.html`). |
| 3 | No accidental noindex | Grepped every `robots:` metadata export site-wide — exactly 4 pages set `index: false`, all intentional (see #4). No public content page carries a stray noindex. |
| 4 | No private routes indexed | `/history`, `/referrals`, `/sign-in`, `/under-construction` all `noindex`. **Fixed this pass:** `/auth/reset-password` had no metadata at all (inherited the indexable homepage default) — see Issues Fixed. |
| 5 | Correct canonical domain | Every canonical/OG/sitemap/robots URL resolves through the single `SITE_URL` constant (`src/lib/seo.ts`) = `https://wipeclip.co`. Verified in rendered output: 22/22 sitemap URLs, all page canonicals. |
| 6 | No preview/Vercel canonical URLs | Repo-wide search for `vercel.app`/`localhost` in canonical-relevant code: zero matches (the only `localhost` reference is the dev-only FastAPI backend fallback URL, unrelated to SEO/canonical). |
| 7 | Sitemap contains appropriate pages | 22 URLs: homepage, pricing, 4 free tools, research hub + article, 3 guides, 9 platform pages, terms/privacy/dmca. Correctly excludes `/history`, `/referrals`, `/sign-in`, `/under-construction`, all `/api/*`, `/auth/*`. |
| 8 | Robots configuration is safe | `allow: /`, `disallow: /api/` only. No accidental blocking of CSS/JS/assets/content pages. |
| 9 | Unique titles | All 26 indexable pages have distinct `<title>`. The only duplicate pair (`/` and Next's internal `/_not-found`) is a non-issue — 404 responses aren't indexed regardless of title. |
| 10 | Unique descriptions | All indexable pages have distinct descriptions. The only duplicates are on already-noindexed pages (`_not-found`, `/under-construction`, `/auth/reset-password`) — irrelevant to search since those pages don't appear in results. |
| 11 | Logical H1/H2 hierarchy | Verified full heading sequence on the research article and a guide page: strict h1→h2→h3 nesting throughout, zero skipped levels, zero multiple-H1 pages. |
| 12 | Breadcrumbs | Present on all 3 guides + both research pages, visible nav paired 1:1 with `BreadcrumbList` JSON-LD (fixed an `aria-current` bug on these in the prior linking pass, reverified clean here). |
| 13 | Valid JSON-LD | Parsed all 49 JSON-LD blocks across every rendered page programmatically — 100% valid JSON, all carry `@context`. |
| 14 | No fake ratings/reviews | Zero `AggregateRating`/`Review` schema, zero star-rating UI anywhere in the codebase. |
| 15 | No fake data | `RESEARCH_TESTS` array is genuinely empty; every research/guide component that would show numbers instead shows an explicit "pending verification" state when no data exists. |
| 16 | No unsupported test claims | Full repo search for the 10 flagged phrases (see below) — every "guaranteed"/"zero quality loss" occurrence in live code is explicitly *negated* ("not guaranteed", "isn't the same as zero quality loss" — honest disclaimers, not claims). One genuine tension found and flagged rather than silently fixed — see Remaining Issues. |
| 17 | No keyword stuffing | Spot-checked title/description/keywords arrays added this project — natural phrasing, no repeated exact-match stacking. |
| 18 | No duplicate platform content | Reverified from the dedicated content-duplication pass: the 4 upgraded platform pages (TikTok/CapCut/Canva/Instagram) share zero prose — confirmed by grepping distinctive phrases from each into the other three, no cross-matches. Shared elements are limited to nav/footer/FAQ-shell/CTA, which is the explicitly allowed reusable UI. |
| 19 | No obvious keyword cannibalization | No new pages added this pass to introduce new cannibalization. Prior-documented state holds: `/video-watermark-remover` was deliberately never created (homepage already owns that intent); the 9 platform pages target distinct brand-qualified queries. |
| 20 | Appropriate internal links | Full hub→spoke→cross-link map already documented in `INTERNAL-LINK-MAP.md`; reverified no new orphans introduced by this pass's one new/changed page (`/auth/reset-password`, correctly noindexed so orphan status there is moot). |
| 21 | Analytics events don't expose private info | Grepped every `trackEvent(` call site for email/name/user-id properties — zero matches. Properties are limited to enums/booleans/fixed strings by design. |
| 22 | Analytics failures can't break the app | `trackEvent()` wraps `@vercel/analytics`'s `track()` in try/catch; every call site is fire-and-forget, never awaited/branched on. |
| 23 | No broken upload workflow | Reread the full affected region of all 5 tool components after last pass's div→button refactor; tag balance verified (`<button>`/`</button>`, `<>`/`</>` counts match in every file); `next build` compiles all 5 clean. Drag/drop, click-to-browse, and the hidden-input trigger logic are all structurally intact. |
| 24 | No broken authentication | `SignInModal`/`SignInClient` form-submission logic untouched by this pass's dialog-semantics fix (only added `role`/`aria-modal`/`Escape`/`autoFocus` — zero changes to `submitPassword`/`signInWithGoogle`/`sendMagicLink`). Labels correctly wired (`htmlFor`/`id` match). |
| 25 | No broken pricing | `PricingClient.tsx` plan cards, `buy()` handler, and credit/plan data (`src/lib/credits.ts`) unchanged this pass. |
| 26 | No broken checkout | `api/checkout/route.ts`'s `plan` value is validated against the `PLANS` enum before being embedded in the redirect URL — no injection risk, no logic changed since the additive `&plan=` fix two phases ago. |
| 27 | Responsive layouts | Covered by the dedicated mobile-QA pass two phases ago (tables, cards, hero CTAs, breadcrumbs, nav all reverified against the 375/768/1024/1440 checklist then); no layout-affecting changes made in this pass. |
| 28 | Accessible forms/buttons | Site-wide sweep this pass: every `onClick` handler in `src/` is on a real `<button>`/`<Link>`/focusable `<input>` except the two standard modal-backdrop `onClick`s in `SignInModal` (correct, supplementary pattern — not the only way to close). Fixed the modal's missing dialog semantics (see Issues Fixed). |
| 29 | No major console errors introduced | No browser tool available in this sandboxed session to confirm directly — `tsc --noEmit` and `next build` (which surfaces React's build-time warnings) are both clean, the strongest signal available here. Flagged under Human Evidence Needed as a real live-browser check to still do. |
| 30 | Build succeeds | `next build` clean. `tsc --noEmit` clean. (No test suite exists in this repo — no `test` script, no test files — so "run tests" is N/A, noted rather than skipped silently.) |

---

# Issues Fixed

1. **`/auth/reset-password` had no page metadata and was indexable.** It's a `"use client"` page component, which can't export `metadata` directly — that structural limitation is why it had none. Split it into `ResetPasswordClient.tsx` (the existing form, unchanged) + a new server `page.tsx` that sets `title: "Reset Password"` and `robots: { index: false, follow: false }`, matching the pattern already used for `/sign-in`. Verified in build output: title and noindex now render correctly.
2. **Sign-in modal had no dialog semantics or keyboard dismissal.** `SignInModal.tsx` (used across every tool page) had no `role="dialog"`/`aria-modal`, no Escape-to-close, and nothing received focus when it opened — a keyboard/screen-reader user had no signal a modal had appeared beyond the visible Close button. Added `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the heading, an Escape-key handler, and `autoFocus` on the email field. No visual change, no behavior change to the sign-in logic itself.
3. **Navbar links caused full page reloads instead of client-side navigation** — carried over from the previous performance pass, reverified stable here: all nav links now use `next/link`.

All three verified via `next build` + rendered-HTML inspection after the change, not assumed.

---

## Suspicious Phrase Search — Full Results

Searched all 10 flagged phrases across `src/` (case-insensitive). Every occurrence, with the evidence determination:

| Phrase | Where found | Verdict |
|---|---|---|
| "zero quality loss" | `guides/ai-inpainting-vs-blur-vs-crop`, `guides/does-watermark-removal-reduce-video-quality`, `remove-capcut-watermark` | **Fine** — all three are the negated form ("isn't the same as zero quality loss" / "does not mean zero quality loss") — these are the articles' entire honest thesis, not a claim. |
| "100% lossless" | — | Not found anywhere. |
| "perfect" | `PricingClient.tsx` ("Perfect to test watermark removal on short clips") | **Flagged** — pre-existing idiom, not obviously false, but is literally the flagged word. Human call needed (see Remaining Issues). |
| "guaranteed" | `guides/ai-inpainting-vs-blur-vs-crop`, `FullMethodComparisonTable`, `RemovalMethodComparison`, `WhatWipeClipDoes` | **Fine** — every instance is negated ("not a guaranteed recovery", "not guaranteed") — honest limitation-setting, not a promise. |
| "100% accurate" | — | Not found anywhere. |
| "our tests" | — | Not found anywhere. |
| "during our test" | — | Not found anywhere. |
| "we tested" | Research page title/H1 (`research/page.tsx`, `research/video-watermark-removal-test/page.tsx`) | **Flagged** — see Remaining Issues below; this is the one genuine tension found. |
| "customers say" | — | Not found anywhere. |
| "thousands of users" | — | Not found anywhere. |

No blind removals were made — every hit was read in context before being judged. Legitimate honest/negated usage was left alone; genuinely unresolved tensions are flagged below rather than silently edited, since they involve either a prior explicit instruction (the research title) or a subjective marketing-copy call outside this audit's authority to unilaterally resolve.

---

# Remaining Issues

- **Research article title uses past-tense "We Tested..." while zero tests have actually been published.** `H1`/title = *"We Tested AI Watermark Removal on Real Videos"* — this exact phrasing was the explicit instruction from the task that created this page, and the page body is saturated with honest disclaimers (`ResearchDisclaimer`, "Pending verification" on all 6 test cards, an explicitly empty benchmark table with "no verified benchmark data has been published yet"). But taken in isolation — a Google search snippet, a social share, a skimming reader — "We Tested..." reads as a completed-past claim, which the page itself doesn't back up yet. This is exactly the "we tested" pattern this audit was asked to flag. **Recommendation:** either accept this as intentional mission-statement framing (defensible given the body's honesty) or soften to present/ongoing tense (e.g. *"Testing AI Watermark Removal on Real Videos"*) once there's user-facing traffic to this page. Not changed unilaterally since it was a specific prior directive — flagging for a decision rather than overriding it.
- **Hero.tsx still has a bare "lossless" stat chip** (`1080p+ / lossless`, no qualifier). This was flagged in the original SEO-AUDIT.md, is unchanged, and is a product/marketing-copy call this audit can't unilaterally resolve — it needs someone who can confirm the output encoding is actually lossless (in which case it's accurate) or knows it's "visually lossless" (in which case the chip should say that).
- **`PricingClient.tsx`: "Perfect to test watermark removal on short clips."** Same status as the original audit — idiomatic ("well-suited to"), not obviously a false accuracy claim, but it is literally one of the flagged phrases. Left for a human call.
- **`RegionSelector`'s drag-to-mark box has no keyboard interaction.** Flagged in the prior performance/accessibility pass, still true, still out of scope for a no-redesign audit — a real fix means adding focusable/arrow-key-operable handles to the core paid interaction, which is a feature addition, not a QA fix.
- **Duplicate `supabase.auth.getUser()` calls per page** (Navbar's `AuthStatus` + each tool/pricing component). Pre-existing architectural pattern, not something introduced this session; a real fix needs a shared auth context, out of scope for this pass.
- **3 pre-existing lint errors** (`FreeToolsBanner`/`ThemeToggle` setState-in-effect, `VideoFrameGrabberDemo`'s `useSuggestion` hook-naming false positive) — unrelated to this audit's scope, unchanged all session.
- **No live-browser console check was possible in this environment.** Build + typecheck are clean, which is the strongest available signal here, but an actual "open every page in a browser and watch devtools" pass hasn't been done.

---

# Human Evidence Needed

- Real before/after test data for `/research/video-watermark-removal-test` — see `RESEARCH-DATA-CHECKLIST.md` for the exact fields required. Nothing on that page can move from "pending" to published without it.
- A decision on the "We Tested..." title framing above.
- A decision on the two remaining marketing phrases above ("lossless" stat chip, "Perfect to test...").
- Confirmation that Google Search Console is actually verified for `wipeclip.co` — no verification meta tag or file exists in this repo (may be handled via DNS outside the codebase; this audit can't confirm either way from code).
- A live QA pass in an actual browser at 375/768/1024/1440px and a real console-error check — this session's prior performance/accessibility pass was thorough on markup/CSS but couldn't render a browser.

---

# Search Console Actions

1. **Submit the sitemap** (`https://wipeclip.co/sitemap.xml`) if not already submitted — it's complete and correctly scoped (22 URLs, verified above).
2. **Request indexing** for the newly-created pages once real content lands: `/research`, `/research/video-watermark-removal-test`, and the 3 `/guides/*` pages are new since the last likely GSC crawl.
3. **Watch Coverage for `/auth/reset-password`** — if Google had already indexed it before this fix (it was indexable with a generic homepage-duplicate title), the noindex fix will need a re-crawl to take effect; consider a manual "Request Removal" for that specific URL if it shows up in Coverage as indexed.
4. **Check the URL Inspection tool** on 2-3 of the 9 platform pages to confirm Google is rendering the client-side pieces (the `WatermarkLandingTemplate` FAQ accordions, `HowItWorks`) correctly, since they're plain HTML/CSS `<details>` elements rather than JS-dependent — should render fine, but worth a spot check.
5. **Monitor for the `SITE_UNDER_CONSTRUCTION` proxy risk** flagged in the original SEO-AUDIT.md — if that env var were ever accidentally left `true` in production, every indexed URL would start serving "Coming Soon" content at HTTP 200 with no redirect signal. Not currently triggerable from anything in this audit, but worth an occasional manual check that it's `false`/unset in the production environment.

---

# Recommended Next 30 Days

1. **Populate real research data.** This is the single highest-leverage open item — the research page, the quality guide's "Real quality measurements" section, and the homepage's evidence placeholder all activate automatically once `RESEARCH_TESTS` in `src/lib/researchData.ts` has real entries.
2. **Resolve the two open marketing-claim decisions** (Hero's "lossless" chip, pricing's "Perfect to test..." line) with whoever owns product accuracy sign-off.
3. **Decide on the research page's title tense** ("We Tested" vs. "Testing") given the current lack of published data.
4. **Confirm/set up Google Search Console verification** if not already done, and work through the Search Console Actions above.
5. **Get a real browser QA pass** (375/768/1024/1440px, actual devtools console) on at least the homepage, one platform page, one guide, and the research article — this session's audit covered markup/CSS/ARIA correctness thoroughly but a live render check is the one thing that couldn't be done here.
6. **Monitor Search Console Coverage weekly** for the first month after the guides/research pages go live, watching specifically for "Discovered, not indexed" or "Crawled, not indexed" states on the new content.
7. **Revisit `RegionSelector` keyboard access** as a scoped follow-up project (not a QA fix) if accessibility compliance for the core tool becomes a requirement.
