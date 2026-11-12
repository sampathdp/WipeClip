/** The audio mix as one model for the preview, the loudness measurement
 * and the export: which file each track plays (a cleaned copy or the
 * original), the clips' sound as one track (volume, mute), the master
 * gain from loudness normalization, and solo for listening.
 *
 * Solo is a listening aid only: it's kept out of the project, so it never
 * changes the export (every unmuted track is exported). Mute and volume
 * are part of the project and exported.
 * Pure - see tests/desktop/audio.test.ts.
 */
import { toneActive, toneKey, toneWire } from "./voiceTone.ts";
import { envelopeGain } from "./envelope.ts";
import { breathGain } from "./breaths.ts";
import { DEFAULT_MASTER, type AudioClip, type Clip, type MasterAudio, type MediaSource, type Project } from "./types.ts";
import { duckGain } from "./ducking.ts";

/** Solo key of the clips' own sound; audio tracks use their id. */
export const VIDEO_TRACK = "video";
/** Highest video-sound multiplier (the clip's own volume goes to 200%). */
export const MAX_VIDEO_VOLUME = 2;

export function masterOf(project: Pick<Project, "master">): MasterAudio {
  return project.master ?? DEFAULT_MASTER;
}

/** The file a track plays: its cleaned copy unless bypassed or missing
 * (a project opened without the copy plays the original). */
export function playedSourceId(a: AudioClip, sources?: Record<string, MediaSource>): string {
  const c = a.clean;
  if (!c || c.bypass) return a.sourceId;
  if (sources && !sources[c.sourceId]) return a.sourceId;
  return c.sourceId;
}

/** Seconds every audio part fades in and out over with smooth cuts on: a
 * cut in the middle of a waveform clicks; 20 ms of fade can't be heard as
 * one. */
export const EDGE_FADE = 0.02;

export function smoothCutsOn(project: Pick<Project, "master">): boolean {
  return masterOf(project).smoothCuts !== false;
}

/** The fades a part plays with: its own, at least EDGE_FADE (never over a
 * quarter of the part) when smooth cuts are on. The export sends these. */
export function partFades(a: Pick<AudioClip, "fadeIn" | "fadeOut" | "duration">, smooth: boolean): { fadeIn: number; fadeOut: number } {
  if (!smooth) return { fadeIn: a.fadeIn, fadeOut: a.fadeOut };
  const edge = Math.min(EDGE_FADE, a.duration / 4);
  return { fadeIn: Math.max(a.fadeIn, edge), fadeOut: Math.max(a.fadeOut, edge) };
}

/** An audio track's gain at timeline time `t`: volume (with a repaired
 * copy's make-up gain), volume curve, fades and ducking (the export's
 * chain in editor.py: volume, curve, duck, afade). 0 outside it. */
export function trackGainAt(a: AudioClip, t: number, smooth = false): number {
  const local = t - a.start;
  if (a.muted || local < 0 || local >= a.duration) return 0;
  const f = partFades(a, smooth);
  const fadeIn = f.fadeIn > 0 ? Math.min(1, local / f.fadeIn) : 1;
  const fadeOut = f.fadeOut > 0 ? Math.min(1, (a.duration - local) / f.fadeOut) : 1;
  return Math.max(0, a.volume * cleanGain(a) * envelopeGain(a, t) * breathGain(a, t) * fadeIn * fadeOut * duckGain(a, t));
}

/** The make-up gain of the copy a track plays (1 for the original). */
export function cleanGain(a: AudioClip): number {
  const g = a.clean && !a.clean.bypass ? (a.clean.gain ?? 1) : 1;
  return Number.isFinite(g) && g > 0 ? Math.min(4, g) : 1;
}

/** A clip's volume with the video-sound track's volume and mute applied. */
export function clipMixVolume(project: Pick<Project, "master">, clip: Clip): number {
  const m = masterOf(project);
  return m.videoMuted ? 0 : clip.volume * m.videoVolume;
}

/** The master gain in dB the preview and export apply (0 = none). */
export function masterGainDb(project: Pick<Project, "master">): number {
  const m = masterOf(project);
  return m.loudness === "off" ? 0 : m.gainDb;
}

/** Whether `key` is heard in the preview under the current solo set. */
export function heardWithSolo(key: string, solo: ReadonlySet<string>): boolean {
  return solo.size === 0 || solo.has(key);
}

/** Toggles `key` in the solo set (several tracks can be soloed). */
export function toggleSolo(solo: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(solo);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Drops soloed keys whose track is gone (deleted, undone). */
export function liveSolo(solo: ReadonlySet<string>, project: Pick<Project, "audio">): Set<string> {
  const ids = new Set(project.audio.map((a) => a.id));
  return new Set([...solo].filter((k) => k === VIDEO_TRACK || ids.has(k)));
}

/** Everything the mix's loudness depends on, as a short key: when it
 * changes, a stored measurement is out of date. */
export function mixKey(project: Project): string {
  const m = masterOf(project);
  const parts: unknown[] = [
    m.videoMuted ? 0 : m.videoVolume,
    project.clips.map((c) => [c.sourceId, c.start, c.end, c.speed, c.ramp ?? 0, c.reverse, c.freeze, c.volume, c.transition?.type ?? 0, c.transition?.duration ?? 0, c.fadeIn ?? 0, c.fadeOut ?? 0, c.envelope ?? 0]),
    project.audio
      .filter((a) => !a.muted && a.volume > 0)
      .map((a) => [playedSourceId(a), a.start, a.offset, a.duration, a.volume, a.fadeIn, a.fadeOut, a.duck?.amount ?? 0, a.duck?.regions.length ?? 0, a.voice ?? 0, ...(toneActive(a.tone) ? [toneKey(toneWire(a.tone))] : []), ...(a.envelope?.length ? [a.envelope] : []), ...(a.breaths?.length ? [a.breaths] : [])]),
    project.overlays.filter((o) => o.kind === "video" && !o.hidden && o.volume > 0).map((o) => (o.kind === "video" ? [o.sourceId, o.start, o.end, o.offset, o.volume] : 0)),
  ];
  // FNV-1a over the JSON: short, stable, and enough to notice a change.
  const text = JSON.stringify(parts);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Whether the stored measurement no longer matches the mix. */
export function loudnessStale(project: Project): boolean {
  const m = masterOf(project);
  return m.loudness !== "off" && (!m.measured || m.measured.key !== mixKey(project));
}

export interface MeterLevel {
  /** Highest sample, 0..1+ (above 1 clips). */
  peak: number;
  /** RMS, 0..1. */
  rms: number;
}

/** Peak and RMS of a block of samples (a meter reading). */
export function meterLevel(block: Float32Array): MeterLevel {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < block.length; i++) {
    const v = block[i];
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
    sum += v * v;
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, block.length)) };
}

/** A meter's bar position 0..1 for a level, on a -60..0 dBFS scale. */
export function meterFraction(level: number, floorDb = -60): number {
  if (!(level > 0)) return 0;
  const db = 20 * Math.log10(level);
  return Math.max(0, Math.min(1, (db - floorDb) / -floorDb));
}

/** Patch for a track's cleanup copy being made (`sourceId`) or removed. */
/** `opts.repairGain`: the copy also had its clipping repaired, and plays at
 * this make-up gain. */
export function withCleanup(
  a: AudioClip,
  sourceId: string | null,
  strength: number,
  opts: { repairGain?: number; gain?: number; wind?: boolean; mouth?: boolean; echo?: number; isolate?: boolean } = {}
): AudioClip {
  if (!sourceId) {
    const { clean: _drop, ...rest } = a;
    void _drop;
    return rest;
  }
  return {
    ...a,
    clean: {
      sourceId,
      strength,
      bypass: false,
      ...(opts.repairGain !== undefined ? { repaired: true, gain: opts.repairGain } : opts.gain !== undefined && opts.gain !== 1 ? { gain: opts.gain } : {}),
      ...(opts.wind ? { wind: true } : {}),
      ...(opts.mouth ? { mouth: true } : {}),
      ...(opts.echo ? { echo: opts.echo } : {}),
      ...(opts.isolate ? { isolated: true } : {}),
    },
  };
}
