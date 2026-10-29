// Manual end-to-end check of the draft assistant in the real editor
// (headless Chrome against the desktop frontend's dev server):
//
//   npx next dev desktop --port 3100
//   node tests/desktop/manual/preview-draft.mjs http://localhost:3100/ out-dir
//
// Seeds a saved project: a 12 s 4-color video with speech-like sound and a
// 4 s pause (3-7 s), a recording with two deliberate clicks (1.5 s and
// 9 s) and a text layer. Then: Tutorial > Draft > Generate draft and Cancel
// at once (no draft may appear); Generate draft; checks the proposals (a
// cut, zooms, click highlights); Accept all; Apply; checks the timeline got
// shorter, the Zoom track has items and the text moved; Ctrl+Z (one step
// back to the original); reloads and reopens the project (the draft is
// still there, so nothing is re-analyzed). Only Node built-ins.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ffmpegPath, launch, sleep } from "./cdp.mjs";

const url = process.argv[2] ?? "http://localhost:3100/";
const out = resolve(process.argv[3] ?? join(tmpdir(), "wipeclip-preview-draft"));
mkdirSync(out, { recursive: true });
const video = join(out, "draft.mp4");
const q = "s=320x180:r=30:d=12";
execFileSync(ffmpegPath(), [
  "-y", "-loglevel", "error",
  "-filter_complex", `color=red:${q}[a];color=lime:${q}[b];color=blue:${q}[c];color=white:${q}[d];[a][b][c][d]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0,format=yuv420p[v]`,
  "-f", "lavfi", "-i", "aevalsrc=0.3*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*4*t))*(lt(t\\,3)+gte(t\\,7)):s=48000:d=12",
  "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-profile:v", "baseline", "-c:a", "aac", "-shortest", "-movflags", "+faststart", video,
]);

/** Settle on a target, click: what the recorder stores. */
const clickAt = (t, x, y) => [
  ...Array.from({ length: 13 }, (_, i) => ({ type: "move", t: (t - 0.9 + (0.4 * i) / 12) * 1000, x: 0.5 + (x - 0.5) * (i / 12), y: 0.5 + (y - 0.5) * (i / 12) })),
  { type: "move", t: (t - 0.2) * 1000, x, y },
  { type: "button", t: t * 1000, button: "left", down: true, x, y },
  { type: "button", t: t * 1000 + 80, button: "left", down: false, x, y },
];
const recording = {
  trackKind: "screen",
  folder: "C:/rec",
  events: [{ type: "move", t: 0, x: 0.5, y: 0.5 }, ...clickAt(1.5, 0.25, 0.25), ...clickAt(9, 0.75, 0.75)],
  manifest: { format: "wipeclip.recording", version: 1, capture: { surface: "monitor", coordinateSpace: "capture", cursorCaptured: true, region: null, video: { width: 320, height: 180, frameRate: 30 } }, tracks: [] },
};
const project = {
  clips: [{ id: "clip_1", sourceId: "src_1", start: 0, end: 12 }],
  overlays: [{ id: "title", kind: "text", start: 8, end: 11, x: 0.5, y: 0.85, width: 0.5, rotation: 0, opacity: 1, animIn: "none", animOut: "none", hidden: false, locked: false, text: { content: "After the pause", font: "sans", size: 0.08, weight: 700, italic: false, color: "#ffffff", background: "#000000", backgroundOpacity: 0, strokeColor: "#000000", strokeWidth: 0, shadow: false, align: "center", letterSpacing: 0, lineHeight: 1.2 } }],
  audio: [],
  effects: [],
};
const meta = { id: "src_1", kind: "original", duration: 12, width: 320, height: 180, fps: 30, hasAudio: true, name: "draft.mp4", type: "video/mp4" };

const b = await launch();
const r = {};
const total = () => b.evaluate(`[...document.querySelectorAll("span")].map(s => s.textContent.trim()).find(t => /^\\/ \\d+:\\d\\d\\.\\d$/.test(t)) ?? null`);
const draftItems = () => b.evaluate(`[...document.querySelectorAll("li p.font-semibold")].map(p => p.textContent)`);
const openTool = async () => {
  if (!(await b.click("Review pauses"))) throw new Error("No Tutorial tool button");
  await sleep(400);
  await b.evaluate(`[...document.querySelectorAll("[role=tab]")].find(t => t.textContent.trim() === "Draft")?.click()`);
  await sleep(400);
};
const textStart = () => b.evaluate(`(() => { const el = [...document.querySelectorAll("[role=button]")].find(e => (e.getAttribute("aria-label") || "").includes("After the pause")); return el?.getAttribute("aria-label") ?? null; })()`);
try {
  await b.goto(url);
  await b.seedProject(readFileSync(video).toString("base64"), project, meta, recording);
  await b.goto(url);
  if (!(await b.click("Open"))) throw new Error("No Open button - the saved project wasn't listed");
  await sleep(3000);
  r.totalBefore = await total();
  r.textBefore = await textStart();
  await openTool();

  // Cancelled generation leaves no draft.
  await b.click("Generate draft");
  await b.evaluate(`[...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Cancel")?.click()`);
  await sleep(1500);
  r.afterCancel = await draftItems();
  r.cancelledLeftNoDraft = !(await b.evaluate(`[...document.querySelectorAll("button")].some(x => x.textContent.trim() === "Accept all")`));

  // Generate for real.
  const t0 = Date.now();
  await b.click("Generate draft");
  for (let i = 0; i < 60 && !(await b.evaluate(`[...document.querySelectorAll("button")].some(x => x.textContent.trim() === "Accept all")`)); i++) await sleep(250);
  r.generateMs = Date.now() - t0;
  r.items = await draftItems();
  r.hasCut = r.items.some((t) => /pause|silence|dead time/i.test(t));
  r.hasZoom = r.items.some((t) => /^Zoom /.test(t));
  r.hasHighlights = r.items.some((t) => /^Highlight \d+ click/.test(t));
  r.totalAfterGenerate = await total();

  await b.click("Accept all");
  await sleep(300);
  r.applyLabel = await b.evaluate(`[...document.querySelectorAll("button")].map(x => x.textContent.trim()).find(t => /^Apply \\d+ accepted$/.test(t)) ?? null`);
  await b.click("Apply ");
  await sleep(1000);
  r.totalAfterApply = await total();
  r.textAfterApply = await textStart();
  r.zoomItems = await b.evaluate(`[...document.querySelectorAll("[role=button]")].filter(e => (e.getAttribute("aria-label") || "").startsWith("Zoom:")).length`);
  r.appliedNote = await b.evaluate(`document.body.textContent.includes("Applied. Everything is now ordinary timeline content")`);

  await b.evaluate(`document.activeElement?.blur?.()`);
  await b.key("z", "KeyZ", 90, 2); // Ctrl+Z
  await sleep(800);
  r.totalAfterUndo = await total();
  r.textAfterUndo = await textStart();
  r.zoomItemsAfterUndo = await b.evaluate(`[...document.querySelectorAll("[role=button]")].filter(e => (e.getAttribute("aria-label") || "").startsWith("Zoom:")).length`);

  // Reopen: the (unapplied) draft is saved with the project.
  await sleep(1500); // autosave
  await b.goto(url);
  await b.click("Open");
  await sleep(3000);
  await openTool();
  r.itemsAfterReopen = (await draftItems()).length;
  r.errors = b.errors.filter((e) => !/reading '(invoke|transformCallback)'/.test(e));
} finally {
  b.close();
}
writeFileSync(join(out, "result.json"), JSON.stringify(r, null, 2));
console.log(JSON.stringify(r, null, 2));
const ok =
  r.cancelledLeftNoDraft && r.hasCut && r.hasZoom && r.hasHighlights && r.totalAfterGenerate === r.totalBefore &&
  r.totalAfterApply !== r.totalBefore && r.zoomItems > 0 && r.appliedNote && r.textAfterApply !== r.textBefore &&
  r.totalAfterUndo === r.totalBefore && r.textAfterUndo === r.textBefore && r.zoomItemsAfterUndo === 0 &&
  r.itemsAfterReopen === r.items.length && r.errors.length === 0;
process.exit(ok ? 0 : 1);
