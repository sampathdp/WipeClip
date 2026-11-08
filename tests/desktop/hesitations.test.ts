// Run with: npm run desktop:test:js
// Hesitation sounds found from the sound (src/lib/editor/hesitations.ts)
// and the filler words in their stretched spellings (wordEdit.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { findHesitations, hesitationSuggestions, type Hesitation } from "../../src/lib/editor/hesitations.ts";
import { transcriptSuggestions } from "../../src/lib/editor/speechEdits.ts";
import type { EditSuggestion, Transcript, TranscriptWord } from "../../src/lib/editor/types.ts";
import { fillerIndices } from "../../src/lib/editor/wordEdit.ts";

const RATE = 16000;
let n = 0;
const ids = () => `sg${++n}`;

/** A small, repeatable random source. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

/** A voice-like sound: harmonics of f0 (Hz, may glide from f0[0] to f0[1])
 * shaped by formant peaks, at `peak` amplitude. */
function voice(out: Float32Array, at: number, len: number, f0: [number, number], formants: number[], peak: number, rand = rng(7)) {
  const a = Math.round(at * RATE);
  const m = Math.round(len * RATE);
  const amps: number[] = [];
  let phase = 0;
  const harmonics = 30;
  const ph = Array.from({ length: harmonics }, () => rand() * Math.PI * 2);
  for (let i = 0; i < m && a + i < out.length; i++) {
    const t = i / m;
    const f = f0[0] + (f0[1] - f0[0]) * t;
    phase += (2 * Math.PI * f) / RATE;
    let s = 0;
    for (let h = 1; h <= harmonics; h++) {
      const hz = h * f;
      if (hz > 4000) break;
      if (i === 0) amps[h] = 0;
      let g = 0.02;
      for (const fm of formants) g += 1 / (1 + ((hz - fm) / 120) ** 2);
      s += (g / h ** 0.5) * Math.sin(h * phase + ph[h - 1]);
    }
    // 20 ms attack and release.
    const env = Math.min(1, i / (0.02 * RATE), (m - i) / (0.02 * RATE));
    out[a + i] += s * env;
  }
  // Scale the stretch to its peak.
  let max = 0;
  for (let i = a; i < a + m && i < out.length; i++) max = Math.max(max, Math.abs(out[i]));
  for (let i = a; i < a + m && i < out.length; i++) out[i] *= peak / (max || 1);
}

/** Speech-like syllables: each a different vowel and pitch movement,
 * 120-220 ms, with a short dip or hiss between them. */
function syllables(out: Float32Array, at: number, len: number, seed = 3) {
  const rand = rng(seed);
  const VOWELS = [
    [700, 1200],
    [300, 2300],
    [500, 1000],
    [400, 2000],
    [600, 1700],
    [350, 900],
  ];
  let t = at;
  while (t < at + len) {
    const d = 0.12 + rand() * 0.1;
    const v = VOWELS[Math.floor(rand() * VOWELS.length)];
    const f = 110 + rand() * 60;
    voice(out, t, d, [f, f * (0.85 + rand() * 0.3)], v, 0.3 + rand() * 0.2, rand);
    t += d;
    // A consonant: hiss or a short silence.
    const c = 0.03 + rand() * 0.05;
    if (rand() < 0.5) {
      const r = rng(Math.floor(rand() * 1e6));
      for (let i = Math.round(t * RATE); i < Math.round((t + c) * RATE) && i < out.length; i++) out[i] += (r() * 2 - 1) * 0.05;
    }
    t += c;
  }
}

function noiseFloor(out: Float32Array, amp = 0.002) {
  const r = rng(99);
  for (let i = 0; i < out.length; i++) out[i] += (r() * 2 - 1) * amp;
}

/** "speech ... aaa ... speech" with pauses around the held sound. */
function withHeldSound(formants = [700, 1200], f0: [number, number] = [120, 112], peak = 0.35) {
  const x = new Float32Array(8 * RATE);
  syllables(x, 0.5, 2.5);
  voice(x, 3.5, 0.7, f0, formants, peak); // 3.5..4.2
  syllables(x, 4.7, 2.5, 11);
  noiseFloor(x);
  return x;
}

test("a held 'aaa' between pauses is found, and the speech around it isn't", () => {
  const found = findHesitations(withHeldSound());
  assert.equal(found.length, 1, JSON.stringify(found));
  const h = found[0];
  assert.ok(h.start >= 3.45 && h.end <= 4.3, `${h.start}..${h.end}`);
  assert.ok(h.end - h.start >= 0.5, "most of the sound is steady");
  assert.ok(h.pauseBefore && h.pauseAfter);
  assert.ok(Math.abs(h.pitchHz - 116) < 8, `${h.pitchHz} Hz`);
  assert.ok(h.quietBefore > 0.2 && h.quietAfter > 0.2);
});

test("'eee' and a quieter hummed 'mmm' are found too", () => {
  assert.equal(findHesitations(withHeldSound([300, 2300], [140, 135])).length, 1, "eee");
  assert.equal(findHesitations(withHeldSound([250], [105, 100], 0.15)).length, 1, "mmm");
});

test("plain speech, steady noise and a long tone are not hesitations", () => {
  const speech = new Float32Array(10 * RATE);
  syllables(speech, 0.3, 9.4, 5);
  noiseFloor(speech);
  assert.deepEqual(findHesitations(speech), [], "syllables change every ~150 ms");

  // A loud fan or hiss: steady, but not voiced.
  const fan = new Float32Array(6 * RATE);
  noiseFloor(fan);
  syllables(fan, 0.3, 1.5);
  const r = rng(5);
  for (let i = 2.5 * RATE; i < 3.5 * RATE; i++) fan[i] += (r() * 2 - 1) * 0.3;
  assert.deepEqual(findHesitations(fan), [], "hiss");

  // A held note of several seconds is music or a tone.
  const tone = new Float32Array(10 * RATE);
  syllables(tone, 0.3, 1.5);
  voice(tone, 2.5, 6, [220, 220], [700, 1200], 0.4);
  noiseFloor(tone);
  assert.deepEqual(findHesitations(tone), [], "too long");

  assert.deepEqual(findHesitations(new Float32Array(3 * RATE)), [], "silence");
  assert.deepEqual(findHesitations(new Float32Array(10)), [], "too short to measure");
});

test("a slower sound that glides in pitch (a word said slowly) is left alone", () => {
  const x = new Float32Array(6 * RATE);
  syllables(x, 0.5, 1.5);
  voice(x, 2.5, 0.7, [180, 110], [700, 1200], 0.35); // a falling "nooo"
  noiseFloor(x);
  assert.deepEqual(findHesitations(x), []);
});

const words = (spec: string): TranscriptWord[] =>
  spec.split(" ").map((item) => {
    const [text, at, len] = item.split("@");
    return { text, start: Number(at), end: Number(at) + Number(len ?? 0.25) };
  });
const tr = (w: TranscriptWord[], language = "si"): Transcript => ({ language, words: w, total: 8 });

const H: Hesitation = { start: 3.5, end: 4.2, soundStart: 3.48, soundEnd: 4.22, pitchHz: 116, pitchSpread: 0.3, pauseBefore: true, pauseAfter: true, quietBefore: 0.5, quietAfter: 0.5 };

test("with a transcript: a sound between words is a high-confidence cut that keeps a short pause", () => {
  const [s, ...rest] = hesitationSuggestions([H], tr(words("one@2.5 two@2.75 three@4.7 four@4.95")), [], ids);
  assert.equal(rest.length, 0);
  assert.equal(s.kind, "hesitation");
  assert.equal(s.action, "cut");
  assert.equal(s.confidence, "high");
  assert.match(s.title, /^Hesitation sound/);
  // 0.2 s of each 0.5 s pause stays.
  assert.ok(Math.abs(s.start - 3.18) < 0.01 && Math.abs(s.end - 4.52) < 0.01, `${s.start}..${s.end}`);
});

test("the cut never reaches into a recognized word", () => {
  const [s] = hesitationSuggestions([{ ...H, quietBefore: 1.2, quietAfter: 1.2 }], tr(words("one@2.9 three@4.5")), [], ids);
  assert.ok(s.start >= 3.15 - 1e-9 && s.end <= 4.47 + 1e-9, `${s.start}..${s.end}`);
});

test("inside a real word, on a transcript filler, or far from any speech: no suggestion", () => {
  assert.deepEqual(hesitationSuggestions([H], tr(words("sooo@3.4@0.9 then@4.7")), [], ids), [], "a word said slowly");
  assert.deepEqual(hesitationSuggestions([H], tr(words("one@2.5 uhh@3.5@0.7 three@4.7"), "en"), [], ids), [], "the filler word covers it");
  const filler: EditSuggestion = { id: "f", kind: "filler", start: 3.4, end: 4.7, title: "", detail: "", action: "cut", status: "pending", confidence: "high" };
  assert.deepEqual(hesitationSuggestions([H], tr(words("one@2.5 three@4.7")), [filler], ids), [], "already suggested");
  assert.deepEqual(hesitationSuggestions([H], tr(words("one@0.2 three@7.6")), [], ids), [], "no speech nearby: music or other sound");
});

test("without a transcript the sound alone decides, with lower confidence", () => {
  const [s] = hesitationSuggestions([H], null, [], ids);
  assert.equal(s.confidence, "medium");
  assert.match(s.detail, /no transcript/);
  const [joined] = hesitationSuggestions([{ ...H, pauseBefore: false, quietBefore: 0, soundStart: 3.5 }], null, [], ids);
  assert.equal(joined.confidence, "low");
  assert.match(joined.detail, /runs straight into the speech/);
});

test("found end to end: synthesized sound plus a transcript without the filler", () => {
  const list = hesitationSuggestions(findHesitations(withHeldSound()), tr(words("one@0.5@1 two@1.6@1.3 three@4.7@1.2 four@6@1.2")), [], ids);
  assert.equal(list.length, 1);
  assert.ok(list[0].start < 3.55 && list[0].end > 4.15);
});

test("filler words are recognized in their stretched spellings, not as real words", () => {
  const w = words("ummm@0 uhhh@1 Aaah,@2 eee@3 hmmm@4 mhm@5 err@6 a@7 e@8 umbrella@9 ahead@10 me@11");
  assert.deepEqual(fillerIndices(w), [0, 1, 2, 3, 4, 5, 6]);
  const list = transcriptSuggestions({ language: "en", words: words("ummm@0 so@0.5 hmmm@1 then@1.5"), total: 3 }, ids).filter((s) => s.kind === "filler");
  assert.deepEqual(
    list.map((s) => [s.title, s.confidence]),
    [
      ['Filler: "ummm"', "high"],
      ['Filler: "hmmm"', "medium"],
    ]
  );
});
