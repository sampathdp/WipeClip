/** The whole mix as the export will sum it, rendered offline at 16 kHz
 * mono for the loudness measurement (loudness.ts): every clip's sound at
 * its speed, volume and the video-sound track's level (reversed clips
 * reversed, speed curves as their pieces, transitions as crossfades),
 * every unmuted audio track (its cleaned copy unless bypassed, with
 * volume, fades and ducking, and its tone - EQ, de-esser and compressor,
 * voiceTone.ts, which can change the level a lot) and the video layers'
 * sound. Voice effects aren't applied (they change the character, not
 * much the level), nor is the master gain - it's what this measures for. Runs in the browser; the
 * gain curves come from mix.ts, the same math the preview uses.
 */
import { ANALYSIS_RATE } from "./audioAnalysis";
import { clipMixVolume, playedSourceId, smoothCutsOn, trackGainAt } from "./mix";
import { clipSoundGain } from "./clipSound";
import { sourceName } from "./sourceFile";
import { decodeSourceAudio } from "./sourceAudio";
import { RAMP_SEGMENTS, activeRamp, rampSegments } from "./speed";
import type { Layout } from "./timeline";
import type { MediaSource, Project } from "./types";
import { connectTone, toneWire } from "./voiceTone";

const RATE = ANALYSIS_RATE;
const CURVE_RATE = 50; // gain automation points per second

export interface ProgramMix {
  /** null when nothing on the timeline has sound. */
  samples: Float32Array | null;
  /** Files left out: too large to decode here, or unreadable. */
  skipped: string[];
}

export async function renderProgramMix(lay: Layout, project: Project, sources: Record<string, MediaSource>, signal?: AbortSignal): Promise<ProgramMix> {
  if (lay.total <= 0) return { samples: null, skipped: [] };
  const skipped = new Set<string>();
  const decoded = new Map<string, Promise<AudioBuffer | null>>();
  const decode = (src: MediaSource) => {
    let p = decoded.get(src.id);
    if (!p) {
      const name = sourceName(src) || "a file";
      const skip = () => {
        skipped.add(name);
        return null;
      };
      p = decodeSourceAudio(src, RATE).then((buf) => (buf && buf !== "too_large" ? buf : skip()));
      decoded.set(src.id, p);
    }
    return p;
  };
  const abort = () => {
    if (signal?.aborted) throw new DOMException("Measuring cancelled", "AbortError");
  };

  const ctx = new OfflineAudioContext(1, Math.ceil(lay.total * RATE), RATE);
  let scheduled = 0;
  /** Plays `buf` from `offset` for `duration` (buffer seconds) at `when`,
   * with a gain curve over its timeline span. */
  const play = (buf: AudioBuffer, when: number, offset: number, duration: number, rate: number, gain: (t: number) => number, via?: { input: AudioNode; output: AudioNode }) => {
    const span = duration / rate;
    if (span <= 0) return;
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.playbackRate.value = rate;
    const g = ctx.createGain();
    const n = Math.max(2, Math.ceil(span * CURVE_RATE) + 1);
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = gain(when + (i / (n - 1)) * span);
    g.gain.setValueCurveAtTime(curve, when, span);
    if (via) {
      node.connect(via.input);
      via.output.connect(g).connect(ctx.destination);
    } else node.connect(g).connect(ctx.destination);
    node.start(when, offset, duration);
    scheduled++;
  };

  for (let i = 0; i < lay.clips.length; i++) {
    const lc = lay.clips[i];
    const c = lc.clip;
    const src = sources[c.sourceId];
    const volume = clipMixVolume(project, c);
    if (c.freeze !== null || volume === 0 || !src?.hasAudio) continue;
    let buf = await decode(src);
    abort();
    if (!buf) continue;
    // Transitions as linear crossfades over the overlap (export: acrossfade).
    const fadeIn = i > 0 ? lay.clips[i - 1].transitionOut : 0;
    const fadeOut = lc.transitionOut;
    const end = lc.start + lc.duration;
    const gain = (t: number) => {
      let g = volume * clipSoundGain(lc, Math.min(t, end - 1e-6));
      if (fadeIn > 0 && t < lc.start + fadeIn) g *= Math.max(0, (t - lc.start) / fadeIn);
      if (fadeOut > 0 && t > end - fadeOut) g *= Math.max(0, (end - t) / fadeOut);
      return g;
    };
    if (c.reverse) buf = reversedPart(ctx, buf, c.start, c.end);
    const ramp = activeRamp(c);
    if (ramp) {
      const piece = (c.end - c.start) / RAMP_SEGMENTS;
      let when = lc.start;
      for (const [k, s] of rampSegments(ramp).entries()) {
        play(buf, when, (c.reverse ? 0 : c.start) + k * piece, piece, s, gain);
        when += piece / s;
      }
    } else play(buf, lc.start, c.reverse ? 0 : c.start, c.end - c.start, c.speed, gain);
  }

  for (const a of project.audio) {
    if (a.muted || a.volume === 0) continue;
    const src = sources[playedSourceId(a, sources)];
    if (!src) continue;
    const buf = await decode(src);
    abort();
    if (!buf) continue;
    // The tone sits before the level, as in the preview and the export.
    const wire = toneWire(a.tone);
    let via: { input: AudioNode; output: AudioNode } | undefined;
    if (wire) {
      const input = ctx.createGain();
      via = { input, output: (await connectTone(ctx, wire, input, 1)).output };
    }
    play(buf, a.start, a.offset, a.duration, 1, (t) => trackGainAt(a, Math.min(t, a.start + a.duration - 1e-6), smoothCutsOn(project)), via);
  }

  for (const o of project.overlays) {
    if (o.kind !== "video" || o.hidden || o.volume <= 0) continue;
    const src = sources[o.sourceId];
    if (!src?.hasAudio) continue;
    const buf = await decode(src);
    abort();
    if (buf) play(buf, o.start, o.offset, o.end - o.start, 1, () => o.volume);
  }

  if (scheduled === 0) return { samples: null, skipped: [...skipped] };
  const mixed = await ctx.startRendering();
  abort();
  return { samples: mixed.getChannelData(0), skipped: [...skipped] };
}

/** A buffer holding source seconds [from, to) of `buf` backwards. */
function reversedPart(ctx: BaseAudioContext, buf: AudioBuffer, from: number, to: number): AudioBuffer {
  const a = Math.max(0, Math.floor(from * buf.sampleRate));
  const b = Math.min(buf.length, Math.ceil(to * buf.sampleRate));
  const out = ctx.createBuffer(1, Math.max(1, b - a), buf.sampleRate);
  const src = buf.getChannelData(0);
  const dst = out.getChannelData(0);
  for (let i = 0; i < b - a; i++) dst[i] = src[b - 1 - i];
  return out;
}
