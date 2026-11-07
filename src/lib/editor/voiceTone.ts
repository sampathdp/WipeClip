/** Voice tone on audio tracks: a low cut, a three-band EQ, a de-esser and
 * a compressor, with presets ("Enhance voice" and friends).
 *
 * One description, three players:
 *  - the preview (Web Audio): BiquadFilterNodes for the EQ, and an
 *    AudioWorklet running DYNAMICS_SOURCE for the de-esser and compressor;
 *  - the loudness measurement (programMix.ts): the same graph, offline;
 *  - the export (editor.py tone_chain): ffmpeg's highpass, lowshelf,
 *    equalizer, highshelf, deesser and acompressor.
 * `toneWire` turns the user's settings into the exact numbers all three
 * use. The EQ filters are the standard biquads (the Web Audio spec and
 * ffmpeg both use the Audio EQ Cookbook); DYNAMICS_SOURCE is a line-by-line
 * port of ffmpeg 7.1's af_deesser.c and af_sidechaincompress.c, so the
 * dynamics match too. tests/desktop/voiceTone.test.ts runs real ffmpeg
 * against this code; tests/fixtures/tone-chains.json pins the ffmpeg
 * chains editor.py builds from the wire numbers. */
import type { VoiceTone, TonePreset } from "./types.ts";

/** Filter frequencies. Must match TONE_* in backend/app/pipeline/editor.py. */
export const TONE_LOW_CUT_HZ = 80;
export const TONE_BASS_HZ = 120;
export const TONE_MID_HZ = 400;
export const TONE_MID_Q = 1;
export const TONE_TREBLE_HZ = 4000;
/** EQ band range, dB. */
export const TONE_MAX_DB = 12;

export const NEUTRAL_TONE: VoiceTone = { lowCut: false, bass: 0, mid: 0, treble: 0, compress: 0, deEss: 0 };

export const TONE_PRESETS: Record<TonePreset, { label: string; hint: string; tone: Omit<VoiceTone, "preset"> }> = {
  clear: {
    label: "Enhance voice",
    hint: "Clearer, fuller and more even speech: rumble cut, less boxiness, more clarity, softer S sounds, steadier level.",
    tone: { lowCut: true, bass: -1, mid: -2, treble: 3, compress: 0.5, deEss: 0.4 },
  },
  podcast: {
    label: "Podcast",
    hint: "Close and even, like radio: stronger leveling and de-essing.",
    tone: { lowCut: true, bass: 1, mid: -2, treble: 2, compress: 0.75, deEss: 0.5 },
  },
  warm: {
    label: "Warm",
    hint: "Rounder and softer, for voices that sound sharp or harsh.",
    tone: { lowCut: true, bass: 3, mid: 0, treble: -2, compress: 0.4, deEss: 0.3 },
  },
  thin: {
    label: "Fix thin mic",
    hint: "For laptop and headset microphones that sound small: adds body, tames the hiss.",
    tone: { lowCut: false, bass: 5, mid: -1, treble: -2, compress: 0.4, deEss: 0.2 },
  },
  boom: {
    label: "Reduce boom",
    hint: "For boomy rooms or a microphone held too close: less low end and mud.",
    tone: { lowCut: true, bass: -5, mid: -3, treble: 1, compress: 0.3, deEss: 0 },
  },
};

export const TONE_PRESET_ORDER: TonePreset[] = ["clear", "podcast", "warm", "thin", "boom"];

export function presetTone(p: TonePreset): VoiceTone {
  return { ...TONE_PRESETS[p].tone, preset: p };
}

/** Whether the tone changes the sound at all. */
export function toneActive(t: VoiceTone | undefined): t is VoiceTone {
  return !!t && (t.lowCut || t.bass !== 0 || t.mid !== 0 || t.treble !== 0 || t.compress > 0 || t.deEss > 0);
}

/** A manual change clears the preset name (it's no longer that preset). */
export function editTone(t: VoiceTone | undefined, patch: Partial<Omit<VoiceTone, "preset">>): VoiceTone {
  const { preset: _drop, ...rest } = { ...NEUTRAL_TONE, ...t };
  void _drop;
  return { ...rest, ...patch };
}

/** Compressor settings for an amount 0..1 (0: off). */
export interface CompressorWire {
  /** dBFS (RMS detection). */
  threshold: number;
  ratio: number;
  /** ms */
  attack: number;
  release: number;
  /** dB, applied after compression. */
  makeup: number;
}

/** The exact numbers the preview and the export use. */
export interface ToneWire {
  lowCut: boolean;
  bass: number;
  mid: number;
  treble: number;
  /** ffmpeg deesser intensity 0..1 (0: off). */
  deEss: number;
  comp: CompressorWire | null;
}

const round = (v: number, step = 1000) => Math.round(v * step) / step;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));

export function compressorFor(amount: number): CompressorWire | null {
  const c = clamp(amount, 0, 1);
  if (c <= 0) return null;
  const threshold = -12 - 18 * c; // -12 .. -30 dBFS
  const ratio = 1.5 + 2.5 * c; // 1.5 .. 4
  // Make up half of what a signal at -6 dBFS RMS loses, so leveling
  // doesn't just make the track quieter (loudness normalization does the rest).
  const makeup = Math.min(12, 0.5 * (-6 - threshold) * (1 - 1 / ratio));
  return { threshold: round(threshold, 100), ratio: round(ratio, 100), attack: 10, release: 150, makeup: round(makeup, 100) };
}

export function toneWire(t: VoiceTone | undefined): ToneWire | null {
  if (!toneActive(t)) return null;
  const db = (v: number) => round(clamp(v, -TONE_MAX_DB, TONE_MAX_DB), 10);
  return {
    lowCut: !!t.lowCut,
    bass: db(t.bass),
    mid: db(t.mid),
    treble: db(t.treble),
    deEss: round(clamp(t.deEss, 0, 1), 100),
    comp: compressorFor(t.compress),
  };
}

export function toneKey(w: ToneWire | null): string {
  return w ? JSON.stringify(w) : "";
}

/** The de-esser and compressor, as plain JavaScript run inside the
 * AudioWorklet (and by the tests). Ported from ffmpeg 7.1
 * (libavfilter/af_deesser.c, af_sidechaincompress.c, hermite.h; LGPL-2.1+),
 * keeping its math and order. Per sample frame: de-ess each channel, then
 * compress all channels with one gain (link=average, detection=rms,
 * mode=downward, mix=1, level_in=1). */
export const DYNAMICS_SOURCE = String.raw`
class DeEsserChannel {
  constructor() { this.s1 = 0; this.s2 = 0; this.s3 = 0; this.m1 = 0; this.m2 = 0; this.ratioA = 1; this.ratioB = 1; this.iirA = 0; this.iirB = 0; this.flip = false; }
}
class DeEsser {
  constructor(intensity, rate, channels) {
    const overall = rate < 44100 ? 44100 / rate : rate / 44100;
    this.intensity = Math.pow(intensity, 5) * (8192 / overall);
    this.maxdess = 1 / Math.pow(10, ((0.5 - 1) * 48) / 20);
    this.iirAmount = Math.pow(0.5, 2) / overall;
    this.ch = [];
    for (let c = 0; c < channels; c++) this.ch.push(new DeEsserChannel());
  }
  sample(c, x) {
    const d = this.ch[c];
    d.s3 = d.s2; d.s2 = d.s1; d.s1 = x;
    d.m1 = (d.s1 - d.s2) * ((d.s1 - d.s2) / 1.3);
    d.m2 = (d.s2 - d.s3) * ((d.s1 - d.s2) / 1.3);
    let sense = (d.m1 - d.m2) * ((d.m1 - d.m2) / 1.3);
    const attack = 7 + sense * 1024;
    sense = 1 + this.intensity * this.intensity * sense;
    sense = Math.min(sense, this.intensity);
    const recovery = 1 + 0.01 / sense;
    const offset = 1 - Math.abs(x);
    const k = offset * this.iirAmount;
    if (d.flip) {
      d.iirA = d.iirA * (1 - k) + x * k;
      d.ratioA = d.ratioA < sense ? (d.ratioA * attack + sense) / (attack + 1) : 1 + (d.ratioA - 1) / recovery;
      d.ratioA = Math.min(d.ratioA, this.maxdess);
      x = d.iirA + (x - d.iirA) / d.ratioA;
    } else {
      d.iirB = d.iirB * (1 - k) + x * k;
      d.ratioB = d.ratioB < sense ? (d.ratioB * attack + sense) / (attack + 1) : 1 + (d.ratioB - 1) / recovery;
      d.ratioB = Math.min(d.ratioB, this.maxdess);
      x = d.iirB + (x - d.iirB) / d.ratioB;
    }
    d.flip = !d.flip;
    return x;
  }
}
function hermite(x, x0, x1, p0, p1, m0, m1) {
  const w = x1 - x0, t = (x - x0) / w;
  m0 *= w; m1 *= w;
  const t2 = t * t, t3 = t2 * t;
  const c2 = -3 * p0 - 2 * m0 + 3 * p1 - m1, c3 = 2 * p0 + m0 - 2 * p1 + m1;
  return c3 * t3 + c2 * t2 + m0 * t + p0;
}
class Compressor {
  constructor(o, rate) {
    const threshold = Math.pow(10, o.threshold / 20), knee = 2.82843;
    this.ratio = o.ratio; this.knee = knee;
    this.makeup = Math.pow(10, o.makeup / 20);
    this.thres = Math.log(threshold);
    const linStart = threshold / Math.sqrt(knee), linStop = threshold * Math.sqrt(knee);
    this.adjKneeStart = linStart * linStart;
    this.kneeStart = Math.log(linStart);
    this.kneeStop = Math.log(linStop);
    this.compKneeStop = (this.kneeStop - this.thres) / o.ratio + this.thres;
    this.attack = Math.min(1, 1 / ((o.attack * rate) / 4000));
    this.release = Math.min(1, 1 / ((o.release * rate) / 4000));
    this.slope = 0;
  }
  /** Gain for one frame from its channels' absolute average. */
  gain(absAvg) {
    const a = absAvg * absAvg;
    this.slope += (a - this.slope) * (a > this.slope ? this.attack : this.release);
    if (!(this.slope > 0 && this.slope > this.adjKneeStart)) return this.makeup;
    const slope = Math.log(this.slope) * 0.5;
    let g = (slope - this.thres) / this.ratio + this.thres;
    if (this.knee > 1 && slope < this.kneeStop) g = hermite(slope, this.kneeStart, this.kneeStop, this.kneeStart, this.compKneeStop, 1, 1 / this.ratio);
    return Math.exp(g - slope) * this.makeup;
  }
}
/** Runs de-esser then compressor over planar channels in place. */
class Dynamics {
  constructor(o, rate, channels) {
    this.de = o.deEss > 0 ? new DeEsser(o.deEss, rate, channels) : null;
    this.comp = o.comp ? new Compressor(o.comp, rate) : null;
  }
  process(chs, n) {
    const nc = chs.length;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let c = 0; c < nc; c++) {
        let x = chs[c][i];
        if (this.de) x = this.de.sample(c, x);
        chs[c][i] = x;
        sum += Math.abs(x);
      }
      if (this.comp) {
        const g = this.comp.gain(sum / nc);
        for (let c = 0; c < nc; c++) chs[c][i] *= g;
      }
    }
  }
}
`;

const WORKLET = `${DYNAMICS_SOURCE}
class VoiceDynamics extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.opts = options.processorOptions;
    this.dyn = null;
    this.channels = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    const n = output[0].length;
    // A mono source fills both outputs, as the export's upmix does.
    const nc = input.length >= 2 ? 2 : 1;
    if (!this.dyn || this.channels !== nc) { this.dyn = new Dynamics(this.opts, sampleRate, nc); this.channels = nc; }
    const chs = [];
    for (let c = 0; c < nc; c++) { const buf = output[c] || new Float32Array(n); if (input[c]) buf.set(input[c]); else buf.fill(0); chs.push(buf); }
    this.dyn.process(chs, n);
    for (let c = nc; c < output.length; c++) output[c].set(chs[0]);
    return true;
  }
}
registerProcessor("voice-dynamics", VoiceDynamics);
`;

const workletReady = new WeakMap<BaseAudioContext, Promise<void>>();

function loadWorklet(ctx: BaseAudioContext): Promise<void> {
  let p = workletReady.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url);
    workletReady.set(ctx, p);
  }
  return p;
}

/** Web Audio's highpass Q is in dB; Butterworth (ffmpeg's default 0.707). */
export const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);

/** Builds the tone after `input`; returns its output node and a disposer.
 * Without a tone the output is the input itself. If the worklet can't
 * load, the EQ still plays and the dynamics are left out (`dynamics`). */
export async function connectTone(
  ctx: BaseAudioContext,
  wire: ToneWire | null,
  input: AudioNode,
  channels = 2
): Promise<{ output: AudioNode; dispose: () => void; dynamics: boolean }> {
  if (!wire) return { output: input, dispose: () => {}, dynamics: true };
  const nodes: AudioNode[] = [];
  const biquad = (type: BiquadFilterType, f: number, gain = 0, q?: number) => {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.gain.value = gain;
    if (q !== undefined) b.Q.value = q;
    nodes.push(b);
  };
  if (wire.lowCut) biquad("highpass", TONE_LOW_CUT_HZ, 0, BUTTERWORTH_Q_DB);
  if (wire.bass) biquad("lowshelf", TONE_BASS_HZ, wire.bass);
  if (wire.mid) biquad("peaking", TONE_MID_HZ, wire.mid, TONE_MID_Q);
  if (wire.treble) biquad("highshelf", TONE_TREBLE_HZ, wire.treble);
  let dynamics = true;
  if (wire.deEss > 0 || wire.comp) {
    try {
      await loadWorklet(ctx);
      nodes.push(new AudioWorkletNode(ctx, "voice-dynamics", { outputChannelCount: [channels], processorOptions: { deEss: wire.deEss, comp: wire.comp } }));
    } catch {
      dynamics = false;
    }
  }
  if (nodes.length === 0) return { output: input, dispose: () => {}, dynamics };
  nodes.reduce<AudioNode>((a, b) => (a.connect(b), b), input);
  return {
    output: nodes[nodes.length - 1],
    dynamics,
    dispose: () => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          // already disconnected
        }
      }
    },
  };
}
