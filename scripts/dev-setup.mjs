// One-time (and safe to re-run) local setup: `npm run dev:setup`.
//  1. backend/.venv with backend/requirements.txt installed
//  2. backend/.env, and a local-only INTERNAL_API_SECRET shared with the
//     site's .env.local, so job tickets are signed and checked like in
//     production
//  3. AI models downloaded now instead of on the first request
//  4. ffmpeg located (system install or the bundled imageio-ffmpeg copy)
// Never touches Supabase. Stop `npm run dev` first: Windows locks the
// backend's loaded packages, so reinstalling them fails while it runs.
// See docs/LOCAL_DEV.md.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.join(root, "backend");
const win = process.platform === "win32";
const venvPython = path.join(backend, ".venv", win ? "Scripts/python.exe" : "bin/python");

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", cwd: backend, ...opts });
  if (res.status !== 0) {
    console.error(`\nFailed: ${cmd} ${args.join(" ")}`);
    process.exit(res.status ?? 1);
  }
}

function step(title) {
  console.log(`\n== ${title}`);
}

// 1. Python environment -----------------------------------------------------
step("Python environment");
if (!existsSync(venvPython)) {
  const candidates = win ? [["py", ["-3.12"]], ["py", ["-3"]], ["python", []]] : [["python3.12", []], ["python3", []]];
  const found = candidates.find(([cmd, pre]) => spawnSync(cmd, [...pre, "--version"]).status === 0);
  if (!found) {
    console.error("No Python 3 found. Install Python 3.12 (what CI and the Docker image use) and re-run.");
    process.exit(1);
  }
  run(found[0], [...found[1], "-m", "venv", ".venv"]);
}
const version = spawnSync(venvPython, ["--version"], { encoding: "utf8" }).stdout.trim();
console.log(`${version} in backend/.venv`);
if (!/Python 3\.1[23]\./.test(version)) console.warn("Note: CI and Docker use Python 3.12; other versions may behave differently.");
run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", "requirements.txt"]);
// rembg pulls in opencv-python-headless, which installs into the same
// cv2/ folder as opencv-contrib-python-headless and can overwrite it -
// dropping cv2.xphoto, which AI cleanup's inpainting needs (video.py).
// Keep only the contrib build.
const pipList = spawnSync(venvPython, ["-m", "pip", "list", "--format=freeze", "--disable-pip-version-check"], { encoding: "utf8" }).stdout;
const contrib = pipList.match(/^opencv-contrib-python-headless==(\S+)/m)?.[1];
if (/^opencv-python-headless==/m.test(pipList) && contrib) {
  console.log("removing opencv-python-headless (it shadows the contrib build's cv2.xphoto)");
  run(venvPython, ["-m", "pip", "uninstall", "-y", "-q", "opencv-python-headless"]);
  run(venvPython, ["-m", "pip", "install", "-q", "--force-reinstall", "--no-deps", `opencv-contrib-python-headless==${contrib}`]);
}
run(venvPython, ["-c", "import cv2; cv2.xphoto.inpaint; print('OpenCV', cv2.__version__, 'with xphoto')"]);
console.log("requirements installed");

// 2. Env files ---------------------------------------------------------------
step("Env files");
const backendEnv = path.join(backend, ".env");
const siteEnv = path.join(root, ".env.local");

function readVar(file, name) {
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : "";
}

/** Sets NAME=value in an env file, appending it (with a comment) if absent.
 * keepExisting leaves a value the developer already chose alone. */
function setVar(file, name, value, comment, keepExisting = false) {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith(`${name}=`));
  if (i >= 0) {
    if (keepExisting || lines[i] === `${name}=${value}`) return;
    lines[i] = `${name}=${value}`;
    writeFileSync(file, lines.join(text.includes("\r\n") ? "\r\n" : "\n"));
    return;
  }
  const sep = !text || text.endsWith("\n") ? "" : "\n";
  appendFileSync(file, `${sep}\n# ${comment}\n${name}=${value}\n`);
}

if (!existsSync(backendEnv)) {
  copyFileSync(path.join(backend, ".env.example"), backendEnv);
  console.log("created backend/.env from backend/.env.example");
}
const secret =
  readVar(siteEnv, "INTERNAL_API_SECRET") || readVar(backendEnv, "INTERNAL_API_SECRET") || randomBytes(32).toString("hex");
setVar(backendEnv, "INTERNAL_API_SECRET", secret, "Local-only; must equal INTERNAL_API_SECRET in ../.env.local.");
setVar(backendEnv, "SITE_URL", "http://localhost:3000", "Local site, for claiming job tickets and refunds.", true);
setVar(siteEnv, "INTERNAL_API_SECRET", secret, "Local-only job-ticket secret, shared with backend/.env (docs/LOCAL_DEV.md).");
setVar(siteEnv, "NEXT_PUBLIC_TOOLS_API_URL", "http://localhost:8002", "Local FastAPI backend (npm run dev:backend).", true);
console.log("backend/.env and .env.local share a local INTERNAL_API_SECRET");
console.log(`site -> backend URL: ${readVar(siteEnv, "NEXT_PUBLIC_TOOLS_API_URL")}`);

// 3. Models ---------------------------------------------------------------------
step("AI models (first run downloads ~200 MB)");
run(venvPython, [
  "-c",
  [
    "from app.pipeline.bg_removal import _rembg_session",
    "from app.pipeline.nsfw_classifier import ensure_model",
    "_rembg_session(); print('background removal model ready')",
    "ensure_model(); print('moderation model ready')",
  ].join("\n"),
]);

// 4. ffmpeg -----------------------------------------------------------------------
step("ffmpeg");
run(venvPython, ["-c", "from app.pipeline.video import get_ffmpeg_path; print(get_ffmpeg_path())"]);

console.log("\nDone. Start everything with `npm run dev`, then check it with `npm run dev:check`.");
