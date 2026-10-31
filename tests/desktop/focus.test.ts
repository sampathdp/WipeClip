// Run with: npm run desktop:test:js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHAIN_GAP,
  REST,
  buildCameraTrack,
  cameraCrop,
  cameraSamples,
  evalCamera,
  sourceTimeOf,
  targetWindow,
  timelineTimeOf,
  zoomSpans,
} from "../../src/lib/editor/camera.ts";
import { FOCUS_PRESETS, analyzeFocus, suggestZooms } from "../../src/lib/editor/focus.ts";
import { buildPointerTrack, pointerAt, ringsAt, sourceToCanvas } from "../../src/lib/editor/pointer.ts";
import { layout, type LaidOutClip } from "../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, DEFAULT_POINTER, FULL_CROP, migrateProject, newClip, type CameraZoom } from "../../src/lib/editor/types.ts";
import type { InteractionEvent } from "../../src/lib/recorder/format.ts";

const zoom = (over: Partial<CameraZoom> = {}): CameraZoom => ({
  id: "z1",
  sourceId: "s",
  start: 2,
  end: 6,
  zoom: 2,
  x: 0.5,
  y: 0.5,
  easeIn: 0.5,
  easeOut: 0.5,
  ease: "smooth",
  enabled: true,
  auto: false,
  ...over,
});

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// --- camera ------------------------------------------------------------------

test("camera eases in, holds and returns, keeping the focus point fixed", () => {
  const track = buildCameraTrack([zoom({ x: 0.3, y: 0.4 })], "s", FULL_CROP);
  assert.deepEqual(evalCamera(track, 0), REST);
  assert.deepEqual(evalCamera(track, 2), REST);
  const held = evalCamera(track, 4);
  close(held.x, 0.05);
  close(held.y, 0.15);
  close(held.s, 0.5);
  assert.deepEqual(evalCamera(track, 6), REST);
  // Halfway into the ease (smoothstep 0.5 = 0.5): rectangle halfway.
  const mid = evalCamera(track, 2.25);
  close(mid.s, 0.75);
  close(mid.x, 0.025);
  // The focus point stays at the same place in the window throughout.
  for (const t of [2.1, 2.25, 2.4]) {
    const w = evalCamera(track, t);
    const u = (0.3 - w.x) / w.s;
    assert.ok(u > 0.29 && u <= 0.5 + 1e-9);
  }
});

test("zoom near frame edges stays inside the frame", () => {
  for (const [x, y] of [
    [0, 0],
    [1, 1],
    [0.98, 0.02],
  ]) {
    const w = targetWindow({ zoom: 3, x, y }, FULL_CROP);
    assert.ok(w.x >= 0 && w.y >= 0 && w.x + w.s <= 1 + 1e-9 && w.y + w.s <= 1 + 1e-9);
    // The focus point is still visible.
    assert.ok(x >= w.x - 1e-9 && x <= w.x + w.s + 1e-9);
  }
});

test("camera respects the clip crop (selected recording region)", () => {
  const crop = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
  const w = targetWindow({ zoom: 2, x: 0.75, y: 0.75 }, crop);
  assert.deepEqual(w, { x: 0.25, y: 0.25, s: 0.5 });
  assert.deepEqual(cameraCrop(crop, w), { x: 0.625, y: 0.625, w: 0.25, h: 0.25 });
  assert.equal(cameraCrop(crop, REST), crop);
});

test("consecutive zooms pan directly instead of bouncing out", () => {
  const a = zoom({ id: "a", start: 1, end: 4, x: 0.2, y: 0.2 });
  const b = zoom({ id: "b", start: 4 + CHAIN_GAP / 2, end: 8, x: 0.8, y: 0.8 });
  const track = buildCameraTrack([b, a], "s", FULL_CROP);
  for (let t = 3.4; t <= 4.9; t += 0.05) assert.ok(evalCamera(track, t).s <= 0.5 + 1e-9, `zoomed out at ${t}`);
  // Far apart: returns to rest between them.
  const far = buildCameraTrack([a, zoom({ id: "c", start: 6, end: 9 })], "s", FULL_CROP);
  assert.deepEqual(evalCamera(far, 5), REST);
});

test("overlapping, disabled and other-source zooms are normalized", () => {
  const track = buildCameraTrack(
    [zoom({ id: "a", start: 0, end: 5 }), zoom({ id: "b", start: 3, end: 7 }), zoom({ id: "d", enabled: false, start: 10, end: 12 }), zoom({ id: "o", sourceId: "x" })],
    "s",
    FULL_CROP
  );
  for (let i = 1; i < track.keys.length; i++) assert.ok(track.keys[i].t >= track.keys[i - 1].t, "keys sorted");
  assert.deepEqual(evalCamera(track, 11), REST, "disabled zoom ignored");
});

test("zoom maps to the timeline through trims, splits, speed and reverse", () => {
  const clips = [
    { ...newClip("c1", "s", 0, 4), speed: 2 },
    { ...newClip("c2", "s", 4, 10), reverse: true },
  ];
  const lay = layout({ clips, overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS }, 30);
  const spans = zoomSpans(lay.clips, { sourceId: "s", start: 2, end: 6 });
  assert.equal(spans.length, 2, "split zoom shows in both clips");
  close(spans[0].start, 1);
  close(spans[0].end, 2);
  // Reversed clip: source 4..6 plays at the end of the clip.
  close(spans[1].start, 2 + 4);
  close(spans[1].end, 2 + 6);
  const c2 = lay.clips[1];
  close(sourceTimeOf(c2, timelineTimeOf(c2, 5)!), 5);
});

test("export samples equal the preview's camera at every frame, only on change", () => {
  const z = zoom();
  const track = buildCameraTrack([z], "s", FULL_CROP);
  const laid: LaidOutClip = { clip: newClip("c", "s", 1, 8), index: 0, start: 0, duration: 7, transitionOut: 0 };
  const rows = cameraSamples(track, laid, 30);
  assert.deepEqual(rows[0], [0, 0, 0, 1]);
  // Static spans produce no rows: far fewer than 210 frames.
  assert.ok(rows.length < 60, `${rows.length} rows`);
  for (const [t, x, y, s] of rows) {
    const w = evalCamera(track, 1 + t);
    close(x, w.x, 1e-5);
    close(y, w.y, 1e-5);
    close(s, w.s, 1e-5);
  }
});

// --- pointer -----------------------------------------------------------------

function path(): InteractionEvent[] {
  const ev: InteractionEvent[] = [];
  // Moves at 60 Hz from (0.1,0.1) to (0.5,0.5) over 1 s, then still, then click.
  for (let i = 0; i <= 60; i++) ev.push({ type: "move", t: (i * 1000) / 60, x: 0.1 + (0.4 * i) / 60, y: 0.1 + (0.4 * i) / 60 });
  ev.push({ type: "button", t: 2000, button: "left", down: true, x: 0.5, y: 0.5 });
  ev.push({ type: "button", t: 2080, button: "left", down: false, x: 0.5, y: 0.5 });
  // Pause at 3 s; the pointer jumps while paused (restated at resume).
  ev.push({ type: "pause", t: 3000 }, { type: "resume", t: 3000 }, { type: "move", t: 3000, x: 0.9, y: 0.9 });
  ev.push({ type: "button", t: 3500, button: "right", down: true, x: 0.9, y: 0.9 });
  return ev;
}

test("pointer holds while still, interpolates movement, never across a pause", () => {
  const tr = buildPointerTrack(path(), 0);
  close(pointerAt(tr, 0.5)!.x, 0.3, 1e-4);
  assert.deepEqual(pointerAt(tr, 1.7), { x: 0.5, y: 0.5 }, "held while standing still");
  close(pointerAt(tr, 2.99)!.x, 0.5, 1e-6);
  close(pointerAt(tr, 3.01)!.x, 0.9, 1e-6);
  assert.equal(pointerAt(buildPointerTrack([], 0), 1), null);
});

test("smoothing never moves the pointer at a click", () => {
  const ev = path();
  // Jittery path towards the click.
  for (let i = 0; i < 30; i++) ev.push({ type: "move", t: 1000 + i * 16, x: 0.5 + (i % 2 ? 0.02 : -0.02), y: 0.5 });
  ev.sort((a, b) => a.t - b.t);
  const tr = buildPointerTrack(ev, 1);
  const at = pointerAt(tr, 2)!;
  close(at.x, 0.5, 1e-4);
  close(at.y, 0.5, 1e-4);
  assert.equal(tr.clicks.length, 2);
  assert.deepEqual(tr.clicks.map((c) => c.button), ["left", "right"]);
});

test("click rings grow and fade over their duration, per button", () => {
  const tr = buildPointerTrack(path(), 0.5);
  const style = { ...DEFAULT_POINTER, ringDuration: 0.5 };
  assert.deepEqual(ringsAt(tr, 1.99, style), []);
  const [r0] = ringsAt(tr, 2, style);
  const [r1] = ringsAt(tr, 2.25, style);
  assert.ok(r1.r > r0.r && r1.alpha < r0.alpha);
  assert.equal(ringsAt(tr, 2.5, style).length, 0);
  assert.equal(ringsAt(tr, 3.6, style)[0].button, "right");
  assert.deepEqual(ringsAt(tr, 2.1, { ...style, clicks: false }), []);
});

test("source points map to canvas through crop, fit box and rotation", () => {
  const crop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  const t0 = { x: 0.5, y: 0.5, rotation: 0 };
  // Portrait 9:16 canvas, landscape box letterboxed (fit): w=1, h=0.316.
  const canvas = { width: 1080, height: 1920 };
  const box = { w: 1, h: (1080 / 1920) * (9 / 16) };
  assert.deepEqual(sourceToCanvas({ x: 0.5, y: 0.5 }, crop, box, t0, canvas), { x: 0.5, y: 0.5 });
  const tl = sourceToCanvas({ x: 0.25, y: 0.25 }, crop, box, t0, canvas)!;
  close(tl.x, 0);
  close(tl.y, 0.5 - box.h / 2);
  assert.equal(sourceToCanvas({ x: 0.1, y: 0.5 }, crop, box, t0, canvas), null, "outside the crop");
  const rot = sourceToCanvas({ x: 0.75, y: 0.5 }, crop, { w: 0.5, h: 0.5 }, { ...t0, rotation: 90 }, { width: 1000, height: 1000 })!;
  close(rot.x, 0.5);
  close(rot.y, 0.75);
});

// --- focus engine ---------------------------------------------------------------

/** A tutorial-like session: settle on a target, click, move on. */
function session(targets: { t: number; x: number; y: number; button?: "left" | "right"; double?: boolean }[]): InteractionEvent[] {
  const ev: InteractionEvent[] = [];
  let pos = { x: 0.5, y: 0.5 };
  let t = 0;
  for (const g of targets) {
    // Travel for 0.4 s, then settle 0.5 s before the click.
    const travelEnd = g.t - 0.5;
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      const tt = Math.max(t, travelEnd - 0.4 + 0.4 * u);
      ev.push({ type: "move", t: tt * 1000, x: pos.x + (g.x - pos.x) * u, y: pos.y + (g.y - pos.y) * u });
    }
    ev.push({ type: "button", t: g.t * 1000, button: g.button ?? "left", down: true, x: g.x, y: g.y });
    ev.push({ type: "button", t: g.t * 1000 + 90, button: g.button ?? "left", down: false, x: g.x, y: g.y });
    if (g.double) ev.push({ type: "button", t: g.t * 1000 + 200, button: "left", down: true, x: g.x, y: g.y });
    pos = { x: g.x, y: g.y };
    t = g.t + 0.1;
  }
  return ev.sort((a, b) => a.t - b.t);
}

let n = 0;
const ids = () => `z${++n}`;

test("deliberate clicks become focus zooms around the click", () => {
  const events = session([
    { t: 3, x: 0.2, y: 0.3 },
    { t: 12, x: 0.8, y: 0.7 },
  ]);
  const { zooms, stats } = suggestZooms({ events, duration: 20, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.balanced, ids);
  assert.equal(stats.clicks, 2);
  assert.equal(zooms.length, 2);
  const [a, b] = zooms;
  assert.ok(a.start < 3 - FOCUS_PRESETS.balanced.lead && a.end > 3, "zoomed in before the click, out after");
  close(a.x, 0.2, 1e-9);
  close(b.y, 0.7, 1e-9);
  assert.ok(a.zoom > 1.15 && a.zoom <= FOCUS_PRESETS.balanced.maxZoom);
  assert.ok(zooms.every((z) => z.auto && z.enabled && z.sourceId === "s"));
  // The click target stays in view with padding at the chosen zoom.
  const w = targetWindow(a, FULL_CROP);
  assert.ok(0.2 > w.x + 0.03 && 0.2 < w.x + w.s - 0.03);
});

test("not every click zooms: hurried single clicks and spread-out clicks are skipped", () => {
  // A click without settling (pointer still moving fast).
  const ev: InteractionEvent[] = [];
  for (let i = 0; i < 40; i++) ev.push({ type: "move", t: i * 16, x: 0.1 + i * 0.015, y: 0.5 });
  ev.push({ type: "button", t: 600, button: "left", down: true, x: 0.6, y: 0.5 });
  const hurried = suggestZooms({ events: ev, duration: 10, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.balanced, ids);
  assert.equal(hurried.zooms.length, 0);
  // Subtle needs more than one deliberate click.
  const one = session([{ t: 3, x: 0.3, y: 0.3 }]);
  assert.equal(suggestZooms({ events: one, duration: 10, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.subtle, ids).zooms.length, 0);
  assert.equal(suggestZooms({ events: one, duration: 10, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.dynamic, ids).zooms.length, 1);
});

test("fast successive clicks on one spot make one zoom; double-clicks count once", () => {
  const events = session([
    { t: 2, x: 0.4, y: 0.4, double: true },
    { t: 2.8, x: 0.42, y: 0.41 },
    { t: 3.5, x: 0.41, y: 0.43 },
  ]);
  const { zooms } = suggestZooms({ events, duration: 10, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.balanced, ids);
  assert.equal(zooms.length, 1);
  assert.match(zooms[0].reason!, /3 clicks/);
});

test("nearby focus points chain into a pan without overlapping", () => {
  const events = session([
    { t: 2, x: 0.15, y: 0.2 },
    { t: 3.6, x: 0.85, y: 0.8 },
  ]);
  const { zooms } = suggestZooms({ events, duration: 10, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.balanced, ids);
  assert.equal(zooms.length, 2);
  assert.ok(zooms[1].start >= zooms[0].end, "no overlap");
  assert.ok(zooms[1].start - zooms[0].end < CHAIN_GAP, "chained: camera pans directly");
});

test("zooms stay inside pause cuts and the recording", () => {
  const events = session([{ t: 1, x: 0.3, y: 0.3 }]);
  events.push({ type: "pause", t: 2000 }, { type: "resume", t: 2000 });
  events.sort((a, b) => a.t - b.t);
  const { zooms } = suggestZooms({ events, duration: 2.5, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.balanced, ids);
  assert.equal(zooms.length, 1);
  assert.ok(zooms[0].start >= 0 && zooms[0].end <= 2);
});

test("markers force a focus; clicks on another display are ignored", () => {
  const events: InteractionEvent[] = [
    { type: "move", t: 0, x: 0.7, y: 0.6 },
    { type: "marker", t: 5000, id: "m1", label: "Marker 1" },
    { type: "button", t: 8000, button: "left", down: true, x: 1.4, y: 0.5 },
  ];
  const { zooms, stats } = suggestZooms({ events, duration: 12, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.subtle, ids);
  assert.equal(stats.clicks, 0);
  assert.equal(zooms.length, 1);
  assert.equal(zooms[0].reason, "Marker 1");
  close(zooms[0].x, 0.7, 1e-9);
});

test("busy recordings are paced to the preset's zooms per minute", () => {
  const targets = [];
  for (let i = 0; i < 40; i++) targets.push({ t: 2 + i * 3, x: i % 2 ? 0.2 : 0.8, y: i % 3 ? 0.25 : 0.75 });
  const events = session(targets);
  const { zooms } = suggestZooms({ events, duration: 130, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.subtle, ids);
  for (const z of zooms) {
    const mid = (z.start + z.end) / 2;
    assert.ok(zooms.filter((o) => Math.abs((o.start + o.end) / 2 - mid) < 30).length <= FOCUS_PRESETS.subtle.maxPerMinute);
  }
});

test("long recordings analyze quickly and can be cancelled", async () => {
  const targets = [];
  for (let i = 0; i < 600; i++) targets.push({ t: 2 + i * 1.5, x: 0.1 + (i % 9) * 0.1, y: 0.1 + (i % 7) * 0.12 });
  const events = session(targets); // ~16k events, 15 minutes
  const t0 = performance.now();
  const res = await analyzeFocus({ events, duration: 905, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.balanced, ids);
  assert.ok(performance.now() - t0 < 2000);
  assert.ok(res.zooms.length > 10);
  for (let i = 1; i < res.zooms.length; i++) assert.ok(res.zooms[i].start >= res.zooms[i - 1].end, "sorted, no overlap");
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(analyzeFocus({ events, duration: 905, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.balanced, ids, { signal: ctrl.signal }), {
    name: "AbortError",
  });
});

// --- project persistence ------------------------------------------------------------

test("zooms and pointer style survive save/reopen and fill defaults", () => {
  const p = {
    clips: [newClip("c", "s", 0, 10)],
    overlays: [],
    audio: [],
    effects: [],
    canvas: DEFAULT_CANVAS,
    zooms: [{ ...zoom(), ease: undefined, enabled: undefined, auto: undefined }],
    pointer: { clicks: true },
  };
  const back = migrateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(back.zooms![0].ease, "smooth");
  assert.equal(back.zooms![0].enabled, true);
  assert.equal(back.pointer!.ringDuration, DEFAULT_POINTER.ringDuration);
  const old = migrateProject({ clips: [newClip("c", "s", 0, 1)] });
  assert.deepEqual(old.zooms, []);
  assert.equal(old.pointer, null);
});

// --- preview/export consistency ------------------------------------------------------
//
// The export payload for a small synthetic recording, made by the same
// functions the preview draws with. Committed as a fixture that the backend
// renders with real ffmpeg (backend/tests/test_focus_export.py) and checks
// pixel by pixel against the `expect` values computed here.
// UPDATE_FIXTURES=1 npm run desktop:test:js rewrites it after intended changes.

import { readFileSync, writeFileSync } from "node:fs";
import { CameraCache, windowPixels } from "../../src/lib/editor/camera.ts";
import { cameraPayload, pointerRows } from "../../src/lib/editor/focusExport.ts";
import { PointerCache, pointerScene } from "../../src/lib/editor/pointer.ts";
import type { MediaSource, Project } from "../../src/lib/editor/types.ts";

const FIXTURE = new URL("../../backend/tests/fixtures/focus_payload.json", import.meta.url);
const VECTORS = new URL("../../backend/tests/fixtures/camera_vectors.json", import.meta.url);

function syntheticRecording() {
  const events: InteractionEvent[] = [
    { type: "move", t: 0, x: 0.5, y: 0.5 },
    { type: "move", t: 900, x: 0.25, y: 0.25 },
    { type: "button", t: 1000, button: "left", down: true, x: 0.25, y: 0.25 },
    { type: "button", t: 1080, button: "left", down: false, x: 0.25, y: 0.25 },
  ];
  const src = {
    id: "s",
    kind: "original",
    url: "",
    duration: 3,
    width: 320,
    height: 180,
    fps: 30,
    hasAudio: false,
    recording: { trackKind: "screen", folder: "", events, manifest: { capture: { coordinateSpace: "capture", cursorCaptured: true } } },
  } as unknown as MediaSource;
  const project: Project = {
    clips: [newClip("c", "s", 0, 3)],
    overlays: [],
    audio: [],
    effects: [],
    canvas: DEFAULT_CANVAS,
    zooms: [zoom({ start: 0.5, end: 2.8, x: 0.25, y: 0.25, zoom: 2, easeIn: 0.4, easeOut: 0.4 })],
    pointer: { ...DEFAULT_POINTER, ringSize: 0.1, ringDuration: 0.6, intensity: 1 },
  };
  return { src, project };
}

test("export payload is the preview's own values (fixture for the backend render test)", () => {
  const { src, project } = syntheticRecording();
  const sources = { s: src };
  const canvas = { width: 320, height: 180 };
  const lay = layout(project, 30);
  const camera = cameraPayload(project, lay, sources, canvas);
  const rows = pointerRows(project, lay, sources, canvas)!;
  assert.ok(camera[0] && camera[0].length > 1);
  assert.ok(rows.ringsUsed && !rows.cursorUsed, "no drawn cursor: the video has its own");
  // What the preview shows at two moments, for the backend to check.
  const caches = { pointer: new PointerCache(), camera: new CameraCache() };
  const ringScene = pointerScene(lay, project, sources, canvas, 1.1, caches);
  const ring = ringScene.rings[0];
  assert.ok(ring && ring.alpha > 0.5);
  const payload = {
    camera: camera[0],
    ringRows: rows.rings,
    expect: {
      ringAt: { t: 1.1, x: Math.round(ring.cx * 320), y: Math.round(ring.cy * 180), alpha: Math.round(ring.alpha * 1000) / 1000 },
      // Fully zoomed on the red quadrant: the whole frame is red.
      zoomedAt: 1.6,
    },
  };
  if (process.env.UPDATE_FIXTURES) writeFileSync(FIXTURE, JSON.stringify(payload) + "\n");
  assert.deepEqual(JSON.parse(readFileSync(FIXTURE, "utf8")), JSON.parse(JSON.stringify(payload)), "fixture out of date: UPDATE_FIXTURES=1");
});

test("zoom pixel geometry matches the backend's shared vectors", () => {
  for (const v of JSON.parse(readFileSync(VECTORS, "utf8"))) {
    assert.deepEqual(windowPixels({ x: v.x, y: v.y, s: v.s }, v.boxW, v.boxH), v.expect);
  }
});

// --- output shapes ------------------------------------------------------------------

import { FULL_VIEW, MAX_ZOOM, clipView } from "../../src/lib/editor/camera.ts";
import { videoBox } from "../../src/lib/editor/timeline.ts";

const HD = { width: 1920, height: 1080 };
const SHAPES = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

/** Where source point p lands on the canvas with zoom z active. */
function onCanvas(z: CameraZoom, p: { x: number; y: number }, canvas: { width: number; height: number }, fit: "fit" | "fill") {
  const clip = newClip("c", "s", 0, 10);
  const view = clipView(clip, HD, canvas, { fit });
  const win = targetWindow(z, clip.crop, view);
  const box = videoBox(clip, HD, canvas, { fit });
  return { win, view, at: sourceToCanvas(p, cameraCrop(clip.crop, win), box, clip.transform, canvas) };
}

test("fit and landscape fill see the whole window; framing is unchanged there", () => {
  for (const canvas of Object.values(SHAPES)) {
    assert.deepEqual(clipView(newClip("c", "s", 0, 10), HD, canvas, { fit: "fit" }), FULL_VIEW);
  }
  assert.deepEqual(clipView(newClip("c", "s", 0, 10), HD, SHAPES.landscape, { fit: "fill" }), FULL_VIEW);
  const z = zoom({ x: 0.05, y: 0.9, zoom: 2.5 });
  assert.deepEqual(targetWindow(z, FULL_CROP, FULL_VIEW), targetWindow(z, FULL_CROP));
});

test("portrait and square fill keep a focus point near the frame edge on the canvas", () => {
  for (const [name, canvas] of [["portrait", SHAPES.portrait], ["square", SHAPES.square]] as const) {
    const view = clipView(newClip("c", "s", 0, 10), HD, canvas, { fit: "fill" });
    assert.ok(view.x0 > 0 && view.x1 < 1 && view.y0 === 0 && view.y1 === 1, `${name}: sides are cut`);
    for (const x of [0.04, 0.12, 0.2, 0.8, 0.88, 0.96]) {
      for (const y of [0.05, 0.5, 0.95]) {
        const z = zoom({ x, y, zoom: 2 });
        const { win, at } = onCanvas(z, z, canvas, "fill");
        if (x > 0.1 && x < 0.9) {
          assert.ok(at && at.x >= 0 && at.x <= 1 && at.y >= 0 && at.y <= 1, `${name} (${x}, ${y}) visible`);
        } else {
          // The outermost strip can't reach the canvas without the window
          // leaving the frame: pushed to that edge at the bounded zoom.
          assert.ok(win.x === 0 || Math.abs(win.x + win.s - 1) < 1e-9, `${name} (${x}, ${y}) at the edge`);
          close(win.s, 1 / 3.5);
        }
        // Bounded: never more than 1.75x beyond the asked zoom.
        assert.ok(win.s >= 1 / Math.min(MAX_ZOOM, 2 * 1.75) - 1e-9, `${name} (${x}, ${y}) zoom bounded`);
        assert.ok(win.x >= 0 && win.y >= 0 && win.x + win.s <= 1 + 1e-9 && win.y + win.s <= 1 + 1e-9, "inside the frame");
      }
    }
    // Mid-frame points are centered on the canvas, at the asked zoom.
    const mid = onCanvas(zoom({ x: 0.5, y: 0.4, zoom: 2 }), { x: 0.5, y: 0.4 }, canvas, "fill");
    close(mid.win.s, 0.5);
    close(mid.at!.x, 0.5, 1e-4);
    close(mid.at!.y, 0.5, 1e-4);
  }
  // Without the view, the same zoom puts an edge click off a portrait canvas.
  const clip = newClip("c", "s", 0, 10);
  const blind = targetWindow(zoom({ x: 0.13, y: 0.5, zoom: 2 }), clip.crop);
  const at = sourceToCanvas({ x: 0.13, y: 0.5 }, cameraCrop(clip.crop, blind), videoBox(clip, HD, SHAPES.portrait, { fit: "fill" }), clip.transform, SHAPES.portrait);
  assert.ok(at && at.x < 0, "regression guard: the old framing lost this click");
});

test("a moved clip's visible part follows its position; rotated clips use the whole window", () => {
  const clip = newClip("c", "s", 0, 10);
  close(clipView({ ...clip, transform: { ...clip.transform, x: 0.25 } }, HD, SHAPES.landscape, { fit: "fit" }).x0, 0.25);
  assert.deepEqual(clipView({ ...clip, transform: { ...clip.transform, rotation: 90 } }, HD, SHAPES.portrait, { fit: "fill" }), FULL_VIEW);
});

test("portrait fill: export camera rows and pointer rings are the preview's values", () => {
  const { src, project } = syntheticRecording();
  const p: Project = {
    ...project,
    canvas: { ...project.canvas, fit: "fill" },
    zooms: [zoom({ start: 0.3, end: 2.8, x: 0.13, y: 0.5, zoom: 2, easeIn: 0.4, easeOut: 0.4 })],
  };
  const events = [
    { type: "move", t: 0, x: 0.13, y: 0.5 },
    { type: "button", t: 1000, button: "left", down: true, x: 0.13, y: 0.5 },
    { type: "button", t: 1080, button: "left", down: false, x: 0.13, y: 0.5 },
  ] as InteractionEvent[];
  const s = { ...src, recording: { ...src.recording!, events } } as MediaSource;
  const canvas = { width: 180, height: 320 };
  const lay = layout(p, 30);
  const rows = cameraPayload(p, lay, { s }, canvas)[0]!;
  assert.ok(rows.length > 10);
  const track = new CameraCache().track(p.zooms, p.clips[0], clipView(p.clips[0], s, canvas, { fit: "fill" }))!;
  for (const [t, x, y, sz] of rows) {
    const w = evalCamera(track, t);
    close(x, w.x, 1e-4);
    close(y, w.y, 1e-4);
    close(sz, w.s, 1e-4);
  }
  // The click ring lands on the canvas (the old framing put it off-screen).
  const scene = pointerScene(lay, p, { s }, canvas, 1.1, { pointer: new PointerCache(), camera: new CameraCache() });
  assert.equal(scene.rings.length, 1);
  assert.ok(scene.rings[0].cx > 0 && scene.rings[0].cx < 1);
});

// --- recorded session to framing -------------------------------------------------------

test("every suggested zoom keeps its clicks inside the zoomed view, in every output shape", () => {
  const targets = [];
  // A 4-minute tutorial with clicks all over the screen. Top and bottom
  // edges included; left/right stay out of the outermost strip that
  // portrait fill can't show (checked above).
  for (let i = 0; i < 60; i++) {
    const x = [0.12, 0.5, 0.88, 0.2, 0.8][i % 5];
    const y = [0.04, 0.5, 0.96, 0.3][i % 4];
    targets.push({ t: 2 + i * 4, x, y, double: i % 7 === 0 });
  }
  const events = session(targets);
  const { zooms } = suggestZooms({ events, duration: 250, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.dynamic, ids);
  assert.ok(zooms.length >= 20, `suggested ${zooms.length}`);
  let checked = 0;
  for (const [name, canvas] of Object.entries(SHAPES)) {
    for (const fit of ["fit", "fill"] as const) {
      const clip = newClip("c", "s", 0, 250);
      const view = clipView(clip, HD, canvas, { fit });
      const box = videoBox(clip, HD, canvas, { fit });
      const track = buildCameraTrack(zooms, "s", clip.crop, view);
      for (const g of targets) {
        const z = zooms.find((zz) => g.t >= zz.start + zz.easeIn && g.t <= zz.end - zz.easeOut);
        if (!z) continue;
        checked++;
        const at = sourceToCanvas(g, cameraCrop(clip.crop, evalCamera(track, g.t)), box, clip.transform, canvas);
        assert.ok(at && at.x >= 0 && at.x <= 1 && at.y >= 0 && at.y <= 1, `${name}/${fit}: click at ${g.t}s (${g.x}, ${g.y}) visible`);
      }
    }
  }
  assert.ok(checked > 100);
});

// --- editing, undo/redo, save/reopen ----------------------------------------------------

import { MIN_ZOOM_LENGTH, dragZoom, mergeSuggestions, patchZoom, removeZoom, splitZoom } from "../../src/lib/editor/zoomEdits.ts";
import { historyReducer, type HistoryState } from "../../src/lib/editor/history.ts";

test("zoom edits: split, drag within the source, suggestions never override the user's zooms", () => {
  const a = zoom({ id: "a", start: 2, end: 6, auto: true });
  assert.equal(splitZoom([a], "a", 2.3, "b"), null, "too close to the start");
  const split = splitZoom([a], "a", 4, "b")!;
  assert.deepEqual(split.map((z) => [z.id, z.start, z.end, z.auto]), [["a", 2, 4, false], ["b", 4, 6, false]]);

  const lay = layout({ clips: [newClip("c", "s", 0, 10)], overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS }, 30);
  const laid = lay.clips[0];
  // Moving past the source's ends keeps the length.
  assert.deepEqual(dragZoom(a, laid, "move", -5, -1, 10), { start: 0, end: 4 });
  assert.deepEqual(dragZoom(a, laid, "move", 8, 12, 10), { start: 6, end: 10 });
  assert.deepEqual(dragZoom(a, laid, "start", 5.9, 6, 10), { start: 6 - MIN_ZOOM_LENGTH, end: 6 });
  assert.deepEqual(dragZoom(a, laid, "end", 2, 30, 10), { start: 2, end: 10 });

  const manual = zoom({ id: "m", start: 10, end: 13 });
  const other = zoom({ id: "o", sourceId: "x", auto: true });
  const fresh = [zoom({ id: "n1", start: 1, end: 4, auto: true }), zoom({ id: "n2", start: 12, end: 15, auto: true })];
  const merged = mergeSuggestions([a, manual, other], "s", fresh);
  assert.deepEqual(merged.map((z) => z.id).sort(), ["m", "n1", "o"], "old suggestion replaced, overlapping one dropped, other source kept");

  const edited = patchZoom(merged, "n1", { zoom: 2.5 });
  assert.equal(edited.find((z) => z.id === "n1")!.auto, false, "edited suggestions become the user's");
  assert.deepEqual(removeZoom(edited, "n1").map((z) => z.id).sort(), ["m", "o"]);
});

test("zoom edits are undoable one step at a time and survive save/reopen", () => {
  const base = migrateProject({ clips: [newClip("c", "s", 0, 10)] });
  let h: HistoryState = { past: [], present: base, future: [], gestureBase: null };
  const apply = (fn: (p: Project) => Project, record = true) => (h = historyReducer(h, { type: "apply", fn, record }));
  apply((p) => ({ ...p, zooms: mergeSuggestions(p.zooms ?? [], "s", [zoom({ id: "a", auto: true }), zoom({ id: "b", start: 7, end: 9, auto: true })]) }));
  apply((p) => ({ ...p, zooms: patchZoom(p.zooms!, "a", { zoom: 3, easeIn: 1 }) }));
  // A drag: many updates, one step.
  h = historyReducer(h, { type: "begin" });
  for (const d of [0.1, 0.2, 0.3]) apply((p) => ({ ...p, zooms: patchZoom(p.zooms!, "b", { start: 7 + d, end: 9 + d }) }), false);
  h = historyReducer(h, { type: "end" });
  apply((p) => ({ ...p, zooms: splitZoom(p.zooms!, "a", 4, "c")! }));
  apply((p) => ({ ...p, zooms: removeZoom(p.zooms!, "c") }));
  assert.equal(h.past.length, 5);

  const reopened = migrateProject(JSON.parse(JSON.stringify(h.present)));
  assert.deepEqual(reopened.zooms, h.present.zooms);

  const at = () => h.present.zooms!.map((z) => `${z.id}:${z.start}-${z.end}x${z.zoom}`).join(" ");
  const steps = [at()];
  for (let i = 0; i < 5; i++) {
    h = historyReducer(h, { type: "undo" });
    steps.push(at());
  }
  assert.deepEqual(steps, [
    "a:2-4x3 b:7.3-9.3x2",
    "a:2-4x3 b:7.3-9.3x2 c:4-6x3",
    "a:2-6x3 b:7.3-9.3x2",
    "a:2-6x3 b:7-9x2",
    "a:2-6x2 b:7-9x2",
    "",
  ]);
  for (let i = 0; i < 5; i++) h = historyReducer(h, { type: "redo" });
  assert.equal(at(), steps[0]);
});

// --- following and typing ------------------------------------------------------

/** Typing every 150 ms from `t0` for `secs`, the text cursor moving right. */
function typing(t0: number, secs: number, at: { x: number; y: number } | null, step = 0.004): InteractionEvent[] {
  const ev: InteractionEvent[] = [];
  for (let i = 0; i * 0.15 < secs; i++) {
    ev.push({ type: "typing", t: (t0 + i * 0.15) * 1000, caret: at ? { x: at.x + i * step, y: at.y, h: 0.02 } : null });
  }
  return ev;
}

test("typing zooms in on the text cursor and follows it along the line", () => {
  const events = typing(4, 6, { x: 0.3, y: 0.6 }, 0.012); // 40 events, cursor moves ~0.48 across
  const { zooms } = suggestZooms({ events, duration: 30, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.balanced, ids);
  assert.equal(zooms.length, 1);
  const z = zooms[0];
  assert.equal(z.reason, "Typing");
  assert.ok(z.start < 4 && z.end > 10, "covers the whole burst, longer than the preset's max duration");
  assert.ok(z.end - z.start > FOCUS_PRESETS.balanced.maxDuration);
  close(z.y, 0.6, 1e-3);
  assert.ok(z.path && z.path.length >= 2, "follows the cursor");
  // At every moment the text cursor is inside the zoomed view.
  const track = buildCameraTrack([z], "s", FULL_CROP);
  for (let i = 0; i < 40; i++) {
    const t = 4 + i * 0.15;
    const w = evalCamera(track, t + 0.01);
    const x = 0.3 + i * 0.012;
    assert.ok(x > w.x && x < w.x + w.s, `cursor ${x.toFixed(3)} outside [${w.x.toFixed(3)}, ${(w.x + w.s).toFixed(3)}] at ${t.toFixed(2)} s`);
  }
});

test("typing without a text cursor uses the click into the field; short or disabled typing is ignored", () => {
  const events = [...session([{ t: 3, x: 0.7, y: 0.25 }]), ...typing(4, 2.5, null)].sort((a, b) => a.t - b.t);
  const { zooms } = suggestZooms({ events, duration: 20, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.subtle, ids);
  assert.equal(zooms.length, 1, "click + typing together pass even the subtle threshold");
  close(zooms[0].x, 0.7, 1e-3);
  assert.ok(zooms[0].end > 6.4);
  const short = typing(4, 0.4, { x: 0.5, y: 0.5 }); // 3 events
  assert.equal(suggestZooms({ events: short, duration: 20, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.dynamic, ids).zooms.length, 0);
  const off = { ...FOCUS_PRESETS.balanced, includeTyping: false };
  assert.equal(suggestZooms({ events: typing(4, 3, { x: 0.5, y: 0.5 }), duration: 20, aspect: 16 / 9, sourceId: "s" }, off, ids).zooms.length, 0);
});

test("a drag is followed to where it ends, small moves don't shake the camera", () => {
  const ev: InteractionEvent[] = [];
  for (let i = 0; i <= 30; i++) ev.push({ type: "move", t: 2000 + i * 16, x: 0.2, y: 0.4 }); // settled
  ev.push({ type: "button", t: 2500, button: "left", down: true, x: 0.2, y: 0.4 });
  for (let i = 1; i <= 60; i++) ev.push({ type: "move", t: 2500 + i * 25, x: 0.2 + i * 0.008, y: 0.4 }); // 1.5 s to x=0.68
  ev.push({ type: "button", t: 4000, button: "left", down: false, x: 0.68, y: 0.4 });
  const { zooms } = suggestZooms({ events: ev, duration: 20, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.balanced, ids);
  assert.equal(zooms.length, 1);
  const z = zooms[0];
  assert.match(z.reason ?? "", /Drag/);
  assert.ok(z.end > 4, "lasts past the release");
  const track = buildCameraTrack([z], "s", FULL_CROP);
  for (const [t, x] of [[2.5, 0.2], [4, 0.68]]) {
    const w = evalCamera(track, t);
    assert.ok(x > w.x && x < w.x + w.s, `drag point ${x} in view at ${t}s`);
  }
  // Wiggling in place: one box, no path.
  const still = session([{ t: 3, x: 0.4, y: 0.4 }, { t: 3.6, x: 0.41, y: 0.41 }, { t: 4.2, x: 0.4, y: 0.42 }]);
  const one = suggestZooms({ events: still, duration: 20, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.balanced, ids).zooms;
  assert.equal(one.length, 1);
  assert.equal(one[0].path, undefined);
});

test("camera pans along a path, arriving at each point on time, and export rows match", () => {
  const z = zoom({ start: 1, end: 9, x: 0.2, y: 0.5, path: [{ t: 5, x: 0.8, y: 0.5 }] });
  const track = buildCameraTrack([z], "s", FULL_CROP);
  const center = (t: number) => {
    const w = evalCamera(track, t);
    return w.x + w.s / 2;
  };
  close(center(4.4), 0.25); // held (clamped at the left edge)
  close(center(5), 0.75); // arrived (clamped at the right edge)
  assert.ok(center(4.75) > 0.3 && center(4.75) < 0.7, "moving during the pan");
  close(evalCamera(track, 6).s, 0.5);
  const laid: LaidOutClip = { clip: newClip("c", "s", 0, 10), index: 0, start: 0, duration: 10, transitionOut: 0 };
  for (const [t, x, y, s] of cameraSamples(track, laid, 30)) {
    const w = evalCamera(track, t);
    close(x, w.x, 1e-4);
    close(y, w.y, 1e-4);
    close(s, w.s, 1e-4);
  }
});

test("zoom edits keep the follow path consistent", async () => {
  const { patchZoom, splitZoom } = await import("../../src/lib/editor/zoomEdits.ts");
  const z = zoom({ id: "a", start: 1, end: 9, path: [{ t: 3, x: 0.3, y: 0.5 }, { t: 6, x: 0.7, y: 0.5 }] });
  // Focus set by hand: no more following.
  assert.equal(patchZoom([z], "a", { x: 0.5 })[0].path, undefined);
  // Moved in time: the path moves along.
  assert.deepEqual(patchZoom([z], "a", { start: 2, end: 10 })[0].path?.map((p) => p.t), [4, 7]);
  // Shortened: points past the end are dropped.
  assert.deepEqual(patchZoom([z], "a", { end: 5 })[0].path?.map((p) => p.t), [3]);
  // Split: each half keeps its points; the second starts where the focus is.
  const [first, second] = splitZoom([z], "a", 4, "b")!;
  assert.deepEqual(first.path?.map((p) => p.t), [3]);
  assert.deepEqual(second.path?.map((p) => p.t), [6]);
  close(second.x, 0.3);
  // Saved and reopened as is.
  const reopened = migrateProject(JSON.parse(JSON.stringify({ clips: [], zooms: [z] })));
  assert.deepEqual(reopened.zooms?.[0].path, z.path);
});

// --- back and forth, invalid events (Phase 3) --------------------------------------

/** Times the camera's center changes horizontal direction (moves under 0.5%
 * of the frame per sample ignored), sampled at 30 Hz. */
function reversals(zooms: CameraZoom[], duration: number): number {
  const track = buildCameraTrack(zooms, "s", FULL_CROP);
  let flips = 0;
  let dir = 0;
  let last = 0.5;
  for (let t = 0; t <= duration; t += 1 / 30) {
    const w = evalCamera(track, t);
    const cx = w.x + w.s / 2;
    const d = cx - last;
    if (Math.abs(d) > 0.005) {
      const sign = Math.sign(d);
      if (dir !== 0 && sign !== dir) flips++;
      dir = sign;
      last = cx;
    }
  }
  return flips;
}

test("clicks going back and forth get one steady zoom, not a whip pan each time", () => {
  // Before Phase 3: 8 chained zooms, 6 direction reversals in 10 s.
  const targets = Array.from({ length: 8 }, (_, i) => ({ t: 2 + i * 1.2, x: i % 2 ? 0.8 : 0.2, y: 0.5 }));
  const duration = 16;
  for (const preset of ["balanced", "dynamic"] as const) {
    const { zooms } = suggestZooms({ events: session(targets), duration, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS[preset], ids);
    assert.ok(zooms.length <= 4, `${preset}: ${zooms.length} zooms`);
    assert.ok(reversals(zooms, duration) <= 2, `${preset}: ${reversals(zooms, duration)} reversals`);
    assert.ok(zooms.some((z) => z.reason?.includes("back and forth")), `${preset}: reason explains the wide zoom`);
    // Every click is still inside the camera window when it happens.
    const track = buildCameraTrack(zooms, "s", FULL_CROP);
    for (const g of targets) {
      const w = evalCamera(track, g.t);
      assert.ok(g.x >= w.x && g.x <= w.x + w.s && g.y >= w.y && g.y <= w.y + w.s, `${preset}: click at ${g.t} s outside the view`);
    }
  }
});

test("a single trip to another area and back after a while is still two zooms", () => {
  // Far apart in time: no back-and-forth merge.
  const events = session([
    { t: 2, x: 0.2, y: 0.5 },
    { t: 2.6, x: 0.2, y: 0.52 },
    { t: 12, x: 0.8, y: 0.5 },
    { t: 12.6, x: 0.8, y: 0.52 },
    { t: 24, x: 0.2, y: 0.5 },
    { t: 24.6, x: 0.2, y: 0.52 },
  ]);
  const { zooms } = suggestZooms({ events, duration: 30, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.balanced, ids);
  assert.equal(zooms.length, 3);
  assert.ok(zooms.every((z) => !z.reason?.includes("back and forth")));
});

test("invalid, out-of-range and unsorted events never produce a broken zoom", () => {
  const good = session([
    { t: 2, x: 0.3, y: 0.3 },
    { t: 5, x: 0.7, y: 0.6 },
  ]);
  const junk: InteractionEvent[] = [
    { type: "button", t: Number.NaN, button: "left", down: true, x: 0.5, y: 0.5 },
    { type: "button", t: 3000, button: "left", down: true, x: Number.NaN, y: 0.5 },
    { type: "button", t: 3100, button: "left", down: true, x: 1.7, y: -0.4 },
    { type: "button", t: -500, button: "left", down: true, x: 0.5, y: 0.5 },
    { type: "button", t: 7000, button: "left", down: false, x: 0.4, y: 0.4 }, // release without a press
    { type: "move", t: Number.POSITIVE_INFINITY, x: 0.5, y: 0.5 },
    { type: "button", t: 99_000, button: "left", down: true, x: 0.5, y: 0.5 }, // after the end
  ];
  const events = [...junk, ...good].reverse(); // unsorted on purpose
  const duration = 10;
  let zooms: CameraZoom[] = [];
  assert.doesNotThrow(() => {
    zooms = suggestZooms({ events, duration, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.dynamic, ids).zooms;
  });
  for (const z of zooms) {
    for (const v of [z.start, z.end, z.x, z.y, z.zoom]) assert.ok(Number.isFinite(v), JSON.stringify(z));
    assert.ok(z.start >= 0 && z.end <= duration && z.start < z.end, JSON.stringify(z));
    assert.ok(z.x >= 0 && z.x <= 1 && z.y >= 0 && z.y <= 1, JSON.stringify(z));
    assert.ok(z.zoom >= 1 && z.zoom <= 4, JSON.stringify(z));
  }
});
