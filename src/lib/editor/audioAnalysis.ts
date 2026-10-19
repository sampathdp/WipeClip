/** Local audio analysis of the timeline's speech: long silences, pauses
 * between spoken sections, clipping, sudden loud peaks and very quiet
 * speech. Works on the 16 kHz mono mix captions already build
 * (captions.ts buildSpeechAudio). Pure - see tests/desktop/tutorial.test.ts.
 *
 * Levels are judged against the recording's own noise floor (a low
 * percentile of 20 ms frame loudness), so background hum or a noisy room
 * doesn't count as speech and quiet speakers aren't mistaken for silence.
 * Nothing here decides what is a mistake: silences become *suggestions*,
 * and a silence while the user is clearly working on screen is marked for
 * review, not for cutting (see insights.ts).
 */

export const ANALYSIS_RATE = 16000;
const FRAME = 320; // 20 ms

export interface SilenceSettings {
  /** 0..1: higher treats more of the quiet as silence. */
  sensitivity: number;
  /** Shortest pause that becomes a suggestion, seconds. */
  minPause: number;
  /** Silence kept on each side of a cut, seconds, so speech doesn't feel clipped. */
  keep: number;
}

export const DEFAULT_SILENCE: SilenceSettings = { sensitivity: 0.5, minPause: 1.5, keep: 0.35 };

export interface AudioSpan {
  start: number;
  end: number;
}

export interface AudioReport {
  /** dBFS of 20 ms frames. */
  frameDb: Float32Array;
  noiseFloorDb: number;
  speechThresholdDb: number;
  /** Silent stretches at least minPause long (full length, before `keep`). */
  silences: AudioSpan[];
  /** Runs of clipped samples (|s| >= 0.99). */
  clipping: AudioSpan[];
  /** Sudden loud moments: much louder than the speech around them. */
  loud: AudioSpan[];
  /** Long stretches of speech close to the noise floor. */
  quiet: AudioSpan[];
  duration: number;
}

const db = (v: number) => 20 * Math.log10(Math.max(1e-9, v));

function percentile(values: Float32Array, p: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))];
}

/** Runs of `true` in a per-frame mask, merged across gaps shorter than
 * `bridge` frames, kept if at least `min` frames long. */
function runs(mask: Uint8Array, min: number, bridge = 0): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < mask.length) {
    if (!mask[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < mask.length && mask[j]) j++;
    const last = out[out.length - 1];
    if (last && i - last[1] <= bridge) last[1] = j;
    else out.push([i, j]);
    i = j;
  }
  return out.filter(([a, b]) => b - a >= min);
}

/** Clipped stretches of one decoded source between source times `from`
 * and `to`, in source seconds. Run on each source at its own sample rate,
 * before mixing: in the mix two loud but clean tracks (microphone plus
 * system sound) can add up past full scale, and resampling to 16 kHz
 * smears the flat tops that mark real clipping. A 20 ms frame is clipped
 * when 3+ samples on any channel hit full scale. */
export function clippedSpans(channels: Float32Array[], rate: number, from = 0, to = Infinity): AudioSpan[] {
  const len = channels.reduce((m, c) => Math.max(m, c.length), 0);
  const frame = Math.max(1, Math.round(rate * 0.02));
  const f0 = Math.max(0, Math.floor((from * rate) / frame));
  const f1 = Math.min(Math.ceil(len / frame), Math.ceil((Math.min(to, len / rate) * rate) / frame));
  if (f1 <= f0) return [];
  const mask = new Uint8Array(f1 - f0);
  for (let f = f0; f < f1; f++) {
    const a = f * frame;
    const b = Math.min(len, a + frame);
    for (const ch of channels) {
      let clipped = 0;
      for (let i = a; i < b && i < ch.length; i++) if (ch[i] >= 0.99 || ch[i] <= -0.99) clipped++;
      if (clipped >= 3) {
        mask[f - f0] = 1;
        break;
      }
    }
  }
  const sec = frame / rate;
  return runs(mask, 1, Math.round(0.2 / sec)).map(([a, b]) => ({ start: (a + f0) * sec, end: (b + f0) * sec }));
}

/** `clipping`: per-source clipping already mapped to timeline time (see
 * clippedSpans). Without it, clipping is estimated from the mix itself. */
export function analyzeAudio(
  samples: Float32Array,
  s: SilenceSettings = DEFAULT_SILENCE,
  rate = ANALYSIS_RATE,
  sourceClipping?: AudioSpan[]
): AudioReport {
  const frame = Math.round((FRAME * rate) / ANALYSIS_RATE);
  const n = Math.floor(samples.length / frame);
  const frameDb = new Float32Array(n);
  const peaks = new Float32Array(n);
  const clipMask = new Uint8Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    let peak = 0;
    let clipped = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) {
      const v = samples[i];
      const a = v < 0 ? -v : v;
      sum += v * v;
      if (a > peak) peak = a;
      if (a >= 0.99) clipped++;
    }
    frameDb[f] = db(Math.sqrt(sum / frame));
    peaks[f] = peak;
    // A few clipped samples in a row is clipping, not one stray peak.
    clipMask[f] = clipped >= 3 ? 1 : 0;
  }
  const sec = frame / rate;
  const toSpan = ([a, b]: [number, number]): AudioSpan => ({ start: a * sec, end: b * sec });
  if (n === 0) {
    return { frameDb, noiseFloorDb: -90, speechThresholdDb: -60, silences: [], clipping: [], loud: [], quiet: [], duration: samples.length / rate };
  }

  const floor = Math.max(-90, percentile(frameDb, 0.1));
  const speechLevel = percentile(frameDb, 0.9);
  // Threshold between the floor and typical speech; sensitivity moves it.
  const margin = 4 + 14 * Math.min(1, Math.max(0, s.sensitivity));
  const threshold = Math.min(Math.max(floor + margin, -60), speechLevel - 3);

  // Silence mask, then ignore speech blips under 120 ms (clicks, breaths).
  const silent = new Uint8Array(n);
  for (let f = 0; f < n; f++) silent[f] = frameDb[f] < threshold ? 1 : 0;
  const blip = Math.round(0.12 / sec);
  const silences = runs(silent, Math.max(1, Math.round(s.minPause / sec)), blip).map(toSpan);

  const clipping = sourceClipping ? mergeSpans(sourceClipping) : runs(clipMask, 1, Math.round(0.2 / sec)).map(toSpan);

  // Loud: well above typical speech, and a jump from what came just before.
  const loudMask = new Uint8Array(n);
  const ctx = Math.round(1 / sec);
  for (let f = 0; f < n; f++) {
    if (frameDb[f] < speechLevel + 9 || peaks[f] < 0.5) continue;
    let before = -90;
    for (let k = Math.max(0, f - ctx); k < f; k++) before = Math.max(before, frameDb[k]);
    if (frameDb[f] - before > 12 || frameDb[f] > speechLevel + 15) loudMask[f] = 1;
  }
  const loud = runs(loudMask, 1, Math.round(0.3 / sec)).map(toSpan);

  // Quiet speech: not silent, but within 6 dB of the threshold for 4 s+,
  // only meaningful when the rest of the speech is clearly louder.
  const quietMask = new Uint8Array(n);
  if (speechLevel - threshold > 12) {
    for (let f = 0; f < n; f++) quietMask[f] = frameDb[f] >= threshold && frameDb[f] < threshold + 6 ? 1 : 0;
  }
  const quiet = runs(quietMask, Math.round(4 / sec), Math.round(0.4 / sec)).map(toSpan);

  return { frameDb, noiseFloorDb: floor, speechThresholdDb: threshold, silences, clipping, loud, quiet, duration: samples.length / rate };
}

/** Sorted, with overlapping or touching spans (within 0.2 s) joined. */
export function mergeSpans(spans: AudioSpan[]): AudioSpan[] {
  const out: AudioSpan[] = [];
  for (const sp of [...spans].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && sp.start - last.end <= 0.2) last.end = Math.max(last.end, sp.end);
    else out.push({ ...sp });
  }
  return out;
}

/** The part of a silence to suggest cutting: `keep` seconds stay on each
 * side (none at the very start or end of the timeline). null if nothing
 * meaningful would be cut. */
export function cutRangeFor(silence: AudioSpan, keep: number, total: number): AudioSpan | null {
  const start = silence.start <= 0.05 ? 0 : silence.start + keep;
  const end = silence.end >= total - 0.05 ? total : silence.end - keep;
  return end - start >= 0.3 ? { start, end } : null;
}
