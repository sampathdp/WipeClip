/** Camera motion for focus zooms on recorded sources. Pure and shared by
 * the preview (PreviewPlayer applies the camera as an extra crop) and the
 * export (exportProject samples the very same function per output frame),
 * so both show identical framing - see tests/desktop/focus.test.ts.
 *
 * Model: a camera *window* is the visible part of a clip's (cropped)
 * frame, {x, y} its top-left and `s` its size, all fractions of the crop.
 * It keeps the frame's aspect ratio, so zooming never distorts, and stays
 * inside the frame, so the recording's edges are never exceeded. Zooms
 * become keyframes in source time; between two keyframes the window is
 * linearly interpolated with an ease curve - interpolating the rectangle
 * (not zoom factor and center separately) makes the camera close in on the
 * focus point along a straight line, without swinging.
 */
import { videoBox, type BoxLayout, type LaidOutClip } from "./timeline.ts";
import type { CameraZoom, Clip, Crop, ZoomEase } from "./types.ts";

/** Zooms closer than this pan straight from one focus to the next instead
 * of zooming out and back in. */
export const CHAIN_GAP = 0.8;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** Shortest ease, seconds - anything faster reads as a jump cut. */
export const MIN_EASE = 0.15;
/** A pan along a zoom's path takes this long and ends at the point's time,
 * so the focus has arrived when the click (or keystroke) happens. */
export const PAN = 0.5;
/** Shorter pans than this are skipped (the next one picks up the motion). */
const MIN_PAN = 0.12;

export interface CameraWindow {
  x: number;
  y: number;
  s: number;
}

export const REST: CameraWindow = { x: 0, y: 0, s: 1 };

interface Key {
  t: number;
  win: CameraWindow;
  /** Curve of the span that *ends* at this key. */
  ease: ZoomEase;
}

export interface CameraTrack {
  keys: Key[];
}

export const EASES: Record<ZoomEase, (u: number) => number> = {
  smooth: (u) => u * u * (3 - 2 * u),
  gentle: (u) => u * u * u * (u * (u * 6 - 15) + 10),
  linear: (u) => u,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The part of the camera window that ends up on the output canvas, in
 * window fractions. With canvas "fit" (or a scaled-down clip) it is the
 * whole window; with "fill" - say a landscape recording in a 9:16 or 1:1
 * project - the canvas cuts the sides of the frame, and only the middle
 * of the window is seen. */
export interface ViewRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const FULL_VIEW: ViewRect = { x0: 0, x1: 1, y0: 0, y1: 1 };

/** Visible part of a clip's fitted box (videoBox, canvas fractions) placed
 * at its transform. Rotated clips count as fully visible: their visible
 * area isn't a rectangle in frame space. */
export function visibleView(box: { w: number; h: number }, transform: { x: number; y: number; rotation: number }): ViewRect {
  if (transform.rotation % 360 !== 0 || box.w <= 0 || box.h <= 0) return FULL_VIEW;
  const axis = (center: number, size: number): [number, number] => {
    const left = center - size / 2;
    const a = clamp((0 - left) / size, 0, 1);
    const b = clamp((1 - left) / size, 0, 1);
    // Nearly off-canvas: nothing sensible to aim for.
    return b - a < 0.05 ? [0, 1] : [a, b];
  };
  const [x0, x1] = axis(transform.x, box.w);
  const [y0, y1] = axis(transform.y, box.h);
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return { x0: r(x0), x1: r(x1), y0: r(y0), y1: r(y1) };
}

/** A partly visible window may zoom in up to this much further than asked
 * to bring the focus point into view - never beyond MAX_ZOOM. */
const VIEW_EXTRA_ZOOM = 1.75;

/** The window that shows `z`'s focus point at its zoom inside `crop`:
 * centered on the point (on the visible part of the window when the
 * canvas cuts the frame, see ViewRect) unless that would leave the frame,
 * in which case it slides back inside - the point then sits off-center
 * but stays visible. When the canvas cuts the frame, a point near a frame
 * edge could slide out of the visible part; the window then zooms in a
 * little further (bounded) so it stays in view. */
export function targetWindow(z: Pick<CameraZoom, "zoom" | "x" | "y">, crop: Crop, view: ViewRect = FULL_VIEW): CameraWindow {
  const zoom = clamp(z.zoom, MIN_ZOOM, MAX_ZOOM);
  let s = clamp(1 / zoom, 1 / MAX_ZOOM, 1);
  const fx = clamp((z.x - crop.x) / crop.w, 0, 1);
  const fy = clamp((z.y - crop.y) / crop.h, 0, 1);
  // Largest window that keeps the point inside the visible part with a
  // margin, per axis, when the window is pushed against a frame edge.
  const fit = (f: number, v0: number, v1: number) => {
    if (v0 <= 0 && v1 >= 1) return Infinity; // whole axis visible
    const m = 0.1 * (v1 - v0);
    const lo = v0 + m > 0 ? f / (v0 + m) : Infinity; // against the left/top edge
    const hi = 1 - v1 + m > 0 ? (1 - f) / (1 - v1 + m) : Infinity; // right/bottom
    return Math.min(lo, hi);
  };
  const need = Math.min(fit(fx, view.x0, view.x1), fit(fy, view.y0, view.y1));
  if (need < s) s = Math.max(need, 1 / Math.min(MAX_ZOOM, zoom * VIEW_EXTRA_ZOOM), 1 / MAX_ZOOM);
  const cx = (view.x0 + view.x1) / 2;
  const cy = (view.y0 + view.y1) / 2;
  return { x: clamp(fx - s * cx, 0, 1 - s), y: clamp(fy - s * cy, 0, 1 - s), s };
}

/** Enabled zooms of one source, sorted, de-overlapped (a zoom starting
 * inside the previous one starts at its end) and with eases that fit. */
export function normalizeZooms(zooms: CameraZoom[], sourceId: string): CameraZoom[] {
  const out: CameraZoom[] = [];
  const sorted = zooms.filter((z) => z.enabled && z.sourceId === sourceId).sort((a, b) => a.start - b.start);
  let prevEnd = -Infinity;
  for (const z of sorted) {
    const start = Math.max(z.start, prevEnd);
    const dur = z.end - start;
    if (!(dur > 2 * MIN_EASE)) continue;
    let easeIn = Math.max(MIN_EASE, z.easeIn);
    let easeOut = Math.max(MIN_EASE, z.easeOut);
    if (easeIn + easeOut > dur) {
      const k = dur / (easeIn + easeOut);
      easeIn *= k;
      easeOut *= k;
    }
    out.push({ ...z, start, easeIn, easeOut });
    prevEnd = z.end;
  }
  return out;
}

export function buildCameraTrack(zooms: CameraZoom[], sourceId: string, crop: Crop, view: ViewRect = FULL_VIEW): CameraTrack {
  const zs = normalizeZooms(zooms, sourceId);
  const keys: Key[] = [];
  zs.forEach((z, i) => {
    const target = targetWindow(z, crop, view);
    const chainedIn = i > 0 && z.start - zs[i - 1].end < CHAIN_GAP;
    const chainsOut = i < zs.length - 1 && zs[i + 1].start - z.end < CHAIN_GAP;
    if (!chainedIn) keys.push({ t: z.start, win: REST, ease: z.ease });
    let cur = target;
    let curT = z.start + z.easeIn;
    keys.push({ t: curT, win: cur, ease: z.ease });
    const holdEnd = z.end - z.easeOut;
    // Follow the path: hold, then pan to arrive at each point on time.
    for (const p of z.path ?? []) {
      const at = Math.min(p.t, holdEnd);
      const from = Math.max(curT, at - PAN);
      if (at - from < MIN_PAN) continue;
      const next = targetWindow({ zoom: z.zoom, x: p.x, y: p.y }, crop, view);
      if (from > curT) keys.push({ t: from, win: cur, ease: "smooth" });
      keys.push({ t: at, win: next, ease: "smooth" });
      cur = next;
      curT = at;
    }
    if (holdEnd > curT) keys.push({ t: holdEnd, win: cur, ease: z.ease });
    if (!chainsOut) keys.push({ t: z.end, win: REST, ease: z.ease });
  });
  return { keys };
}

/** Camera window at source time `t`. O(log n). */
export function evalCamera(track: CameraTrack, t: number): CameraWindow {
  const k = track.keys;
  if (k.length === 0 || t <= k[0].t) return k[0]?.win ?? REST;
  if (t >= k[k.length - 1].t) return k[k.length - 1].win;
  let lo = 0;
  let hi = k.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (k[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = k[lo];
  const b = k[hi];
  const span = b.t - a.t;
  const e = span > 0 ? EASES[b.ease]((t - a.t) / span) : 1;
  return {
    x: a.win.x + (b.win.x - a.win.x) * e,
    y: a.win.y + (b.win.y - a.win.y) * e,
    s: a.win.s + (b.win.s - a.win.s) * e,
  };
}

/** The clip's crop with the camera window applied: what the preview
 * shows, and what the export's zoom chain reproduces. */
export function cameraCrop(crop: Crop, win: CameraWindow): Crop {
  if (win.s >= 1 && win.x === 0 && win.y === 0) return crop;
  return { x: crop.x + win.x * crop.w, y: crop.y + win.y * crop.h, w: win.s * crop.w, h: win.s * crop.h };
}

/** Cache of camera tracks per (source, crop, view, zooms) - the preview
 * asks every frame, the zooms change only on edits. */
export class CameraCache {
  private zooms: CameraZoom[] | undefined;
  private tracks = new Map<string, CameraTrack>();

  track(zooms: CameraZoom[] | undefined, clip: Clip, view: ViewRect = FULL_VIEW): CameraTrack | null {
    if (!zooms?.length) return null;
    if (zooms !== this.zooms) {
      this.zooms = zooms;
      this.tracks.clear();
    }
    const c = clip.crop;
    const key = `${clip.sourceId}|${c.x}|${c.y}|${c.w}|${c.h}|${view.x0}|${view.x1}|${view.y0}|${view.y1}`;
    let tr = this.tracks.get(key);
    if (!tr) {
      tr = buildCameraTrack(zooms, clip.sourceId, c, view);
      this.tracks.set(key, tr);
    }
    return tr.keys.length ? tr : null;
  }
}

/** The camera view of `clip` on a canvas: which part of its window the
 * canvas shows. Preview, masks, pointer and export all go through this so
 * they frame identically. */
export function clipView(
  clip: Clip,
  src: { width: number; height: number } | undefined,
  canvas: { width: number; height: number },
  layout: BoxLayout
): ViewRect {
  if (!src) return FULL_VIEW;
  return visibleView(videoBox(clip, src, canvas, layout), clip.transform);
}

// --- Source time <-> timeline time --------------------------------------------

/** Timeline time of source time `s` inside laid clip `c` (null if the clip
 * doesn't show that moment). */
export function timelineTimeOf(c: LaidOutClip, s: number): number | null {
  const { clip } = c;
  if (clip.freeze !== null || s < clip.start || s > clip.end) return null;
  const local = clip.reverse ? clip.end - s : s - clip.start;
  return c.start + local / (clip.speed || 1);
}

/** Source time shown at timeline time `t` of laid clip `c`. */
export function sourceTimeOf(c: LaidOutClip, t: number): number {
  const { clip } = c;
  if (clip.freeze !== null) return clip.freeze;
  const local = (t - c.start) * (clip.speed || 1);
  return clip.reverse ? clip.end - local : clip.start + local;
}

export interface ZoomSpan {
  clipIndex: number;
  start: number;
  end: number;
}

/** Where a zoom appears on the timeline: once per clip that shows part of
 * it (a zoom over a split shows on both sides). */
export function zoomSpans(clips: LaidOutClip[], z: Pick<CameraZoom, "sourceId" | "start" | "end">): ZoomSpan[] {
  const spans: ZoomSpan[] = [];
  for (const c of clips) {
    const { clip } = c;
    if (clip.sourceId !== z.sourceId || clip.freeze !== null) continue;
    const a = Math.max(z.start, clip.start);
    const b = Math.min(z.end, clip.end);
    if (b - a <= 1e-3) continue;
    const ta = timelineTimeOf(c, a)!;
    const tb = timelineTimeOf(c, b)!;
    spans.push({ clipIndex: c.index, start: Math.min(ta, tb), end: Math.max(ta, tb) });
  }
  return spans;
}

/** One camera sample per output frame where the window changes, in the
 * clip's own timeline time (0 = clip start): [t, x, y, s]. The first frame
 * is always included. Used by the export; the backend applies these
 * exact values (app/pipeline/editor.py, _camera_commands). */
export function cameraSamples(track: CameraTrack, c: LaidOutClip, fps: number): number[][] {
  const out: number[][] = [];
  const frames = Math.max(1, Math.round(c.duration * fps));
  let last: CameraWindow | null = null;
  const r = (v: number) => Math.round(v * 1e5) / 1e5;
  for (let f = 0; f < frames; f++) {
    const local = f / fps;
    const w = evalCamera(track, sourceTimeOf(c, c.start + local));
    if (last && Math.abs(w.x - last.x) < 1e-5 && Math.abs(w.y - last.y) < 1e-5 && Math.abs(w.s - last.s) < 1e-5) continue;
    out.push([r(local), r(w.x), r(w.y), r(w.s)]);
    last = w;
  }
  return out;
}

/** Pixel geometry of the export's zoom for a fitted box of boxW x boxH:
 * the box-sized frame is scaled to zw x zh and placed at (ox, oy) so the
 * window fills the box. Mirrors camera_geometry() in
 * backend/app/pipeline/editor.py; both are checked against
 * backend/tests/fixtures/camera_vectors.json. */
export function windowPixels(w: CameraWindow, boxW: number, boxH: number): [number, number, number, number] {
  const s = Math.max(0.2, Math.min(1, w.s));
  const zw = Math.max(boxW, Math.round(boxW / s));
  const zh = Math.max(boxH, Math.round(boxH / s));
  const ox = Math.max(boxW - zw, Math.min(0, -Math.round(w.x * zw)));
  const oy = Math.max(boxH - zh, Math.min(0, -Math.round(w.y * zh)));
  return [zw, zh, ox + 0, oy + 0];
}
