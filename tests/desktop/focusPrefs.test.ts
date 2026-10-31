// Run with: npm run desktop:test:js
import assert from "node:assert/strict";
import { test } from "node:test";
import { CameraCache, cameraCrop, evalCamera } from "../../src/lib/editor/camera.ts";
import { FOCUS_PRESETS, suggestZooms } from "../../src/lib/editor/focus.ts";
import { cameraPayload, pointerRows } from "../../src/lib/editor/focusExport.ts";
import {
  DEFAULT_FOCUS_PREFS,
  appliedZooms,
  eventsForSuggestions,
  excludeRange,
  patchFocusPrefs,
  previewWithoutZooms,
  removeExclusion,
  scaledZoom,
  setClickIgnored,
} from "../../src/lib/editor/focusPrefs.ts";
import { historyReducer, type HistoryState } from "../../src/lib/editor/history.ts";
import { PointerCache, pointerScene } from "../../src/lib/editor/pointer.ts";
import { layout } from "../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, DEFAULT_POINTER, migrateProject, newClip, type CameraZoom, type MediaSource, type Project } from "../../src/lib/editor/types.ts";
import type { InteractionEvent } from "../../src/lib/recorder/format.ts";

const zoom = (over: Partial<CameraZoom> = {}): CameraZoom => ({
  id: "z1",
  sourceId: "s",
  start: 0.5,
  end: 2.8,
  zoom: 2,
  x: 0.25,
  y: 0.25,
  easeIn: 0.4,
  easeOut: 0.4,
  ease: "smooth",
  enabled: true,
  auto: false,
  ...over,
});

/** A 3 s, 320x180 recording with one left click at 1.0 s, (0.25, 0.25). */
function recording(over: Partial<Project> = {}) {
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
    zooms: [zoom()],
    pointer: { ...DEFAULT_POINTER, ringSize: 0.1, ringDuration: 0.6, intensity: 1 },
    ...over,
  };
  return { src, project, sources: { s: src }, canvas: { width: 320, height: 180 } };
}

const caches = () => ({ pointer: new PointerCache(), camera: new CameraCache() });

test("intensity scales each zoom's strength above 1x, within the limits", () => {
  assert.equal(scaledZoom(2, 1), 2);
  assert.equal(scaledZoom(2, 0.5), 1.5);
  assert.equal(scaledZoom(3, 1.5), 4); // capped at MAX_ZOOM
  assert.equal(scaledZoom(2, 0), 1.25); // clamped to MIN_INTENSITY
  assert.equal(scaledZoom(1.2, 0.25), 1.05);
});

test("applied zooms: unchanged at 100%, none in original view, stable for the camera cache", () => {
  const { project } = recording();
  assert.equal(appliedZooms(project), project.zooms, "no copy at 100%");
  assert.deepEqual(appliedZooms(patchFocusPrefs(project, { bypass: true })), []);
  const half = patchFocusPrefs(project, { intensity: 0.5 });
  const a = appliedZooms(half)!;
  assert.equal(a[0].zoom, 1.5);
  assert.equal(appliedZooms(half), a, "same array while nothing changes");
  assert.equal(project.zooms![0].zoom, 2, "the stored zoom isn't changed");
});

test("export camera rows at 50% intensity are exactly those of a 1.5x zoom, and match the preview", () => {
  const { project, sources, canvas } = recording();
  const half = patchFocusPrefs(project, { intensity: 0.5 });
  const lay = layout(half, 30);
  const rows = cameraPayload(half, lay, sources, canvas)[0]!;
  const direct = cameraPayload({ ...project, zooms: [zoom({ zoom: 1.5 })] }, lay, sources, canvas)[0]!;
  assert.deepEqual(rows, direct);
  // The preview's path (PreviewPlayer: camera.track(appliedZooms(project)...)).
  const track = new CameraCache().track(appliedZooms(half), half.clips[0])!;
  const win = evalCamera(track, 1.6);
  assert.ok(Math.abs(win.s - 1 / 1.5) < 1e-9, `window ${win.s}`);
  const full = cameraCrop(half.clips[0].crop, win);
  assert.ok(full.w < 1 && full.w > 0.6);
});

test("original view: no camera rows, rings drawn at the unzoomed position; turning it off restores the zooms", () => {
  const { project, sources, canvas } = recording();
  const off = patchFocusPrefs(project, { bypass: true });
  const lay = layout(off, 30);
  assert.deepEqual(cameraPayload(off, lay, sources, canvas), [null]);
  const ring = pointerScene(lay, off, sources, canvas, 1.1, caches()).rings[0];
  assert.ok(Math.abs(ring.cx - 0.25) < 1e-6 && Math.abs(ring.cy - 0.25) < 1e-6, "unzoomed: source point = canvas point");
  const zoomed = pointerScene(lay, project, sources, canvas, 1.1, caches()).rings[0];
  assert.ok(Math.abs(zoomed.cx - 0.25) > 0.01, "with the zoom, the ring moves with the camera");
  const back = patchFocusPrefs(off, { bypass: false });
  assert.deepEqual(cameraPayload(back, lay, sources, canvas), cameraPayload(project, lay, sources, canvas));
});

test("an ignored click has no ring in the preview or the export, and restoring it brings it back", () => {
  const { project, sources, canvas } = recording();
  const lay = layout(project, 30);
  const ignored = setClickIgnored(project, "s", 1.0, true);
  assert.equal(pointerScene(lay, ignored, sources, canvas, 1.1, caches()).rings.length, 0);
  assert.equal(pointerRows(ignored, lay, sources, canvas), null, "nothing left to draw");
  assert.equal(pointerScene(lay, project, sources, canvas, 1.1, caches()).rings.length, 1);
  const restored = setClickIgnored(ignored, "s", 1.0, false);
  assert.deepEqual(pointerRows(restored, lay, sources, canvas), pointerRows(project, lay, sources, canvas));
});

/** Settle, click, move on - as the recorder stores it. */
function session(clicks: { t: number; x: number; y: number }[]): InteractionEvent[] {
  const ev: InteractionEvent[] = [];
  let pos = { x: 0.5, y: 0.5 };
  for (const c of clicks) {
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      ev.push({ type: "move", t: (c.t - 0.9 + 0.4 * u) * 1000, x: pos.x + (c.x - pos.x) * u, y: pos.y + (c.y - pos.y) * u });
    }
    ev.push({ type: "button", t: c.t * 1000, button: "left", down: true, x: c.x, y: c.y });
    ev.push({ type: "button", t: c.t * 1000 + 90, button: "left", down: false, x: c.x, y: c.y });
    pos = c;
  }
  return ev.sort((a, b) => a.t - b.t);
}

test("excluded ranges and ignored clicks keep suggestions away; pauses stay as cuts", () => {
  const events = session([
    { t: 3, x: 0.2, y: 0.3 },
    { t: 12, x: 0.8, y: 0.7 },
    { t: 21, x: 0.3, y: 0.8 },
  ]);
  events.push({ type: "pause", t: 15000 }, { type: "resume", t: 15000 });
  events.sort((a, b) => a.t - b.t);
  let n = 0;
  const ids = () => `z${++n}`;
  const input = (ev: InteractionEvent[]) => ({ events: ev, duration: 25, aspect: 16 / 9, sourceId: "s" });
  const all = suggestZooms(input(events), FOCUS_PRESETS.balanced, ids).zooms;
  assert.equal(all.length, 3);

  const prefs = { ...DEFAULT_FOCUS_PREFS, excluded: [{ id: "x", sourceId: "s", start: 10, end: 14 }], ignoredClicks: [{ sourceId: "s", t: 21 }] };
  const filtered = eventsForSuggestions(events, "s", prefs);
  assert.ok(filtered.some((e) => e.type === "pause") && filtered.some((e) => e.type === "resume"), "pause cuts are kept");
  assert.ok(!filtered.some((e) => e.type === "button" && Math.abs(e.t - 21000) < 200), "ignored press and its release are gone");
  assert.ok(!filtered.some((e) => e.t >= 10000 && e.t <= 14000 && e.type !== "pause" && e.type !== "resume"));
  const some = suggestZooms(input(filtered), FOCUS_PRESETS.balanced, ids).zooms;
  assert.equal(some.length, 1);
  assert.ok(some[0].start < 5 && some[0].end > 3, "only the first click still zooms");
  // Another source's settings don't apply.
  assert.equal(eventsForSuggestions(events, "other", prefs), events);
});

test("excluding a range removes the suggestions it overlaps, never the user's own zooms", () => {
  const { project } = recording({
    zooms: [zoom({ id: "auto1", auto: true, start: 1, end: 3 }), zoom({ id: "mine", auto: false, start: 1.5, end: 2.5 }), zoom({ id: "auto2", auto: true, start: 5, end: 7 })],
  });
  const p = excludeRange(project, { id: "x1", sourceId: "s", start: 2, end: 4 });
  assert.deepEqual(p.zooms!.map((z) => z.id), ["mine", "auto2"]);
  assert.equal(p.focus!.excluded.length, 1);
  assert.equal(excludeRange(project, { id: "x2", sourceId: "s", start: 4, end: 4 }), project, "an empty range does nothing");
  const reversed = excludeRange(project, { id: "x3", sourceId: "s", start: 4, end: 2 });
  assert.deepEqual([reversed.focus!.excluded[0].start, reversed.focus!.excluded[0].end], [2, 4]);
  assert.equal(removeExclusion(p, "x1").focus!.excluded.length, 0);
});

test("focus settings are undoable steps and survive saving and reopening", () => {
  const { project } = recording();
  let h: HistoryState = { past: [], present: project, future: [], gestureBase: null };
  h = historyReducer(h, { type: "apply", fn: (p) => patchFocusPrefs(p, { intensity: 0.7 }), record: true });
  h = historyReducer(h, { type: "apply", fn: (p) => setClickIgnored(p, "s", 1, true), record: true });
  h = historyReducer(h, { type: "apply", fn: (p) => excludeRange(p, { id: "x", sourceId: "s", start: 0, end: 0.5 }), record: true });
  const saved = JSON.parse(JSON.stringify(h.present));
  const reopened = migrateProject(saved);
  assert.deepEqual(reopened.focus, h.present.focus);
  assert.deepEqual(appliedZooms(reopened)!.map((z) => z.zoom), [1.7]);
  h = historyReducer(h, { type: "undo" });
  h = historyReducer(h, { type: "undo" });
  h = historyReducer(h, { type: "undo" });
  assert.equal(h.present, project, "back to the original");
  assert.equal(appliedZooms(h.present), project.zooms);
  h = historyReducer(h, { type: "redo" });
  assert.equal(h.present.focus!.intensity, 0.7);
  // Older projects have no focus settings: defaults, nothing added.
  assert.equal(migrateProject(JSON.parse(JSON.stringify(project))).focus, undefined);
  assert.deepEqual(migrateProject({ ...saved, focus: { intensity: 0.5 } }).focus, { intensity: 0.5, bypass: false, excluded: [], ignoredClicks: [] });
});

test("compare with original: the preview loses its zooms, the project and export keep them", () => {
  const { project, sources, canvas } = recording();
  const preview = previewWithoutZooms(project);
  assert.deepEqual(appliedZooms(preview), []);
  assert.equal(previewWithoutZooms(project), preview, "same object while the project is unchanged (preview caches hit)");
  // The project itself, which saving and export use, is untouched.
  assert.equal(appliedZooms(project)?.length, 1);
  assert.equal(project.focus, undefined);
  const lay = layout(project, 30);
  assert.ok((cameraPayload(project, lay, sources, canvas)[0]?.length ?? 0) > 1, "export still zooms");
  assert.deepEqual(cameraPayload(preview, lay, sources, canvas), [null], "the preview's project has no camera");
  // Already in original view: nothing to change.
  const bypassed = patchFocusPrefs(project, { bypass: true });
  assert.equal(previewWithoutZooms(bypassed), bypassed);
});
