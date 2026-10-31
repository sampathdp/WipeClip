import { RELEASES_REPO } from "@/lib/download";

export type DownloadCounts = { windows: number; mac: number; total: number };

/** The website's download buttons link to the version-free installer names
 * (STABLE_NAMES in desktop/scripts/update-manifest.mjs). The versioned copies
 * are what the app's updater fetches, so they are left out: an update isn't
 * a new download. */
const SITE_ASSETS = { windows: /^WipeClip-Windows-.*\.exe$/, mac: /^WipeClip-macOS-.*\.dmg$/ } as const;

/** Installer downloads from the website across every published release,
 * from the release host's own per-asset counters. Cached for an hour, so
 * page views never hit its rate limit; GITHUB_TOKEN (optional) raises it.
 * Null when the counts can't be read - callers then show nothing. */
export async function getDownloadCounts(): Promise<DownloadCounts | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=100`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const releases = (await res.json()) as { assets: { name: string; download_count: number }[] }[];
    const counts = { windows: 0, mac: 0 };
    for (const r of releases) {
      for (const a of r.assets) {
        if (SITE_ASSETS.windows.test(a.name)) counts.windows += a.download_count;
        else if (SITE_ASSETS.mac.test(a.name)) counts.mac += a.download_count;
      }
    }
    return { ...counts, total: counts.windows + counts.mac };
  } catch {
    return null;
  }
}
