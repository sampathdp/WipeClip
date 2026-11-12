// Run with: npm run desktop:test:js
// Trim at the playhead and delete-and-close-gap (src/lib/editor/trimEdit.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { followClips } from "../../src/lib/editor/follow.ts";
import { layout } from "../../src/lib/editor/timeline.ts";
import { deleteClosingGaps, trimAudioAt, trimClipAt, trimLayersAt, trimOverlayAt } from "../../src/lib/editor/trimEdit.ts";
import { DEFAULT_CANVAS, newClip, type AudioClip, type Overlay, type Project } from "../../src/lib/editor/types.ts";

const text = (id: string, start: number, end: number, extra: Partial<Overlay> = {}): Overlay =>
  ({
    id,
    kind: "text",
    start,
    end,
    x: 0.5,
    y: 0.5,
    width: 0.5,
    rotation: 0,
    opacity: 1,
    animIn: "none",
    animOut: "none",
    hidden: false,
    locked: false,
    text: {} as never,
    ...extra,
  }) as Overlay;
const audio = (id: string, start: number, duration: number, offset = 0): AudioClip => ({
  id,
  sourceId: "m",
  label: id,
  start,
  offset,
  duration,
  volume: 1,
  fadeIn: 0.5,
  fadeOut: 0.5,
  muted: false,
});

function base(): Project {
  return {
    clips: [newClip("A", "s", 0, 4), { ...newClip("B", "s", 10, 16), transition: { type: "fade", duration: 0.5 } }, newClip("C", "s", 20, 22)],
    overlays: [text("onB", 6, 7)],
    audio: [],
    effects: [],
    canvas: DEFAULT_CANVAS,
  };
}

test("trim left removes the start of the clip under the playhead", () => {
  const p = base();
  const lay = layout(p, 30);
  const r = trimClipAt(p, lay, 2, "left")!;
  assert.deepEqual(
    r.project.clips.map((c) => [c.start, c.end]),
    [
      [2, 4],
      [10, 16],
      [20, 22],
    ]
  );
  assert.equal(r.removed, 2);
  // Through followClips, the text on B moves up by the 2 s removed.
  const f = followClips(p, r.project, lay, layout(r.project, 30));
  assert.equal(f.overlays[0].start, 4);
});

test("trim right keeps the clip's outgoing transition", () => {
  const p = base();
  const r = trimClipAt(p, layout(p, 30), 6, "right")!; // B plays 4-10, cut 2 s in
  assert.deepEqual([r.project.clips[1].start, r.project.clips[1].end], [10, 12]);
  assert.equal(r.project.clips[1].transition?.type, "fade");
  assert.equal(r.project.clips.length, 3);
});

test("trim at an edge does nothing", () => {
  const p = base();
  assert.equal(trimClipAt(p, layout(p, 30), 0, "left"), null);
});

test("layers: the kept part plays the same moment of its media", () => {
  const a = trimAudioAt(audio("a", 2, 6, 10), 5, "left")!;
  assert.deepEqual([a.start, a.offset, a.duration, a.fadeIn], [5, 13, 3, 0]);
  const b = trimAudioAt(audio("a", 2, 6, 10), 5, "right")!;
  assert.deepEqual([b.start, b.offset, b.duration, b.fadeOut], [2, 10, 3, 0]);
  const cap = trimOverlayAt(text("c", 1, 4, { words: [{ start: 0, end: 1 }, { start: 2, end: 3 }] }), 2.5, "left")!;
  assert.deepEqual([cap.start, cap.end], [2.5, 4]);
  assert.equal(cap.words, undefined); // a word was cut away: even timing instead
  assert.equal(trimOverlayAt(text("x", 1, 2, { locked: true }), 1.5, "left"), null);
  assert.equal(trimOverlayAt(text("x", 1, 2), 3, "left"), null);
  const r = trimLayersAt({ ...base(), audio: [audio("a", 0, 10)] }, ["overlay:onB", "audio:a"], 6.5, "right");
  assert.equal(r.count, 2);
  assert.equal(r.project.overlays[0].end, 6.5);
});

test("delete and close the gap moves everything after it on the row", () => {
  const p: Project = {
    ...base(),
    overlays: [text("a", 0, 1), text("b", 2, 4), text("c", 5, 6), text("d", 7, 8), text("pin", 9, 10, { locked: true })],
    audio: [audio("m1", 0, 3), audio("m2", 3, 3)],
  };
  const r = deleteClosingGaps(p, ["overlay:b", "audio:m1", "clip:A"]);
  assert.equal(r.deleted, 2);
  const at = (id: string) => r.project.overlays.find((o) => o.id === id)?.start;
  // b (2-4) freed 2 s: c and d move back by 2, spacing kept; the locked pin stays.
  assert.deepEqual([at("a"), at("c"), at("d"), at("pin")], [0, 3, 5, 9]);
  assert.equal(r.project.audio[0].start, 0);
  // Overlapping kept items: only time nothing else covered is closed.
  const q: Project = { ...base(), overlays: [text("k", 0, 5), text("x", 3, 6), text("y", 6, 7)] };
  const r2 = deleteClosingGaps(q, ["overlay:x"]);
  assert.equal(r2.project.overlays.find((o) => o.id === "y")?.start, 5);
});
