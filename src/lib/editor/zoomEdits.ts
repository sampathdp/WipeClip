/** Pure edits on focus zooms, used by the editor's commands (VideoEditor)
 * and tested in tests/desktop/focus.test.ts. Zooms are stored in source
 * time (see camera.ts); every edit returns a new array so the project
 * history records it as one undo step. Any edit clears `auto`: an edited
 * suggestion is the user's own and survives re-analysis. */
import { sourceTimeOf, zoomSpans } from "./camera.ts";
import type { LaidOutClip } from "./timeline.ts";
import type { CameraZoom } from "./types.ts";
import { effectiveSpeed } from "./speed.ts";

/** Shortest zoom the editor creates by splitting or dragging, seconds. */
export const MIN_ZOOM_LENGTH = 0.6;

export function patchZoom(zooms: CameraZoom[], id: string, patch: Partial<CameraZoom>): CameraZoom[] {
  return zooms.map((z) => (z.id === id ? withPath({ ...z, ...patch, auto: false }, patchedPath(z, patch)) : z));
}

/** `z` with `path`, or without the key at all when there is none. */
function withPath(z: CameraZoom, path: CameraZoom["path"]): CameraZoom {
  const { path: _drop, ...rest } = z;
  void _drop;
  return path?.length ? { ...rest, path } : rest;
}

/** A zoom's follow path after an edit: setting the focus by hand ends the
 * following; moving the zoom in time moves the path with it; resizing
 * keeps the points still inside. */
function patchedPath(z: CameraZoom, patch: Partial<CameraZoom>): CameraZoom["path"] {
  if (!z.path?.length || "path" in patch) return "path" in patch ? patch.path : z.path;
  if (patch.x !== undefined || patch.y !== undefined) return undefined;
  const start = patch.start ?? z.start;
  const end = patch.end ?? z.end;
  const moved = patch.start !== undefined && patch.end !== undefined && Math.abs(end - start - (z.end - z.start)) < 1e-6;
  const shift = moved ? start - z.start : 0;
  const path = z.path.map((p) => ({ ...p, t: p.t + shift })).filter((p) => p.t > start && p.t <= end);
  return path.length ? path : undefined;
}

export function removeZoom(zooms: CameraZoom[], id: string): CameraZoom[] {
  return zooms.filter((z) => z.id !== id);
}

/** New suggestions for `sourceId` replace the previous unedited ones.
 * Manual and edited zooms are kept, and a suggestion that would overlap
 * one of them is dropped - the user's zoom wins. */
export function mergeSuggestions(zooms: CameraZoom[], sourceId: string, fresh: CameraZoom[]): CameraZoom[] {
  const kept = zooms.filter((z) => !(z.auto && z.sourceId === sourceId));
  const mine = kept.filter((z) => z.sourceId === sourceId);
  const free = fresh.filter((f) => !mine.some((m) => f.start < m.end && m.start < f.end));
  return [...kept, ...free];
}

/** Splits zoom `id` at source time `at` into two zooms with the same
 * settings. null when `at` is too close to either end. */
export function splitZoom(zooms: CameraZoom[], id: string, at: number, secondId: string): CameraZoom[] | null {
  const z = zooms.find((x) => x.id === id);
  if (!z || at - z.start < MIN_ZOOM_LENGTH || z.end - at < MIN_ZOOM_LENGTH) return null;
  // The second half starts where the focus is at the split.
  const before = (z.path ?? []).filter((p) => p.t <= at);
  const after = (z.path ?? []).filter((p) => p.t > at);
  const focus = before[before.length - 1] ?? z;
  const second = withPath({ ...z, id: secondId, start: at, auto: false, x: focus.x, y: focus.y }, after);
  return [...zooms.map((x) => (x.id === id ? withPath({ ...x, end: at, auto: false }, before) : x)), second];
}

/** A zoom item dragged on the timeline over laid clip `laid`: `start` and
 * `end` are the item's new timeline times. Moves keep the length and stay
 * inside the source; edge drags keep MIN_ZOOM_LENGTH. A reversed clip shows
 * the zoom's source end at its left edge. */
export function dragZoom(
  z: CameraZoom,
  laid: LaidOutClip,
  mode: "move" | "start" | "end",
  start: number,
  end: number,
  sourceDuration: number
): { start: number; end: number } | null {
  const span = zoomSpans([laid], z)[0];
  if (!span) return null;
  let zs = z.start;
  let ze = z.end;
  const limit = Number.isFinite(sourceDuration) && sourceDuration > 0 ? sourceDuration : Infinity;
  if (mode === "move") {
    const len = ze - zs;
    let d = (start - span.start) * effectiveSpeed(laid.clip) * (laid.clip.reverse ? -1 : 1);
    d = Math.max(-zs, Math.min(limit - ze, d));
    zs += d;
    ze = zs + len;
  } else {
    const edge = sourceTimeOf(laid, mode === "start" ? start : end);
    if ((mode === "start") !== laid.clip.reverse) zs = Math.max(0, Math.min(edge, ze - MIN_ZOOM_LENGTH));
    else ze = Math.min(limit, Math.max(edge, zs + MIN_ZOOM_LENGTH));
  }
  return { start: zs, end: ze };
}
