// Run with: npm run desktop:test:js
// Audio parts: smooth cuts (mix.ts partFades) and magnetic parts
// (audioMagnet.ts, applied by history.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { EDGE_FADE, partFades, smoothCutsOn, trackGainAt } from "../../src/lib/editor/mix.ts";
import { packAudio } from "../../src/lib/editor/audioMagnet.ts";
import { historyReducer, type HistoryState } from "../../src/lib/editor/history.ts";
import { DEFAULT_CANVAS, DEFAULT_MASTER, migrateProject, newClip, type AudioClip, type Project } from "../../src/lib/editor/types.ts";

const part = (id: string, start: number, duration: number, over: Partial<AudioClip> = {}): AudioClip => ({
  id,
  sourceId: "voice",
  label: "Voice",
  start,
  offset: start,
  duration,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  muted: false,
  ...over,
});
const project = (audio: AudioClip[], master: Partial<Project["master"]> = {}): Project => ({
  clips: [newClip("c1", "video", 0, 200)],
  overlays: [],
  audio,
  effects: [],
  canvas: DEFAULT_CANVAS,
  master: { ...DEFAULT_MASTER, ...master },
});
const starts = (p: Project) => Object.fromEntries(p.audio.map((a) => [a.id, Math.round(a.start * 1000) / 1000]));
const state = (p: Project): HistoryState => ({ past: [], present: p, future: [], gestureBase: null });

test("smooth cuts: on unless turned off; every part fades a little at both edges", () => {
  assert.equal(smoothCutsOn({}), true);
  assert.equal(smoothCutsOn(project([])), true);
  assert.equal(smoothCutsOn(project([], { smoothCuts: false })), false);

  const a = part("a", 10, 4);
  assert.deepEqual(partFades(a, true), { fadeIn: EDGE_FADE, fadeOut: EDGE_FADE });
  assert.deepEqual(partFades(a, false), { fadeIn: 0, fadeOut: 0 });
  assert.deepEqual(partFades({ ...a, fadeIn: 1, fadeOut: 0.5 }, true), { fadeIn: 1, fadeOut: 0.5 }, "longer fades are kept");
  assert.deepEqual(partFades({ ...a, duration: 0.04 }, true), { fadeIn: 0.01, fadeOut: 0.01 }, "never over a quarter of a tiny part");

  // Silent at the cut, full a few ms in, back to silent at the end.
  assert.equal(trackGainAt(a, 10, true), 0);
  assert.ok(Math.abs(trackGainAt(a, 10 + EDGE_FADE / 2, true) - 0.5) < 1e-9);
  assert.equal(trackGainAt(a, 12, true), 1);
  assert.ok(trackGainAt(a, 14 - 1e-4, true) < 0.01);
  assert.equal(trackGainAt(a, 10, false), 1, "off: starts at full level, as before");
});

test("smooth cuts and magnetic survive saving and opening the project", () => {
  const p = migrateProject(JSON.parse(JSON.stringify(project([part("a", 0, 2)], { smoothCuts: false, magnetic: true }))));
  assert.equal(p.master?.smoothCuts, false);
  assert.equal(p.master?.magnetic, true);
});

test("pack: one file's parts close their gaps in timeline order, from where they started", () => {
  const p = project([part("a", 0, 8.7), part("b", 8.7, 12.2), part("c", 88.08, 7.91), part("d", 52.97, 4)]);
  assert.deepEqual(starts(packAudio(p, p)), { a: 0, b: 8.7, c: 24.9, d: 20.9 });

  // Other files are packed on their own; music starting at 5 s stays there.
  const music = part("m1", 5, 30, { sourceId: "music" });
  const q = project([part("a", 0, 2), part("b", 10, 2), music]);
  assert.deepEqual(starts(packAudio(q, q)), { a: 0, b: 2, m1: 5 });

  const packed = packAudio(p, p);
  assert.equal(packAudio(packed, packed), packed, "already packed: the same project back");
});

test("magnetic: deleting or trimming a part slides the rest; off leaves them", () => {
  const on = project([part("a", 0, 4), part("b", 4, 4), part("c", 8, 4)], { magnetic: true });
  const del = (id: string) => (p: Project) => ({ ...p, audio: p.audio.filter((a) => a.id !== id) });

  let h = historyReducer(state(on), { type: "apply", fn: del("a"), record: true });
  assert.deepEqual(starts(h.present), { b: 0, c: 4 }, "deleting the first part slides the rest to 0");
  h = historyReducer(h, { type: "undo" });
  assert.deepEqual(starts(h.present), { a: 0, b: 4, c: 8 });

  const trim = (p: Project) => ({ ...p, audio: p.audio.map((a) => (a.id === "b" ? { ...a, duration: 1 } : a)) });
  assert.deepEqual(starts(historyReducer(state(on), { type: "apply", fn: trim, record: true }).present), { a: 0, b: 4, c: 5 });

  const off = project(on.audio);
  assert.deepEqual(starts(historyReducer(state(off), { type: "apply", fn: del("a"), record: true }).present), { b: 4, c: 8 });

  // Turning it on packs what's there (one undo step).
  const gappy = project([part("a", 0, 2), part("b", 30, 2)]);
  const toggled = historyReducer(state(gappy), { type: "apply", fn: (p) => ({ ...p, master: { ...p.master!, magnetic: true } }), record: true });
  assert.deepEqual(starts(toggled.present), { a: 0, b: 2 });
  assert.deepEqual(starts(historyReducer(toggled, { type: "undo" }).present), { a: 0, b: 30 });
});

test("magnetic: a drag packs once, on release (a front trim doesn't compound)", () => {
  const on = project([part("a", 0, 4), part("b", 4, 4), part("c", 8, 4)], { magnetic: true });
  // The timeline's front-trim step: delta from where the part is now.
  const trimFrontTo = (to: number) => (p: Project) => ({
    ...p,
    audio: p.audio.map((a) => (a.id === "b" ? { ...a, start: to, offset: a.offset + (to - a.start), duration: a.duration - (to - a.start) } : a)),
  });
  let h = historyReducer(state(on), { type: "begin" });
  for (let i = 0; i < 5; i++) h = historyReducer(h, { type: "apply", fn: trimFrontTo(5), record: false });
  h = historyReducer(h, { type: "end" });
  const b = h.present.audio.find((a) => a.id === "b")!;
  assert.equal(b.offset, 5, "trimmed by 1 s once, not five times");
  assert.equal(b.duration, 3);
  assert.deepEqual(starts(h.present), { a: 0, b: 4, c: 7 });
  assert.deepEqual(starts(historyReducer(h, { type: "undo" }).present), { a: 0, b: 4, c: 8 }, "the drag is one undo step");

  // Dragging a part past another swaps them.
  h = historyReducer(historyReducer(state(on), { type: "begin" }), {
    type: "apply",
    fn: (p) => ({ ...p, audio: p.audio.map((a) => (a.id === "a" ? { ...a, start: 9 } : a)) }),
    record: false,
  });
  assert.deepEqual(starts(historyReducer(h, { type: "end" }).present), { a: 8, b: 0, c: 4 });
});
