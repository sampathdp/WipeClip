# Content roadmap

Rule: only write about workflows the product supports today, with real screenshots from the app. If a piece needs media that doesn't exist yet, capture it first.

## Supported features (verified in code, 2026-10-24)

| Feature | Where | Notes |
|---|---|---|
| Screen recording (screen / window / area, system audio, mic, webcam as separate tracks) | Desktop app | Windows and macOS installers |
| Automatic zooms on clicks, pause and retake detection, on-device captions (.srt/.vtt) | Desktop app | |
| Trim, split, transitions, text, stickers, music, filters, aspect ratios, export up to 4K (4K with a pass) | Desktop app | |
| Background removal → transparent PNG | Browser | 1 free reduced-size result a day; full size costs 1 credit |
| Photo sharpening (light / standard / strong) | Browser | Same limits |
| Video frame → PNG, on-device, no upload | Browser | Same limits |
| AI image cleanup (marked region) | Browser, Pro | Behind the AI cleanup flag |

Not available, so don't write about them: a browser video editor, video compression, format conversion, browser subtitle generation.

## Priority list

| # | Working title | Search intent | Feature | Links to | Media needed |
|---|---|---|---|---|---|
| 1 | How to record your screen for a tutorial (free, Windows and Mac) | "record screen tutorial", "free screen recorder windows" | Desktop recorder, zooms, pause cutting | `/download`, `/tools` | 5–6 app screenshots, one 20 s clip |
| 2 | How to add captions to a screen recording | "add captions to video free" | On-device captions, .srt/.vtt export | `/download`, guide 1 | Caption editor screenshots |
| 3 | How to save a frame from a video as a high-quality image | "extract frame from video", "video screenshot png" | Frame grabber | `/extract-video-frame`, `/sharpen-image` | Before/after of a real frame |
| 4 | How to make a transparent PNG from a product photo | "transparent background product photo" | Background remover | `/remove-background`, `/sharpen-image` | 2–3 real product examples (own photos) |
| 5 | Cutting pauses and dead air out of a recording | "remove silence from video" | Pause and retake detection | `/download`, guide 1 | Timeline screenshots |
| 6 | Common AI cleanup artifacts and how to avoid them | "video inpainting artifacts" | AI cleanup | Both existing guides, `/image-cleanup` | Real failure examples from own footage |
| 7 | Exporting one edit as landscape, vertical and square | "resize video vertical" | Aspect ratios | `/download` | Three exports of one project |

Do 1, 3 and 4 first. They target the highest-volume intents the product already serves, and 3 and 4 point at tools that can convert visitors on the page itself.

## Existing guides
Both are good and honest about limitations. Keep them. Once guide 6 exists, link it from both. They only render when the AI cleanup flag is on, which it is in production.

## Translations
After an English guide proves itself (impressions in Search Console), translate guides 1 and 3 first, into German and French. Add each one to `PAGES` only after a native speaker has reviewed it.

## Publishing checklist
- Add the guide to `GUIDES` in `src/lib/site-pages.ts` so the hub, sitemap (add the URL) and related links pick it up.
- Use the same structure as the existing guides: `Breadcrumbs`, `GuideHeader`, `DirectAnswer`, Article JSON-LD, `RelatedGuides`.
- Run `npm run seo:check` against a local build.
- No third-party brand names. Say "landscape / vertical / square" instead of naming platforms.
