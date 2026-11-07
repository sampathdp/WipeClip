// Builds and publishes a desktop release on this machine - no GitHub Actions
// minutes. Same result as the Desktop workflow's release run:
//
//   npm run desktop:release -- patch      (or minor, major, or 0.2.0)
//   npm run desktop:release -- patch --skip-tests
//   npm run desktop:release -- --publish-only   (retry the upload of the
//                                                 version already built)
//
// 1. Checks everything it needs before touching anything: the release token,
//    the updater signing key, desktop/.env.production.local, a clean master
//    that's up to date with origin.
// 2. Runs the desktop tests (cargo test, desktop JS tests).
// 3. desktop/scripts/release.mjs --no-push: version bump, release notes,
//    commit and tag - local only for now.
// 4. Builds the engine (PyInstaller, in backend/.venv-desktop) and the
//    Windows installer, signed for the updater, then writes latest.json
//    (desktop/scripts/update-manifest.mjs). If any of this fails, the
//    version commit and tag are undone, so nothing half-released remains.
// 5. Pushes the commit and tag, then publishes the release in the releases
//    repo: created as a draft, assets uploaded, then made the latest release,
//    so installed apps never see a release with missing files.
//
// Needs, once:
// - RELEASES_TOKEN: the fine-grained token with Contents read/write on the
//   releases repo (same as the repository secret). Put it in
//   desktop/.env.release.local as RELEASES_TOKEN=... (git-ignored) or set it
//   in the environment.
// - The updater key in ~/.tauri/wipeclip-updater.key and .password (or
//   TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD).
// - desktop/.env.production.local with the same public values as the
//   repository variables the workflow uses.
// - Python 3.11 (`py -3.11`), Rust, Node. Another Python: set DESKTOP_PYTHON.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const RELEASES_REPO = "sampathdp/wipeclip-releases"; // must match plugins.updater.endpoints

const root = path.join(import.meta.dirname, "..", "..");
const win = process.platform === "win32";
const args = process.argv.slice(2);
const publishOnly = args.includes("--publish-only");
const skipTests = args.includes("--skip-tests");
const bump = args.find((a) => !a.startsWith("--"));

const fail = (msg) => {
  console.error(`\n${msg}`);
  process.exit(1);
};
const step = (msg) => console.log(`\n=== ${msg}`);

const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
/** Runs a command with its output shown; throws if it fails. */
function run(cmd, cmdArgs = [], opts = {}) {
  // .cmd shims (npm) need a shell on Windows.
  const r = spawnSync(win ? [cmd, ...cmdArgs].map(quote).join(" ") : cmd, win ? [] : cmdArgs, {
    cwd: root,
    stdio: "inherit",
    shell: win,
    ...opts,
    env: { ...process.env, ...opts.env },
  });
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(" ")} failed (exit ${r.status ?? r.signal}).`);
}
const git = (...a) => {
  const r = spawnSync("git", a, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout.trim();
};

// --- Settings -----------------------------------------------------------------

function envFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map(([, k, v]) => [k, v.replace(/^(["'])(.*)\1$/, "$2")])
  );
}
const releaseEnv = envFile(path.join(root, "desktop", ".env.release.local"));
const token = process.env.RELEASES_TOKEN || releaseEnv.RELEASES_TOKEN;
if (!token) fail("RELEASES_TOKEN is missing: add RELEASES_TOKEN=<token> to desktop/.env.release.local (the fine-grained token for the releases repo).");

const keyDir = path.join(os.homedir(), ".tauri");
const readIf = (p) => (existsSync(p) ? readFileSync(p, "utf8").trim() : "");
const signingKey = process.env.TAURI_SIGNING_PRIVATE_KEY || releaseEnv.TAURI_SIGNING_PRIVATE_KEY || readIf(path.join(keyDir, "wipeclip-updater.key"));
const signingPassword =
  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? releaseEnv.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? readIf(path.join(keyDir, "wipeclip-updater.password"));
if (!publishOnly && !signingKey) fail(`Updater signing key not found (${path.join(keyDir, "wipeclip-updater.key")} or TAURI_SIGNING_PRIVATE_KEY).`);
if (!publishOnly && !existsSync(path.join(root, "desktop", ".env.production.local")))
  fail("desktop/.env.production.local is missing - copy desktop/.env.example and fill in the same values as the repository variables.");

const version = () => JSON.parse(readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8")).version;
const outDir = (tag) => path.join(root, "src-tauri", "target", "release-publish", tag);

// --- GitHub releases API --------------------------------------------------------

async function gh(method, url, body, headers = {}) {
  const res = await fetch(url.startsWith("https://") ? url : `https://api.github.com/repos/${RELEASES_REPO}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "wipeclip-release-script",
      ...(body && !Buffer.isBuffer(body) ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body && !Buffer.isBuffer(body) ? JSON.stringify(body) : body,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${url}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function publish(tag) {
  const dir = outDir(tag);
  if (!existsSync(path.join(dir, "latest.json"))) fail(`No built release in ${dir} - run a full release first.`);
  const notes = readFileSync(path.join(dir, "..", `${tag}.notes.md`), "utf8");
  const files = readdirSync(dir).filter((n) => statSync(path.join(dir, n)).isFile());

  step(`Publishing ${tag} to ${RELEASES_REPO}`);
  // Reuse a draft left by an earlier, interrupted attempt.
  const existing = (await gh("GET", "/releases?per_page=30")).find((r) => r.tag_name === tag);
  if (existing && !existing.draft) fail(`${tag} is already published in ${RELEASES_REPO}.`);
  const release =
    existing ?? (await gh("POST", "/releases", { tag_name: tag, name: `WipeClip ${tag.replace(/^desktop-v/, "")}`, body: notes, draft: true }));

  for (const name of files) {
    const old = release.assets?.find((a) => a.name === name);
    if (old) await gh("DELETE", `/releases/assets/${old.id}`);
    const data = readFileSync(path.join(dir, name));
    console.log(`  uploading ${name} (${(data.length / 1e6).toFixed(1)} MB)`);
    await gh("POST", `https://uploads.github.com/repos/${RELEASES_REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, data, {
      "Content-Type": "application/octet-stream",
    });
  }
  // Only now does it become the latest release that apps and the website see.
  await gh("PATCH", `/releases/${release.id}`, { draft: false, make_latest: "true", body: notes });
  console.log(`\nPublished ${tag}: https://github.com/${RELEASES_REPO}/releases/tag/${tag}`);
}

// --- Build ------------------------------------------------------------------------

function python() {
  if (process.env.DESKTOP_PYTHON) return [process.env.DESKTOP_PYTHON];
  if (win) {
    const has311 = spawnSync("py", ["-3.11", "--version"], { encoding: "utf8" }).status === 0;
    if (!has311) console.warn("Python 3.11 not found (py -3.11); using the default py. CI builds the engine with 3.11.");
    return has311 ? ["py", "-3.11"] : ["py", "-3"];
  }
  return ["python3.11"];
}

function buildEngine() {
  step("Building the engine");
  const backend = path.join(root, "backend");
  const venv = path.join(backend, ".venv-desktop");
  const py = path.join(venv, win ? "Scripts/python.exe" : "bin/python");
  if (!existsSync(py)) {
    const [cmd, ...pre] = python();
    run(cmd, [...pre, "-m", "venv", venv]);
  }
  run(py, ["-m", "pip", "install", "-q", "-r", "requirements-desktop.txt"], { cwd: backend });
  run(py, ["-m", "app.pipeline.nsfw_classifier"], { cwd: backend });
  run(py, ["-m", "app.pipeline.matte"], { cwd: backend });
  run(py, ["-m", "app.pipeline.ocr"], { cwd: backend });
  run(py, ["-m", "PyInstaller", "desktop.spec", "--noconfirm"], { cwd: backend });
  const engine = path.join(root, "src-tauri", "resources", "engine");
  rmSync(engine, { recursive: true, force: true });
  mkdirSync(path.dirname(engine), { recursive: true });
  cpSync(path.join(backend, "dist", "wipeclip-engine"), engine, { recursive: true });
}

function buildApp(tag) {
  step("Building the app");
  // Old installers in the bundle folder would confuse update-manifest.mjs.
  rmSync(path.join(root, "src-tauri", "target", "release", "bundle"), { recursive: true, force: true });
  run("npm", ["run", "desktop:build", "--", "--bundles", "nsis"], {
    env: {
      WIPECLIP_REQUIRE_ENGINE: "1",
      WIPECLIP_REQUIRE_UPDATER: "1",
      TAURI_SIGNING_PRIVATE_KEY: signingKey,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: signingPassword,
    },
  });
  step("Writing latest.json");
  const dir = outDir(tag);
  rmSync(dir, { recursive: true, force: true });
  run("node", [
    "desktop/scripts/update-manifest.mjs",
    "src-tauri/target/release/bundle",
    dir,
    tag,
    RELEASES_REPO,
    path.join(dir, "..", `${tag}.notes.md`),
  ]);
}

// --- Main -------------------------------------------------------------------------

if (publishOnly) {
  const tag = `desktop-v${version()}`;
  if (!git("tag", "--list", tag)) fail(`Tag ${tag} doesn't exist - nothing was built for this version.`);
  step("Pushing commit and tag");
  run("git", ["push", "origin", "master"]);
  run("git", ["push", "origin", tag]);
  await publish(tag);
  process.exit(0);
}

if (!bump) fail("Usage: npm run desktop:release -- <patch|minor|major|x.y.z> [--skip-tests]   or   -- --publish-only");
if (win && process.arch !== "x64") fail("Build releases on an x64 Windows machine (the installer is x64).");
if (!win) fail("Releases are Windows only: build them on Windows (or use Actions > Desktop > Run workflow).");

// Fail now, not after a long build, if the push would be refused.
step("Checking master is up to date");
git("fetch", "origin", "master");
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "master") fail("Release from master.");
if (git("status", "--porcelain")) fail("Commit or stash your changes first - the release commit should only change the version and notes.");
if (Number(git("rev-list", "--count", "HEAD..origin/master")) > 0) fail("origin/master has commits you don't have - pull first.");

if (!skipTests) {
  step("Running tests");
  run("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"]);
  run("npm", ["run", "desktop:test:js"]);
}

step("Version bump");
const before = git("rev-parse", "HEAD");
run("node", ["desktop/scripts/release.mjs", bump, "--no-push"]);
const tag = `desktop-v${version()}`;

try {
  buildEngine();
  buildApp(tag);
} catch (e) {
  console.error(`\n${e.message}`);
  console.error(`Undoing the version commit and tag ${tag} - nothing was pushed or published.`);
  git("tag", "-d", tag);
  git("reset", "--hard", before);
  process.exit(1);
}

step("Pushing commit and tag");
run("git", ["push", "origin", "master"]);
run("git", ["push", "origin", tag]);

try {
  await publish(tag);
} catch (e) {
  fail(`${e.message}\n\nThe build is kept in ${outDir(tag)}. Fix the problem, then: npm run desktop:release -- --publish-only`);
}
