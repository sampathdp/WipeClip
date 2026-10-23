/** Beat detection for music tracks, on the device. Pure - see
 * tests/desktop/beats.test.ts.
 *
 * The classic pipeline (Ellis, "Beat Tracking by Dynamic Programming"):
 * 1. Onset strength: how much the log spectrum rises from one frame to the
 *    next (spectral flux), smoothed - peaks where notes and drums hit.
 * 2. Tempo: the lag at which that envelope best repeats (autocorrelation),
 *    weighted towards ~120 BPM so half/double tempos lose.
 * 3. Beats: the sequence of onset peaks, about one period apart, that
 *    scores highest - a dynamic program over the whole track.
 */

export const BEAT_RATE = 16000;
const N = 1024;
const HOP = 256;
const FPS = BEAT_RATE / HOP; // 62.5 onset frames per second

export interface BeatResult {
  bpm: number;
  /** Seconds from the start of the samples. */
  times: number[];
}

function fftMagnitudes(frame: Float32Array, re: Float32Array, im: Float32Array, out: Float32Array): void {
  re.set(frame);
  im.fill(0);
  // Iterative radix-2 FFT.
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < N; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  for (let k = 0; k < N / 2; k++) out[k] = Math.hypot(re[k], im[k]);
}

/** Onset strength per HOP frame. */
export function onsetEnvelope(samples: Float32Array): Float32Array {
  const frames = Math.max(0, Math.floor((samples.length - N) / HOP) + 1);
  const env = new Float32Array(frames);
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const frame = new Float32Array(N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  let prev = new Float32Array(N / 2);
  let cur = new Float32Array(N / 2);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) frame[i] = samples[f * HOP + i] * win[i];
    fftMagnitudes(frame, re, im, cur);
    let flux = 0;
    for (let k = 1; k < N / 2; k++) {
      const v = Math.log1p(1000 * cur[k]);
      const d = v - prev[k];
      if (d > 0 && f > 0) flux += d;
      cur[k] = v;
    }
    env[f] = flux;
    [prev, cur] = [cur, prev];
  }
  // Remove the slow trend (local mean) and normalize.
  const out = new Float32Array(frames);
  const w = Math.round(FPS); // 1 s
  let sum = 0;
  for (let f = 0; f < frames; f++) {
    sum += env[f];
    if (f >= w) sum -= env[f - w];
    out[f] = Math.max(0, env[f] - sum / Math.min(f + 1, w));
  }
  let sd = 0;
  for (const v of out) sd += v * v;
  sd = Math.sqrt(sd / Math.max(1, frames)) || 1;
  for (let f = 0; f < frames; f++) out[f] /= sd;
  return out;
}

/** Beat period in onset frames, from 60 to 180 BPM. */
export function estimatePeriod(env: Float32Array): number {
  const minLag = Math.round((FPS * 60) / 180);
  const maxLag = Math.round((FPS * 60) / 60);
  let best = Math.round((FPS * 60) / 120);
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let ac = 0;
    for (let f = lag; f < env.length; f++) ac += env[f] * env[f - lag];
    ac /= Math.max(1, env.length - lag);
    // Log-Gaussian prior centered on 120 BPM, one octave wide.
    const bpm = (FPS * 60) / lag;
    const prior = Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);
    if (ac * prior > bestScore) {
      bestScore = ac * prior;
      best = lag;
    }
  }
  return best;
}

/** Beats of mono `samples` at BEAT_RATE. */
export function detectBeats(samples: Float32Array): BeatResult {
  const env = onsetEnvelope(samples);
  // Too short, or nothing that rises (silence, a steady tone).
  if (env.length < FPS * 2 || !env.some((v) => v > 0.5)) return { bpm: 0, times: [] };
  const period = estimatePeriod(env);
  // Dynamic program: each beat's score is its onset plus the best previous
  // beat's score, penalized by how far the gap is from one period.
  const alpha = 100;
  const score = new Float32Array(env.length);
  const back = new Int32Array(env.length).fill(-1);
  for (let t = 0; t < env.length; t++) {
    let best = 0;
    let arg = -1;
    for (let p = t - Math.round(2 * period); p <= t - Math.round(period / 2); p++) {
      if (p < 0) continue;
      const s = score[p] - alpha * Math.log((t - p) / period) ** 2;
      if (arg < 0 || s > best) {
        best = s;
        arg = p;
      }
    }
    score[t] = env[t] + (arg >= 0 ? Math.max(0, best) : 0);
    back[t] = arg >= 0 && best > 0 ? arg : -1;
  }
  // Best end within the last period, then follow the chain back.
  let t = env.length - 1;
  for (let i = Math.max(0, env.length - period); i < env.length; i++) if (score[i] > score[t]) t = i;
  const frames: number[] = [];
  while (t >= 0) {
    frames.push(t);
    t = back[t];
  }
  frames.reverse();
  // Onset frame f covers samples from f*HOP; its center is half a window in.
  const times = frames.map((f) => Math.round(((f * HOP + N / 2) / BEAT_RATE) * 1000) / 1000);
  return { bpm: Math.round(((FPS * 60) / period) * 10) / 10, times };
}
