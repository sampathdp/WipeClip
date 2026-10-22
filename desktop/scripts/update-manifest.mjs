// Collects the signed update bundles from the CI build artifacts and writes
// latest.json, the feed the app's updater reads (src-tauri/src/updater.rs,
// endpoint in tauri.conf.json: .../releases/latest/download/latest.json).
//
//   node desktop/scripts/update-manifest.mjs <artifacts dir> <out dir> <tag> <owner/repo>
//
// Copies into <out dir>, under release asset names that say version and
// architecture: the Windows installer (which is also its update bundle), the
// macOS update tarball and the DMG, plus latest.json.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const [src, out, tag, repo] = process.argv.slice(2);
if (!src || !out || !tag || !repo) {
  console.error("usage: node desktop/scripts/update-manifest.mjs <artifacts dir> <out dir> <tag> <owner/repo>");
  process.exit(2);
}

const version = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "..", "src-tauri", "tauri.conf.json"), "utf8")).version;
if (tag !== `desktop-v${version}`) {
  console.error(`Tag ${tag} doesn't match the app version ${version} (tauri.conf.json): expected desktop-v${version}.`);
  process.exit(1);
}

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

add("windows-x86_64", one(/^WipeClip_.*_x64-setup\.exe$/, "Windows installer"), `WipeClip_${version}_x64-setup.exe`);
add("darwin-aarch64", one(/^WipeClip\.app\.tar\.gz$/, "macOS update bundle"), `WipeClip_${version}_aarch64.app.tar.gz`);
copyFileSync(one(/^WipeClip_.*\.dmg$/, "macOS DMG"), path.join(out, `WipeClip_${version}_aarch64.dmg`));

const manifest = {
  version,
  notes: `https://github.com/${repo}/releases/tag/${tag}`,
  pub_date: new Date().toISOString(),
  platforms,
};
writeFileSync(path.join(out, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`latest.json for ${version}: ${Object.keys(platforms).join(", ")}`);
