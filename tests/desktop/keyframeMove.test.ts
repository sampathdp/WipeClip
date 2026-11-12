// Run with: npm run desktop:test:js
// Retiming keyframes from the timeline (src/lib/editor/keyframes.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { KEYFRAME_SNAP, moveKeyframe, removeKeyframe } from "../../src/lib/editor/keyframes.ts";
import type { Keyframe } from "../../src/lib/editor/types.ts";

const k = (t: number): Keyframe => ({ t, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, ease: "smooth" });

test("a keyframe moves, held between its neighbors", () => {
  const kfs = [k(0), k(1), k(2)];
  assert.equal(moveKeyframe(kfs, 1, 1.5)[1].t, 1.5);
  assert.ok(Math.abs(moveKeyframe(kfs, 1, 5)[1].t - (2 - KEYFRAME_SNAP)) < 1e-3);
  assert.ok(Math.abs(moveKeyframe(kfs, 1, -1)[1].t - KEYFRAME_SNAP) < 1e-3);
  assert.equal(moveKeyframe(kfs, 0, -3)[0].t, -3); // the first has no lower neighbor
  assert.equal(moveKeyframe(kfs, 1, 1), kfs); // unchanged: same list
  assert.equal(moveKeyframe(kfs, 9, 1), kfs);
});

test("removing", () => {
  assert.deepEqual(removeKeyframe([k(0), k(1)], 0).map((x) => x.t), [1]);
});
