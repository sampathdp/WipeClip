// Version bump for a desktop release. Usually run for you: by
// desktop/scripts/release-local.mjs (npm run desktop:release, builds on this
// machine) or by the Desktop workflow's "release" input.
//   node desktop/scripts/release.mjs 0.1.2 [--no-push]   (or: patch | minor | major)
// Sets the version everywhere the app reads it (package.json and its lock,
// src-tauri/tauri.conf.json, Cargo.toml and Cargo.lock), files the "next"
// notes in desktop/release-notes.json under that version (the app shows them
// as "What's new" after updating), commits, tags
// desktop-v<version> and pushes both. The tag push starts the Desktop
// workflow, which builds, signs and publishes the release - installed apps
// then offer the update. See docs/desktop/RELEASE.md (Updates).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..", "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const conf = path.join(root, "src-tauri", "tauri.conf.json");
const current = JSON.parse(readFileSync(conf, "utf8")).version;
const arg = process.argv[2];
// --no-push: commit and tag only (desktop/scripts/release-local.mjs builds
// first and pushes once the build has worked).
const noPush = process.argv.includes("--no-push");
if (!arg) fail(`Usage: npm run desktop:release -- <version|patch|minor|major>  (now ${current})`);

const [ma, mi, pa] = current.split(".").map(Number);
const next =
  arg === "patch" ? `${ma}.${mi}.${pa + 1}` : arg === "minor" ? `${ma}.${mi + 1}.0` : arg === "major" ? `${ma + 1}.0.0` : arg.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(next)) fail(`"${arg}" isn't a version like 1.2.3.`);
const cmp = (a, b) => a.map((v, i) => v - b[i]).find((d) => d !== 0) ?? 0;
if (cmp(next.split(".").map(Number), [ma, mi, pa]) <= 0) fail(`${next} must be higher than ${current}, or installed apps won't update to it.`);

if (git("status", "--porcelain")) fail("Commit or stash your changes first - the release commit should only change the version and notes.");

const notesFile = path.join(root, "desktop", "release-notes.json");
const notes = JSON.parse(readFileSync(notesFile, "utf8"));
const pending = (notes.next ?? []).map((n) => String(n).trim()).filter(Boolean);
if (!pending.length) fail(`Add what's new in this version to "next" in desktop/release-notes.json first (users see it after updating).`);
if (notes.releases.some((r) => r.version === next)) fail(`desktop/release-notes.json already has notes for ${next}.`);
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "master") fail(`Release from master (you're on ${branch}).`);
const tag = `desktop-v${next}`;
if (git("tag", "--list", tag)) fail(`Tag ${tag} already exists.`);

// The version in each file, nothing else touched.
const edit = (file, from, to) => {
  const p = path.join(root, file);
  const text = readFileSync(p, "utf8");
  if (!from.test(text)) fail(`Couldn't find the version in ${file}.`);
  writeFileSync(p, text.replace(from, to));
};
edit("package.json", /("version":\s*")[^"]+(")/, `$1${next}$2`);
// The lock's own entries: the top level and packages[""].
edit("package-lock.json", /^(\{\s*"name":\s*"[^"]+",\s*"version":\s*")[^"]+(")/, `$1${next}$2`);
edit("package-lock.json", /("packages":\s*\{\s*"":\s*\{\s*"name":\s*"[^"]+",\s*"version":\s*")[^"]+(")/, `$1${next}$2`);
edit("src-tauri/tauri.conf.json", /("version":\s*")[^"]+(")/, `$1${next}$2`);
edit("src-tauri/Cargo.toml", /^(version = ")[^"]+(")/m, `$1${next}$2`);
edit("src-tauri/Cargo.lock", /(name = "wipeclip"\r?\nversion = ")[^"]+(")/, `$1${next}$2`);
const date = new Date().toISOString().slice(0, 10);
writeFileSync(notesFile, JSON.stringify({ next: [], releases: [{ version: next, date, notes: pending }, ...notes.releases] }, null, 2) + "\n");

git("add", "package.json", "package-lock.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "desktop/release-notes.json");
git("commit", "-m", `chore: release desktop ${next}`);
git("tag", tag);
if (noPush) {
  console.log(`Committed and tagged ${tag} (not pushed).`);
  process.exit(0);
}
git("push", "origin", branch);
git("push", "origin", tag);
console.log(`Pushed ${tag}.`);
