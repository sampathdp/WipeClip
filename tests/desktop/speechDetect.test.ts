// Run with: npm run desktop:test:js
import assert from "node:assert/strict";
import { test } from "node:test";
import { DETECT_RATE, detectSpeech, probeWindows, speechVerdict } from "../../src/lib/editor/speechDetect.ts";

const R = DETECT_RATE;

function rand(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32 - 0.5;
  };
}

/** Speech-like: phrases of syllables (voiced, gliding pitch, 4-5 Hz
 * rise and fall) with breaths and pauses between phrases. */
function speechLike(seconds: number): Float32Array {
  const out = new Float32Array(seconds * R);
  const noise = rand(7);
  let t = 0;
  let phase = 0;
  while (t < seconds - 3) {
    const phrase = 1.2 + 1.5 * Math.abs(noise());
    const end = t + phrase;
    for (let at = t; at < end; ) {
      const syl = 0.16 + 0.1 * Math.abs(noise());
      const f0 = 130 + 60 * noise();
      for (let i = Math.floor(at * R); i < Math.min(out.length, Math.floor((at + syl) * R)); i++) {
        const u = (i / R - at) / syl;
        const f = f0 * (1 + 0.25 * (u - 0.5)); // pitch glides through the syllable
        phase += (2 * Math.PI * f) / R;
        let v = 0;
        for (let k = 1; k <= 12; k++) v += Math.sin(k * phase) / k;
        out[i] = 0.25 * Math.sin(Math.PI * u) * v + 0.01 * noise();
      }
      at += syl + 0.03;
    }
    t = end + 0.35 + 0.4 * Math.abs(noise());
  }
  return out;
}

/** Music-like: held chords over a steady kick and hi-hat, never stopping. */
function musicLike(seconds: number): Float32Array {
  const out = new Float32Array(seconds * R);
  const noise = rand(3);
  const chords = [
    [262, 330, 392],
    [220, 262, 330],
    [175, 220, 262],
    [196, 247, 294],
  ];
  for (let i = 0; i < out.length; i++) {
    const t = i / R;
    let v = 0;
    for (const f of chords[Math.floor(t / 2) % 4]) for (let k = 1; k <= 5; k++) v += (0.05 * Math.sin(2 * Math.PI * f * k * t)) / k;
    const beat = t % 0.5;
    v += 0.5 * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-30 * beat)) * beat) * Math.exp(-12 * beat);
    const hat = t % 0.25;
    v += 0.05 * noise() * Math.exp(-80 * hat);
    out[i] = v;
  }
  return out;
}

test("speech is told from music by its sound", () => {
  const speech = detectSpeech(speechLike(30));
  const music = detectSpeech(musicLike(30));
  assert.equal(speech.speech, true, `speech scored ${speech.score}`);
  assert.equal(music.speech, false, `music scored ${music.score}`);
});

test("silence and very short sounds are not judged", () => {
  assert.equal(detectSpeech(new Float32Array(10 * R)).silent, true);
  assert.equal(detectSpeech(speechLike(30).subarray(0, 2 * R)).silent, true);
});

test("only a range of the track is judged", () => {
  const mixed = new Float32Array(60 * R);
  mixed.set(musicLike(30));
  mixed.set(speechLike(30), 30 * R);
  assert.equal(detectSpeech(mixed, 0, 30 * R).speech, false);
  assert.equal(detectSpeech(mixed, 30 * R, 60 * R).speech, true);
});

test("probe windows skip silence and stay within the range", () => {
  const s = new Float32Array(100 * R);
  s.set(speechLike(30), 70 * R);
  const windows = probeWindows(s);
  assert.ok(windows.length >= 1 && windows.length <= 3);
  for (const w of windows) assert.ok(w.length <= 30 * R);
  assert.equal(probeWindows(new Float32Array(40 * R)).length, 0);
});

test("the speech model and the signal combine", () => {
  const voice = { speech: true, score: 0.9, silent: false, features: null };
  const music = { speech: false, score: 0.1, silent: false, features: null };
  const unsure = { speech: true, score: 0.55, silent: false, features: null };
  const silent = { speech: false, score: 0, silent: true, features: null };
  // No model: the signal decides.
  assert.equal(speechVerdict(voice, null), true);
  assert.equal(speechVerdict(music, null), false);
  // A voice under a music bed: the model hears it.
  assert.equal(speechVerdict(music, [0.05, 0.6]), true);
  // A voice the model doubts (a phone mic, another language): the signal is sure.
  assert.equal(speechVerdict(voice, [0.48, 0.91, 0.69]), true);
  // Music the model calls music.
  assert.equal(speechVerdict(music, [0.6, 0.7]), false);
  // A sparse piece the signal half believes: the model settles it.
  assert.equal(speechVerdict(unsure, [0.95, 0.8]), false);
  assert.equal(speechVerdict(silent, [0.9]), false);
  assert.equal(speechVerdict(silent, [0.35]), true);
});
