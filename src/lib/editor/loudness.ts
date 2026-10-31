/** Loudness of the whole mix and the gain that brings it to a target.
 *
 * Measured the way ITU-R BS.1770-4 / EBU R128 define integrated loudness
 * (what ffmpeg's ebur128 and loudness meters report): K-weighting (a high
 * shelf and a high-pass), mean power in 400 ms blocks every 100 ms, an
 * absolute gate at -70 LUFS and a relative gate 10 LU below the mean.
 *
 * The editor measures the mono 16 kHz mix programMix.ts renders (the same
 * decode the captions use), counted as two identical channels because the
 * export is stereo and its mono sources play on both sides. That matches
 * the export within about 1 LU for voice (measured, see AUDIO.md); wide
 * stereo music reads up to 3 dB low. The gain found here is stored on the
 * project and applied as one fixed gain by the preview and the export
 * alike - never a dynamic loudness filter, which would lift pauses and the
 * noise in them. A peak limiter after it catches what the gain pushes over.
 * Pure - see tests/desktop/audio.test.ts.
 */
import type { LoudnessTarget } from "./types.ts";

export interface LoudnessPreset {
  label: string;
  lufs: number;
  hint: string;
}

export const LOUDNESS_TARGETS: Record<Exclude<LoudnessTarget, "off">, LoudnessPreset> = {
  online: { label: "Online video", lufs: -14, hint: "-14 LUFS, the usual level for video and social sites" },
  voice: { label: "Voice and podcasts", lufs: -16, hint: "-16 LUFS, for talking-head videos, tutorials and podcasts" },
  broadcast: { label: "Broadcast", lufs: -23, hint: "-23 LUFS (EBU R128), for TV and quieter, wide-range mixes" },
};

/** The limiter's ceiling: alimiter limit=0.89 in editor.py, about -1 dBFS. */
export const LIMIT_CEILING = 0.89;
export const LIMIT_CEILING_DB = 20 * Math.log10(LIMIT_CEILING);
/** At most this much boost, so a near-silent mix isn't turned into noise. */
export const MAX_BOOST_DB = 20;
export const MAX_CUT_DB = 24;
/** The most the limiter may take off the loudest peak to reach the target.
 * More than this flattens speech audibly, so the target is missed instead
 * (and the panel says so). */
export const LIMITER_ALLOWANCE_DB = 4;
/** Quieter than this is treated as no sound at all (BS.1770's absolute gate). */
const ABSOLUTE_GATE = -70;

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(Math.max(1e-9, g));

interface Biquad {
  b: [number, number, number];
  a: [number, number, number];
}

/** BS.1770 K-weighting for sample rate `fs`: the standard's analog
 * prototypes through the bilinear transform (the coefficients libebur128
 * computes; at 48 kHz they equal the table in the standard). */
export function kWeighting(fs: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const highpass: Biquad = { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, highpass];
}

export interface LoudnessResult {
  /** Integrated loudness, LUFS; -Infinity when everything is below the gate. */
  lufs: number;
  /** Highest sample, dBFS (of the measured signal, not true peak). */
  peakDb: number;
  /** Seconds measured. */
  duration: number;
}

/** Integrated loudness and sample peak of mono `samples` at `rate`,
 * counted as `channels` identical channels (2 for the stereo export). */
export function measureLoudness(samples: Float32Array, rate: number, channels = 2): LoudnessResult {
  const [s, h] = kWeighting(rate);
  const step = Math.round(rate * 0.1); // 100 ms
  const n = Math.floor(samples.length / step);
  // Power of every 100 ms quarter-block; a 400 ms block is four of them.
  const quarter = new Float64Array(n);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
  let peak = 0;
  for (let q = 0; q < n; q++) {
    let sum = 0;
    for (let i = q * step; i < (q + 1) * step; i++) {
      const x = samples[i];
      const ax = x < 0 ? -x : x;
      if (ax > peak) peak = ax;
      const y = s.b[0] * x + s.b[1] * x1 + s.b[2] * x2 - s.a[1] * y1 - s.a[2] * y2;
      x2 = x1;
      x1 = x;
      const z = h.b[0] * y + h.b[1] * y1 + h.b[2] * y2 - h.a[1] * z1 - h.a[2] * z2;
      y2 = y1;
      y1 = y;
      z2 = z1;
      z1 = z;
      sum += z * z;
    }
    quarter[q] = sum / step;
  }
  for (let i = n * step; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const blocks: number[] = [];
  for (let q = 0; q + 4 <= n; q++) blocks.push(((quarter[q] + quarter[q + 1] + quarter[q + 2] + quarter[q + 3]) / 4) * channels);
  const lufsOf = (z: number) => -0.691 + 10 * Math.log10(Math.max(1e-20, z));
  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
  const loud = blocks.filter((z) => lufsOf(z) > ABSOLUTE_GATE);
  let lufs = -Infinity;
  if (loud.length) {
    const relative = lufsOf(mean(loud)) - 10;
    const gated = loud.filter((z) => lufsOf(z) > relative);
    lufs = lufsOf(mean(gated.length ? gated : loud));
  }
  return { lufs, peakDb: gainToDb(peak), duration: samples.length / rate };
}

export interface GainPlan {
  /** Gain to apply, dB. */
  gainDb: number;
  /** The loudness the mix should end up at (before the limiter). */
  expectedLufs: number;
  /** Why the target isn't reached: the boost cap, or peaks the limiter
   * would have to flatten too much. Null = reached. */
  short: "boost" | "peaks" | null;
}

/** The fixed gain from `measured` to `targetLufs`, or null when there's no
 * sound to measure. Raising is capped at MAX_BOOST_DB and so that the
 * limiter takes at most LIMITER_ALLOWANCE_DB off the loudest peak. */
export function normalizationGain(measured: LoudnessResult, targetLufs: number): GainPlan | null {
  if (!Number.isFinite(measured.lufs) || measured.lufs <= ABSOLUTE_GATE) return null;
  const want = targetLufs - measured.lufs;
  const peakRoom = LIMIT_CEILING_DB - measured.peakDb + LIMITER_ALLOWANCE_DB;
  let gainDb = Math.max(-MAX_CUT_DB, Math.min(want, MAX_BOOST_DB, Math.max(0, peakRoom)));
  // Lowering is always allowed (it only removes clipping risk).
  if (want < 0) gainDb = Math.max(-MAX_CUT_DB, want);
  gainDb = Math.round(gainDb * 10) / 10;
  const short = gainDb < want - 0.05 ? (want > MAX_BOOST_DB && gainDb >= MAX_BOOST_DB - 0.05 ? "boost" : "peaks") : null;
  return { gainDb, expectedLufs: measured.lufs + gainDb, short };
}
