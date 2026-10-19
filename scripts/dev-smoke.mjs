// `npm run dev:smoke` - end-to-end check of the local stack with a real
// video, through the same requests the editor makes:
//   probe -> AI cleanup (ticket from /api/process) -> export (ticket from /api/export)
// Runs signed out on purpose: anonymous jobs skip the credit ledger, so this
// never writes to Supabase (which may be production). Anonymous limits apply
// (3 cleanups and 3 exports per day per IP, in memory locally - restart
// `npm run dev` to reset them).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(root, true);
const SITE = process.env.DEV_SITE_URL ?? "http://localhost:3000";
const TOOLS = process.env.NEXT_PUBLIC_TOOLS_API_URL ?? "http://localhost:8002";
const videoPath = process.argv[2] ?? path.join(root, "public", "demo-video.mp4");
const video = new Blob([readFileSync(videoPath)], { type: "video/mp4" });
const name = path.basename(videoPath);

async function step(title, fn) {
  const t = Date.now();
  process.stdout.write(`${title} ... `);
  try {
    const detail = await fn();
    console.log(`ok (${((Date.now() - t) / 1000).toFixed(1)}s) ${detail ?? ""}`);
  } catch (e) {
    console.log("FAILED");
    console.error(`  ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

async function expectOk(res) {
  if (res.ok) return res;
  const body = await res.text().catch(() => "");
  throw new Error(`${res.status} ${res.url}: ${body.slice(0, 300)}`);
}

/** Checks a returned MP4 by probing it on the backend. */
async function describe(blob) {
  const form = new FormData();
  form.append("file", blob, "result.mp4");
  const res = await expectOk(await fetch(`${TOOLS}/api/video/probe`, { method: "POST", body: form }));
  await res.arrayBuffer();
  const h = (k) => res.headers.get(`x-video-${k}`);
  return `${(blob.size / 1024).toFixed(0)} KB, ${h("width")}x${h("height")}, ${Number(h("duration")).toFixed(2)}s, ${Number(h("fps")).toFixed(2)} fps, audio=${h("has-audio") === "1" ? "yes" : "no"}`;
}

async function ticket(route, payload) {
  const res = await expectOk(
    await fetch(`${SITE}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
  );
  return (await res.json()).ticket;
}

console.log(`site ${SITE}, backend ${TOOLS}, video ${name}\n`);

await step("1. Probe (validation + moderation)", () => describe(video).then((d) => `source: ${d}`));

let cleaned;
await step("2. AI cleanup, first 2s", async () => {
  const t = await ticket("/api/process", { resolution: "720p", filename: name });
  const form = new FormData();
  form.append("ticket", t);
  form.append("file", video, name);
  for (const [k, v] of Object.entries({ x: 40, y: 40, w: 120, h: 60 })) form.append(k, String(v));
  form.append("start", "0.000");
  form.append("end", "2.000");
  const res = await expectOk(await fetch(`${TOOLS}/api/video/process`, { method: "POST", body: form }));
  cleaned = await res.blob();
  return describe(cleaned);
});

await step("3. Ticket replay is refused", async () => {
  const t = await ticket("/api/process", { resolution: "720p", filename: name });
  const send = () => {
    const form = new FormData();
    form.append("ticket", t);
    form.append("file", video, name);
    for (const [k, v] of Object.entries({ x: 40, y: 40, w: 120, h: 60, start: "0", end: "1" })) form.append(k, String(v));
    return fetch(`${TOOLS}/api/video/process`, { method: "POST", body: form });
  };
  await expectOk(await send());
  const again = await send();
  if (again.status !== 409) throw new Error(`second use returned ${again.status}, expected 409`);
  return "second use -> 409";
});

await step("4. Export: trimmed clip + cleaned clip", async () => {
  const project = JSON.stringify({
    canvas: { aspect: "original", fit: "fit", background: { type: "color", color: "#000000", color2: "#000000" } },
    clips: [
      { source: 0, start: 0, end: 1.5 },
      { source: 1, start: 0, end: 1.5 },
    ],
    overlays: [],
    audio: [],
    effects: [],
  });
  const t = await ticket("/api/export", { project, resolution: "720p" });
  const form = new FormData();
  form.append("ticket", t);
  form.append("project", project);
  form.append("sources", video, name);
  form.append("sources", cleaned, "cleaned.mp4");
  const res = await expectOk(await fetch(`${TOOLS}/api/video/export`, { method: "POST", body: form }));
  return describe(await res.blob());
});

console.log("\nLocal stack works end to end.");
