/** A video clip's own sound: fade in, fade out and a volume curve, on top
 * of its volume. The curve's points are in source seconds (like the clip's
 * keyframes and an audio track's curve), so trims, splits and moves keep
 * each one on the sound it was set on. Fades are in timeline seconds from
 * the clip's edges.
 *
 * The preview (PreviewPlayer setLevel), the offline mix (programMix.ts:
 * loudness, captions) and the export (editor.py _clip_audio_chain) use the
 * same gain. Pure - see tests/desktop/clipSound.test.ts. */
import { addPoint, curveAt, normalizePoints } from "./envelope.ts";
import { clipKeyTime, clipKeyTimeToLocal } from "./keyframes.ts";
import type { LaidOutClip } from "./timeline.ts";
import type { Clip, GainPoint } from "./types.ts";

/** Longest fade: 10 s (the export's limit), and never past half the clip. */
export const MAX_CLIP_FADE = 10;

export function clipFades(c: Pick<LaidOutClip, "clip" | "duration">): { fadeIn: number; fadeOut: number } {
  const half = c.duration / 2;
  const f = (v: number | undefined) => Math.max(0, Math.min(MAX_CLIP_FADE, half, v ?? 0));
  return { fadeIn: f(c.clip.fadeIn), fadeOut: f(c.clip.fadeOut) };
}

/** Whether the clip's sound changes over time (fades or a curve). */
export function hasClipSoundShape(clip: Clip): boolean {
  return (clip.fadeIn ?? 0) > 0 || (clip.fadeOut ?? 0) > 0 || !!clip.envelope?.length;
}

/** The fades and curve at timeline time `t` (multiplies the clip's volume). */
export function clipSoundGain(c: LaidOutClip, t: number): number {
  const clip = c.clip;
  if (!hasClipSoundShape(clip)) return 1;
  const local = t - c.start;
  const { fadeIn, fadeOut } = clipFades(c);
  let g = 1;
  if (fadeIn > 0 && local < fadeIn) g *= Math.max(0, local / fadeIn);
  if (fadeOut > 0 && local > c.duration - fadeOut) g *= Math.max(0, (c.duration - local) / fadeOut);
  if (clip.envelope?.length && clip.freeze === null) g *= curveAt(clip.envelope, clipKeyTime(c, t));
  return g;
}

/** For the export: fades, and the curve as [clip-local second, gain] (the
 * export's clip time - after speed and reverse), sorted, with its value at
 * both ends of the clip. */
export function clipSoundWire(c: LaidOutClip): { fadeIn?: number; fadeOut?: number; gain?: [number, number][] } {
  const clip = c.clip;
  const out: { fadeIn?: number; fadeOut?: number; gain?: [number, number][] } = {};
  const { fadeIn, fadeOut } = clipFades(c);
  if (fadeIn > 0) out.fadeIn = round(fadeIn);
  if (fadeOut > 0) out.fadeOut = round(fadeOut);
  const pts = clip.envelope;
  if (pts?.length && clip.freeze === null) {
    const [lo, hi] = [clip.start, clip.end];
    const inner = pts.filter((p) => p.t > lo && p.t < hi).map((p): [number, number] => [round(clipKeyTimeToLocal(clip, p.t)), p.v]);
    const edges: [number, number][] = [
      [0, curveAt(pts, clipKeyTime(c, c.start))],
      [round(c.duration), curveAt(pts, clipKeyTime(c, c.start + c.duration - 1e-4))],
    ];
    const all = [...edges, ...inner].sort((a, b) => a[0] - b[0]);
    if (!all.every(([, v]) => Math.abs(v - 1) < 1e-6)) out.gain = all;
  }
  return out;
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** The curve inside the clip in timeline seconds, for drawing (Timeline
 * CurveOverlay): its value at both edges plus the points within. */
export function visibleClipCurve(c: LaidOutClip): { t: number; v: number; index: number | null }[] {
  const clip = c.clip;
  const pts = clip.envelope ?? [];
  const end = c.start + c.duration;
  const out: { t: number; v: number; index: number | null }[] = [{ t: c.start, v: curveAt(pts, clipKeyTime(c, c.start)), index: null }];
  if (clip.freeze === null) {
    pts.forEach((p, index) => {
      if (p.t > clip.start && p.t < clip.end) out.push({ t: c.start + clipKeyTimeToLocal(clip, p.t), v: p.v, index });
    });
  }
  out.push({ t: end, v: curveAt(pts, clipKeyTime(c, end - 1e-4)), index: null });
  return out.sort((a, b) => a.t - b.t);
}

export type ClipCurveEdit = { kind: "add"; t: number; v: number } | { kind: "move"; index: number; t: number; v: number } | { kind: "remove"; index: number };

/** A curve edit made on the timeline (timeline seconds, gain 0..2). */
export function editClipCurve(c: LaidOutClip, edit: ClipCurveEdit): GainPoint[] {
  const pts = c.clip.envelope ?? [];
  const clampT = (t: number) => Math.min(c.start + c.duration - 1e-3, Math.max(c.start + 1e-3, t));
  // NaN gain: on the current curve.
  if (edit.kind === "add") return addPoint(pts, clipKeyTime(c, clampT(edit.t)), Number.isFinite(edit.v) ? edit.v : undefined);
  if (edit.kind === "remove") return pts.filter((_, i) => i !== edit.index);
  // Held between its neighbors (in source order), so a drag keeps its index.
  const lo = edit.index > 0 ? pts[edit.index - 1].t + 0.02 : 0;
  const hi = edit.index < pts.length - 1 ? pts[edit.index + 1].t - 0.02 : Infinity;
  const s = Math.min(hi, Math.max(lo, clipKeyTime(c, clampT(edit.t))));
  return normalizePoints(pts.map((p, i) => (i === edit.index ? { t: s, v: edit.v } : p)));
}
