// Run with: npm run desktop:test:js
// A clip's own sound: fades and volume curve (src/lib/editor/clipSound.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { clipFades, clipSoundGain, clipSoundWire, editClipCurve, visibleClipCurve } from "../../src/lib/editor/clipSound.ts";
import { layout, splitAt } from "../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, newClip, type Clip, type Project } from "../../src/lib/editor/types.ts";

const proj = (clip: Clip): Project => ({ clips: [clip], overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS });
const laid = (clip: Clip) => layout(proj(clip), 30).clips[0];
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-3, `${a} != ${b}`);

test("fades ramp the gain at the clip's edges", () => {
  const c = laid({ ...newClip("a", "s", 10, 14), fadeIn: 1, fadeOut: 2 });
  close(clipSoundGain(c, 0), 0);
  close(clipSoundGain(c, 0.5), 0.5);
  close(clipSoundGain(c, 1.5), 1);
  close(clipSoundGain(c, 3), 0.5);
  // A fade never runs past half the clip.
  assert.deepEqual(clipFades(laid({ ...newClip("b", "s", 0, 2), fadeIn: 5 })), { fadeIn: 1, fadeOut: 0 });
});

test("the curve is in source seconds, through speed", () => {
  const c = laid({ ...newClip("a", "s", 10, 14), speed: 2, envelope: [{ t: 11, v: 1 }, { t: 13, v: 0 }] });
  // Timeline 1 s = source 12: halfway down the curve.
  close(clipSoundGain(c, 1), 0.5);
  const wire = clipSoundWire(c);
  assert.deepEqual(wire.gain, [
    [0, 1],
    [0.5, 1],
    [1.5, 0],
    [2, 0],
  ]);
  assert.equal(clipSoundWire(laid(newClip("b", "s", 0, 2))).gain, undefined);
});

test("reversed clips read the curve backwards", () => {
  const c = laid({ ...newClip("a", "s", 0, 4), reverse: true, envelope: [{ t: 0, v: 0 }, { t: 4, v: 1 }] });
  // Plays source 4 -> 0: loud at the start, silent at the end.
  assert.ok(clipSoundGain(c, 0.1) > 0.9);
  assert.ok(clipSoundGain(c, 3.9) < 0.1);
  const g = clipSoundWire(c).gain!;
  assert.ok(g[0][1] > 0.99 && g[g.length - 1][1] < 0.01);
});

test("editing from the timeline", () => {
  const c = laid({ ...newClip("a", "s", 10, 14), speed: 2 });
  const pts = editClipCurve(c, { kind: "add", t: 1, v: 0.5 });
  assert.deepEqual(pts, [{ t: 12, v: 0.5 }]);
  const c2 = laid({ ...c.clip, envelope: [{ t: 11, v: 1 }, { t: 12, v: 0.5 }, { t: 13, v: 1 }] });
  // Dragging the middle point past its neighbor stops just before it.
  const moved = editClipCurve(c2, { kind: "move", index: 1, t: 1.9, v: 0.2 });
  assert.equal(moved.length, 3);
  assert.ok(moved[1].t < 13 && moved[1].v === 0.2);
  assert.equal(editClipCurve(c2, { kind: "remove", index: 0 }).length, 2);
  const vis = visibleClipCurve(c2);
  assert.equal(vis.length, 5);
  assert.equal(vis[0].index, null);
});

test("splitting keeps the fades on the outer edges", () => {
  const p = proj({ ...newClip("a", "s", 0, 4), fadeIn: 1, fadeOut: 1 });
  const s = splitAt(p, layout(p, 30), 2)!;
  assert.equal(s.clips[0].fadeIn, 1);
  assert.equal(s.clips[0].fadeOut, undefined);
  assert.equal(s.clips[1].fadeIn, undefined);
  assert.equal(s.clips[1].fadeOut, 1);
});
