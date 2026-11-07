/** Hesitation sounds found from the sound itself: a held, steady voice
 * sound with no word in it - "aaa", "eee", "uhhh", "mmm", "hmm". Speech
 * models often leave these out of the transcript (they write what was
 * meant, not every sound), and in most languages there is no filler word
 * list at all, so the transcript alone misses them.
 *
 * What makes a hesitation different from speech: speech changes every
 * ~100 ms (each syllable moves the mouth, so the spectrum and loudness
 * move), while a hesitation holds one vowel or hum - the spectrum's shape,
 * the loudness and the pitch all stay put for a quarter second or more.
 * Each 10 ms frame of the 16 kHz speech mix is measured for loudness,
 * zero crossings (voiced or hissy), a short autocorrelation (the shape of
 * the spectrum) and pitch; stretches where all of them hold still become
 * candidates.
 *
 * Like every review suggestion, nothing is cut until the user accepts it.
 * Pure - see tests/desktop/hesitations.test.ts. */
import { fillerIndices } from "./wordEdit.ts";
import type { EditSuggestion, Transcript } from "./types.ts";

/** A held sound found in the mix, in mix (timeline) seconds. */
export interface Hesitation {
  /** The steady part. */
  start: number;
  end: number;
  /** With the sound's onset and decay around the steady part. */
  soundStart: number;
  soundEnd: number;
  /** Median pitch, Hz, and its spread in semitones (standard deviation). */
  pitchHz: number;
  pitchSpread: number;
  /** Whether the level drops to a pause right before / after the sound. */
  pauseBefore: boolean;
  pauseAfter: boolean;
  /** Length of that pause, seconds (0 when the sound runs into speech). */
  quietBefore: number;
  quietAfter: number;
}

const HOP_SEC = 0.01;
const WIN_SEC = 0.03;
/** Spectral shape: log energy in this many bands, 100-4000 Hz. */
const BANDS = 16;
const BAND_LO = 100;
const BAND_HI = 4000;
/** The shape is compared with the frame this far ahead (50 ms). */
const SHAPE_STEP = 5;
/** Largest change of shape still "the same sound": RMS over the bands, dB. */
const SHAPE_STILL_DB = 5;
/** Hissy frames (s, f, sh) cross zero far more often than voiced ones
 * (generous: microphone hiss raises it on vowels too; pitch decides). */
const MAX_ZCR = 0.3;
/** Shortest and longest held sound. Longer than a few seconds is a tone,
 * music or a hum, not a hesitation. */
const MIN_SEC = 0.25;
const MAX_SEC = 3.5;
/** A held vowel's loudness stays within this range (10th to 90th
 * percentile); syllables dip between them. */
const MAX_LEVEL_RANGE_DB = 14;
/** Pitch: share of frames with a clear pitch, and how much it may move. */
const MIN_VOICED_SHARE = 0.7;
const MAX_PITCH_SPREAD = 1.5;
const MAX_PITCH_RANGE = 4;
const MIN_HZ = 70;
const MAX_HZ = 400;
/** A pause right before or after is looked for this far out. */
const PAUSE_LOOK = 0.4;
/** Onset and decay taken with the sound, at most. */
const EDGE_SEC = 0.15;

const db = (v: number) => 20 * Math.log10(Math.max(1e-9, v));

function percentile(values: ArrayLike<number>, p: number): number {
  const sorted = Float32Array.from(values).sort();
  if (sorted.length === 0) return -120;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))];
}

/** Log band energies of one Hann-windowed frame (radix-2 FFT), with their
 * mean removed. */
class BandSpectrum {
  private size: number;
  private re: Float32Array;
  private im: Float32Array;
  private hann: Float32Array;
  private edges: number[];
  private rev: Uint32Array;
  private win: number;
  /** Samples averaged into one: the bands stop at 4 kHz, so 8 kHz is enough. */
  private step: number;
  constructor(frame: number, rate: number) {
    this.step = Math.max(1, Math.floor(rate / 8000));
    const win = Math.floor(frame / this.step);
    rate /= this.step;
    this.win = win;
    let size = 1;
    while (size < win) size <<= 1;
    this.size = size;
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
    this.hann = Float32Array.from({ length: win }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1)));
    // Bands evenly spaced on a log scale, as hearing spaces them.
    this.edges = Array.from({ length: BANDS + 1 }, (_, k) => Math.max(1, Math.round(((BAND_LO * (BAND_HI / BAND_LO) ** (k / BANDS)) * size) / rate)));
    const bits = Math.log2(size);
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }
  measure(x: Float32Array, at: number, out: Float32Array) {
    const { size, re, im, rev } = this;
    re.fill(0);
    im.fill(0);
    const step = this.step;
    for (let i = 0; i < this.win; i++) {
      let v = 0;
      for (let k = 0; k < step; k++) v += x[at + i * step + k];
      re[rev[i]] = (v / step) * this.hann[i];
    }
    for (let len = 2; len <= size; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang);
      const wi = Math.sin(ang);
      for (let i = 0; i < size; i += len) {
        let cr = 1;
        let ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const a = i + j;
          const b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci;
          const ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
          const nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = nr;
        }
      }
    }
    let mean = 0;
    for (let k = 0; k < BANDS; k++) {
      let e = 0;
      const hi = Math.max(this.edges[k] + 1, this.edges[k + 1]);
      for (let bin = this.edges[k]; bin < hi; bin++) e += re[bin] * re[bin] + im[bin] * im[bin];
      out[k] = 10 * Math.log10(e / (hi - this.edges[k]) + 1e-12);
      mean += out[k];
    }
    mean /= BANDS;
    for (let k = 0; k < BANDS; k++) out[k] -= mean;
  }
}

/** Pitch of one window by normalized autocorrelation: [Hz, clarity 0..1]. */
function pitchOf(x: Float32Array, a: number, n: number, rate: number): [number, number] {
  const minLag = Math.floor(rate / MAX_HZ);
  const maxLag = Math.min(n - 1, Math.ceil(rate / MIN_HZ));
  let best = 0;
  let bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let e0 = 0;
    let e1 = 0;
    for (let i = a; i < a + n - lag; i++) {
      const u = x[i];
      const v = x[i + lag];
      num += u * v;
      e0 += u * u;
      e1 += v * v;
    }
    const r = num / Math.sqrt(e0 * e1 + 1e-12);
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  // Prefer the shortest lag that is nearly as clear: the longest one is
  // often a multiple of the real period (an octave too low).
  if (bestLag > 0) {
    for (const div of [4, 3, 2]) {
      const lag = Math.round(bestLag / div);
      if (lag < minLag) continue;
      let num = 0;
      let e0 = 0;
      let e1 = 0;
      for (let i = a; i < a + n - lag; i++) {
        num += x[i] * x[i + lag];
        e0 += x[i] * x[i];
        e1 += x[i + lag] * x[i + lag];
      }
      const r = num / Math.sqrt(e0 * e1 + 1e-12);
      if (r > best * 0.9) {
        bestLag = lag;
        break;
      }
    }
  }
  return bestLag ? [rate / bestLag, best] : [0, 0];
}

/** Held, steady voice sounds in a mono mix (any rate; the speech mix is
 * 16 kHz). Independent of the transcript, so it can be kept while only
 * the transcript or the settings change. */
export function findHesitations(samples: Float32Array, rate = 16000): Hesitation[] {
  const hop = Math.max(1, Math.round(rate * HOP_SEC));
  const win = Math.max(hop, Math.round(rate * WIN_SEC));
  const n = Math.max(0, Math.floor((samples.length - win) / hop) + 1);
  if (n < SHAPE_STEP + 2) return [];
  const level = new Float32Array(n);
  const zcr = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const a = f * hop;
    let sum = 0;
    let crossings = 0;
    let prev = samples[a];
    for (let i = a; i < a + win; i++) {
      const v = samples[i];
      sum += v * v;
      if ((v >= 0) !== (prev >= 0)) crossings++;
      prev = v;
    }
    level[f] = db(Math.sqrt(sum / win));
    zcr[f] = crossings / win;
  }
  // Levels against the recording's own noise floor and speech level.
  const floor = percentile(level, 0.1);
  const loud = percentile(level, 0.95);
  if (loud - floor < 15) return []; // no speech above the noise
  const voicedDb = Math.max(floor + 12, loud - 30);
  const pauseDb = Math.max(floor + 8, loud - 24);

  // Spectral shape of each loud frame that isn't hiss: log energy in
  // bands across the voice's range, minus their mean (so only the shape
  // counts, not the loudness).
  const cand = new Uint8Array(n);
  const spec = new BandSpectrum(win, rate);
  const shape = new Float32Array(n * BANDS);
  for (let f = 0; f < n; f++) {
    if (level[f] < voicedDb || zcr[f] > MAX_ZCR) continue;
    cand[f] = 1;
    spec.measure(samples, f * hop, shape.subarray(f * BANDS, (f + 1) * BANDS));
  }
  const still = new Uint8Array(n);
  for (let f = 0; f + SHAPE_STEP < n; f++) {
    if (!cand[f] || !cand[f + SHAPE_STEP]) continue;
    let d = 0;
    for (let k = 0; k < BANDS; k++) {
      const diff = shape[f * BANDS + k] - shape[(f + SHAPE_STEP) * BANDS + k];
      d += diff * diff;
    }
    if (Math.sqrt(d / BANDS) < SHAPE_STILL_DB && Math.abs(level[f] - level[f + SHAPE_STEP]) < 6) still[f] = 1;
  }

  const out: Hesitation[] = [];
  const minFrames = Math.round(MIN_SEC / HOP_SEC);
  let f = 0;
  while (f < n) {
    if (!still[f]) {
      f++;
      continue;
    }
    // A run of still frames, across single-frame wobbles.
    let g = f;
    while (g + 1 < n && (still[g + 1] || (g + 2 < n && still[g + 2]))) g++;
    const a = f;
    const b = Math.min(n - 1, g + SHAPE_STEP); // the last frame compared
    f = g + 1;
    const frames = b - a + 1;
    if (frames < minFrames || frames * HOP_SEC > MAX_SEC) continue;
    // Loudness holds (no syllable dips).
    const lv = level.subarray(a, b + 1);
    if (percentile(lv, 0.9) - percentile(lv, 0.1) > MAX_LEVEL_RANGE_DB) continue;
    // Pitch holds: every second frame is enough.
    const pitches: number[] = [];
    let measured = 0;
    for (let k = a; k <= b; k += 2) {
      measured++;
      const [hz, clarity] = pitchOf(samples, k * hop, win, rate);
      if (clarity >= 0.45 && hz > 0) pitches.push(12 * Math.log2(hz / 100));
    }
    if (pitches.length < measured * MIN_VOICED_SHARE) continue;
    const mean = pitches.reduce((s, v) => s + v, 0) / pitches.length;
    const spread = Math.sqrt(pitches.reduce((s, v) => s + (v - mean) ** 2, 0) / pitches.length);
    const range = percentile(pitches, 0.9) - percentile(pitches, 0.1);
    if (spread > MAX_PITCH_SPREAD || range > MAX_PITCH_RANGE) continue;

    // Onset and decay: louder than a pause, up to EDGE_SEC.
    const edge = Math.round(EDGE_SEC / HOP_SEC);
    let s0 = a;
    while (s0 > 0 && a - s0 < edge && level[s0 - 1] >= pauseDb) s0--;
    let s1 = b;
    while (s1 + 1 < n && s1 - b < edge && level[s1 + 1] >= pauseDb) s1++;
    const look = Math.round(PAUSE_LOOK / HOP_SEC);
    const quietRun = (from: number, step: 1 | -1) => {
      let k = from;
      let len = 0;
      while (k >= 0 && k < n && level[k] < pauseDb && len < 300) {
        k += step;
        len++;
      }
      return len;
    };
    // A pause is right at the sound's edge (onset/decay included).
    const before = s0 > 0 && a - s0 < edge && level[s0 - 1] < pauseDb ? quietRun(s0 - 1, -1) : 0;
    const after = s1 + 1 < n && s1 - b < edge && level[s1 + 1] < pauseDb ? quietRun(s1 + 1, 1) : 0;
    const pauseBefore = before >= 3 || s0 === 0;
    const pauseAfter = after >= 3 || s1 === n - 1;
    if (!pauseBefore && !pauseAfter && frames < look) continue; // held syllable inside speech
    const sorted = [...pitches].sort((x, y) => x - y);
    out.push({
      start: (a * hop) / rate,
      end: (b * hop + win) / rate,
      soundStart: pauseBefore ? (s0 * hop) / rate : (a * hop) / rate,
      soundEnd: pauseAfter ? (s1 * hop + win) / rate : (b * hop + win) / rate,
      pitchHz: 100 * 2 ** (sorted[Math.floor(sorted.length / 2)] / 12),
      pitchSpread: spread,
      pauseBefore,
      pauseAfter,
      quietBefore: before * HOP_SEC,
      quietAfter: after * HOP_SEC,
    });
  }
  // One sound that wobbled in the middle ("aaa-ah") is one hesitation.
  const merged: Hesitation[] = [];
  for (const h of out) {
    const last = merged[merged.length - 1];
    if (last && h.start <= last.end + 0.1 && h.end - last.start <= MAX_SEC) {
      merged[merged.length - 1] = {
        ...last,
        end: h.end,
        soundEnd: h.soundEnd,
        pitchSpread: Math.max(last.pitchSpread, h.pitchSpread),
        pauseAfter: h.pauseAfter,
        quietAfter: h.quietAfter,
      };
    } else merged.push(h);
  }
  return merged;
}

/** Pause left on each side of a cut hesitation, so speech doesn't run
 * together. */
const KEEP_PAUSE = 0.2;
/** Most of a pause taken along with the sound, per side. */
const MAX_PAUSE_TAKEN = 0.6;
/** A held sound this far from any recognized word is music or other
 * sound, not hesitation in speech. */
const NEAR_WORD = 2.5;

/** Review suggestions for the hesitations. `transcript`: one that still
 * matches the edit, or null - then the sound alone decides and the
 * confidence is lower. `existing`: the other suggestions; a hesitation
 * where a transcript filler or repeat is already suggested is left out. */
export function hesitationSuggestions(
  found: Hesitation[],
  transcript: Transcript | null,
  existing: EditSuggestion[],
  ids: () => string
): EditSuggestion[] {
  const words = transcript?.words ?? [];
  const fillers = new Set(fillerIndices(words));
  const taken = existing.filter((s) => s.action === "cut" && (s.kind === "filler" || s.kind === "repeat"));
  const out: EditSuggestion[] = [];
  for (const h of found) {
    const len = h.end - h.start;
    if (taken.some((s) => s.start < h.soundEnd && s.end > h.soundStart)) continue;
    let prevEnd = -Infinity;
    let nextStart = Infinity;
    if (transcript) {
      // Mostly inside a real word: a word said slowly ("sooo"), not a filler.
      let inWords = 0;
      let onFiller = false;
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const o = Math.min(h.end, w.end) - Math.max(h.start, w.start);
        if (o <= 0) continue;
        if (fillers.has(i)) onFiller = true;
        else inWords += o;
      }
      if (onFiller || inWords > Math.min(0.25, len * 0.5)) continue;
      for (const w of words) {
        if (w.end <= h.start + 0.05) prevEnd = Math.max(prevEnd, w.end);
        if (w.start >= h.end - 0.05) nextStart = Math.min(nextStart, w.start);
      }
      if (h.start - prevEnd > NEAR_WORD && nextStart - h.end > NEAR_WORD) continue;
    }
    // The sound, plus the pause around it down to KEEP_PAUSE on each side.
    let start = h.soundStart - Math.min(MAX_PAUSE_TAKEN, Math.max(0, h.quietBefore - KEEP_PAUSE));
    let end = h.soundEnd + Math.min(MAX_PAUSE_TAKEN, Math.max(0, h.quietAfter - KEEP_PAUSE));
    // Never into a recognized word (their times are estimates).
    if (Number.isFinite(prevEnd)) start = Math.max(start, Math.min(h.soundStart, prevEnd + 0.03));
    if (Number.isFinite(nextStart)) end = Math.min(end, Math.max(h.soundEnd, nextStart - 0.03));
    if (end - start < MIN_SEC) continue;
    const isolated = h.pauseBefore && h.pauseAfter;
    const confidence: EditSuggestion["confidence"] = transcript
      ? isolated && len >= 0.35 && h.pitchSpread <= 0.8
        ? "high"
        : "medium"
      : isolated
        ? "medium"
        : "low";
    out.push({
      id: ids(),
      kind: "filler",
      start,
      end,
      title: `Hesitation sound (${len.toFixed(1)} s)`,
      detail:
        "A held, steady voice sound with no word in it, like “aaa”, “eee”, “uhhh” or “mmm”. Found from the sound itself, so it works in any language." +
        (transcript ? "" : " There's no transcript to check it against, so listen first.") +
        (isolated ? "" : " It runs straight into the speech next to it, so play the cut before applying it."),
      action: "cut",
      status: "pending",
      confidence,
    });
  }
  return out;
}
