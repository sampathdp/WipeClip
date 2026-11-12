// Run with: npm run desktop:test:js
// Look and effect strength over time (src/lib/editor/strength.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { clipLookStrength, clipLookWire, effectMixWire, effectStrength, setStrength, strengthAt, strengthFade } from "../../src/lib/editor/strength.ts";
import { layout } from "../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, newClip, type Clip, type EffectClip } from "../../src/lib/editor/types.ts";

const laid = (clip: Clip) => layout({ clips: [clip], overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS }, 30).clips[0];
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-3, `${a} != ${b}`);

test("points: linear, held, clamped, replaced nearby", () => {
  assert.equal(strengthAt(undefined, 5), 1);
  const pts = setStrength(setStrength(undefined, 1, 0), 3, 1);
  close(strengthAt(pts, 0), 0);
  close(strengthAt(pts, 2), 0.5);
  close(strengthAt(pts, 9), 1);
  assert.equal(setStrength(pts, 1.01, 0.4).length, 2);
  assert.equal(setStrength(pts, 2, 7)[1].v, 1);
  assert.deepEqual(strengthFade("out", 0, 4, 1), [
    { t: 3, v: 1 },
    { t: 4, v: 0 },
  ]);
});

test("a clip's look strength is in source time, through speed", () => {
  const c = laid({ ...newClip("a", "s", 10, 14), speed: 2, lookMix: [{ t: 10, v: 0 }, { t: 14, v: 1 }] });
  close(clipLookStrength(c, 1), 0.5); // 1 s on the timeline = source 12
  const wire = clipLookWire(c)!;
  assert.deepEqual(wire[0], [0, 0]);
  assert.deepEqual(wire[wire.length - 1][0], 2);
  close(wire[wire.length - 1][1], 1);
  assert.equal(clipLookWire(laid({ ...newClip("b", "s", 0, 2), lookMix: [{ t: 0, v: 1 }] })), undefined);
});

test("an effect's strength is from its start", () => {
  const e: EffectClip = { id: "e", type: "blur", start: 4, end: 8, intensity: 50, mix: [{ t: 0, v: 0 }, { t: 2, v: 1 }] };
  close(effectStrength(e, 5), 0.5);
  assert.deepEqual(effectMixWire(e), [
    [4, 0],
    [6, 1],
    [8, 1],
  ]);
  assert.equal(effectMixWire({ ...e, mix: undefined }), undefined);
});
