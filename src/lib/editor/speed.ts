import type { Clip } from "./types";

/** Clip speed: one constant `speed`, or a speed ramp (curve).
 *
 * A ramp is a few control points (`clip.ramp`, speeds evenly spaced over
 * the clip's source range) that the engine plays as RAMP_SEGMENTS equal
 * source pieces, each at a constant speed sampled from the curve. Constant
 * pieces keep every mapping exact and cheap - source <-> timeline time is
 * piecewise linear - and let the export retime picture (setpts) and sound
 * (atempo per piece) the same way (editor.py). The curve is relative to the
 * clip, so trimming stretches it and splitting divides it.
 *
 * Freeze frames and reversed clips don't ramp (`speed` applies).
 */

export const RAMP_SEGMENTS = 24;
export const MIN_RAMP_SPEED = 0.1;
export const MAX_RAMP_SPEED = 10;

export const RAMP_PRESETS: { id: string; label: string; points: number[] }[] = [
  { id: "montage", label: "Montage", points: [1, 3, 0.4, 3, 1] },
  { id: "hero", label: "Hero moment", points: [2, 2, 0.3, 0.3, 2] },
  { id: "bullet", label: "Bullet time", points: [3, 0.2, 0.2, 0.2, 3] },
  { id: "flashin", label: "Flash in", points: [5, 2, 1, 1, 1] },
  { id: "flashout", label: "Flash out", points: [1, 1, 1, 2, 5] },
  { id: "speedup", label: "Speed up", points: [0.5, 1, 2, 4] },
  { id: "slowdown", label: "Slow down", points: [4, 2, 1, 0.5] },
  { id: "jump", label: "Jump cut", points: [1, 4, 1, 4, 1] },
];

/** The clip's ramp, when it plays one. */
export function activeRamp(clip: Clip): number[] | null {
  return clip.ramp && clip.ramp.length >= 2 && clip.freeze === null && !clip.reverse ? clip.ramp : null;
}

/** Speed of each of the RAMP_SEGMENTS pieces: the curve (linear between
 * its points) at the piece's middle. */
export function rampSegments(points: number[]): number[] {
  const n = points.length - 1;
  return Array.from({ length: RAMP_SEGMENTS }, (_, k) => {
    const u = ((k + 0.5) / RAMP_SEGMENTS) * n;
    const i = Math.min(n - 1, Math.floor(u));
    const v = points[i] + (points[i + 1] - points[i]) * (u - i);
    return Math.round(Math.min(MAX_RAMP_SPEED, Math.max(MIN_RAMP_SPEED, v)) * 1000) / 1000;
  });
}

/** Source seconds the clip covers. */
const sourceLength = (clip: Clip) => clip.end - clip.start;

/** Timeline seconds the clip lasts (before frame rounding). */
export function clipTimelineLength(clip: Clip): number {
  const ramp = activeRamp(clip);
  if (!ramp) return sourceLength(clip) / (clip.speed || 1);
  const piece = sourceLength(clip) / RAMP_SEGMENTS;
  return rampSegments(ramp).reduce((sum, s) => sum + piece / s, 0);
}

/** Source seconds from the clip's start (in playback order) reached
 * `local` timeline seconds into it. */
export function localToSource(clip: Clip, local: number): number {
  const ramp = activeRamp(clip);
  if (!ramp) return local * (clip.speed || 1);
  const piece = sourceLength(clip) / RAMP_SEGMENTS;
  let acc = 0;
  const segs = rampSegments(ramp);
  for (let k = 0; k < segs.length; k++) {
    const d = piece / segs[k];
    if (local < acc + d || k === segs.length - 1) return k * piece + (local - acc) * segs[k];
    acc += d;
  }
  return sourceLength(clip);
}

/** Inverse of localToSource. */
export function sourceToLocal(clip: Clip, offset: number): number {
  const ramp = activeRamp(clip);
  if (!ramp) return offset / (clip.speed || 1);
  const piece = sourceLength(clip) / RAMP_SEGMENTS;
  const segs = rampSegments(ramp);
  const k = Math.max(0, Math.min(segs.length - 1, Math.floor(offset / piece)));
  let acc = 0;
  for (let i = 0; i < k; i++) acc += piece / segs[i];
  return acc + (offset - k * piece) / segs[k];
}

/** Playback speed at `offset` source seconds into the clip. */
export function speedAt(clip: Clip, offset: number): number {
  const ramp = activeRamp(clip);
  if (!ramp) return clip.speed || 1;
  const segs = rampSegments(ramp);
  const k = Math.floor((offset / Math.max(1e-6, sourceLength(clip))) * RAMP_SEGMENTS);
  return segs[Math.max(0, Math.min(segs.length - 1, k))];
}

/** Average speed (source over timeline length) - for snapping and labels. */
export function effectiveSpeed(clip: Clip): number {
  const len = clipTimelineLength(clip);
  return len > 0 ? sourceLength(clip) / len : clip.speed || 1;
}

/** The ramp's points for the part [from, to] (fractions of the clip) -
 * the curve resampled at the same number of points, for splits. */
export function rampPart(points: number[], from: number, to: number): number[] {
  const n = points.length - 1;
  const at = (u: number) => {
    const x = Math.min(n, Math.max(0, u * n));
    const i = Math.min(n - 1, Math.floor(x));
    return points[i] + (points[i + 1] - points[i]) * (x - i);
  };
  return points.map((_, j) => Math.round(at(from + ((to - from) * j) / n) * 1000) / 1000);
}
