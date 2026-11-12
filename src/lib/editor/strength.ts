/** How strongly a clip's look (filter, adjustments, curves, LUT) or a timed
 * effect shows over time: 0 = not at all, 1 = fully, linear between
 * points, held before the first and after the last. The picture shown is
 * the original blended with the graded / effected one by that amount -
 * the export does exactly that (editor.py blend with all_expr), and the
 * preview does it for the look (GradeFilter's final feComposite) and
 * scales the effect's intensity by it.
 *
 * A clip's points are in source seconds (they stay on the same moment of
 * the video through trims, splits and moves, like its keyframes); an
 * effect's are seconds from its start (moving it moves them).
 *
 * Pure - see tests/desktop/strength.test.ts. */
import { curveAt } from "./envelope.ts";
import { clipKeyTime, clipKeyTimeToLocal } from "./keyframes.ts";
import type { LaidOutClip } from "./timeline.ts";
import type { EffectClip, GainPoint } from "./types.ts";

/** Points closer than this are one. */
const SAME = 0.02;
export const MAX_STRENGTH_POINTS = 32;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);
const round = (v: number) => Math.round(v * 1e4) / 1e4;

export function strengthAt(points: GainPoint[] | undefined, t: number): number {
  return points?.length ? clamp01(curveAt(points, t)) : 1;
}

/** Sets the strength at `t` (replacing a point within SAME). */
export function setStrength(points: GainPoint[] | undefined, t: number, v: number): GainPoint[] {
  const list = (points ?? []).filter((p) => Math.abs(p.t - t) >= SAME);
  return [...list, { t: round(t), v: round(clamp01(v)) }].sort((a, b) => a.t - b.t).slice(0, MAX_STRENGTH_POINTS);
}

/** A fade from nothing to full ("in", from `from`) or from full to nothing
 * ("out", ending at `to`), over `seconds`. Times in the points' own base. */
export function strengthFade(kind: "in" | "out", from: number, to: number, seconds: number): GainPoint[] {
  const d = Math.max(0.05, Math.min(seconds, to - from));
  return kind === "in"
    ? [
        { t: round(from), v: 0 },
        { t: round(from + d), v: 1 },
      ]
    : [
        { t: round(to - d), v: 1 },
        { t: round(to), v: 0 },
      ];
}

// --- clips -------------------------------------------------------------------------

/** How much of the clip's look shows at timeline time `t`. */
export function clipLookStrength(c: LaidOutClip, t: number): number {
  const pts = c.clip.lookMix;
  if (!pts?.length || c.clip.freeze !== null) return pts?.length ? clamp01(pts[0].v) : 1;
  return strengthAt(pts, clipKeyTime(c, t));
}

/** For the export: the clip's look strength as [clip-local second, 0..1]
 * (the export's clip time), sorted, with its value at both ends; none
 * when it's full all along. */
export function clipLookWire(c: LaidOutClip): [number, number][] | undefined {
  const clip = c.clip;
  const pts = clip.lookMix;
  if (!pts?.length) return undefined;
  if (clip.freeze !== null) return pts[0].v >= 1 ? undefined : [[0, clamp01(pts[0].v)]];
  const [lo, hi] = [clip.start, clip.end];
  const inner = pts.filter((p) => p.t > lo && p.t < hi).map((p): [number, number] => [round(clipKeyTimeToLocal(clip, p.t)), clamp01(p.v)]);
  const edges: [number, number][] = [
    [0, strengthAt(pts, clipKeyTime(c, c.start))],
    [round(c.duration), strengthAt(pts, clipKeyTime(c, c.start + c.duration - 1e-4))],
  ];
  const all = [...edges, ...inner].sort((a, b) => a[0] - b[0]);
  return all.every(([, v]) => v >= 1 - 1e-6) ? undefined : all;
}

/** The clip's look-strength time at timeline time `t` (to add a point). */
export function clipStrengthTime(c: LaidOutClip, t: number): number {
  return c.clip.freeze !== null ? 0 : clipKeyTime(c, t);
}

// --- effects -----------------------------------------------------------------------

export function effectStrength(e: EffectClip, t: number): number {
  return strengthAt(e.mix, t - e.start);
}

/** For the export: the effect's strength as [timeline second, 0..1]; none
 * when it's full all along. */
export function effectMixWire(e: EffectClip): [number, number][] | undefined {
  if (!e.mix?.length) return undefined;
  const pts = e.mix.filter((p) => p.t > 0 && p.t < e.end - e.start).map((p): [number, number] => [round(e.start + p.t), clamp01(p.v)]);
  const all: [number, number][] = [[round(e.start), strengthAt(e.mix, 0)], ...pts, [round(e.end), strengthAt(e.mix, e.end - e.start)]];
  return all.every(([, v]) => v >= 1 - 1e-6) ? undefined : all;
}
