#!/usr/bin/env node
// Crawls a running build of the site from its own sitemap and fails on SEO
// regressions: non-200 pages, missing or duplicate titles/descriptions,
// canonicals that don't match the sitemap, stray noindex, H1 count, invalid
// JSON-LD, hreflang targets missing from the sitemap and broken internal
// links. No third-party services.
//
//   npm run build && npm run start   (in another terminal)
//   npm run seo:check                 (defaults to http://localhost:3000)
//   SEO_BASE=https://www.wipeclip.co npm run seo:check

const BASE = (process.env.SEO_BASE || process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const PROD = "https://www.wipeclip.co";

const problems = [];
const fail = (url, msg) => problems.push(`${url}: ${msg}`);

async function get(path, redirect = "manual") {
  const res = await fetch(BASE + path, { redirect });
  return { status: res.status, location: res.headers.get("location"), text: await res.text() };
}

const all = (html, re) => [...html.matchAll(re)].map((m) => m[1]);
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

const robots = await get("/robots.txt");
if (robots.status !== 200) fail("/robots.txt", `status ${robots.status}`);
if (!/^Sitemap: https:\/\/www\.wipeclip\.co\/sitemap\.xml$/m.test(robots.text)) fail("/robots.txt", "missing Sitemap line");
if (/^Disallow: \/\s*$/m.test(robots.text)) fail("/robots.txt", "blocks the whole site");

const sitemap = await get("/sitemap.xml");
if (sitemap.status !== 200) {
  console.error(`sitemap.xml returned ${sitemap.status} from ${BASE}`);
  process.exit(1);
}
const locs = all(sitemap.text, /<loc>([^<]+)<\/loc>/g);
const inSitemap = new Set(locs);
if (inSitemap.size !== locs.length) fail("/sitemap.xml", "duplicate <loc> entries");

const titles = new Map();
const descriptions = new Map();
const internal = new Set();

for (const loc of locs) {
  if (!loc.startsWith(PROD)) {
    fail(loc, "sitemap URL is not on the production host");
    continue;
  }
  const path = loc.slice(PROD.length) || "/";
  const page = await get(path);
  if (page.status !== 200) {
    fail(path, `status ${page.status}${page.location ? ` -> ${page.location}` : ""}`);
    continue;
  }
  const html = page.text;
  const head = html.slice(0, html.indexOf("</head>"));

  const title = all(head, /<title>([^<]*)<\/title>/g);
  if (title.length !== 1) fail(path, `${title.length} <title> tags`);
  else (titles.get(title[0]) ?? titles.set(title[0], []).get(title[0])).push(path);

  const desc = all(head, /<meta name="description" content="([^"]*)"/g);
  if (desc.length !== 1) fail(path, `${desc.length} meta descriptions`);
  else (descriptions.get(desc[0]) ?? descriptions.set(desc[0], []).get(desc[0])).push(path);

  const canonical = all(head, /<link rel="canonical" href="([^"]*)"/g);
  if (canonical.length !== 1) fail(path, `${canonical.length} canonical tags`);
  else if (canonical[0].replace(/\/$/, "") !== loc.replace(/\/$/, "")) fail(path, `canonical ${canonical[0]} != sitemap ${loc}`);

  if (/<meta name="robots" content="[^"]*noindex/.test(head)) fail(path, "noindex on a sitemap URL");

  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) fail(path, `${h1} <h1> elements`);

  for (const block of all(html, /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(block);
      if (!data["@context"]) fail(path, "JSON-LD block without @context");
    } catch {
      fail(path, "JSON-LD does not parse");
    }
  }

  for (const href of all(head, /<link rel="alternate" hrefLang="[^"]+" href="([^"]+)"/g)) {
    if (!inSitemap.has(href)) fail(path, `hreflang target ${href} is not in the sitemap`);
  }

  for (const href of all(html, /<a [^>]*href="(\/[^"#?]*)/g)) internal.add(decode(href));
}

for (const [value, paths] of titles) if (paths.length > 1) fail(paths.join(", "), `share the title "${value}"`);
for (const [, paths] of descriptions) if (paths.length > 1) fail(paths.join(", "), "share a meta description");

for (const href of internal) {
  const res = await fetch(BASE + href, { redirect: "follow" });
  if (res.status >= 400) fail(href, `internal link returns ${res.status}`);
}

console.log(`Checked ${locs.length} sitemap URLs and ${internal.size} internal links on ${BASE}.`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("No problems found.");
