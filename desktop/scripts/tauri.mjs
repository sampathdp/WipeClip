// Runs the Tauri CLI for the desktop app with a Content Security Policy
// generated from the desktop build's env (desktop/.env*), so the CSP names
// the exact API hosts this build talks to instead of a wildcard.
//
//   node desktop/scripts/tauri.mjs dev            -> tauri dev
//   node desktop/scripts/tauri.mjs build [args]   -> tauri build [args]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { buildNotices, NOTICES_PATH } from "./notices.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.join(here, "..");
const root = path.join(desktopDir, "..");

const [mode, ...rest] = process.argv.slice(2);
if (mode !== "dev" && mode !== "build") {
  console.error("usage: node desktop/scripts/tauri.mjs <dev|build> [tauri args]");
  process.exit(2);
}
const dev = mode === "dev";
nextEnv.loadEnvConfig(desktopDir, dev);

const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_TOOLS_API_URL"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(", ")} - copy desktop/.env.example to desktop/.env.${dev ? "development" : "production"}.local and fill it in.`);
  process.exit(1);
}

// WIPECLIP_LOCAL_TEST_BUILD=1: a release build that talks to the local
// stack (npm run dev) so the packaged app can be tested end to end. Only
// http://localhost / 127.0.0.1 are let through; never ship such a build.
const localTest = !dev && process.env.WIPECLIP_LOCAL_TEST_BUILD === "1";
if (localTest) console.warn("LOCAL TEST BUILD: plain-http localhost APIs allowed. Do not distribute this build.");

function origin(name, fallback) {
  const raw = process.env[name] ?? fallback;
  const url = new URL(raw);
  const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (!dev && url.protocol !== "https:" && !(localTest && local)) {
    console.error(`${name} must be https:// for a release build (got ${url.origin}).`);
    process.exit(1);
  }
  return url.origin;
}

const site = origin("NEXT_PUBLIC_DESKTOP_SITE_ORIGIN", "https://www.wipeclip.co");
const tools = origin("NEXT_PUBLIC_TOOLS_API_URL");
const supabase = origin("NEXT_PUBLIC_SUPABASE_URL");

const connect = [
  "'self'",
  "ipc:",
  "http://ipc.localhost",
  "blob:",
  "data:",
  site,
  tools,
  supabase,
  supabase.replace(/^http/, "ws"), // Supabase realtime/auth websockets
  // Auto captions: Whisper model files and the ONNX runtime (see
  // src/lib/editor/captions.worker.ts).
  "https://huggingface.co",
  "https://*.huggingface.co",
  "https://*.hf.co",
  "https://cdn.jsdelivr.net",
  // The bundled processing engine (src-tauri/src/engine.rs) on a free port.
  "http://127.0.0.1:*",
];
const script = ["'self'", "'wasm-unsafe-eval'"];
if (dev) {
  connect.push("ws://localhost:3100", "http://localhost:3100");
  script.push("'unsafe-eval'"); // React dev tooling only; never in release builds
}

const config = {
  app: {
    security: {
      csp: {
        "default-src": "'self'",
        "script-src": script.join(" "),
        "style-src": "'self' 'unsafe-inline'",
        "img-src": "'self' blob: data:",
        "media-src": "'self' blob:",
        "font-src": "'self' data:",
        "worker-src": "'self' blob:",
        "connect-src": [...new Set(connect)].join(" "),
        "object-src": "'none'",
        "base-uri": "'self'",
        "form-action": "'none'",
        "frame-src": "'none'",
      },
    },
  },
};
// The packaged engine (backend/desktop.spec, copied here by CI). Without it
// the app still works, with processing on the cloud backend; CI sets
// WIPECLIP_REQUIRE_ENGINE=1 so a release can't ship without it by accident.
const engineDir = path.join(root, "src-tauri", "resources", "engine");
if (!dev) {
  const engine = existsSync(engineDir);
  const resources = {};
  if (engine) {
    resources["resources/engine/"] = "engine/";
  } else if (process.env.WIPECLIP_REQUIRE_ENGINE === "1") {
    console.error(`No engine at ${engineDir} - build it with backend/desktop.spec first.`);
    process.exit(1);
  } else {
    console.warn("No local engine bundled: this build processes video on the cloud backend.");
  }
  // Licence texts of everything shipped (desktop/scripts/notices.mjs); the
  // app opens it from the start screen.
  const notices = buildNotices({ engine });
  mkdirSync(path.dirname(NOTICES_PATH), { recursive: true });
  writeFileSync(NOTICES_PATH, notices);
  console.log(`Third-party notices: ${(notices.length / 1024).toFixed(0)} KB`);
  resources["resources/THIRD-PARTY-NOTICES.txt"] = "THIRD-PARTY-NOTICES.txt";
  config.bundle = { resources };
  // Signed update bundles (src-tauri/src/updater.rs) need the private key,
  // which only release builds have (CI secret). Other builds still install
  // and run, they just can't be offered as an update.
  if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
    config.bundle.createUpdaterArtifacts = true;
  } else if (process.env.WIPECLIP_REQUIRE_UPDATER === "1") {
    console.error("TAURI_SIGNING_PRIVATE_KEY is not set - a release build must produce signed update bundles.");
    process.exit(1);
  } else {
    console.warn("No TAURI_SIGNING_PRIVATE_KEY: no update bundles in this build.");
  }
}

const generated = path.join(root, "src-tauri", "tauri.generated.conf.json");
writeFileSync(generated, JSON.stringify(config, null, 2) + "\n");
console.log(`CSP connect-src: ${config.app.security.csp["connect-src"]}`);

const cli = require.resolve("@tauri-apps/cli/tauri.js");
const child = spawn(process.execPath, [cli, mode, "--config", generated, ...rest], { cwd: root, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
