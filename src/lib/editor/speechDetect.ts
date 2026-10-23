/** Speech or music? Decides whether an uploaded audio track is a voiceover
 * (captioned) or music (left out of captions), on the device, from the
 * signal alone. Pure - see tests/desktop/speechDetect.test.ts.
 *
 * Speech and music differ in ways that survive any language or voice
 * (the classic speech/music discrimination features):
 * - Speech stops: breaths and pauses between phrases leave many frames far
 *   below the loud ones; music is continuous.
 * - Speech rises and falls at the syllable rate: its loudness envelope
 *   carries most of its modulation at 3-7 Hz.
 * - Music holds notes: its harmonic peaks sit on the same frequency for
 *   a long time, while a voice's pitch keeps gliding between syllables.
 * Each feature alone is fooled by something (a sparse piano piece pauses,
 * a fast drum part modulates at 4 Hz), so they're combined into one score.
 */

export const DETECT_RATE = 16000;
const N = 512; // 32 ms FFT frames
const HOP = 256; // 16 ms
const FRAMES_PER_SECOND = DETECT_RATE / HOP; // 62.5
const PERSIST = 12; // frames a held note must last: ~190 ms
const MOD_WINDOW = 256; // envelope frames per modulation spectrum (~4 s)
/** Longest stretch analysed: a few excerpts spread over the track. */
const MAX_EXCERPTS = 6;
const EXCERPT = 15 * DETECT_RATE;

export interface SpeechFeatures {
  /** Frames 20 dB or more below the loud ones (pauses), 0..1. */
  pauses: number;
  /** Frames under half their second's mean loudness, 0..1. */
  lowEnergy: number;
  /** Share of the envelope's modulation at 3-7 Hz (syllable rate), 0..1. */
  syllabic: number;
  /** Share of spectral peaks still in place ~190 ms later (held notes), 0..1. */
  sustain: number;
}

export interface SpeechVerdict {
  speech: boolean;
  /** 0..1: how speech-like the audio is. */
  score: number;
  /** Nothing audible to judge. */
  silent: boolean;
  features: SpeechFeatures | null;
}

// --- FFT ---------------------------------------------------------------------

const hann = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
const bitrev = (() => {
  const out = new Uint16Array(N);
  const bits = Math.log2(N);
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    out[i] = r;
  }
  return out;
})();
const cosT = Float32Array.from({ length: N / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / N));
const sinT = Float32Array.from({ length: N / 2 }, (_, i) => Math.sin((2 * Math.PI * i) / N));

/** In-place radix-2 FFT of N points. */
function fft(re: Float32Array, im: Float32Array) {
  for (let i = 0; i < N; i++) {
    const j = bitrev[i];
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= N; size *= 2) {
    const half = size / 2;
    const step = N / size;
    for (let start = 0; start < N; start += size) {
      for (let k = 0; k < half; k++) {
        const c = cosT[k * step];
        const s = sinT[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * c + im[b] * s;
        const ti = im[b] * c - re[b] * s;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

// --- Features ----------------------------------------------------------------

const LO_BIN = 4; // 125 Hz
const HI_BIN = 192; // 6 kHz

/** Peaks of one frame's spectrum (dB): local maxima standing 6 dB over
 * their neighbourhood and within 40 dB of the frame's strongest bin. */
function peaks(spec: Float32Array): Uint8Array {
  const out = new Uint8Array(N / 2);
  let max = -Infinity;
  for (let b = LO_BIN; b < HI_BIN; b++) max = Math.max(max, spec[b]);
  for (let b = LO_BIN; b < HI_BIN; b++) {
    const v = spec[b];
    if (v < max - 40 || v < spec[b - 1] || v < spec[b + 1]) continue;
    let sum = 0;
    for (let k = b - 8; k <= b + 8; k++) sum += spec[k];
    if (v - sum / 17 >= 6) out[b] = 1;
  }
  return out;
}

/** The speech features of 16 kHz mono `samples`, or null when they're
 * too short or too quiet to judge. */
export function speechFeatures(samples: Float32Array): SpeechFeatures | null {
  const frames = Math.floor((samples.length - N) / HOP) + 1;
  if (frames < FRAMES_PER_SECOND * 3) return null;

  const level = new Float32Array(frames);
  const spectra: Float32Array[] = [];
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let f = 0; f < frames; f++) {
    const at = f * HOP;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const v = samples[at + i];
      sum += v * v;
      re[i] = v * hann[i];
      im[i] = 0;
    }
    level[f] = Math.sqrt(sum / N);
    fft(re, im);
    const spec = new Float32Array(N / 2);
    for (let b = 0; b < N / 2; b++) spec[b] = 10 * Math.log10(re[b] * re[b] + im[b] * im[b] + 1e-12);
    spectra.push(spec);
  }

  const sorted = Float32Array.from(level).sort();
  const loud = sorted[Math.floor(frames * 0.95)];
  if (loud < 0.003) return null;

  // Pauses: frames 20 dB under the loud ones.
  let quiet = 0;
  for (let f = 0; f < frames; f++) if (level[f] < loud * 0.1) quiet++;
  const pauses = quiet / frames;

  // Low-energy frames, per second, in seconds that aren't silent.
  let lowSum = 0;
  let windows = 0;
  const W = Math.round(FRAMES_PER_SECOND);
  for (let s = 0; s + W <= frames; s += W) {
    let mean = 0;
    for (let f = s; f < s + W; f++) mean += level[f];
    mean /= W;
    if (mean < loud * 0.05) continue;
    let low = 0;
    for (let f = s; f < s + W; f++) if (level[f] < mean * 0.5) low++;
    lowSum += low / W;
    windows++;
  }
  const lowEnergy = windows ? lowSum / windows : 0;

  // Syllable-rate modulation of the loudness envelope.
  let band = 0;
  let total = 0;
  const env = new Float32Array(MOD_WINDOW);
  const k0 = Math.round((0.5 * MOD_WINDOW) / FRAMES_PER_SECOND);
  const k1 = Math.round((15 * MOD_WINDOW) / FRAMES_PER_SECOND);
  const b0 = Math.round((3 * MOD_WINDOW) / FRAMES_PER_SECOND);
  const b1 = Math.round((7 * MOD_WINDOW) / FRAMES_PER_SECOND);
  for (let s = 0; s + MOD_WINDOW <= frames; s += MOD_WINDOW / 2) {
    let mean = 0;
    for (let i = 0; i < MOD_WINDOW; i++) mean += env[i] = Math.sqrt(level[s + i]);
    mean /= MOD_WINDOW;
    for (let i = 0; i < MOD_WINDOW; i++) env[i] = (env[i] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / MOD_WINDOW));
    for (let k = k0; k <= k1; k++) {
      let r = 0;
      let m = 0;
      for (let i = 0; i < MOD_WINDOW; i++) {
        const a = (2 * Math.PI * k * i) / MOD_WINDOW;
        r += env[i] * Math.cos(a);
        m += env[i] * Math.sin(a);
      }
      const p = r * r + m * m;
      total += p;
      if (k >= b0 && k <= b1) band += p;
    }
  }
  const syllabic = total > 0 ? band / total : 0;

  // Held notes: peaks that stay on the same bin (±1) for PERSIST frames.
  const marks = spectra.map(peaks);
  let held = 0;
  let counted = 0;
  for (let f = 0; f + PERSIST < frames; f++) {
    if (level[f] < loud * 0.1) continue;
    const m = marks[f];
    for (let b = LO_BIN; b < HI_BIN; b++) {
      if (!m[b]) continue;
      counted++;
      let stays = true;
      for (let g = f + 1; g <= f + PERSIST && stays; g++) stays = !!(marks[g][b - 1] | marks[g][b] | marks[g][b + 1]);
      if (stays) held++;
    }
  }
  const sustain = counted ? held / counted : 0;

  return { pauses, lowEnergy, syllabic, sustain };
}

/** 0..1 speech likelihood from the features (logistic). Tuned on voice
 * notes, narration and screen recordings against songs, instrumentals and
 * beats; 0.5 is the boundary. */
export function speechScore(f: SpeechFeatures): number {
  const z = -2.2 + 8 * f.pauses + 6 * f.lowEnergy + f.syllabic - 6 * f.sustain;
  return 1 / (1 + Math.exp(-z));
}

/** Up to MAX_EXCERPTS evenly spread EXCERPT-long pieces of
 * samples[from, to), joined - enough to judge a long track quickly. */
export function excerpts(samples: Float32Array, from = 0, to = samples.length): Float32Array {
  from = Math.max(0, Math.floor(from));
  to = Math.min(samples.length, Math.floor(to));
  const length = to - from;
  if (length <= MAX_EXCERPTS * EXCERPT) return samples.subarray(from, to);
  const out = new Float32Array(MAX_EXCERPTS * EXCERPT);
  const gap = (length - EXCERPT) / (MAX_EXCERPTS - 1);
  for (let i = 0; i < MAX_EXCERPTS; i++) {
    const at = from + Math.floor(i * gap);
    out.set(samples.subarray(at, at + EXCERPT), i * EXCERPT);
  }
  return out;
}

/** Whether 16 kHz mono `samples` (or their [from, to) part) are speech. */
export function detectSpeech(samples: Float32Array, from?: number, to?: number): SpeechVerdict {
  const features = speechFeatures(excerpts(samples, from, to));
  if (!features) return { speech: false, score: 0, silent: true, features: null };
  const score = speechScore(features);
  return { speech: score >= 0.5, score, silent: false, features };
}

// --- With the speech model ---------------------------------------------------

const PROBE = 30 * DETECT_RATE; // one Whisper window
const MAX_PROBES = 3;
const PROBE_MIN_RMS = 0.004; // quieter windows say nothing about speech

/** Up to MAX_PROBES audible 30 s windows of samples[from, to), spread
 * over it, for the speech model to judge (speechVerdict). */
export function probeWindows(samples: Float32Array, from = 0, to = samples.length): Float32Array[] {
  from = Math.max(0, Math.floor(from));
  to = Math.min(samples.length, Math.floor(to));
  const count = Math.max(1, Math.min(MAX_PROBES, Math.ceil((to - from) / PROBE)));
  const gap = count > 1 ? (to - from - PROBE) / (count - 1) : 0;
  const out: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const at = from + Math.max(0, Math.floor(i * gap));
    const w = samples.subarray(at, Math.min(to, at + PROBE));
    let sum = 0;
    for (let k = 0; k < w.length; k++) sum += w[k] * w[k];
    if (w.length >= DETECT_RATE && Math.sqrt(sum / w.length) >= PROBE_MIN_RMS) out.push(w);
  }
  return out;
}

/** The final call from the signal verdict and, when the speech model was
 * asked, its no-speech probability for each probe window (0..1).
 *
 * The two fail differently, so either can carry the call: the model hears
 * a voice under a music bed that hides the signal's pauses, and the signal
 * catches a voice the model doubts (an unfamiliar language or accent, a
 * phone mic), while the model also confirms a quiet, sparse piece is not
 * speech. Measured: no music window scored under 0.4 no-speech, while clean
 * narration scores under 0.1. */
export function speechVerdict(signal: SpeechVerdict, noSpeech: number[] | null): boolean {
  if (!noSpeech?.length) return signal.speech;
  const heard = 1 - noSpeech.reduce((a, b) => a + b, 0) / noSpeech.length;
  if (Math.min(...noSpeech) < 0.3) return true;
  if (signal.silent) return heard >= 0.5;
  if (signal.score >= 0.75) return true;
  return (signal.score + heard) / 2 >= 0.5;
}
