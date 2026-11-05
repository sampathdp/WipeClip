// Smart Zoom 2: focus sessions, cooldown, creator profiles, typing,
// edges, natural easing and the zoom-aware cursor. See
// docs/desktop/SMART-ZOOM-2-IMPLEMENTATION.md.
// Run with: npm run desktop:test:js
import assert from "node:assert/strict";
import { test } from "node:test";
import { CameraCache, EASES, FULL_VIEW, buildCameraTrack, cameraCrop, clipView, evalCamera, targetWindow, type CameraWindow } from "../../src/lib/editor/camera.ts";
import { DEFAULT_SESSION, FOCUS_PRESETS, focusSettings, suggestZooms, type FocusPreset, type FocusSettings } from "../../src/lib/editor/focus.ts";
import { pointerRows } from "../../src/lib/editor/focusExport.ts";
import { appliedZooms, patchFocusPrefs } from "../../src/lib/editor/focusPrefs.ts";
import { MAX_POINTER_SCALE, PointerCache, nativeCursorSize, pointerScale, pointerScene, sourceToCanvas } from "../../src/lib/editor/pointer.ts";
import { layout, videoBox } from "../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, DEFAULT_POINTER, FULL_CROP, migrateProject, newClip, type CameraZoom, type MediaSource, type Project } from "../../src/lib/editor/types.ts";
import { mergeSuggestions } from "../../src/lib/editor/zoomEdits.ts";
import type { InteractionEvent } from "../../src/lib/recorder/format.ts";

let n = 0;
const ids = () => `sz${++n}`;
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/** A deliberate click: the pointer travels, settles, clicks. */
function click(t: number, x: number, y: number): InteractionEvent[] {
  return [
    { type: "move", t: t * 1000 - 600, x: x - 0.05, y },
    { type: "move", t: t * 1000 - 500, x, y },
    { type: "button", t: t * 1000, button: "left", down: true, x, y },
    { type: "button", t: t * 1000 + 80, button: "left", down: false, x, y },
  ];
}

/** Typing every 150 ms for `secs`, the text cursor running along lines
 * 40 characters long. */
function typing(t0: number, secs: number, x: number, y: number, caret = true): InteractionEvent[] {
  const out: InteractionEvent[] = [];
  for (let k = 0; k * 0.15 < secs; k++) {
    out.push({ type: "typing", t: Math.round((t0 + k * 0.15) * 1000), caret: caret ? { x: x + (k % 40) * 0.006, y: y + Math.floor(k / 40) * 0.03, h: 0.02 } : null } as InteractionEvent);
  }
  return out;
}

function suggest(events: InteractionEvent[], duration: number, s: FocusSettings) {
  return suggestZooms({ events: [...events].sort((a, b) => a.t - b.t), duration, aspect: 16 / 9, sourceId: "s" }, s, ids);
}

/** Camera behaviour of a set of zooms at 30 Hz: zoom-outs between the
 * first zoom-in and the last zoom-out, and whether the view ever leaves
 * the frame. */
function camera(zooms: CameraZoom[], duration: number) {
  const tr = buildCameraTrack(zooms, "s", FULL_CROP);
  let outs = 0;
  let wasIn = false;
  for (let t = 0; t <= duration; t += 1 / 30) {
    const w = evalCamera(tr, t);
    assert.ok(w.x >= -1e-9 && w.y >= -1e-9 && w.x + w.s <= 1 + 1e-9 && w.y + w.s <= 1 + 1e-9, `inside the frame at ${t}`);
    const zin = w.s < 0.9;
    if (wasIn && !zin) outs++;
    wasIn = zin;
  }
  return { track: tr, zoomOutsBetween: Math.max(0, outs - 1) };
}

const inView = (w: CameraWindow, p: { x: number; y: number }) => p.x >= w.x - 1e-9 && p.x <= w.x + w.s + 1e-9 && p.y >= w.y - 1e-9 && p.y <= w.y + w.s + 1e-9;

// --- grouping ---------------------------------------------------------------------

test("consecutive clicks on one area a few seconds apart stay in one zoom (no zoom-out and back in)", () => {
  for (const preset of ["balanced", "dynamic"] as FocusPreset[]) {
    for (const gap of [2, 3, 3.5, 4, 5]) {
      const ev: InteractionEvent[] = [];
      for (let i = 0; i < 8; i++) ev.push(...click(2 + i * gap, 0.4 + (i % 2) * 0.05, 0.5));
      const { zooms } = suggest(ev, 60, focusSettings(preset));
      const { zoomOutsBetween, track } = camera(zooms, 60);
      // Before Smart Zoom 2: dynamic zoomed out 7 times at 3.5-5 s, balanced 7 times at 5 s.
      assert.equal(zoomOutsBetween, 0, `${preset}, ${gap} s apart: ${zooms.length} zooms`);
      for (let i = 0; i < 8; i++) assert.ok(inView(evalCamera(track, 2 + i * gap), { x: 0.4 + (i % 2) * 0.05, y: 0.5 }));
    }
  }
});

test("independent actions far apart in time still get their own zooms", () => {
  const ev = [...click(3, 0.2, 0.3), ...click(25, 0.8, 0.7)];
  const { zooms } = suggest(ev, 40, focusSettings("balanced"));
  assert.equal(zooms.length, 2);
  assert.ok(zooms[1].start - zooms[0].end > 5, "the camera rests at full view in between");
});

test("clicks alternating between two areas: the camera pans, and no click is ever hidden", () => {
  for (const preset of ["balanced", "dynamic"] as FocusPreset[]) {
    for (const gap of [3, 4]) {
      const ev: InteractionEvent[] = [];
      const pts: { t: number; x: number; y: number }[] = [];
      for (let i = 0; i < 8; i++) {
        const p = { t: 2 + i * gap, x: i % 2 ? 0.8 : 0.2, y: 0.5 };
        pts.push(p);
        ev.push(...click(p.t, p.x, p.y));
      }
      const { zooms } = suggest(ev, 60, focusSettings(preset));
      const { track, zoomOutsBetween } = camera(zooms, 60);
      assert.ok(zoomOutsBetween <= 1, `${preset} ${gap}s: ${zoomOutsBetween} zoom-outs`);
      for (const p of pts) assert.ok(inView(evalCamera(track, p.t), p), `${preset} ${gap}s: click at ${p.t} visible`);
    }
  }
});

test("joining never holds the camera on one area while an action happens elsewhere", () => {
  // A, B (far), A again: whatever the engine does with B, B must be visible.
  const ev = [...click(2, 0.2, 0.5), ...click(5, 0.85, 0.15), ...click(8, 0.2, 0.5), ...click(11, 0.21, 0.52)];
  for (const preset of ["subtle", "balanced", "dynamic"] as FocusPreset[]) {
    const { zooms } = suggest(ev, 20, focusSettings(preset));
    const { track } = camera(zooms, 20);
    assert.ok(inView(evalCamera(track, 5), { x: 0.85, y: 0.15 }), preset);
  }
});

test("cooldown: a weak zoom right after a rest is dropped; important ones are kept", () => {
  const s: FocusSettings = { ...focusSettings("dynamic"), sessionGap: 1, cooldown: 6 };
  // Two areas, ~3.5 s rest between the zooms (more than sessionGap, less than cooldown).
  const weak = suggest([...click(2, 0.2, 0.3), ...click(8, 0.8, 0.7)], 20, s);
  assert.equal(weak.zooms.length, 1, "the weaker of two quick, unrelated zooms goes");
  assert.equal(weak.stats.skippedPacing, 1);
  // A marker makes the second one important: it is the one kept.
  const marked = suggest([...click(2, 0.2, 0.3), ...click(8, 0.8, 0.7), { type: "marker", t: 8000, id: "m", label: "Step 2" }], 20, s);
  assert.equal(marked.zooms.length, 1);
  assert.equal(marked.zooms[0].reason, "Step 2");
  // Both important (markers): both keep their own zooms.
  const both = suggest([...click(2, 0.2, 0.3), { type: "marker", t: 2000, id: "m1", label: "Step 1" }, ...click(8, 0.8, 0.7), { type: "marker", t: 8000, id: "m2", label: "Step 2" }], 20, s);
  assert.equal(both.zooms.length, 2);
  // With the cooldown off, both stay.
  assert.equal(suggest([...click(2, 0.2, 0.3), ...click(8, 0.8, 0.7)], 20, { ...s, cooldown: 0 }).zooms.length, 2);
});

test("session length is bounded: very long activity continues in chained zooms", () => {
  const ev: InteractionEvent[] = [];
  for (let i = 0; i < 60; i++) ev.push(...click(2 + i * 2, 0.4, 0.5));
  const s: FocusSettings = { ...focusSettings("balanced"), maxSession: 30 };
  const { zooms } = suggest(ev, 130, s);
  assert.ok(zooms.length >= 4);
  for (const z of zooms) assert.ok(z.end - z.start <= 30 + 1e-6, `${z.end - z.start}`);
  assert.equal(camera(zooms, 130).zoomOutsBetween, 0, "chained: still no zoom-out");
});

test("settings saved before Smart Zoom 2 (no session fields) still work", () => {
  const old = { ...FOCUS_PRESETS.balanced } as FocusSettings;
  delete old.sessionGap;
  delete old.cooldown;
  delete old.maxSession;
  delete old.includeShortcuts;
  const ev: InteractionEvent[] = [];
  for (let i = 0; i < 4; i++) ev.push(...click(2 + i * 3, 0.4, 0.5));
  const a = suggest(ev, 20, old);
  const b = suggest(ev, 20, { ...old, ...DEFAULT_SESSION });
  assert.deepEqual(
    a.zooms.map((z) => [z.start, z.end, z.x, z.y, z.zoom]),
    b.zooms.map((z) => [z.start, z.end, z.x, z.y, z.zoom])
  );
});

// --- typing -----------------------------------------------------------------------

test("continuous typing: one session for the whole text, no zoom-out, few camera moves", () => {
  const ev = [...click(0.5, 0.3, 0.3), ...typing(1, 90, 0.3, 0.3)];
  for (const preset of ["balanced", "dynamic"] as FocusPreset[]) {
    const { zooms } = suggest(ev, 100, focusSettings(preset));
    const { track, zoomOutsBetween } = camera(zooms, 100);
    assert.equal(zoomOutsBetween, 0, preset);
    // Every keystroke's text cursor is in view (it used to stop at 45 s).
    for (const e of ev) if (e.type === "typing" && e.caret) assert.ok(inView(evalCamera(track, e.t / 1000), e.caret), `${preset}: caret at ${e.t} ms`);
    // Line wraps don't pan back and forth (it used to be 14 pans).
    const pans = zooms.reduce((k, z) => k + (z.path?.length ?? 0), 0);
    assert.ok(pans <= 6, `${preset}: ${pans} pans`);
  }
});

test("typing with thinking pauses and shortcuts while the pointer is elsewhere is one zoom", () => {
  const ev: InteractionEvent[] = [
    ...click(0.8, 0.3, 0.3),
    { type: "move", t: 1500, x: 0.9, y: 0.9 },
    ...[0, 1, 2, 3, 4].flatMap((b) => typing(1 + b * 6.5, 3, 0.3, 0.3)),
    { type: "key", t: 9000, combo: "Ctrl+S" },
    { type: "key", t: 22000, combo: "Ctrl+B" },
  ];
  for (const preset of ["balanced", "dynamic"] as FocusPreset[]) {
    const { zooms } = suggest(ev, 40, focusSettings(preset));
    // Before: dynamic made 5 zooms with 4 zoom-outs.
    assert.equal(zooms.length, 1, preset);
    assert.match(zooms[0].reason!, /Typing/);
  }
  // A shortcut on its own (no typing nearby) is still an action.
  const alone = suggest([...click(2, 0.5, 0.5), { type: "key", t: 2400, combo: "Ctrl+C" }, { type: "key", t: 2800, combo: "Ctrl+V" }], 10, focusSettings("dynamic"));
  assert.match(alone.zooms[0].reason!, /click/);
});

// --- dragging and multiple focus points ------------------------------------------

test("a drag is followed from press to release and stays in view", () => {
  const ev: InteractionEvent[] = [{ type: "move", t: 1000, x: 0.2, y: 0.4 }, { type: "move", t: 1500, x: 0.2, y: 0.4 }, { type: "button", t: 2000, button: "left", down: true, x: 0.2, y: 0.4 }];
  for (let i = 1; i <= 30; i++) ev.push({ type: "move", t: 2000 + i * 60, x: 0.2 + i * 0.02, y: 0.4 + i * 0.006 });
  ev.push({ type: "button", t: 3900, button: "left", down: false, x: 0.8, y: 0.58 });
  const { zooms } = suggest(ev, 10, focusSettings("balanced"));
  assert.equal(zooms.length, 1);
  assert.match(zooms[0].reason!, /Drag/);
  const { track } = camera(zooms, 10);
  for (const e of ev) if (e.type === "move" && e.t >= 2300 && e.t <= 3800) assert.ok(inView(evalCamera(track, e.t / 1000 + 0.05), e), `drag point at ${e.t}`);
});

test("multiple focus points in one session: each click is in view when it happens", () => {
  const pts = [
    { t: 2, x: 0.15, y: 0.2 },
    { t: 3.2, x: 0.3, y: 0.25 },
    { t: 4.5, x: 0.6, y: 0.6 },
    { t: 6, x: 0.85, y: 0.8 },
    { t: 7.1, x: 0.82, y: 0.75 },
  ];
  const { zooms } = suggest(pts.flatMap((p) => click(p.t, p.x, p.y)), 15, focusSettings("dynamic"));
  const { track, zoomOutsBetween } = camera(zooms, 15);
  assert.equal(zoomOutsBetween, 0);
  for (const p of pts) assert.ok(inView(evalCamera(track, p.t), p), `click at ${p.t}`);
});

// --- edges --------------------------------------------------------------------------

test("screen-edge interactions: framed inside the frame, visible, and no idle pans", () => {
  for (const [x, y] of [
    [0.995, 0.5],
    [0.005, 0.99],
    [0.5, 0.002],
    [0.99, 0.99],
  ]) {
    const ev = [...click(2, x, y), ...click(3, Math.min(1, x + 0.002), y), ...click(4.2, x, Math.max(0, y - 0.002))];
    const { zooms } = suggest(ev, 10, focusSettings("dynamic"));
    assert.equal(zooms.length, 1, `${x},${y}`);
    const { track } = camera(zooms, 10);
    assert.ok(inView(evalCamera(track, 2), { x, y }));
    // Points pressed against the edge can't pull the camera any further:
    // no pans that go nowhere.
    assert.equal(zooms[0].path, undefined, `${x},${y}: ${JSON.stringify(zooms[0].path)}`);
  }
});

// --- profiles -------------------------------------------------------------------------

test("creator profiles: gaming ignores typing, shortcuts and scrolling; demo zooms less than tutorial", () => {
  const ev: InteractionEvent[] = [...typing(1, 20, 0.5, 0.5, false)];
  for (let i = 0; i < 20; i++) ev.push({ type: "key", t: 1000 + i * 900, combo: "Ctrl+1" }, { type: "scroll", t: 1100 + i * 900, x: 0.5, y: 0.5, dx: 0, dy: 1 } as InteractionEvent);
  ev.push({ type: "move", t: 500, x: 0.5, y: 0.5 });
  assert.ok(suggest(ev, 30, focusSettings("dynamic", "tutorial")).zooms.length >= 1, "tutorial zooms on typing");
  assert.equal(suggest(ev, 30, focusSettings("dynamic", "gaming")).zooms.length, 0, "WASD and hotkeys are the game");
  // Gaming still honours markers and calm, deliberate clusters.
  const marked = suggest([...ev, { type: "marker", t: 15000, id: "m", label: "Boss" }], 30, focusSettings("dynamic", "gaming"));
  assert.equal(marked.zooms.length, 1);
  assert.ok(marked.zooms[0].zoom <= 1.5 && !marked.zooms[0].path);
  // A tutorial-like session: demo makes fewer, wider zooms.
  const steps: InteractionEvent[] = [];
  for (let i = 0; i < 30; i++) steps.push(...click(2 + i * 6, [0.2, 0.8, 0.5][i % 3], [0.3, 0.7][i % 2]));
  const tut = suggest(steps, 200, focusSettings("balanced", "tutorial")).zooms;
  const demo = suggest(steps, 200, focusSettings("balanced", "demo")).zooms;
  assert.ok(demo.length <= tut.length, `${demo.length} vs ${tut.length}`);
  assert.ok(Math.max(...demo.map((z) => z.zoom)) < Math.max(...tut.map((z) => z.zoom)));
  // Presets are untouched by profiles.
  assert.equal(FOCUS_PRESETS.dynamic.includeTyping, true);
});

// --- user zooms -----------------------------------------------------------------------

test("sessions never swallow a manual zoom: suggestions overlapping it are dropped", () => {
  const ev: InteractionEvent[] = [];
  for (let i = 0; i < 6; i++) ev.push(...click(2 + i * 3, 0.4, 0.5));
  const fresh = suggest(ev, 30, focusSettings("dynamic")).zooms;
  const manual: CameraZoom = { id: "mine", sourceId: "s", start: 8, end: 10, zoom: 3, x: 0.9, y: 0.9, easeIn: 0.3, easeOut: 0.3, ease: "smooth", enabled: true, auto: false };
  const merged = mergeSuggestions([manual], "s", fresh);
  assert.ok(merged.some((z) => z.id === "mine" && z.zoom === 3 && z.x === 0.9), "manual zoom kept as is");
  for (const z of merged) if (z.id !== "mine") assert.ok(z.end <= manual.start || z.start >= manual.end, "no suggestion overlaps it");
});

// --- smooth animation -----------------------------------------------------------------

test("natural easing: soft landing, exact ends, steady perceived zoom, never leaves the frame", () => {
  const e = EASES.natural;
  close(e(0), 0);
  close(e(1), 1);
  for (let u = 0; u < 1; u += 0.01) assert.ok(e(u + 0.01) >= e(u) - 1e-9, "monotone");
  assert.ok(e(0.9) > 0.97, "lands softly");
  const z: CameraZoom = { id: "z", sourceId: "s", start: 1, end: 5, zoom: 3, x: 0.9, y: 0.1, easeIn: 0.8, easeOut: 0.8, ease: "natural", enabled: true, auto: true };
  const tr = buildCameraTrack([z], "s", FULL_CROP);
  const target = targetWindow(z, FULL_CROP);
  // Zoom in along the straight line from rest to the target.
  for (let t = 1.2; t <= 1.6 + 1e-9; t += 0.1) {
    const w = evalCamera(tr, t);
    // On the straight line from rest to the target: the focus point stays put.
    const along = (1 - w.s) / (1 - target.s);
    close(w.x, target.x * along, 1e-9);
    close(w.y, target.y * along, 1e-9);
  }
  assert.deepEqual(evalCamera(tr, 1.8), target);
  assert.deepEqual(evalCamera(tr, 5), { x: 0, y: 0, s: 1 });
  // Older eases interpolate the rectangle exactly as before.
  const smooth = buildCameraTrack([{ ...z, ease: "smooth" }], "s", FULL_CROP);
  close(evalCamera(smooth, 1.4).s, 1 + (target.s - 1) * 0.5);
});

test("chained zooms pan smoothly between nearby focus points without a zoom-out", () => {
  const a: CameraZoom = { id: "a", sourceId: "s", start: 1, end: 4, zoom: 2, x: 0.3, y: 0.3, easeIn: 0.6, easeOut: 0.6, ease: "natural", enabled: true, auto: true };
  const b: CameraZoom = { ...a, id: "b", start: 4.3, end: 8, x: 0.7, y: 0.6 };
  const { track } = camera([a, b], 9);
  for (let t = 3; t <= 5; t += 0.02) assert.ok(evalCamera(track, t).s < 0.6, `stays zoomed at ${t}`);
  // Velocity is continuous enough: no step larger than a small fraction per frame.
  let last = evalCamera(track, 3);
  for (let t = 3; t <= 5.5; t += 1 / 60) {
    const w = evalCamera(track, t);
    assert.ok(Math.hypot(w.x - last.x, w.y - last.y) < 0.03, `no jump at ${t.toFixed(2)}`);
    last = w;
  }
});

// --- cursor scaling ---------------------------------------------------------------------

function recording(width: number, height: number, cursorCaptured = false) {
  const events: InteractionEvent[] = [
    { type: "move", t: 0, x: 0.5, y: 0.5 },
    { type: "move", t: 900, x: 0.25, y: 0.3 },
    { type: "button", t: 1000, button: "left", down: true, x: 0.25, y: 0.3 },
    { type: "button", t: 1080, button: "left", down: false, x: 0.25, y: 0.3 },
  ];
  return {
    id: "s",
    kind: "original",
    url: "",
    duration: 4,
    width,
    height,
    fps: 30,
    hasAudio: false,
    recording: { trackKind: "screen", folder: "", events, manifest: { capture: { coordinateSpace: "capture", cursorCaptured } } },
  } as unknown as MediaSource;
}

function project(over: Partial<Project> = {}): Project {
  return {
    clips: [newClip("c", "s", 0, 4)],
    overlays: [],
    audio: [],
    effects: [],
    canvas: DEFAULT_CANVAS,
    zooms: [{ id: "z", sourceId: "s", start: 0.5, end: 3.5, zoom: 2.5, x: 0.25, y: 0.3, easeIn: 0.5, easeOut: 0.5, ease: "natural", enabled: true, auto: false }],
    pointer: { ...DEFAULT_POINTER, cursor: true, cursorSize: 0.04 },
    ...over,
  };
}

const scene = (p: Project, src: MediaSource, canvas: { width: number; height: number }, t: number) =>
  pointerScene(layout(p, 30), p, { s: src }, canvas, t, { pointer: new PointerCache(), camera: new CameraCache() });

test("the drawn cursor and rings scale with the zoom and stay on the recorded position", () => {
  const src = recording(1920, 1080);
  const p = project();
  const canvas = { width: 1920, height: 1080 };
  const rest = scene(p, src, canvas, 0.2);
  close(rest.cursor!.scale, 1);
  const held = scene(p, src, canvas, 1.1); // fully zoomed in, just after the click
  close(held.cursor!.scale, 2.5, 1e-6);
  assert.equal(held.rings.length, 1);
  // Ring radius = style ring x ring growth x zoom.
  const unscaled = scene({ ...p, pointer: { ...p.pointer!, scaleWithZoom: false } }, src, canvas, 1.1);
  close(held.rings[0].r, unscaled.rings[0].r * 2.5, 1e-9);
  close(unscaled.cursor!.scale, 1);
  // Tip exactly where the recorded pointer is mapped through the camera.
  const clip = p.clips[0];
  const track = new CameraCache().track(appliedZooms(p), clip, FULL_VIEW)!;
  const crop = cameraCrop(clip.crop, evalCamera(track, 1.1));
  const at = sourceToCanvas({ x: 0.25, y: 0.3 }, crop, videoBox(clip, src, canvas, p.canvas), clip.transform, canvas)!;
  close(held.cursor!.x, at.x, 1e-6);
  close(held.cursor!.y, at.y, 1e-6);
  // During the animated zoom the scale follows the camera smoothly.
  let last = 1;
  for (let t = 0.5; t <= 1.0; t += 1 / 30) {
    const k = scene(p, src, canvas, t).cursor!.scale;
    // Monotone, and no frame grows it by more than a quarter (2.5x in 0.5 s).
    assert.ok(k >= last - 1e-9 && k / last < 1.25, `smooth growth at ${t.toFixed(2)}: ${last} -> ${k}`);
    last = k;
  }
  // Intensity and original view change the cursor with the camera.
  close(scene(patchFocusPrefs(p, { intensity: 0.5 }), src, canvas, 1.5).cursor!.scale, 1.75, 1e-6);
  close(scene(patchFocusPrefs(p, { bypass: true }), src, canvas, 1.5).cursor!.scale, 1);
});

test("multiple source resolutions: cursor position and size don't depend on the recording's pixels", () => {
  const canvas = { width: 1920, height: 1080 };
  const p = project({ pointer: { ...DEFAULT_POINTER, cursor: true, cursorSize: 0.03, sizeBase: "recording" } });
  const ref = scene(p, recording(1920, 1080), canvas, 1.5).cursor!;
  for (const [w, h] of [
    [1280, 720],
    [2560, 1440],
    [3840, 2160],
  ]) {
    const c = scene(p, recording(w, h), canvas, 1.5).cursor!;
    close(c.x, ref.x, 1e-9);
    close(c.y, ref.y, 1e-9);
    close(c.scale, ref.scale, 1e-9);
  }
  // An ultrawide recording fitted into 16:9 is letterboxed: a
  // recording-relative cursor shrinks with the picture.
  const wide = scene(p, recording(3440, 1440), canvas, 0.2).cursor!;
  close(wide.scale, (1920 / 3440) * (1440 / 1080), 1e-3);
});

test("high-DPI: the recording's native cursor size is the same fraction at any scaling", () => {
  const win = (h: number, scale: number) => nativeCursorSize({ display: { bounds: { height: h }, scaleFactor: scale }, desktopUnit: "physical-pixels" });
  // 1080p at 100% and 4K at 200% show the same logical screen.
  assert.equal(win(1080, 1), win(2160, 2));
  close(win(1080, 1)!, 22 / 1080, 1e-4);
  // 4K at 100%: twice as many logical pixels, half the fraction.
  close(win(2160, 1)!, 22 / 2160, 1e-4);
  // 1440p at 150%.
  close(win(1440, 1.5)!, 22 / 960, 1e-4);
  // macOS reports points: a Retina display at 2x, 900 points tall.
  close(nativeCursorSize({ display: { bounds: { height: 900 }, scaleFactor: 2 }, desktopUnit: "points" })!, 22 / 900, 1e-4);
  assert.equal(nativeCursorSize({ display: null, desktopUnit: "points" }), null);
});

test("canvas aspect ratio changes: a recording-sized cursor keeps its size next to the screen", () => {
  const src = recording(1920, 1080);
  const p = project({ pointer: { ...DEFAULT_POINTER, cursor: true, cursorSize: 0.03, sizeBase: "recording" } });
  for (const [name, canvas, fit] of [
    ["landscape fit", { width: 1920, height: 1080 }, "fit"],
    ["portrait fit", { width: 1080, height: 1920 }, "fit"],
    ["square fit", { width: 1080, height: 1080 }, "fit"],
    ["portrait fill", { width: 1080, height: 1920 }, "fill"],
  ] as const) {
    const q = { ...p, canvas: { ...p.canvas, fit } };
    const box = videoBox(q.clips[0], src, canvas, q.canvas);
    const c = scene(q, src, canvas, 0.2).cursor!;
    // Cursor height in canvas pixels / recording height on the canvas = 3 %.
    close((0.03 * c.scale * canvas.height) / (box.h * canvas.height), 0.03, 1e-9);
    const z = scene(q, src, canvas, 1.5).cursor!;
    // Grows with the zoom (fill may zoom a little further to keep the point on the canvas).
    assert.ok(z.scale / c.scale >= 2.5 - 1e-6, `${name}: ${z.scale / c.scale}`);
  }
  // The canvas-relative default keeps the old size whatever the shape.
  const legacy = project({ pointer: { ...DEFAULT_POINTER, cursor: true, scaleWithZoom: false } });
  close(scene({ ...legacy, canvas: { ...legacy.canvas, fit: "fit" } }, src, { width: 1080, height: 1920 }, 0.2).cursor!.scale, 1);
});

test("cursor scale is bounded", () => {
  assert.equal(pointerScale({ sizeBase: "recording" }, { h: 0.05 }, { h: 0.001 }, { h: 1 }), MAX_POINTER_SCALE);
  assert.ok(pointerScale({}, { h: 1 }, { h: 1e9 }, { h: 1 }) >= 0.05);
});

test("a cropped recording region magnifies the cursor like the picture", () => {
  const src = recording(1920, 1080);
  const p = project({ zooms: [], pointer: { ...DEFAULT_POINTER, cursor: true, cursorSize: 0.03, sizeBase: "recording" } });
  const cropped = { ...p, clips: [{ ...p.clips[0], crop: { x: 0, y: 0, w: 0.5, h: 0.5 } }] };
  close(scene(cropped, src, { width: 1920, height: 1080 }, 0.2).cursor!.scale / scene(p, src, { width: 1920, height: 1080 }, 0.2).cursor!.scale, 2, 1e-6);
});

// --- timeline edits and preview/export consistency ------------------------------------

test("timeline edits after generation: split, speed and trim keep zoom and cursor on the source moment", () => {
  const src = recording(1920, 1080);
  const base = project();
  const canvas = { width: 1920, height: 1080 };
  const at = scene(base, src, canvas, 1.5).cursor!;
  // Split at 1 s, second half at 2x speed and moved first.
  const [a, b] = [newClip("a", "s", 0, 1), { ...newClip("b", "s", 1, 4), speed: 2 }];
  const edited = { ...base, clips: [b, a] };
  // Source time 1.5 s is 0.25 s into clip b on the timeline.
  const moved = scene(edited, src, canvas, 0.25).cursor!;
  close(moved.x, at.x, 1e-6);
  close(moved.y, at.y, 1e-6);
  close(moved.scale, at.scale, 1e-6);
});

test("preview and export rows agree on cursor position and size every frame", () => {
  const src = recording(1920, 1080);
  const p = project();
  const canvas = { width: 1920, height: 1080 };
  const lay = layout(p, 30);
  const rows = pointerRows(p, lay, { s: src }, canvas)!;
  assert.ok(rows.cursor.every((r) => r.length === 4), "size column");
  close(rows.cursorScale, 2.5, 1e-4);
  const caches = { pointer: new PointerCache(), camera: new CameraCache() };
  let row = 0;
  for (let f = 0; f < Math.round(lay.total * 30); f++) {
    const t = f / 30;
    while (row + 1 < rows.cursor.length && rows.cursor[row + 1][0] <= Math.round(t * 1000) / 1000 + 1e-9) row++;
    const sc = pointerScene(lay, p, { s: src }, canvas, t, caches).cursor!;
    const [, x, y, k] = rows.cursor[row];
    close(x, sc.x, 1e-4);
    close(y, sc.y, 1e-4);
    close(k * rows.cursorScale, sc.scale, 1e-3);
  }
  // Rings: radius in the rows is the scaled preview radius.
  const sc = pointerScene(lay, p, { s: src }, canvas, 1.1, caches);
  const ringRow = rows.rings.find((r) => Math.abs(r[0] - 1.1) < 1e-6)!;
  close(ringRow[4], sc.rings[0].r, 1e-4);
  // A cursor that never changes size sends the 3-column rows older backends accept.
  const fixed = pointerRows({ ...p, pointer: { ...p.pointer!, scaleWithZoom: false } }, lay, { s: src }, canvas)!;
  assert.ok(fixed.cursor.every((r) => r.length === 3));
  assert.equal(fixed.cursorScale, 1);
});

// --- persistence ------------------------------------------------------------------------

test("older projects open unchanged; new pointer fields survive save and reopen", () => {
  const old = migrateProject({ clips: [newClip("c", "s", 0, 1)], pointer: { cursor: true, cursorSize: 0.05 } });
  assert.equal(old.pointer!.sizeBase, undefined, "canvas-relative size, as before");
  assert.equal(old.pointer!.scaleWithZoom, true, "the zoom-aware cursor is the fix");
  const saved = migrateProject(JSON.parse(JSON.stringify({ ...old, pointer: { ...old.pointer, sizeBase: "recording", scaleWithZoom: false } })));
  assert.equal(saved.pointer!.sizeBase, "recording");
  assert.equal(saved.pointer!.scaleWithZoom, false);
  const z = migrateProject({ clips: [newClip("c", "s", 0, 1)], zooms: [{ id: "z", sourceId: "s", start: 0, end: 1, zoom: 2, x: 0.5, y: 0.5, easeIn: 0.2, easeOut: 0.2, ease: "natural" }] });
  assert.equal(z.zooms![0].ease, "natural");
});

void clipView;
