// Run with: npm run desktop:test:js
import assert from "node:assert/strict";
import { test } from "node:test";
import { BEAT_RATE, detectBeats } from "../../src/lib/editor/beats.ts";

const R = BEAT_RATE;

function rand(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32 - 0.5;
  };
}

/** A kick-like thump every `interval` seconds over quiet noise, from `offset`. */
function drums(seconds: number, interval: number, offset = 0, seed = 1): Float32Array {
  const noise = rand(seed);
  const x = new Float32Array(Math.round(seconds * R));
  for (let i = 0; i < x.length; i++) x[i] = noise() * 0.02;
  for (let t = offset; t < seconds; t += interval) {
    const at = Math.round(t * R);
    for (let i = 0; i < 0.12 * R && at + i < x.length; i++) {
      const env = Math.exp(-i / (0.03 * R));
      x[at + i] += env * (Math.sin((2 * Math.PI * 70 * i) / R) * 0.8 + noise() * 0.4);
    }
  }
  return x;
}

test("finds the tempo and the beats of a steady pulse", () => {
  const { bpm, times } = detectBeats(drums(20, 0.5, 0.25));
  assert.ok(Math.abs(bpm - 120) < 3, `bpm ${bpm}`);
  assert.ok(times.length >= 36 && times.length <= 41, `${times.length} beats`);
  // Every beat lands on a thump (within 40 ms).
  for (const t of times) {
    const phase = (t - 0.25) / 0.5;
    assert.ok(Math.abs(phase - Math.round(phase)) * 0.5 < 0.04, `beat at ${t}`);
  }
});

test("prefers the real tempo over half or double", () => {
  for (const interval of [0.4, 0.75]) {
    const { bpm } = detectBeats(drums(20, interval, 0.1, 7));
    assert.ok(Math.abs(bpm - 60 / interval) < 4, `interval ${interval}: bpm ${bpm}`);
  }
});

test("silence has no beats", () => {
  assert.deepEqual(detectBeats(new Float32Array(R * 5)).times, []);
});
