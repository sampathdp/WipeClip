/** Getting around and fine-tuning cuts on the timeline:
 *
 * - **Markers** (M): notes on moments, jumped to with Up/Down.
 * - **Edit points** (Up/Down): clip cuts, markers, the in/out range and both
 *   ends of the timeline.
 * - **In/out range** (I / O): a stretch to cut, loop or export.
 * - **Slip** (Alt+drag a clip): shows an earlier or later part of its video
 *   in the same place and length.
 * - **Roll** (Alt+drag a cut): moves the cut between two clips - one gets
 *   longer, the other shorter, everything else stays.
 *
 * Pure - see tests/desktop/timelineNav.test.ts. */
import { MIN_CLIP_SECONDS, clipVisualSpan, newId, type Layout } from "./timeline.ts";
import { activeRamp } from "./speed.ts";
import type { Clip, Marker, Project } from "./types.ts";

const EPS = 1e-3;

// --- markers ---------------------------------------------------------------

/** A marker at `t` (none added when one is already there). */
export function addMarker(markers: Marker[] | undefined, t: number): { markers: Marker[]; marker: Marker; added: boolean } {
  const list = markers ?? [];
  const near = list.find((m) => Math.abs(m.t - t) < 0.05);
  if (near) return { markers: list, marker: near, added: false };
  let n = list.length + 1;
  while (list.some((m) => m.label === `Marker ${n}`)) n++;
  const marker: Marker = { id: newId("mk"), t: Math.max(0, Math.round(t * 1000) / 1000), label: `Marker ${n}` };
  return { markers: [...list, marker].sort((a, b) => a.t - b.t), marker, added: true };
}

export function moveMarker(markers: Marker[], id: string, t: number, total: number): Marker[] {
  const v = Math.round(Math.min(total, Math.max(0, t)) * 1000) / 1000;
  return markers.map((m) => (m.id === id ? { ...m, t: v } : m)).sort((a, b) => a.t - b.t);
}

// --- edit points -------------------------------------------------------------

export interface Range {
  in: number;
  out: number;
}

/** Every place Up/Down stops at, sorted. */
export function editPoints(lay: Layout, markers: Marker[] = [], range: Range | null = null): number[] {
  const pts = [0, lay.total, ...lay.clips.slice(1).map((_, i) => clipVisualSpan(lay, i + 1).from), ...markers.map((m) => m.t)];
  if (range) pts.push(range.in, range.out);
  const out: number[] = [];
  for (const t of pts.filter((x) => Number.isFinite(x) && x >= 0 && x <= lay.total + EPS).sort((a, b) => a - b)) {
    if (!out.length || t - out[out.length - 1] > EPS) out.push(t);
  }
  return out;
}

/** The next edit point after `t` (dir 1) or before it (dir -1), or null. */
export function nextPoint(points: number[], t: number, dir: 1 | -1): number | null {
  if (dir > 0) return points.find((p) => p > t + EPS) ?? null;
  for (let i = points.length - 1; i >= 0; i--) if (points[i] < t - EPS) return points[i];
  return null;
}

/** The range after setting its in (`which` "in") or out point at `t`: an
 * in after the out (or an out before the in) starts a fresh range there
 * running to the end (or from the start). */
export function setRangePoint(range: Range | null, which: "in" | "out", t: number, total: number): Range | null {
  const v = Math.min(total, Math.max(0, t));
  if (which === "in") {
    const out = range && range.out > v + 0.05 ? range.out : total;
    return out - v > 0.05 ? { in: v, out } : null;
  }
  const from = range && range.in < v - 0.05 ? range.in : 0;
  return v - from > 0.05 ? { in: from, out: v } : null;
}

// --- slip and roll -----------------------------------------------------------

/** Why a clip can't be slipped or rolled, or null. */
export function fineTrimBlocker(c: Clip): string | null {
  if (c.freeze !== null) return "A freeze frame has no video to slip.";
  if (c.reverse) return "Reversed clips can't be slipped or rolled. Set it to play forward first.";
  if (activeRamp(c)) return "Clips with a speed curve can't be slipped or rolled.";
  return null;
}

/** The clip showing `delta` source seconds later (earlier when negative)
 * of its video, held inside the video. */
export function slipClip(c: Clip, delta: number, sourceDuration: number): Clip {
  if (fineTrimBlocker(c)) return c;
  const d = Math.min(Math.max(delta, -c.start), Math.max(0, sourceDuration - c.end));
  if (Math.abs(d) < 1e-6) return c;
  return { ...c, start: round(c.start + d), end: round(c.end + d) };
}

/** Moves the cut after clip `index` by `dt` timeline seconds: that clip
 * ends later (or earlier) and the next one starts later (or earlier) in
 * its video, so the total length stays the same. Null when not possible. */
export function rollCut(p: Project, index: number, dt: number, sourceDuration: (sourceId: string) => number): Project | null {
  const a = p.clips[index];
  const b = p.clips[index + 1];
  if (!a || !b || fineTrimBlocker(a) || fineTrimBlocker(b)) return null;
  const sa = a.speed || 1;
  const sb = b.speed || 1;
  // Timeline seconds each side can give or take.
  const maxLater = Math.min((sourceDuration(a.sourceId) - a.end) / sa, (b.end - b.start) / sb - MIN_CLIP_SECONDS);
  const maxEarlier = Math.min((a.end - a.start) / sa - MIN_CLIP_SECONDS, b.start / sb);
  const d = Math.min(Math.max(dt, -Math.max(0, maxEarlier)), Math.max(0, maxLater));
  if (Math.abs(d) < 1e-6) return p;
  const clips = [...p.clips];
  clips[index] = { ...a, end: round(a.end + d * sa) };
  clips[index + 1] = { ...b, start: round(b.start + d * sb) };
  return { ...p, clips };
}

const round = (t: number) => Math.round(t * 1e6) / 1e6;
