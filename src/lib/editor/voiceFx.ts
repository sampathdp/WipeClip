import type { VoiceFx } from "./types";

/** Voice effects on audio tracks. The preview runs them in Web Audio; the
 * export runs the ffmpeg chains in editor.py VOICE_FX. Filters, echo, ring
 * modulation and soft clipping use the same numbers on both sides; the
 * pitch shift is the same ratio by different means (here a two-tap delay
 * line, there asetrate + atempo), so it can sound slightly different. */

export const VOICE_FX_LABELS: Record<VoiceFx, string> = {
  none: "None",
  chipmunk: "Chipmunk",
  deep: "Deep",
  robot: "Robot",
  echo: "Echo",
  telephone: "Telephone",
  radio: "Radio",
};

export const PITCH_RATIO: Partial<Record<VoiceFx, number>> = { chipmunk: 1.5, deep: 0.75 };
const ROBOT_HZ = 50;
const ECHO_DELAY = 0.25;
const ECHO_DECAY = 0.45;
const ECHO_OUT = 0.7;

const WORKLET = `
class PitchShift extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: "ratio", defaultValue: 1 }]; }
  constructor() {
    super();
    this.size = Math.round(sampleRate * 0.06);
    this.buf = [new Float32Array(this.size * 2), new Float32Array(this.size * 2)];
    this.w = 0;
    this.phase = 0;
  }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    const ratio = params.ratio[0];
    const n = this.size, len = n * 2;
    for (let i = 0; i < output[0].length; i++) {
      // Two read heads half a window apart sweep the delay line at
      // (1 - ratio); each fades in and out (triangle), hiding the jumps.
      this.phase = (this.phase + (1 - ratio) / n + 1) % 1;
      for (let c = 0; c < output.length; c++) {
        const src = input[c] || input[0];
        const b = this.buf[Math.min(c, 1)];
        b[this.w] = src ? src[i] : 0;
        let y = 0;
        for (const off of [0, 0.5]) {
          const p = (this.phase + off) % 1;
          const d = p * n;
          let r = this.w - d;
          if (r < 0) r += len;
          const r0 = Math.floor(r), f = r - r0;
          const s = b[r0 % len] * (1 - f) + b[(r0 + 1) % len] * f;
          y += s * (1 - Math.abs(2 * p - 1));
        }
        output[c][i] = y;
      }
      this.w = (this.w + 1) % len;
    }
    return true;
  }
}
registerProcessor("pitch-shift", PitchShift);
`;

const workletReady = new WeakMap<BaseAudioContext, Promise<void>>();

function loadWorklet(ctx: AudioContext): Promise<void> {
  let p = workletReady.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url);
    workletReady.set(ctx, p);
  }
  return p;
}

/** Routes preview audio elements through Web Audio once one needs a voice
 * effect (an element can't be un-routed after that, so it stays routed and
 * its volume moves to a gain node - which also allows >100%). */
export class AudioFxRouter {
  private ctx: AudioContext | null = null;
  private routes = new Map<HTMLMediaElement, { src: MediaElementAudioSourceNode; gain: GainNode; fx: VoiceFx; pending: boolean; dispose: () => void }>();

  /** The gain node that now sets `el`'s volume, or null if it plays directly. */
  apply(el: HTMLMediaElement, fx: VoiceFx): GainNode | null {
    let r = this.routes.get(el);
    if (!r) {
      if (fx === "none") return null;
      const ctx = (this.ctx ??= new AudioContext());
      const src = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      r = { src, gain, fx: "none", pending: false, dispose: () => {} };
      src.connect(gain);
      r.dispose = () => src.disconnect();
      this.routes.set(el, r);
    }
    const ctx = this.ctx!;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    if (r.fx !== fx && !r.pending) {
      const route = r;
      route.pending = true;
      route.dispose();
      connectVoiceFx(ctx, fx, route.src, route.gain)
        .then((dispose) => {
          route.dispose = dispose;
          route.fx = fx;
        })
        .catch(() => {
          route.src.connect(route.gain);
          route.dispose = () => route.src.disconnect();
          route.fx = fx;
        })
        .finally(() => {
          route.pending = false;
        });
    }
    return r.gain;
  }

  close(): void {
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.routes.clear();
  }
}

/** Builds the effect between `input` and `output`; returns a disposer. */
export async function connectVoiceFx(ctx: AudioContext, fx: VoiceFx, input: AudioNode, output: AudioNode): Promise<() => void> {
  const nodes: AudioNode[] = [];
  const chain = (...list: AudioNode[]) => {
    nodes.push(...list);
    list.reduce((a, b) => (a.connect(b), b), input);
    list[list.length - 1].connect(output);
  };
  const biquad = (type: BiquadFilterType, f: number) => {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = Math.SQRT1_2;
    return b;
  };
  const gain = (v: number) => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };
  const ratio = PITCH_RATIO[fx];
  if (ratio) {
    await loadWorklet(ctx);
    const node = new AudioWorkletNode(ctx, "pitch-shift", { outputChannelCount: [2] });
    node.parameters.get("ratio")!.value = ratio;
    chain(node);
  } else if (fx === "robot") {
    const ring = gain(0);
    const osc = ctx.createOscillator();
    osc.frequency.value = ROBOT_HZ;
    osc.connect(ring.gain);
    osc.start();
    nodes.push(osc);
    chain(ring);
  } else if (fx === "echo") {
    const dry = gain(ECHO_OUT);
    const delay = ctx.createDelay(1);
    delay.delayTime.value = ECHO_DELAY;
    const wet = gain(ECHO_OUT * ECHO_DECAY);
    input.connect(dry).connect(output);
    input.connect(delay).connect(wet).connect(output);
    nodes.push(dry, delay, wet);
  } else if (fx === "telephone") {
    chain(biquad("highpass", 300), biquad("lowpass", 3400));
  } else if (fx === "radio") {
    const shaper = ctx.createWaveShaper();
    shaper.curve = Float32Array.from({ length: 1024 }, (_, i) => Math.tanh(((i / 1023) * 2 - 1) * 4) / Math.tanh(4)) as Float32Array<ArrayBuffer>;
    chain(biquad("highpass", 500), biquad("lowpass", 2800), gain(1), shaper, gain(0.5));
  } else {
    input.connect(output);
  }
  return () => {
    try {
      input.disconnect();
    } catch {
      // already disconnected
    }
    for (const n of nodes) {
      try {
        if (n instanceof OscillatorNode) n.stop();
        n.disconnect();
      } catch {
        // already disconnected
      }
    }
  };
}
