/** Breaths between phrases, found from the sound: an unvoiced, noise-like
 * sound (no pitch), quieter than the speech, with its energy in the middle
 * of the voice range rather than in the hiss of an "s" (which crosses zero
 * far more often), lasting 0.15-1 s, next to speech. They're turned down,
 * not cut (cutting them makes speech run together): the track plays them
 * BREATH_DROP_DB quieter, with short ramps.
 *
 * Found on the 16 kHz speech mix in timeline seconds; kept on each voice
 * track in seconds of its file (AudioClip.breaths), so cuts and trims keep
 * them on the right sound. Pure - see tests/desktop/breaths.test.ts. */
import { BANDS, BandSpectrum, pitchOf } from "./hesitations.ts";
import type { AudioClip, Transcript } from "./types.ts";

const HOP_SEC = 0.01;
const WIN_SEC = 0.03;
const MIN_SEC = 0.15;
const MAX_SEC = 1.0;
/** "s", "sh", "f" are brighter than breath noise: their energy is mostly
 * above 4 kHz, a breath's around 1-2 kHz. Measured as the energy of the
 * sample-to-sample difference over the signal's (about 0.3 for noise
 * around 1.5 kHz, 1.2 around 3 kHz, 3 around 5 kHz, at 16 kHz). */
const MAX_BRIGHTNESS = 1.6;
/** Above the room by this much, below the speech by this much (dB). */
const ABOVE_FLOOR_DB = 5;
const BELOW_SPEECH_DB = 8;
/** Speech must be this close (s) before or after: a breath belongs to a phrase. */
const NEAR_SPEECH = 1.0;
/** How much a breath is turned down, and its fade in and out. */
export const BREATH_DROP_DB = -18;
export const BREATH_RAMP = 0.03;

export interface BreathSpan {
  start: number;
  end: number;
}

const db = (v: number) => 20 * Math.log10(Math.max(1e-9, v));

function percentile(values: ArrayLike<number>, p: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))] : -120;
}

/** Breaths in a mono mix, timeline seconds (see breathsOutsideWords). */
export function findBreaths(samples: Float32Array, rate = 16000): BreathSpan[] {
  const hop = Math.max(1, Math.round(rate * HOP_SEC));
  const win = Math.max(hop, Math.round(rate * WIN_SEC));
  const n = Math.max(0, Math.floor((samples.length - win) / hop) + 1);
  if (n < 10) return [];
  const level = new Float32Array(n);
  const zcr = new Float32Array(n);
  const bright = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const a = f * hop;
    let sum = 0;
    let diff = 0;
    let crossings = 0;
    let prev = samples[a];
    for (let i = a; i < a + win; i++) {
      const v = samples[i];
      sum += v * v;
      diff += (v - prev) * (v - prev);
      if ((v >= 0) !== (prev >= 0)) crossings++;
      prev = v;
    }
    level[f] = db(Math.sqrt(sum / win));
    zcr[f] = crossings / win;
    bright[f] = diff / (sum + 1e-20);
  }
  const floor = percentile(level, 0.1);
  const loud = percentile(level, 0.95);
  if (loud - floor < 20) return [];
  const lo = floor + ABOVE_FLOOR_DB;
  const hi = loud - BELOW_SPEECH_DB;

  // Voiced speech frames (for "next to speech" and to exclude vowels).
  const voiced = new Uint8Array(n);
  const spec = new BandSpectrum(win, rate);
  const shape = new Float32Array(BANDS);
  // Bands 100..4000 Hz on a log scale: the first four are under ~250 Hz,
  // the last five over ~1.3 kHz.
  const cand = new Uint8Array(n);
  for (let f = 0; f < n; f++) {
    if (level[f] < lo) continue;
    // Speech (cheap test): loud and not hissy.
    if (level[f] >= loud - 20 && zcr[f] < 0.2) voiced[f] = 1;
    if (level[f] > hi || bright[f] > MAX_BRIGHTNESS) continue;
    spec.measure(samples, f * hop, shape);
    let low = 0;
    let high = 0;
    for (let k = 0; k < 4; k++) low += shape[k] / 4;
    for (let k = BANDS - 5; k < BANDS; k++) high += shape[k] / 5;
    // Breath noise is broad: as much energy up high as down low (hum,
    // rumble and a voice's low tail are all bottom-heavy).
    if (high - low <= -6) continue;
    // No pitch: a quiet vowel or hum isn't a breath.
    if (pitchOf(samples, f * hop, win, rate)[1] >= 0.3) continue;
    cand[f] = 1;
  }

  const near = Math.round(NEAR_SPEECH / HOP_SEC);
  const voicedNear = (a: number, b: number) => {
    for (let k = Math.max(0, a - near); k < Math.min(n, b + near); k++) if (voiced[k]) return true;
    return false;
  };
  const out: BreathSpan[] = [];
  let f = 0;
  while (f < n) {
    if (!cand[f]) {
      f++;
      continue;
    }
    let g = f;
    while (g + 1 < n && (cand[g + 1] || (g + 3 < n && (cand[g + 2] || cand[g + 3])))) g++;
    const a = f;
    const b = g + 1;
    f = b;
    const start = (a * hop) / rate;
    const end = (g * hop + win) / rate;
    const len = end - start;
    if (len < MIN_SEC || len > MAX_SEC) continue;
    if (!voicedNear(a, b)) continue;
    out.push({ start, end });
  }
  return out;
}

/** With a transcript that matches the edit: breaths mostly over a
 * recognized word are a "h", "f" or a whispered syllable, not a breath. */
export function breathsOutsideWords(found: BreathSpan[], transcript: Transcript | null): BreathSpan[] {
  const words = transcript?.words ?? [];
  if (!words.length) return found;
  return found.filter((b) => words.reduce((s, w) => s + Math.max(0, Math.min(b.end, w.end) - Math.max(b.start, w.start)), 0) <= 0.3 * (b.end - b.start));
}

/** Breaths found on the timeline, as spans of a track's file (seconds),
 * for the parts of them the track plays. */
export function breathsForTrack(a: AudioClip, found: BreathSpan[]): [number, number][] {
  const out: [number, number][] = [];
  for (const b of found) {
    const s = Math.max(b.start, a.start);
    const e = Math.min(b.end, a.start + a.duration);
    if (e - s < 0.05) continue;
    const r = (t: number) => Math.round((a.offset + (t - a.start)) * 1000) / 1000;
    out.push([r(s), r(e)]);
  }
  return out;
}

/** The track's breath gain at timeline time `t`: BREATH_DROP_DB inside a
 * breath, ramping over BREATH_RAMP at both ends (inside the span). The
 * export builds the same curve (editor.py breath_points). */
export function breathGain(a: AudioClip, t: number): number {
  const spans = a.breaths;
  if (!spans || spans.length === 0) return 1;
  const s = a.offset + (t - a.start);
  const low = 10 ** (BREATH_DROP_DB / 20);
  for (const [x, y] of spans) {
    if (s < x || s > y) continue;
    const r = Math.min(BREATH_RAMP, (y - x) / 2);
    const u = Math.min(1, (s - x) / r, (y - s) / r);
    return 1 + (low - 1) * u;
  }
  return 1;
}
