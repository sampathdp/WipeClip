// Several video layers at once in the real editor (headless Chrome): the
// preview's pixels for cropped layers in a grid (the same picture the
// export test checks: backend/tests/test_layer_compose.py), split-screen
// presets, undo, duplicating, renaming, hiding, locking, stacking order,
// aligning, and saving and reopening the project.
//
//   npx next dev desktop --port 3100      (or serve a `next build desktop`)
//   node tests/desktop/manual/preview-layers.mjs http://localhost:3100/ out-dir
//
// Exits non-zero when a check fails.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ffmpegPath, launch, sleep } from "./cdp.mjs";

const url = process.argv[2] ?? "http://localhost:3100/";
const out = resolve(process.argv[3] ?? join(tmpdir(), "wipeclip-preview-layers"));
mkdirSync(out, { recursive: true });
const video = join(out, "quad.mp4");
const q = "s=320x180:r=30:d=8";
execFileSync(ffmpegPath(), [
  "-y", "-loglevel", "error",
  "-filter_complex", `color=red:${q}[a];color=lime:${q}[b];color=blue:${q}[c];color=white:${q}[d];[a][b][c][d]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0,format=yuv420p[v]`,
  "-f", "lavfi", "-i", "sine=f=440:d=8",
  "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-profile:v", "baseline", "-c:a", "aac", "-shortest", "-movflags", "+faststart", video,
]);

const layer = (id, x, y, width, extra = {}) => ({
  id, kind: "video", sourceId: "src_1", offset: 0, volume: 0, start: 0, end: 8, x, y, width, rotation: 0, opacity: 1, animIn: "none", animOut: "none", hidden: false, locked: false, ...extra,
});
const RED = { x: 0, y: 0, w: 0.5, h: 0.5 };
const GREEN = { x: 0.5, y: 0, w: 0.5, h: 0.5 };
const BLUE = { x: 0, y: 0.5, w: 0.5, h: 0.5 };
const WHITE = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
// Four layers, each a different quarter of the video, in a 2 x 2 grid - the
// opposite colour to the main video's under each.
const project = {
  clips: [{ id: "clip_1", sourceId: "src_1", start: 0, end: 8 }],
  overlays: [
    layer("tl", 0.25, 0.25, 0.5, { crop: WHITE, name: "Top left" }),
    layer("tr", 0.75, 0.25, 0.5, { crop: BLUE }),
    layer("bl", 0.25, 0.75, 0.5, { crop: GREEN }),
    layer("br", 0.75, 0.75, 0.5, { crop: RED }),
  ],
  audio: [],
  effects: [],
};
const meta = { id: "src_1", kind: "original", duration: 8, width: 320, height: 180, fps: 30, hasAudio: true, name: "quad.mp4", type: "video/mp4" };

const name = ([r, g, b]) =>
  r > 200 && g > 200 && b > 200 ? "white" : r > 180 && g < 90 && b < 90 ? "red" : g > 180 && r < 90 && b < 90 ? "green" : b > 180 && r < 90 && g < 90 ? "blue" : `rgb(${r},${g},${b})`;

const b = await launch();
const results = {};
const checks = {};
const expect = (label, got, want) => {
  checks[label] = JSON.stringify(got) === JSON.stringify(want);
  if (!checks[label]) results[`FAILED ${label}`] = { got, want };
};
const colors = async (points, file) => (await b.stageColors(points, join(out, file))).map(name);
/** The saved project, read back from the editor's own store. */
const saved = () =>
  b.evaluate(`(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open("wipeclip-editor"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const v = await new Promise((res, rej) => { const q = db.transaction("projects").objectStore("projects").get("prj_seed"); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    db.close();
    return v.project;
  })()`);
const mod = 2; // Ctrl
const open = async () => {
  await b.goto(url);
  if (!(await b.click("Open"))) throw new Error("No Open button - the saved project wasn't listed");
  await sleep(3000);
  for (let i = 0; i < 30; i++) await b.key("ArrowRight", "ArrowRight", 39); // 1 s
  await sleep(900);
};
// The centres of the four quarters, and points just either side of the middle lines.
const QUARTERS = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
const SEAMS = [[0.485, 0.25], [0.515, 0.25], [0.25, 0.47], [0.25, 0.53]];

try {
  await b.goto(url);
  await b.seedProject(readFileSync(video).toString("base64"), project, meta, null);
  await open();

  // 1. Cropped layers in a grid: the picture the export test expects.
  expect("grid of cropped layers", await colors(QUARTERS, "1-grid.png"), ["white", "blue", "green", "red"]);
  expect("no gaps or overlap at the middle lines", await colors(SEAMS, "1-grid.png"), ["white", "blue", "white", "green"]);

  // 2. Split screen > Side by side: the main video (cropped to its middle)
  // on the left, the bottom layer on the right; the other three stay put.
  if (!(await b.click("Canvas"))) throw new Error("No Canvas tool");
  await sleep(300);
  if (!(await b.click("Split screen"))) throw new Error("No Split screen tab");
  await sleep(400);
  results.layoutPanel = await b.evaluate(`!!document.querySelector('section[aria-label="Split screen"]')`);
  if (!(await b.click("Two equal screens, left and right"))) throw new Error("No side by side preset");
  await sleep(900);
  let p = await saved();
  const tl = p.overlays.find((o) => o.id === "tl");
  expect("layout: first layer fills the right half", { x: tl.x, y: tl.y, width: tl.width, crop: tl.crop }, { x: 0.75, y: 0.5, width: 0.5, crop: { x: 0.25, y: 0, w: 0.5, h: 1 } });
  expect("layout: main video in the left half", { x: p.clips[0].transform.x, scale: p.clips[0].transform.scale, crop: p.clips[0].crop }, { x: 0.25, scale: 1, crop: { x: 0.25, y: 0, w: 0.5, h: 1 } });
  expect("layout: the slot is kept", p.mainSlot, { x: 0, y: 0, w: 0.5, h: 1, fit: "fill" });
  expect("layout: every layer is still its own", p.overlays.map((o) => o.id), ["tl", "tr", "bl", "br"]);

  // 3. 2 x 2 grid of the four layers, without the main video.
  await b.evaluate(`(() => { const c = [...document.querySelectorAll('input[type=checkbox]')].find((i) => i.parentElement.textContent.includes("main video takes")); if (c.checked) c.click(); })()`);
  await sleep(200);
  if (!(await b.click("Four equal screens"))) throw new Error("No grid preset");
  await sleep(900);
  // Each layer whole in its quarter now ("fill" from the whole frame): the
  // four colours repeat in every quarter.
  expect("grid preset: four whole pictures", await colors([[0.125, 0.125], [0.375, 0.125], [0.625, 0.125], [0.875, 0.375], [0.125, 0.875], [0.875, 0.875]], "3-grid-preset.png"), ["red", "green", "red", "white", "blue", "white"]);

  // 4. Undo both layouts: back to the seeded picture.
  await b.key("z", "KeyZ", 90, mod);
  await b.key("z", "KeyZ", 90, mod);
  await sleep(900);
  expect("undo restores the grid", await colors(QUARTERS, "4-undo.png"), ["white", "blue", "green", "red"]);
  p = await saved();
  expect("undo restores the main video", { t: p.clips[0].transform, slot: p.mainSlot ?? null }, { t: { x: 0.5, y: 0.5, scale: 1, rotation: 0 }, slot: null });
  // Redo, then undo again: the same.
  await b.key("y", "KeyY", 89, mod);
  await sleep(500);
  await b.key("z", "KeyZ", 90, mod);
  await sleep(900);
  expect("redo then undo", await colors(QUARTERS, "4-redo-undo.png"), ["white", "blue", "green", "red"]);

  // 5. Layers panel: names, types, duplicate, rename, hide, lock, order.
  if (!(await b.click("Elements"))) throw new Error("No Elements tool");
  await sleep(300);
  if (!(await b.click("Layers"))) throw new Error("No Layers tab");
  await sleep(400);
  const rows = () => b.evaluate(`[...document.querySelectorAll('section[aria-label="Layers"] li')].map((li) => li.querySelector("span.truncate")?.textContent ?? "")`);
  expect("layers listed top first, named", await rows(), ["quad.mp4", "quad.mp4", "quad.mp4", "Top left"]);
  // Duplicate the top one (br, red): the copy sits on it, selected.
  await b.evaluate(`document.querySelector('section[aria-label="Layers"] li button[aria-label="Duplicate layer"]').click()`);
  await sleep(900);
  p = await saved();
  expect("duplicate: one more layer, right above the original", p.overlays.map((o) => (o.id.startsWith("ovl_") ? "copy" : o.id)), ["tl", "tr", "bl", "br", "copy"]);
  const copy = p.overlays[4];
  const br = p.overlays[3];
  expect("duplicate: same source, timing, transform and crop", { ...copy, id: "br" }, br);
  // Hide the copy's original: the copy still shows there (independent layers).
  await b.evaluate(`[...document.querySelectorAll('section[aria-label="Layers"] li')][1].querySelector('button[aria-label="Hide layer"]').click()`);
  await sleep(700);
  expect("hiding the original leaves the copy", (await colors([[0.75, 0.75]], "5-hidden-original.png"))[0], "red");
  // Hide the copy too: the main video (white there) shows through.
  await b.evaluate(`[...document.querySelectorAll('section[aria-label="Layers"] li')][0].querySelector('button[aria-label="Hide layer"]').click()`);
  await sleep(700);
  expect("hiding both shows the main video", (await colors([[0.75, 0.75]], "5-hidden-both.png"))[0], "white");
  // Lock the bottom-left layer.
  await b.evaluate(`[...document.querySelectorAll('section[aria-label="Layers"] li')][2].querySelector('button[aria-label="Lock layer"]').click()`);
  await sleep(1300); // past the autosave
  p = await saved();
  expect("lock", p.overlays.find((o) => o.id === "bl").locked, true);
  expect("hidden flags", p.overlays.map((o) => !!o.hidden), [false, false, false, true, true]);
  // Bring "Top left" (bottom of the list) forward one step.
  await b.evaluate(`[...document.querySelectorAll('section[aria-label="Layers"] li')][4].querySelector('button[aria-label="Bring forward"]').click()`);
  await sleep(1300);
  p = await saved();
  expect("order: one step forward", p.overlays.map((o) => (o.id.startsWith("ovl_") ? "copy" : o.id)), ["tr", "tl", "bl", "br", "copy"]);

  // 6. Select "Top left", align it to the right edge and the bottom: it
  // covers the bottom-right quarter (both layers there are hidden).
  await b.evaluate(`[...document.querySelectorAll('section[aria-label="Layers"] li')][3].querySelector("button").click()`);
  await sleep(500);
  if (!(await b.click("Right edge of the canvas"))) throw new Error("No align button");
  await sleep(300);
  if (!(await b.click("Bottom edge of the canvas"))) throw new Error("No align button");
  await sleep(900);
  p = await saved();
  const moved = p.overlays.find((o) => o.id === "tl");
  expect("align right and bottom", { x: moved.x, y: moved.y }, { x: 0.75, y: 0.75 });
  expect("aligned layer drawn there", (await colors([[0.75, 0.75], [0.25, 0.25]], "6-aligned.png")), ["white", "red"]);
  // Ctrl+Left twice: 1% left.
  await b.key("ArrowLeft", "ArrowLeft", 37, mod);
  await b.key("ArrowLeft", "ArrowLeft", 37, mod);
  await sleep(900);
  p = await saved();
  expect("nudge with Ctrl+arrows", Math.round(p.overlays.find((o) => o.id === "tl").x * 1000), 740);

  // 7. Reopen: everything is as saved.
  const before = await saved();
  await open();
  await sleep(1200);
  expect("reopened project is the same", await saved(), before);
  expect("reopened picture", (await colors([[0.25, 0.25], [0.75, 0.25], [0.25, 0.75]], "7-reopened.png")), ["red", "blue", "green"]);

  // 8. Dragging on the preview. Layers now: "tr" (blue) in the top-right
  // quarter, "tl" (white) at 0.74 / 0.75, "bl" locked; the rest hidden.
  const stage = () => b.evaluate(`(() => { const r = document.querySelector(".touch-none.select-none").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const centreOf = (label, nth = 0) =>
    b.evaluate(`(() => { const r = document.querySelectorAll('button[aria-label="${label}"]')[${nth}].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  /** Presses at `from`, moves to `to` in steps, releases (screen pixels). */
  const dragTo = async (from, to, modifiers = 0) => {
    const ev = (type, x, y, buttons) => b.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1, modifiers });
    await ev("mouseMoved", from.x, from.y, 0);
    await ev("mousePressed", from.x, from.y, 1);
    for (let i = 1; i <= 6; i++) await ev("mouseMoved", from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6, 1);
    await sleep(120);
    await ev("mouseReleased", to.x, to.y, 0);
    await sleep(1300); // past the autosave
  };
  const at = (st, fx, fy) => ({ x: st.x + fx * st.w, y: st.y + fy * st.h });
  const layerNow = async (id) => (await saved()).overlays.find((o) => o.id === id);
  const round = (v) => Math.round(v * 1000) / 1000;
  let st = await stage();

  // A move that ends 0.3% short of the canvas centre and 0.2% off the top
  // edge: snapped onto both.
  await dragTo(at(st, 0.75, 0.25), at(st, 0.75 - 0.247, 0.252));
  let tr = await layerNow("tr");
  expect("drag: snaps to the canvas centre and top edge", { x: round(tr.x), y: round(tr.y) }, { x: 0.5, y: 0.25 });
  // The same kind of move with Alt held: lands where it was dropped.
  await dragTo(at(st, 0.5, 0.25), at(st, 0.5 + 0.103, 0.25 + 0.052), 1);
  tr = await layerNow("tr");
  expect("drag with Alt: no snapping", { x: round(tr.x), y: round(tr.y) }, { x: 0.603, y: 0.302 });
  await b.key("z", "KeyZ", 90, mod);
  await sleep(1300);
  tr = await layerNow("tr");
  expect("a drag is one undo step", { x: round(tr.x), y: round(tr.y) }, { x: 0.5, y: 0.25 });

  // Resize by the bottom-right corner, a quarter of the way to the opposite
  // corner: three quarters the size, the top-left corner where it was.
  const corner = await centreOf("Resize layer", 3);
  await dragTo(corner, { x: corner.x - 0.125 * st.w, y: corner.y - 0.125 * st.h });
  tr = await layerNow("tr");
  expect("resize: opposite corner fixed, proportions kept", { width: round(tr.width), left: round(tr.x - tr.width / 2), top: round(tr.y - tr.width / 2) }, { width: 0.375, left: 0.25, top: 0 });

  // Crop by the right edge: in by 5% of the canvas. The picture keeps its
  // size; the box and the crop lose the same share (0.05 / 0.375).
  const edge = await centreOf("Crop the right edge");
  await dragTo(edge, { x: edge.x - 0.05 * st.w, y: edge.y });
  tr = await layerNow("tr");
  expect("crop by an edge", { width: round(tr.width), left: round(tr.x - tr.width / 2), crop: { x: tr.crop.x, y: tr.crop.y, w: round(tr.crop.w), h: tr.crop.h } }, { width: 0.325, left: 0.25, crop: { x: 0, y: 0.5, w: 0.433, h: 0.5 } });
  expect("cropped layer drawn: blue, then the main video past its new edge", await colors([[0.35, 0.12], [0.56, 0.12], [0.6, 0.12]], "8-cropped.png"), ["blue", "blue", "green"]);

  // Ctrl+click adds the other layer; dragging one moves both by the same amount.
  const tlBefore = await layerNow("tl");
  const trBefore = await layerNow("tr");
  await dragTo(at(st, 0.9, 0.9), at(st, 0.9, 0.9), 2);
  results.pickedCount = await b.evaluate(`[...document.querySelectorAll("span, button")].map((e) => e.textContent.trim()).find((t) => /^2 selected/.test(t)) ?? null`);
  checks["ctrl+click picks a second layer"] = results.pickedCount !== null;
  await dragTo(at(st, 0.35, 0.12), at(st, 0.35 + 0.031, 0.12 + 0.043), 1);
  tr = await layerNow("tr");
  const tlAfter = await layerNow("tl");
  expect("several layers move together", { tr: [round(tr.x - trBefore.x), round(tr.y - trBefore.y)], tl: [round(tlAfter.x - tlBefore.x), round(tlAfter.y - tlBefore.y)] }, { tr: [0.031, 0.043], tl: [0.031, 0.043] });
  // The locked layer never moved.
  const bl = await layerNow("bl");
  expect("locked layer untouched", { x: bl.x, y: bl.y, width: bl.width }, { x: 0.25, y: 0.75, width: 0.5 });

  // In a plain browser the desktop shell's native calls aren't there.
  results.errors = b.errors.filter((e) => !/favicon|Download the React DevTools|hydrat|reading 'invoke'|transformCallback|\[desktop\]/i.test(e));
  checks["no console errors"] = results.errors.length === 0;
} finally {
  results.checks = checks;
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  b.close();
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
if (failed.length) {
  console.error(`FAILED: ${failed.join("; ")}`);
  process.exit(1);
}
console.log(`All ${Object.keys(checks).length} checks passed.`);
