// Run with: npm run desktop:test:js
// Split-screen layouts (src/lib/editor/layouts.ts) and duplicating layers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { layerRect, rectBounds, type VideoLayer } from "../../src/lib/editor/layerGeometry.ts";
import { LAYOUT_PRESETS, applyLayout, clipInCell, findPreset, gridCells, insetCells, layoutCandidates, relayoutSlots, releaseMain } from "../../src/lib/editor/layouts.ts";
import { duplicateKeys } from "../../src/lib/editor/multiSelect.ts";
import { overlayValues } from "../../src/lib/editor/keyframes.ts";
import { videoBox } from "../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, migrateProject, newClip, type MediaSource, type Overlay, type Project } from "../../src/lib/editor/types.ts";

const CANVAS = { width: 1920, height: 1080 };
const near = (a: number, b: number, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const source = (id: string, width = 1920, height = 1080): MediaSource => ({ id, kind: "layer", file: null, url: "", duration: 20, width, height, fps: 30, hasAudio: true });
const SOURCES: Record<string, MediaSource> = { main: source("main"), a: source("a"), b: source("b", 1080, 1920), c: source("c", 1280, 720) };

const video = (id: string, sourceId: string, patch: Partial<VideoLayer> = {}): VideoLayer => ({
  id,
  kind: "video",
  sourceId,
  offset: 0,
  volume: 1,
  start: 0,
  end: 10,
  x: 0.5,
  y: 0.5,
  width: 0.4,
  rotation: 0,
  opacity: 1,
  animIn: "none",
  animOut: "none",
  hidden: false,
  locked: false,
  ...patch,
});

const project = (overlays: Overlay[]): Project => ({ clips: [newClip("c1", "main", 0, 10)], overlays, audio: [], effects: [], canvas: DEFAULT_CANVAS });

/** Where a layer is on the canvas: left, top, right, bottom. */
function boundsOf(p: Project, id: string, t = 0) {
  const o = p.overlays.find((x) => x.id === id) as VideoLayer;
  return rectBounds(layerRect(o, o.width, SOURCES[o.sourceId], CANVAS, t), CANVAS);
}

test("every preset's screens are inside the canvas, and the grids tile it", () => {
  const all = LAYOUT_PRESETS.flatMap((g) => g.presets);
  assert.equal(all.length, 13);
  assert.equal(new Set(all.map((p) => p.id)).size, 13);
  for (const p of all) {
    for (const c of p.cells) assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9, p.id);
    if (!p.over) near(p.cells.reduce((s, c) => s + c.w * c.h, 0), 1);
  }
  assert.equal(findPreset("4-grid")!.cells.length, 4);
  assert.equal(gridCells(3, 2).length, 6);
});

test("side by side: the main video and a layer each fill their half", () => {
  const p = project([video("l1", "a")]);
  const r = applyLayout(p, SOURCES, CANVAS, findPreset("2-side")!.cells, { fit: "fill", main: true, layerIds: ["l1"], time: 0 });
  assert.equal(r.filled, 2);
  assert.equal(r.empty, 0);
  // The layer: the right half, cropped to its shape.
  const b = boundsOf(r.project, "l1");
  near(b.l, 0.5);
  near(b.r, 1);
  near(b.t, 0);
  near(b.b, 1);
  const l = r.project.overlays[0] as VideoLayer;
  assert.deepEqual(l.crop, { x: 0.25, y: 0, w: 0.5, h: 1 });
  assert.deepEqual(l.slot, { x: 0.5, y: 0, w: 0.5, h: 1, fit: "fill" });
  // The main clip: the left half.
  const c = r.project.clips[0];
  const box = videoBox(c, SOURCES.main, CANVAS, r.project.canvas);
  near(box.w, 0.5);
  near(box.h, 1);
  near(c.transform.x, 0.25);
  assert.deepEqual(r.project.mainSlot, { x: 0, y: 0, w: 0.5, h: 1, fit: "fill" });
  // Nothing is merged: still one clip and one layer, each its own.
  assert.equal(r.project.clips.length, 1);
  assert.equal(r.project.overlays.length, 1);
});

test("a 2 x 2 grid of four layers, the main video left alone", () => {
  const p = project([video("l1", "a"), video("l2", "b"), video("l3", "c"), video("l4", "a")]);
  const r = applyLayout(p, SOURCES, CANVAS, findPreset("4-grid")!.cells, { fit: "fill", main: false, layerIds: ["l1", "l2", "l3", "l4"], time: 0 });
  assert.equal(r.filled, 4);
  assert.equal(r.project.clips[0], p.clips[0]);
  assert.equal(r.project.mainSlot, undefined);
  const want = [
    [0, 0],
    [0.5, 0],
    [0, 0.5],
    [0.5, 0.5],
  ];
  ["l1", "l2", "l3", "l4"].forEach((id, i) => {
    const b = boundsOf(r.project, id);
    near(b.l, want[i][0]);
    near(b.t, want[i][1]);
    near(b.r - b.l, 0.5);
    near(b.b - b.t, 0.5);
  });
  // The tall video is cropped top and bottom to the screen's shape.
  near((r.project.overlays[1] as VideoLayer).crop!.w, 1);
  near((r.project.overlays[1] as VideoLayer).crop!.h, (1080 / 1920) / (16 / 9));
  // A 16:9 video in a 16:9 screen needs no crop.
  assert.equal((r.project.overlays[0] as VideoLayer).crop, undefined);
});

test("fit shows all of each video inside its screen", () => {
  const p = project([video("l1", "b")]);
  const r = applyLayout(p, SOURCES, CANVAS, findPreset("2-side")!.cells, { fit: "fit", main: true, layerIds: ["l1"], time: 0 });
  const b = boundsOf(r.project, "l1");
  near(b.t, 0);
  near(b.b, 1);
  near((b.l + b.r) / 2, 0.75);
  assert.ok(b.l > 0.5 && b.r < 1);
  assert.equal((r.project.overlays[0] as VideoLayer).crop, undefined);
  // The main video fitted in the left half: half as wide, centred there.
  const box = videoBox(r.project.clips[0], SOURCES.main, CANVAS, r.project.canvas);
  near(box.w, 0.5);
  near(box.h, 0.5);
  assert.deepEqual(r.project.clips[0].crop, { x: 0, y: 0, w: 1, h: 1 });
});

test("more screens than videos leaves screens empty; extra layers are untouched", () => {
  const p = project([video("l1", "a"), video("l2", "b")]);
  const r = applyLayout(p, SOURCES, CANVAS, findPreset("4-grid")!.cells, { fit: "fill", main: true, layerIds: ["l1"], time: 0 });
  assert.equal(r.filled, 2);
  assert.equal(r.empty, 2);
  assert.equal(r.project.overlays[1], p.overlays[1]);
});

test("spacing draws every screen in by half the gap", () => {
  const cells = insetCells(gridCells(2, 1), 0.04, CANVAS);
  // 4% of 1080 = 43.2 px: 21.6 px on each side of every screen.
  near(cells[0].x * 1920, 21.6, 0.01);
  near(cells[0].y * 1080, 21.6, 0.01);
  near((cells[1].x - (cells[0].x + cells[0].w)) * 1920, 43.2, 0.01);
  assert.equal(insetCells(gridCells(2, 1), 0, CANVAS)[0].x, 0);
});

test("a layout keeps keyframes: a layer gets one at the playhead, an animated clip stays", () => {
  const kfs = [{ t: 0, x: 0.85, y: 0.85, scale: 1, rotation: 0, opacity: 1, ease: "smooth" as const }];
  const p = project([video("l1", "a", { width: 0.2, keyframes: kfs })]);
  p.clips[0] = { ...p.clips[0], keyframes: [{ t: 1, x: 0.5, y: 0.5, scale: 1.2, rotation: 0, opacity: 1, ease: "smooth" }] };
  const r = applyLayout(p, SOURCES, CANVAS, findPreset("2-side")!.cells, { fit: "fill", main: true, layerIds: ["l1"], time: 4 });
  const l = r.project.overlays[0] as VideoLayer;
  assert.equal(l.keyframes!.length, 2);
  assert.deepEqual(l.keyframes![0], kfs[0]);
  near(overlayValues(l, 4).x, 0.75);
  // Still in its corner at the start: the layout is where it animates to.
  near(overlayValues(l, 0).x, 0.85);
  assert.equal(r.animatedClips, 1);
  assert.equal(r.project.clips[0], p.clips[0]);
});

test("a webcam layout on a layer gives way to the screen", () => {
  const mask = { shape: "circle" as const, x: 0.5, y: 0.5, w: 1, h: 1, rotation: 0, feather: 0, invert: false };
  const p = project([video("l1", "a", { camLayout: { shape: "circle", size: "medium", corner: "top-left" }, mask })]);
  const l = applyLayout(p, SOURCES, CANVAS, findPreset("2-stack")!.cells, { fit: "fill", main: true, layerIds: ["l1"], time: 0 }).project.overlays[0] as VideoLayer;
  assert.equal(l.camLayout, undefined);
  assert.equal(l.mask, null);
});

test("only layers showing at the playhead, not hidden or locked, are placed", () => {
  const p = project([video("l1", "a"), video("l2", "a", { hidden: true }), video("l3", "a", { locked: true }), video("l4", "a", { start: 12, end: 15 })]);
  assert.deepEqual(layoutCandidates(p, 5).map((o) => o.id), ["l1"]);
  assert.deepEqual(layoutCandidates(p, 13).map((o) => o.id), ["l4"]);
});

test("changing the canvas size places the screens again, unless moved by hand", () => {
  const p = project([video("l1", "a"), video("l2", "c")]);
  const laid = applyLayout(p, SOURCES, CANVAS, findPreset("3-cols")!.cells, { fit: "fill", main: true, layerIds: ["l1", "l2"], time: 0 }).project;
  // l2 dragged since.
  const moved = { ...laid, overlays: laid.overlays.map((o) => (o.id === "l2" ? { ...o, x: 0.6 } : o)) };
  const square = { width: 1080, height: 1080 };
  const next = relayoutSlots(moved, SOURCES, CANVAS, square);
  const l1 = next.overlays[0] as VideoLayer;
  const b = rectBounds(layerRect(l1, l1.width, SOURCES.a, square, 0), square);
  near(b.l, 1 / 3);
  near(b.r, 2 / 3);
  near(b.t, 0);
  near(b.b, 1);
  assert.equal(next.overlays[1], moved.overlays[1]);
  const box = videoBox(next.clips[0], SOURCES.main, square, next.canvas);
  near(box.w, 1 / 3);
  near(box.h, 1);
  // The same canvas shape: nothing to do.
  assert.equal(relayoutSlots(laid, SOURCES, CANVAS, { width: 1280, height: 720 }), laid);
});

test("the main video goes back over the whole canvas", () => {
  const laid = applyLayout(project([video("l1", "a")]), SOURCES, CANVAS, findPreset("2-side")!.cells, { fit: "fill", main: true, layerIds: ["l1"], time: 0 }).project;
  const back = releaseMain(laid);
  assert.deepEqual(back.clips[0].transform, { x: 0.5, y: 0.5, scale: 1, rotation: 0 });
  assert.deepEqual(back.clips[0].crop, { x: 0, y: 0, w: 1, h: 1 });
  assert.equal("mainSlot" in back, false);
  assert.equal(releaseMain(back), back);
});

test("a clip fitted into a narrow screen stays within the export's scale", () => {
  const c = clipInCell(newClip("c", "main", 0, 5), SOURCES.main, CANVAS, DEFAULT_CANVAS, { x: 0, y: 0, w: 0.05, h: 0.05 }, "fit");
  assert.equal(c.transform.scale, 0.1);
});

test("the new fields survive saving and opening a project", () => {
  const laid = applyLayout(project([video("l1", "a", { name: "Guest", frame: { radius: 0.3, border: 0.02, borderColor: "#ff0000", shadow: 0.5 } })]), SOURCES, CANVAS, findPreset("2-side")!.cells, {
    fit: "fill",
    main: true,
    layerIds: ["l1"],
    time: 0,
  }).project;
  const reopened = migrateProject(JSON.parse(JSON.stringify(laid)));
  assert.deepEqual(reopened.overlays, JSON.parse(JSON.stringify(laid.overlays)));
  assert.deepEqual(reopened.mainSlot, laid.mainSlot);
  assert.deepEqual(reopened.clips[0].crop, laid.clips[0].crop);
  // A project saved before layouts existed opens as it was.
  const old = migrateProject({ clips: [newClip("c1", "main", 0, 10)], overlays: [{ ...video("l1", "a") }] });
  assert.equal(old.mainSlot, undefined);
  assert.equal((old.overlays[0] as VideoLayer).crop, undefined);
  assert.equal(migrateProject({ clips: [], mainSlot: { x: 0, y: 0, w: 0, h: 1, fit: "fill" } }).mainSlot, undefined);
});

// --- duplicating -----------------------------------------------------------------

test("a duplicate is the same layer again, with its own id, right above the original", () => {
  const kfs = [{ t: 0, x: 0.2, y: 0.2, scale: 1, rotation: 0, opacity: 1, ease: "smooth" as const }];
  const original = video("l1", "a", { crop: { x: 0.1, y: 0, w: 0.5, h: 1 }, opacity: 0.6, keyframes: kfs, start: 2, end: 7, offset: 1.5, name: "Cam" });
  const p = project([original, video("l2", "b")]);
  const r = duplicateKeys(p, ["overlay:l1"])!;
  assert.equal(r.project.overlays.length, 3);
  assert.deepEqual(r.project.overlays.map((o) => o.id).filter((id) => id === "l1" || id === "l2"), ["l1", "l2"]);
  const copy = r.project.overlays[1] as VideoLayer;
  assert.notEqual(copy.id, "l1");
  assert.deepEqual(r.keys, [`overlay:${copy.id}`]);
  // Everything but the id is the same: source, timing, transform, crop, keyframes.
  assert.deepEqual({ ...copy, id: "l1" }, original);
  assert.equal(copy.sourceId, "a");
  // ...and none of it is shared: changing the copy leaves the original alone.
  assert.notEqual(copy.keyframes, original.keyframes);
  assert.notEqual(copy.crop, original.crop);
  copy.keyframes![0].x = 0.9;
  copy.crop!.w = 0.2;
  assert.equal(original.keyframes![0].x, 0.2);
  assert.equal(original.crop!.w, 0.5);
  assert.equal(r.project.overlays[0], original);
});

test("duplicating several at once, a whole group, and what can't be", () => {
  const p: Project = {
    ...project([video("l1", "a", { locked: true }), video("l2", "b")]),
    audio: [{ id: "a1", sourceId: "m", label: "m", start: 3, offset: 0, duration: 2, volume: 1, fadeIn: 0, fadeOut: 0, muted: false }],
    groups: [{ id: "g", keys: ["overlay:l1", "overlay:l2"] }],
  };
  const r = duplicateKeys(p, ["overlay:l1", "overlay:l2", "audio:a1", "clip:c1"])!;
  assert.equal(r.project.overlays.length, 4);
  assert.equal(r.project.audio.length, 2);
  assert.equal(r.project.audio[1].start, 3);
  assert.equal(r.project.clips.length, 1);
  assert.equal(r.keys.length, 3);
  // The copy of a locked layer can be moved.
  assert.equal(r.project.overlays[1].locked, false);
  // The copies are a group of their own.
  assert.equal(r.project.groups!.length, 2);
  assert.deepEqual(r.project.groups![1].keys, [`overlay:${r.project.overlays[1].id}`, `overlay:${r.project.overlays[3].id}`]);
  assert.equal(duplicateKeys(p, ["clip:c1"]), null);
  // Half a group: no new group.
  assert.equal(duplicateKeys(p, ["overlay:l2"])!.project.groups!.length, 1);
});
