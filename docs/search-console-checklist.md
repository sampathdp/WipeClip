# Search Console checklist

None of this can be done from the repository. It needs the Search Console property for `https://www.wipeclip.co` (use a Domain property if you can, so `wipeclip.co` and `www` are covered together).

## After deploying this branch

1. **Sitemaps** › submit `https://www.wipeclip.co/sitemap.xml`. Expect about 41 URLs discovered. If the count is lower, open the sitemap report and compare against the `<loc>` list.
2. **URL Inspection** › inspect each URL below, check that **User-declared canonical** and **Google-selected canonical** match, then click **Request indexing**:
   - `/`, `/download`, `/tools`, `/guides`
   - `/remove-background`, `/extract-video-frame`, `/sharpen-image`, `/image-cleanup`
   - `/de`, `/fr`, `/es`, `/it`, `/nl`, `/pl`
   There is a daily quota of roughly 10–12 requests, so spread these over two days.
3. In URL Inspection, open **View crawled page › HTML** for `/remove-background` and confirm the H1, how-to steps and FAQ are in the HTML (they are server-rendered).

## Indexing coverage (Pages report), weekly

| Status | What to do |
|---|---|
| Discovered – currently not indexed | Normal for new URLs during the first 2–4 weeks. If it persists, add internal links from higher-traffic pages. |
| Crawled – currently not indexed | Usually a quality signal. Improve the page's unique content, and get a native review of translated pages. |
| Duplicate, Google chose different canonical | Inspect the URL. Translated pages must not canonicalize to the English page; each declares itself. |
| Excluded by noindex | Should only be `/sign-in`, `/history`, `/referrals`, `/profile`, `/welcome`, `/under-construction` |
| Blocked by robots.txt | Should only be `/api/`, `/admin`, `/auth/` |
| Not found (404) | Expected for the retired `…-watermark` URLs. Leave them; they drop out over time. |
| Page with redirect | Expected for `/editor`, apex host, `http://`, trailing slashes |
| Server error (5xx) | Investigate immediately |

## International targeting
- **Performance › Search results**, filter by **Country** (Germany, France, Spain, Italy, Netherlands, Poland) and by **Page** containing `/de/`, `/fr/`, etc.
- In URL Inspection for a translated page, confirm hreflang alternates are detected. Search Console no longer has a dedicated report for this.

## Non-branded queries
In **Performance**, add a Query filter › **Doesn't contain** › `wipe` (this covers "wipeclip" and "wipe clip"). Save it as a comparison. Track the following:
- Non-branded impressions and clicks
- Number of distinct landing pages with clicks (the goal is more than the homepage)
- Average position per tool page

## Comparing periods
- **Date › Compare › Last 28 days vs previous period** for week-to-week movement.
- **Last 3 months vs previous period** for the trend. The baseline before this release: 349 impressions, 135 clicks, about 82% branded.
- Note the deploy date. Ignore the first 2 weeks after it while pages are recrawled.

## Rich results
Run the **Rich Results Test** on `/remove-background` (FAQ, WebApplication), `/download` (SoftwareApplication, FAQ) and one guide (Article, BreadcrumbList). Google shows FAQ rich results only for some sites, so the goal here is valid markup, not a guaranteed visual change.

## Core Web Vitals
After about 28 days, check **Core Web Vitals** (mobile) and compare with the Speed Insights panel. Targets at the 75th percentile: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.
