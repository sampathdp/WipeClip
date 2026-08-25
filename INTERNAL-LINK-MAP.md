# Internal Link Map

Written 2026-08-25. Documents the topic cluster around video watermark removal after this pass, plus what was audited and fixed to get there.

## A note on the requested hub

The task's suggested primary hub was `/video-watermark-remover`. That route does not exist and was deliberately not created — the homepage (`/`) already owns that exact commercial intent (title, H1, and metadata all target "AI Video Watermark Remover" as of the SEO-foundation pass earlier in this project). Creating a second page for the same query would cannibalize the homepage rather than support it. **`/` is the real hub** for everything below.

Of the other suggested spokes, these don't exist either and were not created (per "only use routes that actually exist" / "do not create new articles in this phase"): `/remove-watermark-from-video-without-blur`, `/remove-moving-watermark-from-video`, `/remove-logo-from-video`. Where the task envisioned those, the homepage's `#static-vs-moving` and `#comparison` sections and the `/guides/*` articles fill the same role today.

---

## Hub

```
/  (homepage)
```

Sections on this page double as sub-anchors other pages link into directly: `#upload` (the tool), `#what-it-does`, `#how-it-works`, `#static-vs-moving`, `#comparison`, `#situations`, `#evidence`, `#limitations`, `#privacy`, `#related`, `#faq`.

## Spokes (real routes, linked from the hub)

```
/  ↓
   ├─ /remove-tiktok-watermark        (Footer, RelatedContent)
   ├─ /remove-capcut-watermark        (Footer, RelatedContent)
   ├─ /remove-canva-watermark         (Footer, RelatedContent)
   ├─ /remove-instagram-watermark     (Footer, RelatedContent)
   ├─ /remove-facebook-watermark      (Footer, RelatedContent)
   ├─ /remove-snapchat-watermark      (Footer, RelatedContent)
   ├─ /remove-kapwing-watermark       (Footer, RelatedContent)
   ├─ /remove-inshot-watermark        (Footer, RelatedContent)
   ├─ /remove-image-watermark         (Footer, FreeTools)
   ├─ /remove-background              (Footer, FreeTools)
   ├─ /extract-video-frame            (Footer, FreeTools)
   ├─ /sharpen-image                  (Footer, FreeTools)
   ├─ /pricing                        (Navbar)
   ├─ /research                       (Footer)
   ├─ /guides/ai-inpainting-vs-blur-vs-crop            (RemovalMethodComparison section)
   ├─ /guides/does-watermark-removal-reduce-video-quality  (LimitationsSection)
   └─ /guides/how-ai-video-inpainting-works            (WhatWipeClipDoes)
```

```
/research  ↓
   └─ /research/video-watermark-removal-test   (article card)
```

---

## Cross-links (spoke ↔ spoke, not routed through the hub)

```
/research/video-watermark-removal-test
   ├─→ /guides/ai-inpainting-vs-blur-vs-crop
   ├─→ /guides/does-watermark-removal-reduce-video-quality
   └─→ /guides/how-ai-video-inpainting-works

/guides/ai-inpainting-vs-blur-vs-crop
   ├─→ /guides/how-ai-video-inpainting-works
   ├─→ /guides/does-watermark-removal-reduce-video-quality
   ├─→ /research/video-watermark-removal-test
   └─→ /remove-tiktok-watermark

/guides/does-watermark-removal-reduce-video-quality
   ├─→ /guides/how-ai-video-inpainting-works
   ├─→ /guides/ai-inpainting-vs-blur-vs-crop
   ├─→ /research/video-watermark-removal-test
   └─→ /privacy

/guides/how-ai-video-inpainting-works
   ├─→ /guides/ai-inpainting-vs-blur-vs-crop
   ├─→ /guides/does-watermark-removal-reduce-video-quality
   ├─→ /research/video-watermark-removal-test
   └─→ /remove-tiktok-watermark

/remove-tiktok-watermark
   ├─→ /#comparison, /#static-vs-moving, /#limitations   (hub anchors)
   └─→ /research/video-watermark-removal-test   (via the EvidenceSection placeholder)

/remove-capcut-watermark
   ├─→ /guides/does-watermark-removal-reduce-video-quality  (new this pass)
   └─→ /#comparison

/remove-canva-watermark
   ├─→ /guides/how-ai-video-inpainting-works  (new this pass)
   └─→ /#limitations

/remove-instagram-watermark
   ├─→ /guides/does-watermark-removal-reduce-video-quality  (new this pass)
   ├─→ /#comparison
   └─→ /terms
```

Anchor text used for these is varied and descriptive throughout — e.g. "how it compares to crop, blur, and cover", "why an estimate isn't the same as zero quality loss", "how that reconstruction actually works", "why that distinction matters", "see the research methodology" — never "click here" / "learn more" / "read this" (checked site-wide, zero matches).

---

## Orphan-page fixes made this pass

- `/remove-image-watermark` was reachable from only one place (`FreeTools` on the homepage). Added to the Footer's platform row (as "Still Images") so every public tool page now has at least two inbound routes.
- `/research/video-watermark-removal-test` had zero outbound related-content links (only an inbound one from the homepage/TikTok evidence placeholder). Added a 3-link `RelatedGuides` block to the three guides, closing the loop.

## Broken links found and fixed

- **`CtaBanner.tsx`** used a bare `href="#upload"` same-page anchor. It's rendered on every platform page, all 3 guides, and the research article — none of which have an `id="upload"` element (that only exists on the homepage's `UploadDemo`). This was silently broken on 13+ pages, including before this session touched any of them. Fixed to `<Link href="/#upload">`.
- **`EvidenceSection.tsx`**'s "Try it on your own clip instead" button had the same bug (bare `#upload`, broken wherever the component is reused off the homepage — i.e. the TikTok page). Fixed to `<Link href="/#upload">` in the prior session pass; re-verified here.
- **`Breadcrumbs.tsx`** gave `aria-current="page"` (and current-page styling) to *any* breadcrumb item without an `href`, not just the actual last/current one — so the non-clickable "Guides" / "Research" category crumb rendered identically to the real current page. Fixed so only the last item without an `href` is marked current; earlier non-linked items render as plain muted text.

## Checked, found clean

- **Duplicate navigation:** Navbar (4 items) and Footer (research/privacy/terms/dmca + free-tools row + platform row) have no repeated entries.
- **Circular nonsense:** no page's only outbound links loop back to a single other page with no other exits — every spoke links back to the hub (Navbar logo, breadcrumbs, or an explicit CTA) and to at least one other independent page.
- **Links to redirects:** `next.config.ts` defines no `redirects()`, so no internal link resolves through a redirect hop.
- **Footer bloat:** deliberately did not add the 3 guides or the research article to the footer — they're already well cross-linked from the homepage, each other, and the platform pages; footer stays limited to category-level links plus the one orphan fix above.
