import { encodeWav } from "./voiceover";

/** Built-in sound effects, synthesized on the device with Web Audio (no
 * sample library to license): each is rendered offline to a short WAV and
 * then added like any uploaded audio. */

export interface SfxDef {
  id: string;
  label: string;
  icon: string;
  seconds: number;
  build: (ctx: OfflineAudioContext, out: AudioNode) => void;
}

function noise(ctx: BaseAudioContext, seconds: number): AudioBufferSourceNode {
  const buf = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    d[i] = seed / 2 ** 31 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

function env(ctx: BaseAudioContext, points: [number, number][]): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(points[0][1], points[0][0]);
  for (const [t, v] of points.slice(1)) g.gain.linearRampToValueAtTime(v, t);
  return g;
}

function tone(ctx: BaseAudioContext, out: AudioNode, type: OscillatorType, freq: number | [number, number][], at: number, len: number, peak: number, decay = len) {
  const o = ctx.createOscillator();
  o.type = type;
  if (typeof freq === "number") o.frequency.value = freq;
  else {
    o.frequency.setValueAtTime(freq[0][1], at + freq[0][0]);
    for (const [t, f] of freq.slice(1)) o.frequency.exponentialRampToValueAtTime(f, at + t);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + len);
}

export const SFX: SfxDef[] = [
  {
    id: "whoosh",
    label: "Whoosh",
    icon: "💨",
    seconds: 0.8,
    build: (ctx, out) => {
      const n = noise(ctx, 0.8);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(300, 0);
      bp.frequency.exponentialRampToValueAtTime(3000, 0.45);
      bp.frequency.exponentialRampToValueAtTime(800, 0.8);
      n.connect(bp).connect(env(ctx, [[0, 0], [0.4, 0.9], [0.8, 0]])).connect(out);
      n.start();
    },
  },
  {
    id: "riser",
    label: "Riser",
    icon: "📈",
    seconds: 2,
    build: (ctx, out) => {
      tone(ctx, out, "sawtooth", [[0, 120], [1.9, 900]], 0, 2, 0.25, 2);
      const n = noise(ctx, 2);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.setValueAtTime(500, 0);
      hp.frequency.exponentialRampToValueAtTime(6000, 1.9);
      n.connect(hp).connect(env(ctx, [[0, 0], [1.9, 0.4], [2, 0]])).connect(out);
      n.start();
    },
  },
  { id: "pop", label: "Pop", icon: "🫧", seconds: 0.25, build: (ctx, out) => tone(ctx, out, "sine", [[0, 900], [0.08, 250]], 0, 0.25, 0.9, 0.12) },
  {
    id: "ding",
    label: "Ding",
    icon: "🔔",
    seconds: 1.5,
    build: (ctx, out) => {
      for (const [f, a] of [[1320, 0.5], [2640, 0.2], [3960, 0.1]] as const) tone(ctx, out, "sine", f, 0, 1.5, a, 1.4);
    },
  },
  {
    id: "success",
    label: "Success",
    icon: "✅",
    seconds: 0.9,
    build: (ctx, out) => {
      [523, 659, 784].forEach((f, i) => tone(ctx, out, "triangle", f, i * 0.1, 0.6, 0.5, 0.5));
    },
  },
  {
    id: "error",
    label: "Error",
    icon: "⛔",
    seconds: 0.6,
    build: (ctx, out) => {
      tone(ctx, out, "square", 180, 0, 0.22, 0.25, 0.22);
      tone(ctx, out, "square", 140, 0.25, 0.3, 0.25, 0.3);
    },
  },
  { id: "click", label: "Click", icon: "🖱️", seconds: 0.08, build: (ctx, out) => tone(ctx, out, "square", [[0, 2500], [0.02, 600]], 0, 0.06, 0.5, 0.03) },
  {
    id: "boom",
    label: "Boom",
    icon: "💥",
    seconds: 1.6,
    build: (ctx, out) => {
      tone(ctx, out, "sine", [[0, 110], [1.2, 30]], 0, 1.6, 1, 1.5);
      const n = noise(ctx, 0.6);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      n.connect(lp).connect(env(ctx, [[0, 0.8], [0.6, 0]])).connect(out);
      n.start();
    },
  },
  {
    id: "shutter",
    label: "Camera",
    icon: "📸",
    seconds: 0.3,
    build: (ctx, out) => {
      for (const at of [0, 0.09]) {
        const n = noise(ctx, 0.08);
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 2000;
        n.connect(hp).connect(env(ctx, [[at, 0], [at + 0.003, 0.9], [at + 0.07, 0]])).connect(out);
        n.start(at);
      }
    },
  },
  {
    id: "notify",
    label: "Notification",
    icon: "💬",
    seconds: 0.7,
    build: (ctx, out) => {
      tone(ctx, out, "sine", 880, 0, 0.3, 0.5, 0.25);
      tone(ctx, out, "sine", 1175, 0.15, 0.5, 0.5, 0.45);
    },
  },
  {
    id: "typing",
    label: "Typing",
    icon: "⌨️",
    seconds: 1.6,
    build: (ctx, out) => {
      let seed = 7;
      for (let t = 0; t < 1.5; ) {
        tone(ctx, out, "square", 1800 + (seed % 7) * 150, t, 0.03, 0.25, 0.02);
        seed = (seed * 31 + 11) % 97;
        t += 0.07 + (seed % 5) * 0.025;
      }
    },
  },
  { id: "swipe", label: "Swipe", icon: "👆", seconds: 0.35, build: (ctx, out) => tone(ctx, out, "triangle", [[0, 400], [0.3, 1600]], 0, 0.35, 0.35, 0.33) },
];

/** A sound effect as a WAV file. */
export async function renderSfx(def: SfxDef): Promise<File> {
  const rate = 48000;
  const ctx = new OfflineAudioContext(1, Math.ceil(def.seconds * rate), rate);
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  def.build(ctx, master);
  const buffer = await ctx.startRendering();
  return new File([encodeWav(buffer)], `${def.label}.wav`, { type: "audio/wav" });
}
