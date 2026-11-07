// Run with: npm run desktop:test:js
// Phase 3 audio: volume curves (src/lib/editor/envelope.ts), a repaired
// copy's make-up gain (mix.ts cleanGain), and the microphone check
// (src/lib/recorder/micCheck.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { addPoint, curveAt, envelopeGain, envelopeWire, gainLabel, normalizePoints, visibleCurve } from "../../src/lib/editor/envelope.ts";
import { cleanGain, mixKey, trackGainAt, withCleanup } from "../../src/lib/editor/mix.ts";
import { rippleCut } from "../../src/lib/editor/ripple.ts";
import { layout } from "../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, newClip, type AudioClip, type Project } from "../../src/lib/editor/types.ts";
import { analyzeMic, MIC_CHECK_SECONDS } from "../../src/lib/recorder/micCheck.ts";

const close = (a: number, b: number, eps = 1e-6, what = "") => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} != ${b}`);

const track = (over: Partial<AudioClip> = {}): AudioClip => ({
  id: "m",
  sourceId: "song",
  label: "Music",
  start: 0,
  offset: 0,
  duration: 20,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  muted: false,
  ...over,
});
const project = (audio: AudioClip[]): Project => ({ clips: [newClip("c1", "screen", 0, 20)], overlays: [], audio, effects: [], canvas: DEFAULT_CANVAS });

// --- Volume curve -------------------------------------------------------------

test("the curve is linear between points and held outside them", () => {
  const pts = [
    { t: 2, v: 1 },
    { t: 4, v: 0 },
    { t: 6, v: 2 },
  ];
  assert.equal(curveAt(undefined, 3), 1);
  assert.equal(curveAt([], 3), 1);
  assert.equal(curveAt(pts, 0), 1);
  close(curveAt(pts, 3), 0.5);
  close(curveAt(pts, 5), 1);
  assert.equal(curveAt(pts, 99), 2);
});

test("points are sorted, clamped, rounded, deduplicated and capped", () => {
  const out = normalizePoints([
    { t: 5, v: 9 },
    { t: 1, v: -1 },
    { t: 1.004, v: 0.5 },
    { t: Number.NaN, v: 1 },
    { t: -2, v: 1 },
  ]);
  assert.deepEqual(out, [
    { t: 1.004, v: 0.5 },
    { t: 5, v: 2 },
  ]);
  assert.equal(normalizePoints(Array.from({ length: 300 }, (_, i) => ({ t: i, v: 1 }))).length, 200);
});

test("a new point sits on the curve, so it changes nothing until moved", () => {
  const pts = addPoint(
    [
      { t: 0, v: 1 },
      { t: 10, v: 0 },
    ],
    5
  );
  assert.deepEqual(pts[1], { t: 5, v: 0.5 });
  for (const s of [0, 2.5, 5, 7.5, 10]) close(curveAt(pts, s), curveAt([{ t: 0, v: 1 }, { t: 10, v: 0 }], s));
});

test("the curve is in the file's time: it plays in the track's gain and survives a ripple cut", () => {
  // Music from file second 3 at timeline 1; the dip is at file seconds 8..10.
  const a = track({
    start: 1,
    offset: 3,
    duration: 15,
    envelope: [
      { t: 8, v: 1 },
      { t: 9, v: 0.2 },
      { t: 10, v: 1 },
    ],
  });
  close(envelopeGain(a, 1 + (9 - 3)), 0.2, 1e-9, "at file second 9");
  close(trackGainAt(a, 7), 0.2, 1e-9, "trackGainAt multiplies it in");
  close(trackGainAt({ ...a, volume: 0.5 }, 7), 0.1, 1e-9);
  // Cut timeline 2..4 (file seconds 4..6): the dip moves 2 s earlier on
  // the timeline but stays on file second 9.
  const p = project([a]);
  const cut = rippleCut(p, layout(p, 30), 2, 4);
  assert.ok(cut.ok);
  if (!cut.ok) return;
  const after = cut.project.audio.find((x) => x.offset > 3)!;
  assert.deepEqual(after.envelope, a.envelope);
  close(trackGainAt(after, 5), 0.2, 1e-9, "timeline 5 is file second 9 after the cut");
});

test("drawing: the visible part with the curve's value at the track's edges", () => {
  const a = track({
    start: 10,
    offset: 2,
    duration: 4,
    envelope: [
      { t: 0, v: 0 },
      { t: 3, v: 1 },
      { t: 8, v: 2 },
    ],
  });
  const c = visibleCurve(a);
  assert.deepEqual(
    c.map((p) => [p.t, Math.round(p.v * 1000) / 1000, p.index]),
    [
      [10, 0.667, null],
      [11, 1, 1],
      [14, 1.6, null],
    ]
  );
});

test("export rows, mix key and labels", () => {
  assert.equal(envelopeWire(track()), undefined);
  assert.equal(envelopeWire(track({ envelope: [{ t: 1, v: 1 }] })), undefined, "a flat curve sends nothing");
  assert.deepEqual(envelopeWire(track({ envelope: [{ t: 1, v: 0.5 }] })), [[1, 0.5]]);
  assert.equal(mixKey(project([track({ envelope: undefined })])), mixKey(project([track()])));
  assert.notEqual(mixKey(project([track({ envelope: [{ t: 1, v: 0.5 }] })])), mixKey(project([track()])));
  assert.equal(gainLabel(0), "Silent");
  assert.equal(gainLabel(1), "0 dB");
  assert.equal(gainLabel(2), "+6.0 dB");
  assert.equal(gainLabel(0.5), "-6.0 dB");
});

// --- Repaired copy ------------------------------------------------------------

test("a repaired copy plays at its make-up gain; the original and old copies at 1", () => {
  const plain = withCleanup(track(), "clean1", 0.5);
  assert.equal(cleanGain(plain), 1);
  const repaired = withCleanup(track(), "clean2", 0, { gain: 1.6 });
  assert.equal(repaired.clean?.repaired, true);
  assert.equal(cleanGain(repaired), 1.6);
  close(trackGainAt(repaired, 5), 1.6);
  assert.equal(cleanGain({ ...repaired, clean: { ...repaired.clean!, bypass: true } }), 1, "Original plays the file as it is");
  assert.equal(cleanGain({ ...repaired, clean: { ...repaired.clean!, gain: Number.NaN } }), 1);
  assert.equal(cleanGain({ ...repaired, clean: { ...repaired.clean!, gain: 50 } }), 4, "capped");
});

// --- Microphone check ---------------------------------------------------------

const RATE = 48000;
/** Speech-like: bursts of a voiced tone, 0.3 s on / 0.15 s off, over room noise. */
function take(speechAmp: number, noiseAmp: number, seconds = MIC_CHECK_SECONDS): Float32Array {
  const x = new Float32Array(seconds * RATE);
  let seed = 9;
  for (let i = 0; i < x.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const t = i / RATE;
    const on = t % 0.45 < 0.3 ? 1 : 0;
    let v = 0;
    for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * 140 * h * t) / h;
    x[i] = Math.max(-1, Math.min(1, speechAmp * on * v * 0.45 + noiseAmp * (seed / 2 ** 31 - 1)));
  }
  return x;
}

test("mic check: a clear voice in a quiet room passes", () => {
  const r = analyzeMic(take(0.3, 0.0005), RATE);
  assert.deepEqual(r.issues, []);
  assert.match(r.verdict, /^Sounds good/);
  assert.ok(r.speechDb > -20 && r.floorDb < -60, `${r.speechDb} / ${r.floorDb}`);
});

test("mic check: quiet, distorted, noisy and silent takes each say what to do", () => {
  const quiet = analyzeMic(take(0.01, 0.00005), RATE);
  assert.deepEqual(quiet.issues, ["quiet"]);
  assert.match(quiet.tips[0], /closer/);

  const clipped = analyzeMic(take(3, 0.0005), RATE);
  assert.ok(clipped.issues.includes("clipping"), clipped.issues.join());
  assert.ok(clipped.clippedFrames > 10);
  assert.equal(clipped.verdict, "Too loud: it distorts.");

  const noisy = analyzeMic(take(0.3, 0.03), RATE);
  assert.deepEqual(noisy.issues, ["noisy"]);
  assert.match(noisy.tips[0], /fans/);

  const silent = analyzeMic(new Float32Array(RATE * MIC_CHECK_SECONDS), RATE);
  assert.deepEqual(silent.issues, ["no-speech"]);
  assert.match(silent.tips[0], /right microphone/);

  // Steady hum, no talking.
  const hum = new Float32Array(RATE * MIC_CHECK_SECONDS).map((_, i) => 0.05 * Math.sin((2 * Math.PI * 100 * i) / RATE));
  assert.deepEqual(analyzeMic(hum, RATE).issues, ["no-speech"]);
  assert.deepEqual(analyzeMic(new Float32Array(10), RATE).issues, ["no-speech"]);
});
