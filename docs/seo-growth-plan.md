# SEO growth plan (30 / 60 / 90 days)

These are planning targets, not promises. Baseline (3 months): 349 impressions and 135 clicks, about 82% of clicks branded.

## Completed engineering (branch `feat/eu-localization`)
- HTML weight down ~76% (inline CSS removed); long cache for public media
- `/tools` directory, `/guides` hub, related-tool links, navbar/footer links
- WebApplication schema on tool pages; one registry for tools and guides
- Pages in six European languages with hreflang
- `npm run seo:check` regression crawl

## Days 0–30
**Owner tasks (external access needed)**
- Merge and deploy the branch.
- Search Console: submit the sitemap and request indexing (`search-console-checklist.md`).
- Cloudflare: turn off Email Address Obfuscation (it creates 404 links for crawlers) and Web Analytics auto-injection (a duplicate beacon).
- Paddle: set EUR and GBP price overrides so localized prices are round numbers.
- Get native-speaker review of the translated pages, starting with German, Polish and French.
- Legal: check whether an EU representative under GDPR Article 27 is needed.

**Engineering**
- Re-encode `public/demo-sintel.mp4` to ~1–1.5 MB and add a poster image to the hero video.
- Run `npm run seo:check` before every release, or add it to CI after `next build && next start`.

**Content**
- Publish roadmap #1 (screen recording tutorial) and #3 (save a video frame) with real screenshots.

## Days 31–60
- Publish roadmap #4 (transparent product photos) and #2 (captions).
- From Search Console, list queries where tool pages rank in positions 8–30. Rewrite titles and descriptions for those queries, without inventing features.
- Promotion: post genuinely useful answers in local-language creator, e-commerce and seller communities, and submit to tool directories in each language. No paid links, no link schemes.
- Short demo clips (screen recording, frame grab, background removal) with local-language captions, each linking to the matching tool page.

## Days 61–90
- Translate the best-performing English guide into German and French.
- If a tool page reaches about 100 impressions a month in a country, translate its interface strings too.
- Compare against the baseline with the 3-month comparison (impressions, non-branded clicks, number of entry pages).

## Planning targets (90 days after deploy)
| Metric | Baseline | Aspiration |
|---|---|---|
| Impressions | 349 | 3,000–5,000 |
| Clicks | 135 | 250–400 |
| Entry pages with clicks | Mostly the homepage | 5+ pages |
| Non-branded share of clicks | ~18% | 40%+ |

## Future product opportunities (not built, so don't market them)
- Browser screen recorder (lightweight, for people who won't install software)
- Video object removal as a standalone browser tool (exists only as part of the AI cleanup feature)
- Translated app interface (the desktop app is English-only)
