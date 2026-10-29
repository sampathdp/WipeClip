/** On-screen activity for the silence review: which parts of which video
 * files are on screen during a timeline range, and the share of that range
 * in which the picture changes, from measurements made by the local engine
 * (backend/app/pipeline/activity.py). Measurements are cached per file and
 * source range, so re-analyzing with other settings or after unrelated
 * edits doesn't decode the same footage again. Pure - see
 * tests/desktop/cleanup.test.ts.
 */
import { sourceTimeOf } from "./camera.ts";
import type { Layout } from "./timeline.ts";
import type { MediaSource } from "./types.ts";

export interface ScreenPiece {
  path: string;
  /** Source seconds, start < end whatever the clip's direction. */
  sourceStart: number;
  sourceEnd: number;
  /** Timeline seconds this piece covers. */
  length: number;
}

const VIDEO_KINDS = new Set<MediaSource["kind"]>(["original", "cleaned", "take"]);

/** The video on screen during timeline `start..end`, per clip, for clips
 * whose file is on disk (the engine reads it by path). Freeze frames are
 * still by definition and left out. */
export function screenPieces(lay: Layout, sources: Record<string, MediaSource>, start: number, end: number): ScreenPiece[] {
  const out: ScreenPiece[] = [];
  for (const c of lay.clips) {
    const a = Math.max(start, c.start);
    const b = Math.min(end, c.start + c.duration);
    if (b - a < 0.05) continue;
    const src = sources[c.clip.sourceId];
    if (!src?.disk || !VIDEO_KINDS.has(src.kind) || c.clip.freeze !== null) continue;
    const s1 = sourceTimeOf(c, a);
    const s2 = sourceTimeOf(c, b);
    out.push({ path: src.disk.path, sourceStart: Math.min(s1, s2), sourceEnd: Math.max(s1, s2), length: b - a });
  }
  return out;
}

const key = (p: { path: string; sourceStart: number; sourceEnd: number }) => `${p.path}|${p.sourceStart.toFixed(2)}|${p.sourceEnd.toFixed(2)}`;

export class ActivityCache {
  private values = new Map<string, number>();

  get(p: ScreenPiece): number | undefined {
    return this.values.get(key(p));
  }

  set(p: { path: string; sourceStart: number; sourceEnd: number }, changing: number) {
    this.values.set(key(p), changing);
  }

  /** Pieces not measured yet, without duplicates. */
  missing(pieces: ScreenPiece[]): ScreenPiece[] {
    const seen = new Set<string>();
    return pieces.filter((p) => {
      const k = key(p);
      if (this.values.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** Share of `pieces` (weighted by timeline length) in which the picture
   * changes; null if none of them is measured. */
  share(pieces: ScreenPiece[]): number | null {
    let len = 0;
    let moving = 0;
    for (const p of pieces) {
      const v = this.get(p);
      if (v === undefined) continue;
      len += p.length;
      moving += v * p.length;
    }
    return len > 0 ? moving / len : null;
  }
}
