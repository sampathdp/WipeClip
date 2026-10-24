// Builds THIRD-PARTY-NOTICES.txt for the desktop installer: the licence
// texts of the npm packages compiled into the app's UI, the Rust crates in
// the shell and, when the local engine is bundled, its Python packages and
// ffmpeg. tauri.mjs runs it before every release build and ships the file as
// a bundle resource; the app opens it from the start screen.
//
//   node desktop/scripts/notices.mjs [--engine] [out]
//
// Default out: src-tauri/resources/THIRD-PARTY-NOTICES.txt (gitignored).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
export const NOTICES_PATH = path.join(root, "src-tauri", "resources", "THIRD-PARTY-NOTICES.txt");

// Packages the desktop UI imports (desktop/app, src/components, src/lib).
// Their dependency trees are what the static bundle can contain.
const JS_ROOTS = [
  "react",
  "react-dom",
  "next",
  "@supabase/supabase-js",
  "@supabase/ssr",
  "@huggingface/transformers",
  "@tauri-apps/api",
  "@tauri-apps/plugin-deep-link",
  "@vercel/analytics",
];
// Node-only dependencies of those packages; the browser bundle leaves them out.
const JS_NOT_SHIPPED = new Set(["onnxruntime-node", "sharp"]);

const LICENSE_FILE = /^(licen[cs]e|copying|notice|third[-_]?party[-_]?notices)([-._].*)?$/i;

function licenseFilesIn(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => LICENSE_FILE.test(n) && !/\.(js|ts|rs|py|json|html)$/i.test(n))
    .map((n) => path.join(dir, n))
    .filter((p) => statSync(p).isFile())
    .sort()
    .map((p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n").trim());
}

// --- npm ------------------------------------------------------------------

function jsPackages() {
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8")).packages;
  // Node resolution: from the requiring package's folder up to the root.
  const resolve = (from, name) => {
    for (let dir = from; ; dir = dir.slice(0, Math.max(0, dir.lastIndexOf("/node_modules/")))) {
      const key = `${dir ? `${dir}/` : ""}node_modules/${name}`;
      if (lock[key]) return key;
      if (!dir) return null;
    }
  };
  const seen = new Set();
  const queue = JS_ROOTS.map((n) => resolve("", n)).filter(Boolean);
  while (queue.length) {
    const key = queue.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    for (const dep of Object.keys(lock[key].dependencies ?? {})) {
      if (JS_NOT_SHIPPED.has(dep)) continue;
      const found = resolve(key, dep);
      if (found) queue.push(found);
    }
  }
  return [...seen].map((key) => {
    const dir = path.join(root, key);
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    return { name: pkg.name, version: pkg.version, license: lock[key].license ?? pkg.license ?? "see text", texts: licenseFilesIn(dir) };
  });
}

// --- Rust -----------------------------------------------------------------

function rustPackages() {
  const host = /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))[1];
  const meta = JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--manifest-path", path.join(root, "src-tauri", "Cargo.toml"), "--filter-platform", host], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    }),
  );
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const pkgs = new Map(meta.packages.map((p) => [p.id, p]));
  // Normal dependencies only: build scripts and dev-dependencies aren't shipped.
  const seen = new Set();
  const queue = [meta.resolve.root];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id).deps) {
      if (dep.dep_kinds.some((k) => k.kind === null)) queue.push(dep.pkg);
    }
  }
  seen.delete(meta.resolve.root);
  return [...seen].map((id) => {
    const p = pkgs.get(id);
    const dir = path.dirname(p.manifest_path);
    const texts = licenseFilesIn(dir);
    if (p.license_file) texts.push(readFileSync(path.join(dir, p.license_file), "utf8").replace(/\r\n/g, "\n").trim());
    return { name: p.name, version: p.version, license: p.license ?? "see text", texts: [...new Set(texts)] };
  });
}

// --- Python engine ----------------------------------------------------------

function enginePython() {
  if (process.env.WIPECLIP_ENGINE_PYTHON) return process.env.WIPECLIP_ENGINE_PYTHON;
  for (const p of ["backend/.venv/Scripts/python.exe", "backend/.venv/bin/python"]) {
    if (existsSync(path.join(root, p))) return path.join(root, p);
  }
  return process.platform === "win32" ? "python" : "python3";
}

// Walks requirements-desktop.txt through installed metadata. Extras are
// skipped; other environment markers are kept (listing too much is harmless).
const PY_HELPER = String.raw`
import json, os, re, sys
from importlib import metadata
roots = json.loads(sys.argv[1])
norm = lambda n: re.sub(r"[-_.]+", "-", n).lower()
lic = re.compile(r"(licen[cs]e|copying|notice|third[-_]?party[-_]?notices)([-._][^/]*)?$", re.I)
seen, out, queue = set(), [], list(roots)
while queue:
    name = norm(queue.pop())
    if name in seen:
        continue
    seen.add(name)
    try:
        dist = metadata.distribution(name)
    except metadata.PackageNotFoundError:
        continue
    for req in dist.requires or []:
        if "extra ==" in req:
            continue
        queue.append(re.match(r"[A-Za-z0-9][A-Za-z0-9._-]*", req).group(0))
    texts = []
    for f in dist.files or []:
        base = os.path.basename(str(f))
        if lic.match(base) and not base.endswith((".py", ".pyc", ".json", ".html")):
            try:
                with open(f.locate(), encoding="utf-8", errors="replace") as fh:
                    texts.append(fh.read().replace("\r\n", "\n").strip())
            except OSError:
                pass
    m = dist.metadata
    out.append({"name": m["Name"], "version": m["Version"], "license": m.get("License-Expression") or m.get("License") or "see text", "texts": list(dict.fromkeys(texts))})
python_license = None
for p in (os.path.join(sys.base_prefix, "LICENSE.txt"), os.path.join(sys.base_prefix, "lib", "python%d.%d" % sys.version_info[:2], "LICENSE.txt")):
    if os.path.exists(p):
        python_license = open(p, encoding="utf-8").read().replace("\r\n", "\n").strip()
        break
print(json.dumps({"python": "%d.%d.%d" % sys.version_info[:3], "pythonLicense": python_license, "packages": out}))
`;

function pythonPackages() {
  const reqs = readFileSync(path.join(root, "backend", "requirements-desktop.txt"), "utf8")
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map((l) => /^[A-Za-z0-9][A-Za-z0-9._-]*/.exec(l)[0])
    .filter((n) => n.toLowerCase() !== "pyinstaller"); // build tool; its bootloader is noted separately
  const raw = execFileSync(enginePython(), ["-I", "-c", PY_HELPER, JSON.stringify(reqs)], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const data = JSON.parse(raw);
  // Licence metadata is sometimes wrong (nudenet says MIT, ships AGPL-3.0):
  // flag packages whose text names a GPL family licence.
  for (const p of data.packages) {
    const gpl = p.texts.find((t) => /GNU (AFFERO |LESSER )?GENERAL PUBLIC LICENSE/.test(t.slice(0, 400)));
    if (gpl && !/GPL/i.test(p.license)) p.license = `${p.license} (licence file: ${/GNU [A-Z ]+LICENSE/.exec(gpl)[0]})`;
  }
  return data;
}

function ffmpegNotice(engineDir) {
  const binDir = path.join(engineDir, "_internal", "imageio_ffmpeg", "binaries");
  const exe = existsSync(binDir) && readdirSync(binDir).find((n) => n.startsWith("ffmpeg"));
  if (!exe) return null;
  let version = "";
  try {
    version = execFileSync(path.join(binDir, exe), ["-hide_banner", "-version"], { encoding: "utf8" }).split("\n").slice(0, 3).join("\n").trim();
  } catch {
    version = exe;
  }
  return [
    `The local engine runs ffmpeg (${exe}) as a separate program. This build of`,
    "ffmpeg is licensed under the GNU General Public License, version 3 (text below).",
    "",
    version,
    "",
    "Corresponding source code: the FFmpeg release named above, https://ffmpeg.org/releases/,",
    "and the build configuration shown above (Windows builds: https://www.gyan.dev/ffmpeg/builds/).",
    "To request a copy of the source code, contact WipeClip at https://www.wipeclip.co/feedback.",
  ].join("\n");
}

// --- Output -------------------------------------------------------------------

const RULE = "=".repeat(78);

function section(title, intro, packages) {
  const list = [...packages].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const byText = new Map();
  const lines = [RULE, title, RULE, "", intro, ""];
  for (const p of list) {
    const id = `${p.name} ${p.version}`;
    lines.push(`  ${id} (${p.license})${p.texts.length ? "" : " - no licence file in the published package"}`);
    for (const t of p.texts) byText.set(t, [...(byText.get(t) ?? []), id]);
  }
  for (const [text, ids] of byText) lines.push("", "-".repeat(78), `Applies to: ${ids.join(", ")}`, "-".repeat(78), "", text);
  lines.push("", "");
  return lines.join("\n");
}

export function buildNotices({ engine = false } = {}) {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const parts = [
    "WipeClip desktop - third-party notices",
    "",
    `WipeClip ${pkg.version} includes the open-source software listed below. Each part`,
    "lists the components, then the licence texts they are distributed under.",
    "",
    "",
    section("User interface (JavaScript)", "Compiled into the app's user interface.", jsPackages()),
    section("Application shell (Rust)", "Compiled into the WipeClip program.", rustPackages()),
  ];
  if (engine) {
    const engineDir = path.join(root, "src-tauri", "resources", "engine");
    const py = pythonPackages();
    parts.push(
      section(
        "Local processing engine (Python)",
        [
          `Bundled in the engine folder with Python ${py.python}, packaged by PyInstaller, whose`,
          "bootloader is GPL-2.0 with an exception that allows distributing it with any program.",
          "The engine folder also holds the Microsoft Visual C++ runtime, redistributed under",
          "the Visual Studio redistribution terms.",
        ].join("\n"),
        py.packages,
      ),
    );
    if (py.pythonLicense) parts.push(section("Python", "The Python runtime bundled with the engine.", [{ name: "Python", version: py.python, license: "PSF-2.0", texts: [py.pythonLicense] }]));
    const apache = readFileSync(path.join(here, "..", "notices", "Apache-2.0.txt"), "utf8").replace(/\r\n/g, "\n").trim();
    parts.push(
      section(
        "Content check model",
        "Weights bundled with the engine (backend/app/pipeline/nsfw_classifier.py), unmodified.",
        [{ name: "Marqo/nsfw-image-detection-384", version: "0c26ec2", license: "Apache-2.0", texts: [apache] }],
      ),
    );
    const ffmpeg = ffmpegNotice(engineDir);
    if (ffmpeg) {
      const gpl = readFileSync(path.join(here, "..", "notices", "GPL-3.0.txt"), "utf8").replace(/\r\n/g, "\n").trim();
      parts.push([RULE, "ffmpeg", RULE, "", ffmpeg, "", "-".repeat(78), "", gpl, "", ""].join("\n"));
    }
  }
  parts.push(
    [
      RULE,
      "Downloaded on first use (not included in the installer)",
      RULE,
      "",
      "Auto captions download a Whisper speech model - large-v3-turbo with a usable GPU,",
      "small otherwise (OpenAI, MIT licence; ONNX conversion by onnx-community on Hugging",
      "Face) - and the ONNX Runtime Web files, only after you agree to the download.",
      "",
    ].join("\n"),
  );
  return parts.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const engine = args.includes("--engine");
  const out = args.find((a) => !a.startsWith("--")) ?? NOTICES_PATH;
  const text = buildNotices({ engine });
  writeFileSync(out, text);
  console.log(`Wrote ${out} (${(text.length / 1024).toFixed(0)} KB)`);
}
