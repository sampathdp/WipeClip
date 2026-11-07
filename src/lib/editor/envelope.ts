/** Volume curve of an audio track: points of gain drawn on the track, on
 * top of its volume, fades and ducking. Points are in seconds of the audio
 * file (like beats), so trims, splits and ripple cuts keep each one on the
 * sound it was set on. Linear between points, held before the first and
 * after the last - the same as editor.py's keyframe_expr with linear ease,
 * which the export runs. Pure - see tests/desktop/envelope.test.ts. */
import type { AudioClip, GainPoint } from "./types.ts";

/** Highest point: +6 dB. */
export const MAX_POINT_GAIN = 2;
export const MAX_POINTS = 200;
/** Two points closer than this are one. */
const MIN_GAP = 0.01;

const clampGain = (v: number) => (Number.isFinite(v) ? Math.min(MAX_POINT_GAIN, Math.max(0, v)) : 1);
const round = (v: number, step: number) => Math.round(v * step) / step;

/** Sorted, clamped, rounded, without duplicates or more than MAX_POINTS. */
export function normalizePoints(points: GainPoint[]): GainPoint[] {
  const out: GainPoint[] = [];
  for (const p of [...points].filter((p) => Number.isFinite(p.t) && p.t >= 0).sort((a, b) => a.t - b.t)) {
    const q = { t: round(p.t, 1000), v: round(clampGain(p.v), 1000) };
    const last = out[out.length - 1];
    if (last && q.t - last.t < MIN_GAP) out[out.length - 1] = q;
    else out.push(q);
  }
  return out.slice(0, MAX_POINTS);
}

/** The curve's gain at source second `s` (1 without points). */
export function curveAt(points: GainPoint[] | undefined, s: number): number {
  if (!points || points.length === 0) return 1;
  if (s <= points[0].t) return points[0].v;
  const last = points[points.length - 1];
  if (s >= last.t) return last.v;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= s) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  return b.t - a.t < 1e-9 ? b.v : a.v + ((b.v - a.v) * (s - a.t)) / (b.t - a.t);
}

/** A track's curve gain at timeline time `t`. */
export function envelopeGain(a: AudioClip, t: number): number {
  return curveAt(a.envelope, a.offset + (t - a.start));
}

/** Adds a point at source second `s` on the current curve (so adding one
 * doesn't change the sound until it's moved). */
export function addPoint(points: GainPoint[] | undefined, s: number, v?: number): GainPoint[] {
  return normalizePoints([...(points ?? []), { t: s, v: v ?? curveAt(points, s) }]);
}

/** The part of the curve inside the track, in timeline seconds, for
 * drawing: the points within it plus the curve's value at both edges. */
export function visibleCurve(a: AudioClip): { t: number; v: number; index: number | null }[] {
  const pts = a.envelope ?? [];
  const from = a.offset;
  const to = a.offset + a.duration;
  const toTl = (s: number) => a.start + (s - a.offset);
  const out: { t: number; v: number; index: number | null }[] = [{ t: a.start, v: curveAt(pts, from), index: null }];
  pts.forEach((p, index) => {
    if (p.t > from && p.t < to) out.push({ t: toTl(p.t), v: p.v, index });
  });
  out.push({ t: a.start + a.duration, v: curveAt(pts, to), index: null });
  return out;
}

/** "-6.0 dB", "0 dB", "Silent". */
export function gainLabel(v: number): string {
  if (v <= 0.001) return "Silent";
  const db = 20 * Math.log10(v);
  return Math.abs(db) < 0.05 ? "0 dB" : `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
}

/** For the export: [source second, gain] rows. */
export function envelopeWire(a: AudioClip): [number, number][] | undefined {
  const pts = a.envelope;
  if (!pts || pts.length === 0 || pts.every((p) => p.v === 1)) return undefined;
  return pts.map((p) => [p.t, p.v]);
}
