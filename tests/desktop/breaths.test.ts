// Run with: npm run desktop:test:js
// Breaths found from the sound and turned down (src/lib/editor/breaths.ts),
// and hesitations the speech model wrote as a short word (hesitations.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { BREATH_DROP_DB, breathGain, breathsForTrack, breathsOutsideWords, findBreaths } from "../../src/lib/editor/breaths.ts";
import { heardAsWord, hesitationSuggestions, type Hesitation } from "../../src/lib/editor/hesitations.ts";
import { mixKey, trackGainAt } from "../../src/lib/editor/mix.ts";
import { DEFAULT_CANVAS, newClip, type AudioClip, type Project } from "../../src/lib/editor/types.ts";

const RATE = 16000;
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Vowel-like syllables, 120-220 ms each with short gaps. */
function speech(x: Float32Array, at: number, len: number, seed = 3) {
  const r = rng(seed);
  let t = at;
  while (t < at + len) {
    const d = 0.12 + r() * 0.1;
    const f0 = 110 + r() * 50;
    const a = Math.round(t * RATE);
    const m = Math.round(d * RATE);
    for (let i = 0; i < m && a + i < x.length; i++) {
      const tt = i / RATE;
      let v = 0;
      for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * f0 * h * tt) / h;
      x[a + i] += 0.3 * v * Math.min(1, i / 320, (m - i) / 320);
    }
    t += d + 0.03 + r() * 0.04;
  }
}

/** Noise shaped like a breath: band-limited (about 250 Hz - 2 kHz, most
 * energy around 1 kHz), with a swell, at `amp`. */
function breath(x: Float32Array, at: number, len: number, amp: number, seed = 5) {
  const r = rng(seed);
  const a = Math.round(at * RATE);
  const m = Math.round(len * RATE);
  let lp = 0;
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < m && a + i < x.length; i++) {
    const w = r() * 2 - 1;
    lp += 0.4 * (w - lp); // low-pass ~1.3 kHz
    hp = 0.9 * (hp + lp - prev); // high-pass ~250 Hz
    prev = lp;
    x[a + i] += amp * hp * Math.sin((Math.PI * i) / m);
  }
}

/** "s": noise above 4 kHz (alternating sign = top of the band). */
function hiss(x: Float32Array, at: number, len: number, amp: number) {
  const r = rng(11);
  const a = Math.round(at * RATE);
  for (let i = 0; i < Math.round(len * RATE) && a + i < x.length; i++) x[a + i] += amp * (r() * 2 - 1) * (i % 2 ? 1 : -1);
}

function room(x: Float32Array, amp = 0.0015) {
  const r = rng(99);
  for (let i = 0; i < x.length; i++) x[i] += amp * (r() * 2 - 1);
}

test("a breath between phrases is found; speech, an 's' and silence aren't", () => {
  const x = new Float32Array(9 * RATE);
  speech(x, 0.3, 2.5);
  breath(x, 3.2, 0.45, 0.25); // 3.2..3.65, about 20 dB under the speech
  speech(x, 4.0, 2.0, 7);
  hiss(x, 6.0, 0.15, 0.08); // an "s" right after speech
  speech(x, 6.6, 2.0, 9);
  room(x);
  const found = findBreaths(x, RATE);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.ok(found[0].start > 3.15 && found[0].end < 3.75, JSON.stringify(found));
  assert.ok(found[0].end - found[0].start > 0.25);
});

test("no breaths in plain speech, hum, or a file without speech", () => {
  const x = new Float32Array(8 * RATE);
  speech(x, 0.3, 7.4, 4);
  room(x);
  assert.deepEqual(findBreaths(x, RATE), []);
  const hum = new Float32Array(5 * RATE).map((_, i) => 0.02 * Math.sin((2 * Math.PI * 100 * i) / RATE));
  speech(hum, 0.5, 1.5);
  assert.deepEqual(findBreaths(hum, RATE), []);
  const onlyNoise = new Float32Array(4 * RATE);
  breath(onlyNoise, 1, 0.5, 0.5);
  room(onlyNoise);
  assert.deepEqual(findBreaths(onlyNoise, RATE), [], "a breath needs speech near it");
});

test("breaths over a recognized word are left alone", () => {
  const spans = [
    { start: 1, end: 1.4 },
    { start: 3, end: 3.4 },
  ];
  const t = { language: "en", total: 10, words: [{ text: "hello", start: 2.9, end: 3.5 }] };
  assert.deepEqual(breathsOutsideWords(spans, t), [spans[0]]);
  assert.deepEqual(breathsOutsideWords(spans, null), spans);
});

const track = (over: Partial<AudioClip> = {}): AudioClip => ({
  id: "mic",
  sourceId: "m",
  label: "Microphone",
  start: 2,
  offset: 5,
  duration: 10,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  muted: false,
  ...over,
});

test("breaths are kept in the track's file time and turned down with short ramps", () => {
  const a = track();
  // Timeline 3..3.4 is file 6..6.4; a breath partly outside the track is clipped.
  assert.deepEqual(
    breathsForTrack(a, [
      { start: 3, end: 3.4 },
      { start: 11.9, end: 12.5 },
      { start: 20, end: 21 },
    ]),
    [
      [6, 6.4],
      [14.9, 15],
    ]
  );
  const b = { ...a, breaths: [[6, 6.4]] as [number, number][] };
  const low = 10 ** (BREATH_DROP_DB / 20);
  assert.equal(breathGain(b, 2.9), 1);
  assert.ok(Math.abs(breathGain(b, 3.2) - low) < 1e-9, "inside");
  assert.ok(Math.abs(breathGain(b, 3.015) - (1 + (low - 1) * 0.5)) < 1e-6, "half way down the ramp");
  assert.ok(Math.abs(trackGainAt(b, 3.2) - low) < 1e-9, "part of the track's gain");
  const p = (x: AudioClip) => ({ clips: [newClip("c", "s", 0, 20)], overlays: [], audio: [x], effects: [], canvas: DEFAULT_CANVAS }) as Project;
  assert.notEqual(mixKey(p(b)), mixKey(p(a)));
});

const H: Hesitation = { start: 3.5, end: 4.2, soundStart: 3.48, soundEnd: 4.22, pitchHz: 116, pitchSpread: 0.3, pauseBefore: true, pauseAfter: true, quietBefore: 0.5, quietAfter: 0.5 };

test("a hesitation the speech model wrote as a short word is still found", () => {
  // Sinhala "අ", Tamil "ஆ", Hindi "अ", Latin "aa" / "Ahh", a repeated letter.
  for (const text of ["අ", "ஆ", "अ", "aa", "Ahh,", "ම්ම්", "eeee"]) assert.ok(heardAsWord(text, 3.45, 4.25, H), text);
  // Real words, or a short word said at normal speed, are not.
  assert.equal(heardAsWord("hello", 3.45, 4.25, H), false);
  assert.equal(heardAsWord("මම", 3.45, 3.7, H), false, "too short to be held");
  const ws = [
    { text: "one", start: 2.5, end: 2.8 },
    { text: "අ", start: 3.45, end: 4.25 },
    { text: "two", start: 4.7, end: 5 },
  ];
  const [s] = hesitationSuggestions([H], { language: "si", words: ws, total: 8 }, [], () => "x");
  assert.equal(s.kind, "hesitation");
  assert.match(s.detail, /wrote it as “අ”/);
  assert.equal(s.confidence, "high");
});
