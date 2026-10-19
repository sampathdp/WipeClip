# WipeClip Desktop: Repository Audit and Architecture Proposal

Stage 1 deliverable. Audited on branch `feature/wipeclip-desktop`, cut from `master` at `570922f`.

## 1. Existing architecture

| Area | Finding |
|---|---|
| Framework | Next.js **16.3.1**, App Router only (`src/app`), React 19.2.8, TypeScript 5 |
| Package manager | npm (`package-lock.json`), Node 22 locally, Node 20 in CI |
| Styling | Tailwind 4 via `@tailwindcss/postcss` |
| Hosting | Vercel (`@vercel/analytics`, `@vercel/speed-insights`, `x-real-ip` assumptions) |
| Server features in use | 15 Route Handlers under `src/app/api`, `src/proxy.ts` (Next 16's renamed middleware), `redirects()` and `headers()` in `next.config.ts`, async Server Components that read cookies (`/history`, `/profile`), `/auth/callback` route that exchanges the OAuth code server-side, generated `opengraph-image`/`apple-icon` |
| Auth | Supabase via `@supabase/ssr`. The session lives in **cookies on the site's origin**; every API route reads it with `createClient()` from `src/lib/supabase/server.ts` |
| Billing / plans | Credits and plan tiers in Supabase (`supabase/schema.sql`), enforced in Route Handlers with the service-role key (`consume_credits`, `ensure_daily_reset`) |
| AI / processing backend | Separate FastAPI service in `backend/` (Python, PyAV, OpenCV, rembg, inpainting), deployed to Cloud Run (`.github/workflows/deploy-backend.yml`) |
| CI | `.github/workflows/ci.yml`: `npm run lint`, `tsc --noEmit`, backend compile and import check. No test suite exists in either half |

## 2. Editor and processing flow (traced, not assumed)

Entry: `src/app/editor/page.tsx` renders `VideoEditor` (a single `"use client"` component tree, ~6,700 lines in `src/components/editor` and `src/lib/editor`).

**Import** (`VideoEditor.tsx` `importFile`)
1. `<input type="file" accept="video/*">` or drag and drop gives a `File`. Rejected unless `file.type` starts with `video/`, max 300 MB (`MAX_BYTES`), UI promises MP4, MOV, WebM, up to 10 minutes.
2. In parallel: `loadVideoMeta()` decodes through a `<video>` on a `blob:` URL (browser codec check), and `probeVideo()` uploads the **whole file** to `POST {NEXT_PUBLIC_TOOLS_API_URL}/api/video/probe` for server-side validation and content moderation. Import fails if either fails.
3. The file is copied into IndexedDB (`projectStore.saveSource`) for crash recovery. Project JSON autosaves every 800 ms.

**Editing** is entirely client-side: timeline, trims, transitions, overlays (text, stickers, images, picture-in-picture video), audio tracks, filters, effects, undo history, preview rendering on `<video>` and canvas. Thumbnails and waveforms come from `<video>`/`OfflineAudioContext` (waveforms read the whole file into memory, skipped above 400 MB).

**Auto captions** run locally in Web Workers with `@huggingface/transformers` (Whisper base, WebGPU encoder with WASM fallback). Model weights download from `huggingface.co` on first use and are cached by the browser.

**AI cleanup** (`AiCleanupDialog.tsx` then `toolsApi.processVideo`)
1. `POST /api/process` (same-origin Next route, cookie auth) checks rate limits, spends credits with the service-role client, decides quality tier from the real plan, returns an HMAC-signed single-use **ticket** (`src/lib/jobTicket.ts`).
2. Browser uploads the video plus region and time range with the ticket straight to `POST {TOOLS_API_URL}/api/video/process`.
3. Backend verifies the ticket, claims it through `/api/internal/ticket` on the site, processes, returns the MP4 as the HTTP response body (no polling, no job IDs; a 20-minute client-side abort is the only timeout). Failed paid jobs are refunded by the backend.
4. The result becomes a new in-memory `MediaSource`.

**Export** (`ExportDialog.tsx` then `exportProject.ts` then `toolsApi.exportEditorProject`)
1. `POST /api/export` (cookie auth) checks tier, resolution, premium features, daily limit; returns a ticket pinned to the project's SHA-256.
2. Browser uploads every used source video, overlay PNGs, audio and background to `POST {TOOLS_API_URL}/api/video/export`. Backend renders with PyAV and returns the MP4 as the response body.
3. The result is a `Blob`; signed-in users download it through `<a href={blobUrl} download>`. Anonymous users must sign in first (`saveLastExport` keeps the blob in IndexedDB across the sign-in).

There is **no** progress reporting beyond an elapsed-time counter and an indeterminate bar, and no cancel button once rendering starts. The desktop build must not invent either.

## 3. Reusable unchanged

- Every editor component and library: `src/components/editor/*`, `src/lib/editor/*` (timeline, history, preview, rasters, captions, project store).
- Plan display logic: `src/lib/entitlements.ts`, `src/lib/credits.ts` (pure data).
- The whole FastAPI backend and its ticket protocol.
- All billing, credit, plan and moderation enforcement. It stays on the server; the desktop app is just another client of it.

## 4. Needs a desktop-specific adapter

| Concern | Web today | Desktop need |
|---|---|---|
| Same-origin API calls (`/api/process`, `/api/export`, `/api/credits`, `/api/referrals/claim`) | Relative URLs, cookies sent automatically | Absolute URL to the production site, `Authorization: Bearer <supabase access token>`, CORS on those routes for the desktop origins |
| Server-side session read | `createClient()` reads cookies | Also accept a bearer token (`supabase.auth.getUser(jwt)`), only on routes the desktop calls |
| Backend CORS | `ALLOWED_ORIGINS` (default `*`) | Add `tauri://localhost` (macOS) and `http://tauri.localhost` (Windows) if production narrows it |
| Google OAuth and magic links | Redirect to `{origin}/auth/callback`, a server route | Open the system browser, return through a `wipeclip://` deep link, exchange the PKCE code client-side |
| Export download | `<a download>` on a blob URL | Native save dialog, write to the chosen path from Rust (atomic temp file then rename) |
| Import | `<input type=file>` | Native open dialog; must still end up as a `File` because the editor, IndexedDB recovery and uploads all need one |
| Links to `/pricing`, `/terms`, `/profile` | In-site navigation | Open in the system browser at `https://www.wipeclip.co/...` |
| Analytics | Vercel Analytics, Speed Insights, Sentry | Vercel scripts do nothing useful off Vercel; leave them out of the desktop layout |

## 5. Next.js features blocking a straight `output: "export"`

Per `node_modules/next/dist/docs/01-app/02-guides/static-exports.md`, static export rejects Route Handlers that read the request, cookies, `redirects`, `headers`, proxy, and Server Components that read cookies. This app uses all of them, so **the existing app cannot be statically exported as-is**, and switching the main build to `output: "export"` would break the website.

The editor route itself, though, is a static page wrapping a client component. Only its API calls and auth depend on the server.

## 6. Recommended desktop architecture

**Option A, chosen: a static export of the editor only, inside Tauri 2, talking to the production site and backend over HTTPS.**

- New directory `desktop/` holding a second, tiny Next.js app (`output: "export"`) whose only page imports the real `VideoEditor` from `../src`. No editor code is copied. The website's `next.config.ts`, routes and Vercel deployment are untouched.
- `src-tauri/` holds the Rust shell, capabilities and bundle config.
- A small platform layer, `src/lib/platform/`, with `isDesktop()`, `apiUrl()`, `authHeaders()`, `openVideoFile()`, `saveExportFile()`, `openExternal()`, `showDesktopError()`. In the browser each one falls back to today's behaviour, so the website is unaffected.
- Server change, small and additive: the four routes the editor calls accept a bearer token and answer CORS preflights for the two desktop origins only. Cookie auth keeps working exactly as before.

**Rejected**
- **B: bundle `next start` as a sidecar.** Would ship Node plus the service-role key, Paddle and Payments.lk secrets inside the installer. Unacceptable.
- **C: point the WebView at `https://www.wipeclip.co/editor`.** Explicitly ruled out by the brief, and native file APIs exposed to a remote page are a larger attack surface.

## 7. Platform risks

| Risk | Detail | Mitigation |
|---|---|---|
| **Codec support differs per WebView** | Windows WebView2 is Chromium: H.264, VP9, AV1, HEVC only with the OS extension. macOS WKWebView is Safari: H.264, HEVC, VP9 in recent versions, **no** WebM/VP8 in older macOS, Opus-in-WebM patchy | Import already fails cleanly with "media_error". Backend probe still runs. Document per-OS formats; do not silently transcode |
| WebGPU for captions | WebView2 has it; WKWebView only on macOS 26+ / Safari 26 | Existing WASM fallback in `captions.ts` |
| `blob:` and IndexedDB storage | Both work in both WebViews; quota is per app origin | No change |
| Large files | Native dialog returns a path; turning it into a `File` means reading it into JS memory (up to 300 MB) | Accept within the existing 300 MB cap; streaming upload from Rust is a later optimisation |
| Auth deep links | Needs `tauri-plugin-deep-link` and `wipeclip://auth/callback` added to Supabase's redirect allowlist | Password sign-in works without it; OAuth and magic link follow in a later stage |
| Signing | Unsigned Windows builds trigger SmartScreen; unsigned macOS builds are blocked by Gatekeeper | Needs an Authenticode certificate and an Apple Developer ID plus notarization |
| **Toolchain on this machine** | No Rust, no MSVC C++ Build Tools. WebView2 152 is present | Must install rustup and VS Build Tools before any Tauri build can run here. macOS builds need a Mac (or a macOS GitHub Actions runner) |

## 8. Stages and validation

| Stage | Work | Validation |
|---|---|---|
| 2 Foundation | `desktop/` static app, `src-tauri/`, platform layer, CSP, capabilities | `npm run build` (web) still passes; `npm run desktop:build-frontend` produces `desktop/out`; `tauri dev` opens the editor |
| 3 Native I/O | Open dialog import, save dialog export with atomic write | Manual: open real MP4, cancel dialogs, export to chosen folder, check duplicate names and read-only folder |
| 4 Backend integration | Bearer auth + CORS on 4 routes, absolute API URLs, external links | Sign in, AI cleanup on a clip, credits decrease, 720p cap when signed out, plan gates |
| 5 Security and tests | Capability review, secret scan of `desktop/out` and the installer, unit tests for the platform layer | Automated scan; `tauri info`; manual permission checks |
| 6 Release | NSIS installer, DMG, signing and notarization docs, GitHub Actions matrix | Build on real Windows and macOS runners; install, upgrade, uninstall |
