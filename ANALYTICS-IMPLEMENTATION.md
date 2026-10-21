# WipeClip Analytics Implementation

Implemented 2026-08-25. No production functionality was changed — this phase only adds instrumentation on top of the existing tool/auth/checkout flows. No new analytics platform was installed; the existing provider was extended with custom events.

---

## 1. Existing Analytics Provider

**Vercel Web Analytics** (`@vercel/analytics`, already a dependency) is the site's only analytics provider. It was already wired into the root layout before this phase:

- `src/app/layout.tsx:3-4` imports `Analytics` (from `@vercel/analytics/next`) and `SpeedInsights` (from `@vercel/speed-insights/next`).
- `src/app/layout.tsx:153-154` renders `<Analytics />` and `<SpeedInsights />` inside `<body>`, so both run on every route.
- Before this phase, Vercel Analytics only tracked automatic pageviews — a repo-wide search confirmed zero calls to `track()`, `gtag()`, or `fbq()` anywhere in the codebase.
- No Google Analytics, GTM, Meta Pixel, or any other analytics platform exists in the codebase. None was added.

This phase adds custom **event** tracking on top of the same provider, using its existing `track()` API (`@vercel/analytics`'s browser export). No new package was installed.

---

## 2 & 3. Events Added and Where They Fire

All events go through one helper, `trackEvent()` in `src/lib/analytics.ts` (new file), which wraps `@vercel/analytics`'s `track()` in a try/catch so a failed or blocked analytics call can never throw into the calling code. A second helper, `useToolView(tool)`, fires `tool_view` once on mount and is shared by every tool component.

| Event | Fires in | Trigger |
|---|---|---|
| `tool_view` | `UploadDemo.tsx`, `BackgroundRemoverDemo.tsx`, `PhotoSharpenerDemo.tsx`, `ImageEditorDemo.tsx`, `VideoFrameGrabberDemo.tsx` | Component mount (via `useToolView`) |
| `upload_clicked` | Same 5 components | Click on the drag-and-drop zone, right before the native file picker opens |
| `file_selected` | Same 5 components | A file is picked or dropped (fires once per pick, covers both the click-to-browse and drag-and-drop paths) |
| `mask_started` | `UploadDemo.tsx`, `ImageEditorDemo.tsx` (the two tools with a region-marking step) | The marking UI (`RegionSelector`) becomes visible, right after the probe/detect step succeeds |
| `mask_completed` | `UploadDemo.tsx`, `ImageEditorDemo.tsx` | "Remove Object Now" is clicked, at the top of `process()`, right before the processing request is sent |
| `processing_started` | All 4 tools with a server processing step (`UploadDemo`, `BackgroundRemoverDemo`, `PhotoSharpenerDemo`, `ImageEditorDemo`) | Top of `process()`, right before the API call |
| `processing_completed` | Same 4 | On a successful response, right after `setStep("done")` |
| `processing_failed` | Same 4 | Every `catch` branch in `process()` — content-policy block, insufficient credits, auth/Pro-required (image tool only), and a generic processing-error fallback |
| `download_clicked` | Same 4, plus both download links in `VideoFrameGrabberDemo.tsx` | `onClick` on the actual `<a download>` result link |
| `signup_started` | `SignInModal.tsx`, `SignInClient.tsx` (the `/sign-in` page) | Right before `supabase.auth.signUp()` is called, on the password sign-up path only |
| `signup_completed` | Same two files | Immediately after `signUp()` returns a session (no email confirmation required) |
| `pricing_viewed` | `PricingClient.tsx` | Mount, once the client-side auth check resolves |
| `checkout_started` | `PricingClient.tsx` | Top of `buy(plan)`, right before `POST /api/checkout` |
| `purchase_completed` | `PricingClient.tsx` | Mount, when `?success=1` is present in the URL (the redirect Lemon Squeezy sends back after a completed hosted checkout — see §4) |

---

## 4. Properties Sent

All properties are drawn from the allowed list in the brief. None of them are computed from file contents, filenames, emails, or any user-entered text.

| Property | Used on | Value |
|---|---|---|
| `tool` | every tool event | A fixed, hardcoded identifier per component: `video_object_remover`, `background_remover`, `photo_sharpener`, `image_object_remover`, `video_frame_grabber` |
| `route` | `tool_view` | `window.location.pathname` at mount |
| `landing_page` | `tool_view`, `pricing_viewed` | Same-origin referrer **path only** (e.g. `/remove-background`); cross-origin referrers and query strings are dropped by `landingPagePath()` in `src/lib/analytics.ts` |
| `mode` | video-tool processing events | `"remove"` or `"replace"` — a UI toggle, not user content |
| `resolution` | video-tool processing events | `"720p"` / `"1080p"` / `"4k"` — a UI setting |
| `strength` | photo-sharpener processing events | `"light"` / `"standard"` / `"strong"` — a UI setting |
| `error_category` | `processing_failed` | One of a fixed set: `content_policy`, `insufficient_credits`, `auth_required`, `pro_required`, `processing_error` — mapped from the existing typed error classes in `src/lib/toolsApi.ts`, never the raw error message |
| `source` | `VideoFrameGrabberDemo`'s `download_clicked` | `"capture"` or `"suggestion"` — which grid the download came from |
| `method` | `signup_started` / `signup_completed` | Always `"password"` currently (see §6 for why OAuth/magic-link aren't tagged) |
| `logged_in` | `pricing_viewed`, `checkout_started` | Boolean, from a client-side Supabase session read (same pattern already used by every tool demo component) |
| `plan` | `checkout_started`, `purchase_completed` | One of `"starter"` / `"pro"` / `"payg"` — an internal plan key, not a price or payment detail |
| `source` (pricing) | `pricing_viewed` | Same as `landing_page` above |

---

## 5. Privacy Considerations

- **No PII is sent.** No email, name, IP address, or any Supabase user ID is included in any event property.
- **No uploaded content.** No video/image bytes, frames, or thumbnails are ever sent to analytics — every property is a fixed enum value or a UI setting.
- **No filenames.** `file.name` is used elsewhere in these components (for the download filename, and in `<p>{file.name}</p>` display text) but was deliberately never passed into `trackEvent()`. Every `file_selected` call only carries the generic `tool` identifier.
- **No payment details.** `checkout_started`/`purchase_completed` only carry the internal plan key (`starter`/`pro`/`payg`); no price, card, or Lemon Squeezy order/customer data is read or sent.
- **No raw error messages.** `processing_failed` carries a `error_category` drawn from a fixed, small set of values, not `e.message` (which can vary and, per `throwApiError` in `toolsApi.ts`, occasionally echoes backend validation detail).
- **Referrer is path-only and same-origin-only.** `landingPagePath()` parses `document.referrer`, discards it entirely if the origin doesn't match the site's own origin, and only ever returns a `pathname` — never a full URL, never a query string (which could carry a referral code or other incidental data).
- **Analytics can never break the product.** Every call goes through `trackEvent()`, which wraps `@vercel/analytics`'s `track()` in try/catch. If the script is blocked (ad blocker, browser privacy mode, offline), `track()` itself is designed to no-op silently, and the wrapper's catch is a second layer of defense — no event call can throw into an upload, processing, checkout, or auth code path.
- **`purchase_completed` doesn't touch billing state.** It fires from a URL query parameter (`?success=1&plan=...`) that Lemon Squeezy's checkout redirect sets; it's purely observational. Credit-granting is unchanged and still happens exclusively through the signed webhook handler (`src/app/api/webhooks/lemonsqueezy/route.ts`), which this phase did not modify.

---

## 6. Events That Could Not Be Implemented (or were scoped down)

- **`signup_started`/`signup_completed` only cover the password sign-up path.** Google OAuth (`signInWithOAuth`) and magic-link (`signInWithOtp`) don't tell the caller whether the email belongs to a new or returning user — Supabase's client-side response is the same shape either way. Firing these events for those paths would have meant guessing, which risks polluting the funnel with false signups. Distinguishing new-vs-returning for those paths would need a server-side check (e.g. comparing `created_at` and `last_sign_in_at` in `auth/callback/route.ts`) — left out as out of scope for this phase; flagged here as a known gap.
- **`signup_completed` doesn't fire for the email-confirmation-required branch.** When `signUp()` returns without a session (confirmation email sent), the account isn't usable yet and completion happens later, in an email client on a page this app doesn't control. `signup_started` still fires for that path, so a started-but-not-completed gap is visible in the data rather than silently miscounted as complete.
- **No `processing_started`/`processing_completed`/`processing_failed` for `VideoFrameGrabberDemo`.** Frame extraction is a genuinely synchronous, local, browser-only operation (canvas draw, no network call, no credit gate — see the component's own doc comment) — there is no "processing" request to bracket. `tool_view`, `upload_clicked`, `file_selected`, and `download_clicked` are still instrumented for this tool.
- **`mask_started`/`mask_completed` don't apply to `BackgroundRemoverDemo`, `PhotoSharpenerDemo`, or `VideoFrameGrabberDemo`.** Those tools have no region-marking step by design (whole-image or synchronous operations), so those two funnel stages are structurally not applicable there — not a missed instrumentation gap.
- **`ImageEditorDemo`'s `tool_view` fires even for non-Pro visitors who only see the upgrade gate**, not the actual upload tool (the component returns the gate UI before the tool UI when `planState !== "pro"`). This still accurately reflects "reached the tool's entry point," but it isn't distinguishable from an actual tool interaction in this dataset without an added property — left as-is rather than adding one-off scope.
- **`purchase_completed` is a checkout-redirect signal, not a webhook-confirmed one.** It's the client-side, session-attributed signal (consistent with how every other funnel event here is tracked), but it's technically once removed from the authoritative source of truth (the signed Lemon Squeezy webhook, which is server-to-server and has no connection to the buyer's original browsing session to attribute an event to). A server-side `track()` call from the webhook was considered and rejected for this phase — see §7.

---

## 7. Provider-Side Configuration Required

- **Custom Events may require a paid Vercel plan.** Vercel Web Analytics' free/Hobby tier includes pageview tracking; **Custom Events** (the `track()` calls this phase adds) is documented by Vercel as a feature of paid plans. The `track()` calls added here are safe either way — on a plan without Custom Events, they're a no-op at the dashboard level (no error, no thrown exception, per the try/catch in `trackEvent()`), they just won't produce visible data in the Vercel dashboard until the project is on a plan that supports them. **Action needed:** confirm the Vercel project's plan supports Custom Events, or upgrade it, for this data to actually appear.
- **No environment variables were added.** `@vercel/analytics` auto-configures itself via Vercel's own build-time injection when deployed on Vercel; nothing new needs to be set for the events to start sending (subject to the plan caveat above).
- **Nothing to configure for the events staying private.** All properties are enums/booleans/fixed strings, so there's no PII-scrubbing or redaction step required on Vercel's side.
