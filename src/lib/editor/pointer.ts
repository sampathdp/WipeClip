/** Reconstructed pointer and click indicators for recorded sources. Pure
 * and shared by preview and export (see camera.ts for the same pattern) -
 * tests/desktop/focus.test.ts.
 *
 * The recorder stores pointer samples only when the pointer moves (Phase 1,
 * src/lib/recorder/format.ts), so a long gap between samples means it
 * stood still: positions are held across gaps and only interpolated
 * between samples that are close in time. Nothing is ever interpolated
 * across a pause cut. Everything is resampled onto a fixed grid once,
 * which makes playback and export lookups O(1).
 *
 * Smoothing is a Gaussian over that grid, faded back to the raw path
 * around every click so the cursor is exactly where the click happened.
 */
import { cameraCrop, evalCamera, visibleView, type CameraCache } from "./camera.ts";
import { locate, sourceTimeAt, videoBox, type Layout } from "./timeline.ts";
import type { MediaSource, PointerStyle, Project } from "./types.ts";
import type { InteractionEvent, MouseButton } from "../recorder/format.ts";

export const GRID_HZ = 60;
/** Samples further apart than this mean the pointer was standing still. */
const HOLD_GAP = 0.1;
/** Around a click the path returns to the raw position. */
const PIN = 0.15;
const MAX_SIGMA = 0.12;

export interface Click {
  t: number; // source seconds
  button: MouseButton;
  x: number;
  y: number;
}

export interface PointerTrack {
  t0: number;
  xs: Float32Array;
  ys: Float32Array;
  /** 1 where the position is known. */
  known: Uint8Array;
  /** Grid index ranges that must not be blended across (pause cuts). */
  cutAfter: Uint8Array;
  clicks: Click[];
}

/** Events in source coordinates, or null when this recording can't place
 * them on the video (window capture / unknown display). */
export function recordingEvents(src: MediaSource | undefined): InteractionEvent[] | null {
  const rec = src?.recording;
  if (!rec || rec.trackKind !== "screen" || rec.manifest.capture.coordinateSpace !== "capture" || rec.events.length === 0) return null;
  return rec.events;
}

export function buildPointerTrack(events: InteractionEvent[], smoothing: number): PointerTrack {
  const samples: { t: number; x: number; y: number }[] = [];
  const cuts: number[] = [];
  const clicks: Click[] = [];
  for (const e of events) {
    if (e.type === "move" || e.type === "scroll") samples.push({ t: e.t / 1000, x: e.x, y: e.y });
    else if (e.type === "button") {
      samples.push({ t: e.t / 1000, x: e.x, y: e.y });
      if (e.down) clicks.push({ t: e.t / 1000, button: e.button, x: e.x, y: e.y });
    } else if (e.type === "pause") cuts.push(e.t / 1000);
  }
  samples.sort((a, b) => a.t - b.t);
  const end = samples.length ? samples[samples.length - 1].t : 0;
  const n = samples.length ? Math.ceil(end * GRID_HZ) + 2 : 0;
  const rx = new Float32Array(n);
  const ry = new Float32Array(n);
  const known = new Uint8Array(n);
  const cutAfter = new Uint8Array(n);
  for (const c of cuts) {
    // The cut lies between grid points i and i+1: i/hz < c <= (i+1)/hz.
    const i = Math.ceil(c * GRID_HZ) - 1;
    if (i >= 0 && i < n) cutAfter[i] = 1;
  }
  const isCutBetween = (a: number, b: number) => cuts.some((c) => c > a && c <= b);
  let j = -1; // last sample at or before the grid time
  for (let i = 0; i < n; i++) {
    const g = i / GRID_HZ;
    while (j + 1 < samples.length && samples[j + 1].t <= g) j++;
    if (j < 0) continue;
    const a = samples[j];
    const b = samples[j + 1];
    known[i] = 1;
    if (b && b.t - a.t <= HOLD_GAP && !isCutBetween(a.t, b.t)) {
      const u = (g - a.t) / (b.t - a.t);
      rx[i] = a.x + (b.x - a.x) * u;
      ry[i] = a.y + (b.y - a.y) * u;
    } else {
      rx[i] = a.x;
      ry[i] = a.y;
    }
  }
  const { xs, ys } = smooth(rx, ry, known, cutAfter, clicks, Math.min(1, Math.max(0, smoothing)) * MAX_SIGMA);
  return { t0: 0, xs, ys, known, cutAfter, clicks };
}

function smooth(rx: Float32Array, ry: Float32Array, known: Uint8Array, cutAfter: Uint8Array, clicks: Click[], sigma: number) {
  const n = rx.length;
  if (sigma <= 1 / GRID_HZ / 2 || n === 0) return { xs: rx, ys: ry };
  const radius = Math.ceil(sigma * 3 * GRID_HZ);
  const kernel = new Float32Array(radius + 1);
  for (let k = 0; k <= radius; k++) kernel[k] = Math.exp(-((k / GRID_HZ) ** 2) / (2 * sigma * sigma));
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  // Distance (in seconds) to the nearest click, for pinning.
  const pin = new Float32Array(n).fill(Infinity);
  for (const c of clicks) {
    const ci = c.t * GRID_HZ;
    const lo = Math.max(0, Math.floor(ci - PIN * GRID_HZ));
    const hi = Math.min(n - 1, Math.ceil(ci + PIN * GRID_HZ));
    for (let i = lo; i <= hi; i++) pin[i] = Math.min(pin[i], Math.abs(i - ci) / GRID_HZ);
  }
  for (let i = 0; i < n; i++) {
    if (!known[i]) continue;
    let sx = 0;
    let sy = 0;
    let sw = 0;
    // Walk outwards, stopping at cuts and unknown samples.
    for (let dir = -1; dir <= 1; dir += 2) {
      for (let k = dir < 0 ? 0 : 1; k <= radius; k++) {
        const j = i + dir * k;
        if (j < 0 || j >= n || !known[j]) break;
        if (dir < 0 && k > 0 && cutAfter[j]) break;
        if (dir > 0 && cutAfter[j - 1]) break;
        sx += rx[j] * kernel[k];
        sy += ry[j] * kernel[k];
        sw += kernel[k];
      }
    }
    const w = Math.min(1, pin[i] / PIN); // 0 at a click, 1 away from clicks
    xs[i] = rx[i] + (sx / sw - rx[i]) * w;
    ys[i] = ry[i] + (sy / sw - ry[i]) * w;
  }
  return { xs, ys };
}

/** Pointer position at source time `t` (fractions of the source frame),
 * or null before the first sample. */
export function pointerAt(track: PointerTrack, t: number): { x: number; y: number } | null {
  const n = track.xs.length;
  if (n === 0) return null;
  const f = Math.max(0, t * GRID_HZ);
  const i = Math.min(n - 1, Math.floor(f));
  if (!track.known[i]) return null;
  const j = i + 1;
  if (j >= n || !track.known[j] || track.cutAfter[i]) return { x: track.xs[i], y: track.ys[i] };
  const u = f - i;
  return { x: track.xs[i] + (track.xs[j] - track.xs[i]) * u, y: track.ys[i] + (track.ys[j] - track.ys[i]) * u };
}

export interface Ring {
  /** Index of the click in track.clicks. */
  click: number;
  button: MouseButton;
  x: number; // source fractions
  y: number;
  /** Radius, fraction of canvas height. */
  r: number;
  alpha: number;
}

const easeOut = (p: number) => 1 - (1 - p) ** 3;

/** Click rings visible at source time `t`. */
export function ringsAt(track: PointerTrack, t: number, style: PointerStyle): Ring[] {
  if (!style.clicks) return [];
  const out: Ring[] = [];
  const d = Math.max(0.1, style.ringDuration);
  // Clicks are sorted; walk back from the latest one that has started.
  let lo = 0;
  let hi = track.clicks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (track.clicks[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo - 1; i >= 0; i--) {
    const c = track.clicks[i];
    const p = (t - c.t) / d;
    if (p >= 1) break;
    const k = 0.6 + 0.4 * style.intensity;
    out.push({
      click: i,
      button: c.button,
      x: c.x,
      y: c.y,
      r: style.ringSize * k * (0.35 + 0.65 * easeOut(p)),
      alpha: Math.min(1, style.intensity) * (1 - p) * (1 - p),
    });
  }
  return out;
}

// --- Canvas placement ----------------------------------------------------------

export interface PointerScene {
  /** Canvas fractions; null = not visible. */
  cursor: { x: number; y: number } | null;
  rings: (Ring & { cx: number; cy: number })[];
}

export class PointerCache {
  private tracks = new Map<string, { events: InteractionEvent[]; smoothing: number; track: PointerTrack }>();

  track(src: MediaSource | undefined, smoothing: number): PointerTrack | null {
    const events = recordingEvents(src);
    if (!events || !src) return null;
    const hit = this.tracks.get(src.id);
    if (hit && hit.events === events && hit.smoothing === smoothing) return hit.track;
    const track = buildPointerTrack(events, smoothing);
    this.tracks.set(src.id, { events, smoothing, track });
    return track;
  }
}

/** Maps a source-frame point to canvas fractions through the clip's crop,
 * camera window, fit box, position and rotation - the same geometry the
 * preview's video slot and the export's clip chain use. null = outside
 * the visible picture. */
export function sourceToCanvas(
  p: { x: number; y: number },
  crop: { x: number; y: number; w: number; h: number },
  box: { w: number; h: number },
  transform: { x: number; y: number; rotation: number },
  canvas: { width: number; height: number }
): { x: number; y: number } | null {
  const u = (p.x - crop.x) / crop.w;
  const v = (p.y - crop.y) / crop.h;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  // In canvas pixels, relative to the box center, then rotated.
  const dx = (u - 0.5) * box.w * canvas.width;
  const dy = (v - 0.5) * box.h * canvas.height;
  const a = (transform.rotation * Math.PI) / 180;
  const rx = dx * Math.cos(a) - dy * Math.sin(a);
  const ry = dx * Math.sin(a) + dy * Math.cos(a);
  return { x: transform.x + rx / canvas.width, y: transform.y + ry / canvas.height };
}

/** What to draw at timeline time `t`. During a transition the outgoing
 * clip's pointer is shown until it ends. */
export function pointerScene(
  lay: Layout,
  project: Project,
  sources: Record<string, MediaSource>,
  canvasSize: { width: number; height: number },
  t: number,
  caches: { pointer: PointerCache; camera: CameraCache }
): PointerScene {
  const style = project.pointer;
  const none: PointerScene = { cursor: null, rings: [] };
  if (!style || (!style.cursor && !style.clicks)) return none;
  const loc = locate(lay, t);
  if (!loc) return none;
  const laid = lay.clips[loc.primary.index];
  const clip = laid.clip;
  const src = sources[clip.sourceId];
  const track = caches.pointer.track(src, style.smoothing);
  if (!track || !src) return none;
  const s = sourceTimeAt(laid, Math.min(t, laid.start + laid.duration));
  const box = videoBox(clip, src, canvasSize, project.canvas);
  const cam = caches.camera.track(project.zooms, clip, visibleView(box, clip.transform));
  const crop = cam ? cameraCrop(clip.crop, evalCamera(cam, s)) : clip.crop;
  const place = (p: { x: number; y: number }) => sourceToCanvas(p, crop, box, clip.transform, canvasSize);
  const cursorAllowed = style.cursor && src.recording?.manifest.capture.cursorCaptured === false;
  const pos = cursorAllowed ? pointerAt(track, s) : null;
  const cursor = pos ? place(pos) : null;
  const rings = [];
  // Rings only for normal playback; a freeze or reversed clip has no
  // meaningful "moment of the click".
  if (clip.freeze === null && !clip.reverse) {
    for (const r of ringsAt(track, s, style)) {
      const c = place(r);
      if (c) rings.push({ ...r, cx: c.x, cy: c.y });
    }
  }
  return { cursor, rings };
}
