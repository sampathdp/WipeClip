// Collects the signed update bundles from the CI build artifacts and writes
// latest.json, the feed the app's updater reads (src-tauri/src/updater.rs,
// endpoint in tauri.conf.json: .../releases/latest/download/latest.json).
//
//   node desktop/scripts/update-manifest.mjs <artifacts dir> <out dir> <tag> <owner/repo> [notes file]
//
// Copies into <out dir>, under release asset names that say version and
// architecture: the Windows installer (which is also its update bundle), the
// macOS update tarball and the DMG, plus latest.json. The installers also get
// a copy under a fixed name (STABLE_NAMES), so the website's download links
// - .../releases/latest/download/<name> - always serve the newest release.
// The version's notes (desktop/release-notes.json) go into latest.json, where
// the update banner shows them, and into [notes file], the release page text.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Version-free installer names for the website's download buttons
 * (NEXT_PUBLIC_DOWNLOAD_WINDOWS_URL / _MAC_URL, src/lib/download.ts). */
const STABLE_NAMES = { windows: "WipeClip-Windows-x64-setup.exe", mac: "WipeClip-macOS-AppleSilicon.dmg" };

const [src, out, tag, repo, notesOut] = process.argv.slice(2);
if (!src || !out || !tag || !repo) {
  console.error("usage: node desktop/scripts/update-manifest.mjs <artifacts dir> <out dir> <tag> <owner/repo> [notes file]");
  process.exit(2);
}

const root = path.join(import.meta.dirname, "..", "..");
const version = JSON.parse(readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8")).version;
if (tag !== `desktop-v${version}`) {
  console.error(`Tag ${tag} doesn't match the app version ${version} (tauri.conf.json): expected desktop-v${version}.`);
  process.exit(1);
}

const notes = JSON.parse(readFileSync(path.join(root, "desktop", "release-notes.json"), "utf8")).releases.find((r) => r.version === version)?.notes;
if (!notes?.length) {
  console.error(`desktop/release-notes.json has no notes for ${version} (desktop/scripts/release.mjs files them).`);
  process.exit(1);
}
const notesText = notes.map((n) => `- ${n}`).join("\n");

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const all = files(src);
const one = (re, what) => {
  const found = all.filter((p) => re.test(path.basename(p)));
  if (found.length !== 1) {
    console.error(`Expected one ${what}, found ${found.length}: ${found.join(", ") || "none"}`);
    process.exit(1);
  }
  return found[0];
};

mkdirSync(out, { recursive: true });
const platforms = {};
const add = (target, file, asset) => {
  const sig = one(new RegExp(`^${path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.sig$`), `${asset}.sig`);
  copyFileSync(file, path.join(out, asset));
  platforms[target] = {
    signature: readFileSync(sig, "utf8").trim(),
    url: `https://github.com/${repo}/releases/download/${tag}/${asset}`,
  };
};

const winInstaller = one(/^WipeClip_.*_x64-setup\.exe$/, "Windows installer");
const dmg = one(/^WipeClip_.*\.dmg$/, "macOS DMG");
add("windows-x86_64", winInstaller, `WipeClip_${version}_x64-setup.exe`);
add("darwin-aarch64", one(/^WipeClip\.app\.tar\.gz$/, "macOS update bundle"), `WipeClip_${version}_aarch64.app.tar.gz`);
copyFileSync(dmg, path.join(out, `WipeClip_${version}_aarch64.dmg`));
copyFileSync(winInstaller, path.join(out, STABLE_NAMES.windows));
copyFileSync(dmg, path.join(out, STABLE_NAMES.mac));

const manifest = {
  version,
  notes: notesText,
  pub_date: new Date().toISOString(),
  platforms,
};
writeFileSync(path.join(out, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
if (notesOut) {
  writeFileSync(
    notesOut,
    `## What's new\n\n${notesText}\n\nWipeClip ${version} for Windows and macOS. Download the installer below, or let the app update itself.\n`
  );
}
console.log(`latest.json for ${version}: ${Object.keys(platforms).join(", ")}`);
