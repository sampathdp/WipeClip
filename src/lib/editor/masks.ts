/** Privacy masks: where each mask is on the canvas at a given time.
 * Pure and shared by the preview (PreviewPlayer draws them) and the export
 * (exportProject sends these rectangles; the backend blurs, pixelates or
 * fills exactly them) - see tests/desktop/tutorial.test.ts.
 *
 * A "video" mask is anchored to its source's frame, so it moves and scales
 * with the clip's crop, position and focus zoom; a "canvas" mask stays
 * put. "pointer" masks are centered on the recorded pointer. Rotated clips
 * get the mask's axis-aligned bounding box (it covers at least the area).
 */
import { CameraCache, cameraCrop, evalCamera, visibleView } from "./camera.ts";
import { PointerCache, pointerAt } from "./pointer.ts";
import { locate, sourceTimeAt, videoBox, type Layout } from "./timeline.ts";
import type { MediaSource, PrivacyMask, Project } from "./types.ts";

export interface CanvasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MaskCaches {
  camera: CameraCache;
  pointer: PointerCache;
}

const clampRect = (r: CanvasRect): CanvasRect | null => {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(1, r.x + r.w);
  const y1 = Math.min(1, r.y + r.h);
  return x1 - x0 > 1e-4 && y1 - y0 > 1e-4 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};

export function maskActive(m: PrivacyMask, t: number): boolean {
  return m.enabled && t >= m.start && t < m.end;
}

/** The mask's rectangle on the canvas at timeline time `t` (fractions),
 * or null when it isn't showing. */
export function maskRect(
  m: PrivacyMask,
  t: number,
  lay: Layout,
  project: Project,
  sources: Record<string, MediaSource>,
  canvas: { width: number; height: number },
  caches: MaskCaches
): CanvasRect | null {
  if (!maskActive(m, t)) return null;
  const loc = locate(lay, t);
  const laid = loc ? lay.clips[loc.primary.index] : undefined;
  const src = laid ? sources[laid.clip.sourceId] : undefined;

  // Geometry of the clip on screen right now.
  const place = () => {
    if (!laid || !src) return null;
    const clip = laid.clip;
    const s = sourceTimeAt(laid, Math.min(t, laid.start + laid.duration));
    const box = videoBox(clip, src, canvas, project.canvas);
    const cam = caches.camera.track(project.zooms, clip, visibleView(box, clip.transform));
    const crop = cam ? cameraCrop(clip.crop, evalCamera(cam, s)) : clip.crop;
    return { clip, s, crop, box };
  };
  const toCanvas = (g: NonNullable<ReturnType<typeof place>>, px: number, py: number) => {
    const u = (px - g.crop.x) / g.crop.w;
    const v = (py - g.crop.y) / g.crop.h;
    const dx = (u - 0.5) * g.box.w * canvas.width;
    const dy = (v - 0.5) * g.box.h * canvas.height;
    const a = (g.clip.transform.rotation * Math.PI) / 180;
    return {
      x: g.clip.transform.x + (dx * Math.cos(a) - dy * Math.sin(a)) / canvas.width,
      y: g.clip.transform.y + (dx * Math.sin(a) + dy * Math.cos(a)) / canvas.height,
    };
  };

  if (m.space === "canvas") {
    let { x, y } = m;
    if (m.follow === "pointer") {
      const g = place();
      const track = g ? caches.pointer.track(src, 0) : null;
      const p = g && track ? pointerAt(track, g.s) : null;
      if (!g || !p) return null; // nothing to follow here
      const c = toCanvas(g, p.x, p.y);
      x = c.x - m.w / 2;
      y = c.y - m.h / 2;
    }
    return clampRect({ x, y, w: m.w, h: m.h });
  }

  // Video space: only while its source is on screen.
  const g = place();
  if (!g || g.clip.sourceId !== m.sourceId) return null;
  let { x, y } = m;
  if (m.follow === "pointer") {
    const track = caches.pointer.track(src, 0);
    const p = track ? pointerAt(track, g.s) : null;
    if (!p) return null;
    x = p.x - m.w / 2;
    y = p.y - m.h / 2;
  }
  const corners = [
    toCanvas(g, x, y),
    toCanvas(g, x + m.w, y),
    toCanvas(g, x, y + m.h),
    toCanvas(g, x + m.w, y + m.h),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  // Also clip to the visible picture box (outside it the video isn't shown).
  const bx0 = g.clip.transform.x - g.box.w / 2;
  const by0 = g.clip.transform.y - g.box.h / 2;
  const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  const rot = g.clip.transform.rotation % 360 !== 0;
  if (!rot) {
    const x0 = Math.max(r.x, bx0);
    const y0 = Math.max(r.y, by0);
    const x1 = Math.min(r.x + r.w, bx0 + g.box.w);
    const y1 = Math.min(r.y + r.h, by0 + g.box.h);
    if (x1 <= x0 || y1 <= y0) return null;
    return clampRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return clampRect(r);
}

/** Export rows per mask: [t, x, y, w, h] at output frames where the
 * rectangle changes (w = 0 hides it), timeline time. */
export function maskRows(
  m: PrivacyMask,
  lay: Layout,
  project: Project,
  sources: Record<string, MediaSource>,
  canvas: { width: number; height: number },
  caches: MaskCaches = { camera: new CameraCache(), pointer: new PointerCache() }
): number[][] {
  const fps = lay.fps;
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  const rows: number[][] = [];
  let last = "";
  const f0 = Math.max(0, Math.floor(m.start * fps));
  const f1 = Math.min(Math.round(lay.total * fps), Math.ceil(m.end * fps));
  for (let f = f0; f < f1; f++) {
    const t = f / fps;
    const r = maskRect(m, t, lay, project, sources, canvas, caches);
    const row = r ? [r4(t), r4(r.x), r4(r.y), r4(r.w), r4(r.h)] : [r4(t), 0, 0, 0, 0];
    const key = row.slice(1).join(",");
    if (key !== last) {
      rows.push(row);
      last = key;
    }
  }
  return rows;
}
