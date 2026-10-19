// Fails the desktop build if a server-side secret ended up in the static
// frontend (desktop/out) - everything there ships inside the installer and
// is readable by anyone who has it. Checks:
//  - known secret key formats (Payments.lk, Paddle, webhook secrets),
//  - JWTs whose role is service_role (the Supabase key that bypasses RLS),
//  - the exact values of server-only variables from the website's local
//    env files, when present.
// It also fails if the required public config (Supabase URL, backend URL)
// is missing from the build - an app built without it starts to a dead
// editor ("supabaseUrl is required").
// Prints only variable names and file paths, never values.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(here, "..", "out"));
const root = path.join(here, "..", "..");

if (!existsSync(out)) {
  console.error(`No build output at ${out}`);
  process.exit(1);
}

const patterns = [
  ["Payments.lk secret key", /\bsk_(live|test)_[A-Za-z0-9]{8,}/],
  ["webhook signing secret", /\bwhsec_[A-Za-z0-9+/=]{8,}/],
  ["Paddle API key", /\bpdl_(live|sdbx)_apikey_[A-Za-z0-9_]{8,}/],
  ["Paddle notification secret", /\bpdl_ntfset_[A-Za-z0-9_]{8,}/],
];

const SERVER_ONLY = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "INTERNAL_API_SECRET",
  "PAYMENTS_LK_SECRET_KEY",
  "PAYMENTS_LK_WEBHOOK_SECRET",
  "PADDLE_API_KEY",
  "PADDLE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "SITE_BYPASS_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
];
const secretValues = [];
for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  const p = path.join(root, file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#\r\n]*)"?/);
    if (m && SERVER_ONLY.includes(m[1]) && m[2].trim().length >= 12) secretValues.push([m[1], m[2].trim()]);
  }
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

const problems = [];
let scanned = 0;
for (const file of files(out)) {
  if (/\.(wasm|woff2?|png|jpe?g|webp|ico|mp4)$/i.test(file)) continue;
  const text = readFileSync(file, "utf8");
  scanned++;
  for (const [label, re] of patterns) if (re.test(text)) problems.push(`${label} in ${path.relative(out, file)}`);
  for (const jwt of text.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []) {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
      if (payload.role === "service_role") problems.push(`Supabase service_role key in ${path.relative(out, file)}`);
    } catch {
      // not a JWT after all
    }
  }
  for (const [name, value] of secretValues) if (text.includes(value)) problems.push(`${name} in ${path.relative(out, file)}`);
}

// Only for the real build output; the tests scan throwaway folders.
if (!process.argv[2]) {
  nextEnv.loadEnvConfig(path.join(here, ".."), false);
  const all = [...files(out)].filter((f) => f.endsWith(".js")).map((f) => readFileSync(f, "utf8")).join("\n");
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_TOOLS_API_URL"]) {
    const value = process.env[name];
    if (!value) problems.push(`${name} is not set for this build (see desktop/.env.example)`);
    else if (!all.includes(value)) problems.push(`${name} is set but missing from the bundle - delete desktop/.next and rebuild`);
  }
}

if (problems.length) {
  console.error("Bundle check FAILED - do not ship this build:");
  for (const p of [...new Set(problems)]) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Secret scan passed: ${scanned} files in ${path.relative(root, out)}, ${secretValues.length} local server secrets compared.`);
