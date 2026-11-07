import { connectVoiceFx } from "./voiceFx";
import { LIMIT_CEILING } from "./loudness";
import { meterLevel, type MeterLevel } from "./mix";
import type { VoiceFx, VoiceTone } from "./types";
import { connectTone, toneKey, toneWire } from "./voiceTone";

/** Wire numbers and key per tone object (tones are immutable project data,
 * and route() runs every frame). */
const toneCache = new WeakMap<VoiceTone, { key: string; wire: ReturnType<typeof toneWire> }>();
function toneOf(t: VoiceTone | undefined) {
  if (!t) return { key: "", wire: null };
  let v = toneCache.get(t);
  if (!v) {
    const wire = toneWire(t);
    v = { key: toneKey(wire), wire };
    toneCache.set(t, v);
  }
  return v;
}

/** The preview's mixer: once something needs it (a voice effect, a level
 * above 100%, loudness normalization, the meters), media elements play
 * through Web Audio instead of straight out:
 *
 *   element -> tone (voiceTone.ts) -> voice effect -> its level (gain)
 *           -> track bus (meter)
 *           -> master gain (loudness) -> peak limiter -> master meter -> out
 *
 * which is the export's order (editor.py: per-track volume and effect, the
 * mix, master_chain). The limiter holds the same ceiling as the export's
 * alimiter, without its look-ahead (a 5 ms preview delay isn't worth it),
 * so a sharp peak can sound slightly different. An element can't be
 * un-routed, so once routed it stays routed.
 *
 * Disk sources (desktop) are served from another origin; Web Audio only
 * hears them with CORS, so an element is switched to crossOrigin
 * "anonymous" (the app's asset protocol answers CORS) when it's routed.
 */

const LIMITER = `
class PeakLimiter extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: "ceiling", defaultValue: ${LIMIT_CEILING} }]; }
  constructor() {
    super();
    this.env = 0;
    this.release = Math.exp(-1 / (sampleRate * 0.08));
  }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    const ceiling = params.ceiling[0];
    for (let i = 0; i < output[0].length; i++) {
      let m = 0;
      for (let c = 0; c < output.length; c++) {
        const v = input[c] ? Math.abs(input[c][i]) : 0;
        if (v > m) m = v;
      }
      // Instant attack, smooth release: the envelope is never below the
      // sample, so the output never passes the ceiling.
      this.env = m > this.env ? m : this.env * this.release + m * (1 - this.release);
      if (this.env < m) this.env = m;
      const g = this.env > ceiling ? ceiling / this.env : 1;
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] ? input[c][i] : 0) * g;
    }
    return true;
  }
}
registerProcessor("peak-limiter", PeakLimiter);
`;

interface Route {
  src: MediaElementAudioSourceNode;
  gain: GainNode;
  /** What the chain was built for: tone key and voice effect. */
  built: string;
  pending: boolean;
  dispose: () => void;
  key: string;
}

interface Bus {
  input: GainNode;
  analyser: AnalyserNode;
}

export class PreviewMixer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private masterMeter: AnalyserNode | null = null;
  private buses = new Map<string, Bus>();
  private routes = new WeakMap<HTMLMediaElement, Route>();
  private block = new Float32Array(1024);
  /** Whether elements are routed through the mixer. */
  engaged = false;

  /** Starts routing; false when Web Audio isn't available. */
  engage(): boolean {
    if (this.engaged) return true;
    if (typeof AudioContext === "undefined") return false;
    const ctx = (this.ctx ??= new AudioContext());
    this.master = ctx.createGain();
    this.masterMeter = analyser(ctx);
    // Straight out until the limiter has loaded, then through it.
    this.master.connect(this.masterMeter).connect(ctx.destination);
    const url = URL.createObjectURL(new Blob([LIMITER], { type: "text/javascript" }));
    ctx.audioWorklet
      ?.addModule(url)
      .then(() => {
        if (!this.master || !this.masterMeter || this.ctx !== ctx) return;
        const limiter = new AudioWorkletNode(ctx, "peak-limiter", { outputChannelCount: [2] });
        this.master.disconnect();
        this.master.connect(limiter).connect(this.masterMeter);
      })
      .catch(() => {});
    this.engaged = true;
    return true;
  }

  /** Routes `el` (a track `key`) through its tone and voice effect into
   * the mix and returns the gain node that now sets its level; null when it
   * plays straight out (not engaged, no tone and no effect). */
  route(el: HTMLMediaElement, key: string, fx: VoiceFx = "none", tone?: VoiceTone): GainNode | null {
    const t = toneOf(tone);
    let r = this.routes.get(el);
    if (!r) {
      if (!this.engaged && fx === "none" && !t.wire) return null;
      if (!this.engage()) return null;
      const ctx = this.ctx!;
      corsEnable(el);
      const src = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.connect(this.bus(key).input);
      src.connect(gain);
      r = { src, gain, built: "|none", pending: false, dispose: () => src.disconnect(), key };
      this.routes.set(el, r);
    }
    if (r.key !== key) {
      r.gain.disconnect();
      r.gain.connect(this.bus(key).input);
      r.key = key;
    }
    const ctx = this.ctx!;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const want = `${t.key}|${fx}`;
    if (r.built !== want && !r.pending) {
      const route = r;
      route.pending = true;
      route.dispose();
      const build = async () => {
        const tn = await connectTone(ctx, t.wire, route.src);
        try {
          const dropFx = await connectVoiceFx(ctx, fx, tn.output, route.gain);
          return () => {
            dropFx();
            tn.dispose();
            try {
              route.src.disconnect();
            } catch {
              // already disconnected
            }
          };
        } catch (e) {
          tn.dispose();
          throw e;
        }
      };
      build()
        .then((dispose) => {
          route.dispose = dispose;
          route.built = want;
        })
        .catch(() => {
          route.src.connect(route.gain);
          route.dispose = () => route.src.disconnect();
          route.built = want;
        })
        .finally(() => {
          route.pending = false;
        });
    }
    return r.gain;
  }

  /** The gain node of an element routed earlier, or null. */
  existing(el: HTMLMediaElement): GainNode | null {
    return this.routes.get(el)?.gain ?? null;
  }

  /** The master gain (loudness normalization), linear. */
  setMasterGain(gain: number): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.02);
  }

  /** Current levels of the track buses and the master (after the limiter). */
  levels(): { tracks: Map<string, MeterLevel>; master: MeterLevel | null } {
    const tracks = new Map<string, MeterLevel>();
    for (const [key, bus] of this.buses) tracks.set(key, this.read(bus.analyser));
    return { tracks, master: this.masterMeter ? this.read(this.masterMeter) : null };
  }

  private read(a: AnalyserNode): MeterLevel {
    a.getFloatTimeDomainData(this.block);
    return meterLevel(this.block);
  }

  private bus(key: string): Bus {
    let b = this.buses.get(key);
    if (!b) {
      const ctx = this.ctx!;
      const input = ctx.createGain();
      const meter = analyser(ctx);
      input.connect(this.master!);
      input.connect(meter);
      b = { input, analyser: meter };
      this.buses.set(key, b);
    }
    return b;
  }
}

function analyser(ctx: BaseAudioContext): AnalyserNode {
  const a = ctx.createAnalyser();
  a.fftSize = 1024;
  return a;
}

/** Reloads a cross-origin element with CORS so Web Audio can hear it. */
function corsEnable(el: HTMLMediaElement): void {
  const url = el.currentSrc || el.src;
  if (!url || el.crossOrigin === "anonymous" || /^(blob|data):/.test(url)) return;
  try {
    if (new URL(url, location.href).origin === location.origin) return;
  } catch {
    return;
  }
  const t = el.currentTime;
  const playing = !el.paused;
  el.crossOrigin = "anonymous";
  el.src = url;
  el.currentTime = t;
  if (playing) el.play().catch(() => {});
}

let shared: PreviewMixer | null = null;

/** The one preview mixer of this page (the preview's clips, tracks and
 * video layers all go through it). */
export function previewMixer(): PreviewMixer {
  return (shared ??= new PreviewMixer());
}
