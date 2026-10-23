import type { AudioClip } from "./types";

/** Auto-ducking: an audio track (music) lowered while someone speaks.
 *
 * The speech regions come from the timeline's own speech (clip sound,
 * voiceovers - captions.ts buildSpeechMix) and are stored on the track, so
 * preview and export use the very same curve: the track's gain drops by
 * `amount` over ATTACK seconds before each region and comes back over
 * RELEASE seconds after it. The export evaluates the same polyline
 * (editor.py duck_breakpoints).
 */

export const DUCK_ATTACK = 0.3;
export const DUCK_RELEASE = 0.5;
export const DEFAULT_DUCK_AMOUNT = 0.7;

const FRAME = 0.02; // seconds per loudness frame
const MIN_REGION = 0.25;

/** Where speech is audible in `samples` (mono, `rate` Hz, timeline time):
 * frames well above the quiet floor, short gaps bridged, blips dropped,
 * and regions merged when their ramps would overlap. */
export function speechRegions(samples: Float32Array, rate: number): [number, number][] {
  const hop = Math.round(rate * FRAME);
  const n = Math.floor(samples.length / hop);
  if (n === 0) return [];
  const rms = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) sum += samples[i] * samples[i];
    rms[f] = Math.sqrt(sum / hop);
  }
  const sorted = Float32Array.from(rms).sort();
  const floor = sorted[Math.floor(n * 0.2)];
  const loud = sorted[Math.floor(n * 0.95)];
  // Halfway (in dB) between the quiet floor and the loud frames, and never
  // below about -45 dBFS.
  const threshold = Math.max(0.006, Math.sqrt(Math.max(floor, 1e-5) * Math.max(loud, 1e-5)));
  const raw: [number, number][] = [];
  let start = -1;
  for (let f = 0; f <= n; f++) {
    const on = f < n && rms[f] > threshold;
    if (on && start < 0) start = f;
    if (!on && start >= 0) {
      raw.push([start * FRAME, f * FRAME]);
      start = -1;
    }
  }
  return mergeRegions(raw, 0.6).filter(([a, b]) => b - a >= MIN_REGION);
}

/** Joins regions less than `gap` apart, then ones whose ramps would touch. */
export function mergeRegions(regions: [number, number][], gap = 0): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of [...regions].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a - last[1] < Math.max(gap, DUCK_ATTACK + DUCK_RELEASE)) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]);
}

/** Gain multiplier (0..1) of a ducked track at timeline time `t`. */
export function duckGain(clip: AudioClip, t: number): number {
  const d = clip.duck;
  if (!d || d.amount <= 0) return 1;
  let f = 0;
  for (const [a, b] of d.regions) {
    if (t < a - DUCK_ATTACK) break;
    if (t <= b + DUCK_RELEASE) {
      f = t < a ? (t - (a - DUCK_ATTACK)) / DUCK_ATTACK : t <= b ? 1 : 1 - (t - b) / DUCK_RELEASE;
      break;
    }
  }
  return 1 - d.amount * f;
}
