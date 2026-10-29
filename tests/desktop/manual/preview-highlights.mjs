// Manual end-to-end check of highlight suggestions and creator presets in
// the real editor (headless Chrome against the desktop frontend's dev server):
//
//   npx next dev desktop --port 3100
//   node tests/desktop/manual/preview-highlights.mjs http://localhost:3100/ out-dir
//
// Seeds a saved project: a 20 s video with speech-like sound, a loud burst at
// 12-13 s, and a recording with a marker at 4 s and a burst of clicks at
// 12 s on the right of the screen. Then: Highlights > Find highlights;
// checks the marker and the burst are suggested with their reasons and the
// timeline didn't change; Keep / Reject / Start at playhead; Export clip
// opens "Export highlight" with the clip's length; Find again keeps the kept
// one; Canvas > Vertical preset (9:16, clip moved toward the clicks) and Ctrl+Z;
// reload: the highlights are still there. No picture measurement here (no
// local engine in a browser). Only Node built-ins.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ffmpegPath, launch, sleep } from "./cdp.mjs";

const url = process.argv[2] ?? "http://localhost:3100/";
const out = resolve(process.argv[3] ?? join(tmpdir(), "wipeclip-preview-highlights"));
mkdirSync(out, { recursive: true });
const video = join(out, "hl.mp4");
execFileSync(ffmpegPath(), [
  "-y", "-loglevel", "error",
  "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=20",
  // Talk-like tone (phrases with pauses), much louder at 12-13 s.
  "-f", "lavfi", "-i", "aevalsrc=(0.05+0.85*between(t\\,12\\,13))*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*4*t))*lt(mod(t\\,4)\\,3):s=48000:d=20",
  "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-profile:v", "baseline", "-c:a", "aac", "-shortest", "-movflags", "+faststart", video,
]);

const clicks = Array.from({ length: 8 }, (_, i) => [
  { type: "button", t: (11.8 + i * 0.3) * 1000, button: "left", down: true, x: 0.85, y: 0.5 },
  { type: "button", t: (11.8 + i * 0.3) * 1000 + 60, button: "left", down: false, x: 0.85, y: 0.5 },
]).flat();
const recording = {
  trackKind: "screen",
  folder: "C:/rec",
  events: [{ type: "move", t: 0, x: 0.8, y: 0.5 }, { type: "marker", t: 4000, id: "m1", label: "Good part" }, ...clicks, { type: "move", t: 15000, x: 0.82, y: 0.5 }],
  manifest: { format: "wipeclip.recording", version: 1, capture: { surface: "monitor", coordinateSpace: "capture", cursorCaptured: true, region: null, video: { width: 320, height: 180, frameRate: 30 } }, tracks: [] },
};
const project = { clips: [{ id: "clip_1", sourceId: "src_1", start: 0, end: 20 }], overlays: [], audio: [], effects: [] };
const meta = { id: "src_1", kind: "original", duration: 20, width: 320, height: 180, fps: 30, hasAudio: true, name: "hl.mp4", type: "video/mp4" };

const b = await launch();
const r = {};
const total = () => b.evaluate(`[...document.querySelectorAll("span")].map(s => s.textContent.trim()).find(t => /^\\/ \\d+:\\d\\d\\.\\d$/.test(t)) ?? null`);
const items = () =>
  b.evaluate(`[...document.querySelectorAll('ul[aria-label="Highlight suggestions"] > li')].map(li => ({ title: li.querySelector("p.font-semibold")?.textContent, reasons: [...li.querySelectorAll("ul li")].map(x => x.textContent), conf: li.querySelector("span.rounded")?.textContent }))`);
const clickIn = (n, label) => b.evaluate(`(() => { const li = document.querySelectorAll('ul[aria-label="Highlight suggestions"] > li')[${n}]; const btn = li && [...li.querySelectorAll("button")].find(x => x.textContent.trim().startsWith(${JSON.stringify(label)})); btn?.click(); return !!btn; })()`);
const find = async () => {
  await b.click("Find");
  for (let i = 0; i < 80 && (await b.evaluate(`document.body.textContent.includes("Mixing") || document.body.textContent.includes("Finding highlights…")`)); i++) await sleep(250);
  await sleep(300);
};
try {
  await b.goto(url);
  await b.seedProject(readFileSync(video).toString("base64"), project, meta, recording);
  await b.goto(url);
  if (!(await b.click("Open"))) throw new Error("No Open button - the saved project wasn't listed");
  await sleep(3000);
  r.totalBefore = await total();
  if (!(await b.click("Suggest moments"))) throw new Error("No Highlights tool button");
  await sleep(400);
  const t0 = Date.now();
  await find();
  r.findMs = Date.now() - t0;
  r.items = await items();
  r.hasMarker = r.items.some((h) => /Good part/.test(h.title) && h.conf === "high");
  r.hasBurst = r.items.some((h) => h.reasons.some((x) => /Sound jumps/.test(x)) && h.reasons.some((x) => /burst of input/.test(x)));
  r.pictureNote = await b.evaluate(`document.body.textContent.includes("The picture wasn't measured here")`);
  r.totalAfterFind = await total();

  // Keep the first, reject the second, edit the first's start.
  await clickIn(0, "Keep");
  await sleep(200);
  const n0 = r.items.length;
  await clickIn(1, "Reject");
  await sleep(300);
  r.afterReject = (await items()).length;
  r.rejectedNote = await b.evaluate(`document.body.textContent.includes("1 rejected")`);
  // Playhead to 2 s (Shift+Right = 1 s), then move the start there.
  await b.evaluate(`document.activeElement?.blur?.()`);
  await b.key("ArrowRight", "ArrowRight", 39, 8);
  await b.key("ArrowRight", "ArrowRight", 39, 8);
  await sleep(200);
  await clickIn(0, "Start at playhead");
  await sleep(300);
  r.editedNote = await b.evaluate(`document.body.textContent.includes("Range edited by you")`);

  await clickIn(0, "Export clip");
  await sleep(800);
  r.exportDialog = await b.evaluate(`document.querySelector('[role=dialog]')?.getAttribute("aria-label") ?? null`);
  r.exportLength = await b.evaluate(`[...document.querySelectorAll('[role=dialog] p.font-mono')].map(p => p.textContent)[0] ?? null`);
  await b.evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(x => x.getAttribute("aria-label") === "Close")?.click()`);
  await sleep(300);

  await find();
  const again = await items();
  r.keptSurvives = again.some((h) => /Good part/.test(h.title));
  r.stats = await b.evaluate(`[...document.querySelectorAll("p")].map(p => p.textContent).find(t => t.startsWith("This project so far")) ?? null`);

  // Preset: Vertical, then undo.
  await b.click("Canvas size and background");
  await sleep(400);
  await b.click("Vertical");
  await sleep(600);
  r.canvasAfterPreset = await b.evaluate(`[...document.querySelectorAll('[role=radiogroup][aria-label="Canvas size"] [role=radio]')].find(x => x.getAttribute("aria-checked") === "true")?.textContent ?? null`);
  r.presetMessage = await b.evaluate(`document.body.textContent.includes("preset applied")`);
  await b.evaluate(`document.activeElement?.blur?.()`);
  await b.key("z", "KeyZ", 90, 2);
  await sleep(500);
  r.canvasAfterUndo = await b.evaluate(`[...document.querySelectorAll('[role=radiogroup][aria-label="Canvas size"] [role=radio]')].find(x => x.getAttribute("aria-checked") === "true")?.textContent ?? null`);

  await sleep(1500); // autosave
  await b.goto(url);
  await b.click("Open");
  await sleep(3000);
  await b.click("Suggest moments");
  await sleep(400);
  r.itemsAfterReopen = (await items()).length;
  r.totalAtEnd = await total();
  r.n0 = n0;
  r.errors = b.errors.filter((e) => !/reading '(invoke|transformCallback)'/.test(e));
} finally {
  b.close();
}
writeFileSync(join(out, "result.json"), JSON.stringify(r, null, 2));
console.log(JSON.stringify(r, null, 2));
const ok =
  r.hasMarker && r.hasBurst && r.pictureNote && r.totalAfterFind === r.totalBefore && r.afterReject === r.n0 - 1 && r.rejectedNote && r.editedNote &&
  r.exportDialog === "Export highlight" && r.keptSurvives && r.canvasAfterPreset?.startsWith("9:16") && r.canvasAfterUndo?.startsWith("Original") &&
  r.itemsAfterReopen > 0 && r.totalAtEnd === r.totalBefore && r.errors.length === 0;
process.exit(ok ? 0 : 1);
