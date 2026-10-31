// Speech model consent, cancel and offline handling in the real editor
// (headless Chrome, fresh profile so the model isn't cached):
//
//   npx next dev desktop --port 3100      (or serve a `next build desktop`)
//   node tests/desktop/manual/preview-transcript.mjs http://localhost:3100/ out-dir
//
// 1. Transcript panel: before consent it shows the one-time download notice
//    (size, memory, "never leaves this device") and no Transcribe button;
//    nothing is in the model cache.
// 2. Consent, Transcribe, then Cancel within a second: "cancelled" message,
//    no transcript, the Transcribe button is back.
// 3. A second browser with the model hosts unresolvable (offline for them):
//    the run fails with the connection message and the project is unchanged.
// Exits non-zero on the first failed check. Step 2 starts a real model
// download from Hugging Face and stops it after about a second.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ffmpegPath, launch, sleep } from "./cdp.mjs";

const url = process.argv[2] ?? "http://localhost:3100/";
const out = resolve(process.argv[3] ?? join(tmpdir(), "wipeclip-preview-transcript"));
mkdirSync(out, { recursive: true });
const video = join(out, "speech.mp4");
// A voice-like tone (pitch and loudness move like syllables) so the timeline counts as having sound.
execFileSync(ffmpegPath(), [
  "-y", "-loglevel", "error",
  "-f", "lavfi", "-i", "color=gray:s=320x180:r=30:d=8",
  "-f", "lavfi", "-i", "aevalsrc=0.3*sin(2*PI*(180+40*sin(2*PI*3*t))*t)*(0.5+0.5*sin(2*PI*4*t)):s=48000:d=8",
  "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-profile:v", "baseline", "-c:a", "aac", "-shortest", "-movflags", "+faststart", video,
]);
const project = { clips: [{ id: "clip_1", sourceId: "src_1", start: 0, end: 8 }], overlays: [], audio: [], effects: [] };
const meta = { id: "src_1", kind: "original", duration: 8, width: 320, height: 180, fps: 30, hasAudio: true, name: "speech.mp4", type: "video/mp4" };
const results = {};
const check = (name, ok, detail) => {
  results[name] = { ok, ...(detail === undefined ? {} : { detail }) };
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail === undefined ? "" : ` - ${JSON.stringify(detail)}`}`);
  if (!ok) throw new Error(name);
};

async function openTranscript(b) {
  await b.goto(url);
  await b.seedProject(readFileSync(video).toString("base64"), project, meta);
  // A simple static server sometimes drops a chunk ("This page couldn't load"): reload.
  for (let i = 0; i < 3; i++) {
    await b.goto(url);
    if (!/couldn.t load/.test(await b.evaluate("document.body.innerText"))) break;
  }
  if (!(await b.click("Open"))) throw new Error("No Open button - the saved project wasn't listed");
  const ready = await waitFor(b, () => b.evaluate(`[...document.querySelectorAll("button")].some(x => x.textContent.trim().startsWith("Transcript"))`), 20000);
  if (!ready && /couldn.t load/.test(await b.evaluate("document.body.innerText"))) {
    await b.evaluate("location.reload()");
    await sleep(3000);
  }
  if (!ready && !(await waitFor(b, () => b.evaluate(`[...document.querySelectorAll("button")].some(x => x.textContent.trim().startsWith("Transcript"))`), 20000))) throw new Error(`No Transcript tool button; page: ${(await b.evaluate(`document.body.innerText`)).slice(0, 400)}; console errors: ${JSON.stringify(b.errors?.slice?.(0, 3) ?? [])}; buttons: ${await b.evaluate(`[...document.querySelectorAll("button")].map(x => x.textContent.trim()).filter(Boolean).slice(0, 30).join(", ")`)}`);
  await b.click("Transcript");
  await sleep(800);
}
const panelText = (b) => b.evaluate(`document.querySelector('aside[aria-label="Properties"]')?.innerText ?? ""`);
const toast = (b) => b.evaluate(`[...document.querySelectorAll('[role=status][aria-live]')].map(e => e.innerText).join(" | ")`);
const modelFiles = (b) => b.evaluate(`caches.open("transformers-cache").then(c => c.keys()).then(k => k.length).catch(() => -1)`);
async function waitFor(b, fn, ms) {
  for (let t = 0; t < ms; t += 250) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  return null;
}

let b = await launch();
try {
  await openTranscript(b);
  // Wait for the "is the model cached?" check to finish.
  const text = await waitFor(b, async () => { const t = await panelText(b); return /Speech model needed|Transcribe/.test(t) ? t : null; }, 15000);
  check("consent notice before any download", /Speech model needed \(one time\)/.test(text ?? "") && /never leaves this device/.test(text ?? "") && /Download model \(\d+ MB\)/.test(text ?? ""), (text ?? "").slice(0, 200));
  check("no Transcribe button before consent", !(await b.evaluate(`[...document.querySelectorAll("button")].some(x => x.textContent.trim() === "Transcribe")`)));
  check("model cache empty before consent", (await modelFiles(b)) === 0, await modelFiles(b));

  await b.click("Download model");
  await sleep(300);
  check("Transcribe offered after consent", await b.click("Transcribe"));
  await sleep(1000);
  check("cancel button while running", await b.click("Cancel transcribing"));
  const msg = await waitFor(b, async () => { const t = await toast(b); return /cancelled/i.test(t) ? t : null; }, 20000);
  check("cancelled message", !!msg, msg);
  const after = await panelText(b);
  check("no transcript after cancel", /Transcribe/.test(after) && !/Cut selected words/.test(after));
} finally {
  await b.close();
}

// Offline for the model hosts: the download can't start.
b = await launch({ port: 9334, args: ["--host-resolver-rules=MAP huggingface.co ~NOTFOUND, MAP *.huggingface.co ~NOTFOUND, MAP *.hf.co ~NOTFOUND, MAP cdn.jsdelivr.net ~NOTFOUND"] });
try {
  await openTranscript(b);
  await waitFor(b, async () => /Speech model needed/.test(await panelText(b)), 15000);
  await b.click("Download model");
  await sleep(300);
  check("Transcribe offered offline", await b.click("Transcribe"));
  const msg = await waitFor(b, async () => { const t = await toast(b); return /failed/i.test(t) ? t : null; }, 60000);
  check("offline: clear failure message", /Check your connection/.test(msg ?? ""), msg);
  const after = await panelText(b);
  check("offline: project unchanged", /Transcribe/.test(after) && !/Cut selected words/.test(after));
} finally {
  await b.close();
}
console.log(JSON.stringify(results, null, 1));
