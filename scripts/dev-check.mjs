// `npm run dev:check` - is the local stack up and wired together?
// Read-only: it never signs in, never spends credits and never writes to
// Supabase (the configured project may be production). See docs/LOCAL_DEV.md.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(root, true); // same files and precedence as `next dev`

const SITE = process.env.DEV_SITE_URL ?? "http://localhost:3000";
const TOOLS = process.env.NEXT_PUBLIC_TOOLS_API_URL ?? "";
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function backendVar(name) {
  const file = path.join(root, "backend", ".env");
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : "";
}

async function http(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeout ?? 10_000) });
  return res;
}

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ ok: true, name, detail });
  } catch (e) {
    results.push({ ok: false, name, detail: e instanceof Error ? e.message : String(e) });
  }
}
const fail = (msg) => {
  throw new Error(msg);
};

await check("Backend config (backend/.env)", async () => {
  const secret = backendVar("INTERNAL_API_SECRET");
  if (secret === null) fail("backend/.env missing - run `npm run dev:setup`");
  if (!secret) fail("INTERNAL_API_SECRET empty - run `npm run dev:setup`");
  if (secret !== (process.env.INTERNAL_API_SECRET ?? "")) fail("INTERNAL_API_SECRET differs from the site's - run `npm run dev:setup`");
  if (!backendVar("SITE_URL")) fail("SITE_URL unset - failed paid jobs wouldn't be refunded");
  return "ticket secret matches the site; SITE_URL set";
});

await check("Backend API", async () => {
  if (!TOOLS) fail("NEXT_PUBLIC_TOOLS_API_URL not set");
  const res = await http(`${TOOLS}/api/health`).catch(() => fail(`nothing answering at ${TOOLS} - is \`npm run dev\` running?`));
  if (!res.ok) fail(`${TOOLS}/api/health returned ${res.status}`);
  return `${TOOLS} healthy`;
});

await check("Website", async () => {
  const res = await http(`${SITE}/editor`, { timeout: 120_000 }).catch(() => fail(`nothing answering at ${SITE}`));
  if (!res.ok) fail(`${SITE}/editor returned ${res.status}`);
  return `${SITE} serves /editor`;
});

await check("Backend -> site ticket callback", async () => {
  // A deliberately invalid ticket: 400 proves the secret was accepted,
  // 403 means the two sides disagree. Nothing is claimed or refunded.
  const res = await http(`${SITE}/api/internal/ticket`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Process-Secret": process.env.INTERNAL_API_SECRET ?? "" },
    body: JSON.stringify({ action: "claim", ticket: "not-a-ticket" }),
    timeout: 60_000,
  }).catch(() => fail(`nothing answering at ${SITE}`));
  if (res.status === 403) fail("site rejected the secret - restart `npm run dev` after `npm run dev:setup`");
  if (res.status !== 400) fail(`unexpected ${res.status}`);
  return "site accepts the backend's secret";
});

await check("Desktop dev CORS", async () => {
  const res = await http(`${SITE}/api/credits`, {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:3100", "Access-Control-Request-Method": "GET" },
    timeout: 60_000,
  }).catch(() => fail(`nothing answering at ${SITE}`));
  if (res.status !== 204) fail("set DESKTOP_DEV_ORIGINS=http://localhost:3100 in .env.local (only needed for `npm run desktop:dev`)");
  return "localhost:3100 allowed";
});

await check("Supabase (read-only)", async () => {
  if (!SUPABASE || !ANON) fail("NEXT_PUBLIC_SUPABASE_URL / ANON_KEY not set");
  const res = await http(`${SUPABASE}/auth/v1/health`, { headers: { apikey: ANON } }).catch(() => fail(`can't reach ${SUPABASE}`));
  if (!res.ok) fail(`auth health returned ${res.status}`);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) fail("reachable, but SUPABASE_SERVICE_ROLE_KEY is unset - credits and AI cleanup will fail");
  return `${new URL(SUPABASE).host} reachable (shared project - local sign-ins and AI use write to it)`;
});

for (const r of results) console.log(`${r.ok ? "  ok  " : " FAIL "} ${r.name}: ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} problem(s).` : "\nEverything is up.");
process.exit(failed ? 1 : 0);
