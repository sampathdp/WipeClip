// Manual end-to-end check of Phase 3 tutorial tools in the real editor
// (needs Chrome and a running dev server; see preview-focus.mjs):
//
//   node tests/desktop/manual/preview-tutorial.mjs http://localhost:3100/ out-dir
//
// Opens a saved project (4-color video with speech-like sound, a pause
// in the middle) with a solid and a blur privacy mask and an arrow, checks
// the preview pixels, then runs Tutorial > Review > Analyze, accepts the
// suggested cut, checks the timeline got shorter, undoes it, plays with
// "Preview the result" (the pending cut must be skipped, nothing removed)
// and analyzes again (the mix's levels must be reused).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ffmpegPath, launch, sleep } from "./cdp.mjs";

const url = process.argv[2] ?? "http://localhost:3005/editor";
const out = resolve(process.argv[3] ?? join(tmpdir(), "wipeclip-preview-tutorial"));
mkdirSync(out, { recursive: true });
const video = join(out, "quad-audio.mp4");
const q = "s=320x180:r=30:d=8";
execFileSync(ffmpegPath(), [
  "-y", "-loglevel", "error",
  "-filter_complex", `color=red:${q}[a];color=lime:${q}[b];color=blue:${q}[c];color=white:${q}[d];[a][b][c][d]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0,format=yuv420p[v]`,
  // Tone (stand-in for speech) 0-2.5 s and 6-8 s; silence between.
  "-f", "lavfi", "-i", "aevalsrc=0.3*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*4*t))*(lt(t\\,2.5)+gte(t\\,6)):s=48000:d=8",
  "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-profile:v", "baseline", "-c:a", "aac", "-shortest", "-movflags", "+faststart", video,
]);

const base = { x: 0, y: 0, width: 0.2, rotation: 0, opacity: 1, animIn: "none", animOut: "none", hidden: false, locked: false };
const project = {
  clips: [{ id: "clip_1", sourceId: "src_1", start: 0, end: 8 }],
  overlays: [
    { ...base, id: "arrow", kind: "shape", start: 0, end: 8, x: 0.25, y: 0.75, width: 0.2, shape: { type: "arrow", color: "#f43f5e", filled: true, stroke: 0.08, aspect: 3, number: 1, text: "" } },
  ],
  audio: [],
  effects: [],
  masks: [
    { id: "solid", start: 0, end: 8, mode: "solid", strength: 0, color: "#ff00ff", x: 0.6, y: 0.6, w: 0.2, h: 0.2, space: "canvas", follow: "none", enabled: true },
    { id: "blur", start: 0, end: 8, mode: "blur", strength: 100, color: "#000000", x: 0.4, y: 0.05, w: 0.2, h: 0.35, space: "canvas", follow: "none", enabled: true },
  ],
};
const meta = { id: "src_1", kind: "original", duration: 8, width: 320, height: 180, fps: 30, hasAudio: true, name: "quad-audio.mp4", type: "video/mp4" };

const b = await launch();
const results = {};
try {
  await b.goto(url);
  await b.seedProject(readFileSync(video).toString("base64"), project, meta, null);
  await b.goto(url);
  if (!(await b.click("Open"))) throw new Error("No Open button - the saved project wasn't listed");
  await sleep(3000);
  for (let i = 0; i < 30; i++) await b.key("ArrowRight", "ArrowRight", 39); // 1 s
  await sleep(900);
  const [solid, blurMid, outside, arrow] = await b.stageColors(
    [
      [0.7, 0.7],
      [0.5, 0.2],
      [0.2, 0.2],
      [0.25, 0.75],
    ],
    join(out, "masks.png")
  );
  results.solidMagenta = solid[0] > 200 && solid[2] > 200 && solid[1] < 80;
  // Red|green boundary under the blur mixes both.
  results.blurMixes = blurMid[0] > 70 && blurMid[1] > 70;
  results.outsideSharpRed = outside[0] > 200 && outside[1] < 60;
  results.arrowDrawn = !(arrow[2] > 200 && arrow[0] < 80); // not plain blue
  results.colors = { solid, blurMid, outside, arrow };

  const total = () => b.evaluate(`[...document.querySelectorAll("span")].map(s => s.textContent.trim()).find(t => /^\\/ \\d+:\\d\\d\\.\\d$/.test(t)) ?? null`);
  results.totalBefore = await total();
  if (!(await b.click("Review pauses"))) throw new Error("No Tutorial tool button");
  await sleep(500);
  if (!(await b.click("Analyze recording"))) throw new Error("No Analyze button");
  for (let i = 0; i < 40 && !(await b.evaluate(`[...document.querySelectorAll("button")].some(b => /^Cut \\d/.test(b.textContent.trim()))`)); i++) await sleep(500);
  results.suggestionTitles = await b.evaluate(`[...document.querySelectorAll("li p.font-semibold")].map(p => p.textContent)`);
  results.cutClicked = await b.click("Cut ");
  await sleep(800);
  results.totalAfterCut = await total();
  await b.evaluate(`document.activeElement?.blur?.()`);
  await b.key("z", "KeyZ", 90, 2); // Ctrl+Z
  await sleep(800);
  results.totalAfterUndo = await total();

  // Preview the result: playback jumps over the pending cut (still not applied).
  const playhead = () => b.evaluate(`(() => { const t = [...document.querySelectorAll("*")].map(e => e.childNodes[0]?.textContent?.trim()).find(t => /^\\d+:\\d\\d\\.\\d+$/.test(t ?? "")); if (!t) return null; const [m, s] = t.split(":"); return Number(m) * 60 + Number(s); })()`);
  const cutRange = await b.evaluate(`(() => { const p = [...document.querySelectorAll("li")].map(li => li.textContent).find(t => /pause|dead time|silence/i.test(t)); return p ?? null; })()`);
  results.previewToggle = await b.evaluate(`(() => { const l = [...document.querySelectorAll("label")].find(l => l.textContent.trim().startsWith("Preview the result")); l?.querySelector("input")?.click(); return !!l?.querySelector("input")?.checked; })()`);
  await b.evaluate(`document.activeElement?.blur?.()`);
  for (let i = 0; i < 10; i++) await b.key("ArrowLeft", "ArrowLeft", 37, 8); // Shift: 1 s steps, back to the start
  await b.key(" ", "Space", 32); // play
  const seen = [];
  for (let i = 0; i < 45; i++) {
    await sleep(100);
    seen.push(await playhead());
  }
  await b.key(" ", "Space", 32); // pause
  results.previewPlayheads = seen;
  // The pause is 2.5-6 s; with 0.35 s kept each side the cut is ~2.85-5.65 s.
  results.previewSkipped = seen.some((t) => t !== null && t >= 5.6) && !seen.some((t) => t !== null && t > 3.0 && t < 5.5);
  results.totalWhilePreviewing = await total();
  results.cutRangeText = cutRange;

  // Analyze again with nothing changed: the mix's levels are reused.
  await b.evaluate(`(() => { window.__info = []; const i = console.info; console.info = (...a) => { window.__info.push(a.join(" ")); i(...a); }; })()`);
  await b.click("Analyze recording");
  for (let i = 0; i < 40 && !(await b.evaluate(`window.__info.some(l => l.startsWith("[review] analysis took"))`)); i++) await sleep(250);
  results.reanalysis = await b.evaluate(`window.__info.find(l => l.startsWith("[review] analysis took")) ?? null`);
  // Outside the desktop app the shell's Tauri calls fail; not what this checks.
  results.errors = b.errors.filter((e) => !/reading '(invoke|transformCallback)'/.test(e));
} finally {
  b.close();
}
writeFileSync(join(out, "result.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
const ok =
  results.solidMagenta && results.blurMixes && results.outsideSharpRed && results.arrowDrawn && results.cutClicked &&
  results.totalBefore !== results.totalAfterCut && results.totalAfterUndo === results.totalBefore &&
  results.previewSkipped && results.totalWhilePreviewing === results.totalBefore && /levels reused/.test(results.reanalysis ?? "") &&
  results.errors.length === 0;
process.exit(ok ? 0 : 1);
