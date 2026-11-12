// Run with: npm run desktop:test:js
// Markers, edit points, in/out range, slip and roll (src/lib/editor/timelineNav.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { followClips } from "../../src/lib/editor/follow.ts";
import { rippleCut } from "../../src/lib/editor/ripple.ts";
import { layout, updateClip } from "../../src/lib/editor/timeline.ts";
import { addMarker, editPoints, moveMarker, nextPoint, rollCut, setRangePoint, slipClip } from "../../src/lib/editor/timelineNav.ts";
import { DEFAULT_CANVAS, newClip, type Overlay, type Project } from "../../src/lib/editor/types.ts";

function base(): Project {
  return {
    clips: [newClip("A", "s", 2, 6), newClip("B", "s", 10, 14)],
    overlays: [{ id: "t", kind: "text", start: 5, end: 6, x: 0.5, y: 0.5, width: 0.5, rotation: 0, opacity: 1, animIn: "none", animOut: "none", hidden: false, locked: false, text: {} as never } as Overlay],
    audio: [],
    effects: [],
    canvas: DEFAULT_CANVAS,
    markers: [{ id: "m1", t: 5, label: "Marker 1" }],
  };
}

test("markers: added once per moment, numbered, moved", () => {
  const a = addMarker(undefined, 2);
  assert.equal(a.marker.label, "Marker 1");
  const b = addMarker(a.markers, 2.01);
  assert.equal(b.added, false);
  const c = addMarker(a.markers, 1);
  assert.deepEqual(c.markers.map((m) => m.label), ["Marker 2", "Marker 1"]);
  assert.equal(moveMarker(c.markers, a.marker.id, 99, 8).find((m) => m.id === a.marker.id)?.t, 8);
});

test("markers follow the clips and ripple cuts", () => {
  const p = base();
  const next = updateClip(p, "A", { start: 3 }); // A loses 1 s
  const f = followClips(p, next, layout(p, 30), layout(next, 30));
  assert.equal(f.markers?.[0].t, 4);
  const cut = rippleCut(p, layout(p, 30), 1, 2);
  assert.ok(cut.ok && cut.project.markers?.[0].t === 4);
});

test("edit points and jumping between them", () => {
  const p = base();
  const pts = editPoints(layout(p, 30), p.markers, { in: 1, out: 7 });
  assert.deepEqual(pts, [0, 1, 4, 5, 7, 8]);
  assert.equal(nextPoint(pts, 4, 1), 5);
  assert.equal(nextPoint(pts, 4, -1), 1);
  assert.equal(nextPoint(pts, 8, 1), null);
});

test("in/out range", () => {
  assert.deepEqual(setRangePoint(null, "in", 2, 8), { in: 2, out: 8 });
  assert.deepEqual(setRangePoint({ in: 2, out: 8 }, "out", 5, 8), { in: 2, out: 5 });
  // An in after the out starts a new range to the end.
  assert.deepEqual(setRangePoint({ in: 2, out: 5 }, "in", 6, 8), { in: 6, out: 8 });
  assert.deepEqual(setRangePoint(null, "out", 3, 8), { in: 0, out: 3 });
  assert.equal(setRangePoint(null, "in", 8, 8), null);
});

test("slip: same place and length, other part of the video; layers stay", () => {
  const p = base();
  const s = slipClip(p.clips[0], 1.5, 20);
  assert.deepEqual([s.start, s.end], [3.5, 7.5]);
  assert.deepEqual([slipClip(p.clips[0], -9, 20).start, slipClip(p.clips[0], 99, 20).end], [0, 20]);
  const next = { ...p, clips: [s, p.clips[1]] };
  const f = followClips(p, next, layout(p, 30), layout(next, 30));
  assert.equal(f.overlays, p.overlays);
  assert.equal(slipClip({ ...p.clips[0], reverse: true }, 1, 20).start, 2);
});

test("roll: the cut moves, the total stays", () => {
  const p = base();
  const r = rollCut(p, 0, 1, () => 20)!;
  assert.deepEqual([r.clips[0].end, r.clips[1].start], [7, 11]);
  assert.equal(layout(r, 30).total, layout(p, 30).total);
  // Held by the video's length and the next clip's minimum.
  const far = rollCut(p, 0, 50, () => 20)!;
  assert.ok(far.clips[1].end - far.clips[1].start >= 0.2 - 1e-9);
  const back = rollCut(p, 0, -50, () => 20)!;
  assert.ok(back.clips[0].end - back.clips[0].start >= 0.2 - 1e-9);
  assert.equal(rollCut(p, 1, 1, () => 20), null);
});
