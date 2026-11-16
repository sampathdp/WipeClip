/** Where layers sit on the canvas, and the tools that move them: boxes,
 * alignment, distribution, equal sizes, snapping, corner placement, fitting
 * a picture into a rectangle, and cropping a video layer by its edges.
 *
 * A layer's box is its centre (x, y), width (fraction of the canvas width)
 * and height (fraction of the canvas height), turned by `rotation` around
 * the centre. A video layer's height follows its picture's proportions as
 * cropped, or its `aspect` when stretched (the export sizes it by the same
 * rule, editor.py _overlay_filters).
 *
 * Pure - see tests/desktop/layerGeometry.test.ts.
 */
import { animateOverlayPatch, overlayValues } from "./keyframes.ts";
import type { Crop, Overlay } from "./types.ts";

export type VideoLayer = Extract<Overlay, { kind: "video" }>;

export interface Size {
  width: number;
  height: number;
}

export interface LayerRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

/** Edges of an upright rectangle, fractions of the canvas. */
export interface Bounds {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** A rectangle by its left/top corner, fractions of the canvas. */
export interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

const WHOLE: Crop = { x: 0, y: 0, w: 1, h: 1 };
export const CANVAS_BOUNDS: Bounds = { l: 0, t: 0, r: 1, b: 1 };
/** Smallest part of a video's frame a crop can leave (the export's limit). */
export const MIN_CROP = 0.05;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function layerCrop(o: Overlay): Crop {
  return o.kind === "video" && o.crop ? o.crop : WHOLE;
}

export const isCropped = (c: Crop) => c.x > 1e-6 || c.y > 1e-6 || c.w < 1 - 1e-6 || c.h < 1 - 1e-6;

/** A layer's box proportions (width / height) in canvas pixels. `natural`
 * is its picture's size: the raster, or the video's frame. */
export function layerAspect(o: Overlay, natural: Size): number {
  const n = natural.width > 0 && natural.height > 0 ? natural.width / natural.height : 1;
  if (o.kind !== "video") return n;
  if (o.aspect && o.aspect > 0) return o.aspect;
  const c = layerCrop(o);
  return (n * c.w) / c.h;
}

/** The layer's box at timeline time `t`. `width` is its base width as a
 * fraction of the canvas width (text sizes itself: textRaster.ts overlayWidth). */
export function layerRect(o: Overlay, width: number, natural: Size, canvas: Size, t: number): LayerRect {
  const v = overlayValues(o, t);
  const w = width * v.scale;
  return { id: o.id, x: v.x, y: v.y, w, h: (w * canvas.width) / (layerAspect(o, natural) * canvas.height), rotation: v.rotation };
}

/** Half the size of the upright rectangle around a turned box. */
function extents(r: LayerRect, canvas: Size): { ex: number; ey: number } {
  const a = (r.rotation * Math.PI) / 180;
  const hw = (r.w * canvas.width) / 2;
  const hh = (r.h * canvas.height) / 2;
  return {
    ex: (Math.abs(hw * Math.cos(a)) + Math.abs(hh * Math.sin(a))) / canvas.width,
    ey: (Math.abs(hw * Math.sin(a)) + Math.abs(hh * Math.cos(a))) / canvas.height,
  };
}

export function rectBounds(r: LayerRect, canvas: Size): Bounds {
  const { ex, ey } = extents(r, canvas);
  return { l: r.x - ex, t: r.y - ey, r: r.x + ex, b: r.y + ey };
}

export function unionBounds(all: Bounds[]): Bounds {
  return { l: Math.min(...all.map((b) => b.l)), t: Math.min(...all.map((b) => b.t)), r: Math.max(...all.map((b) => b.r)), b: Math.max(...all.map((b) => b.b)) };
}

export type Move = Map<string, { x: number; y: number }>;

export type AlignOp = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** New centres for `rects`, aligned to the canvas (one layer, or `toCanvas`)
 * or to the rectangle around all of them. */
export function alignRects(rects: LayerRect[], op: AlignOp, canvas: Size, toCanvas = rects.length < 2): Move {
  const out: Move = new Map();
  if (!rects.length) return out;
  const each = rects.map((r) => ({ r, b: rectBounds(r, canvas) }));
  const to = toCanvas ? CANVAS_BOUNDS : unionBounds(each.map((e) => e.b));
  for (const { r, b } of each) {
    let { x, y } = r;
    if (op === "left") x += to.l - b.l;
    else if (op === "right") x += to.r - b.r;
    else if (op === "hcenter") x += (to.l + to.r) / 2 - (b.l + b.r) / 2;
    else if (op === "top") y += to.t - b.t;
    else if (op === "bottom") y += to.b - b.b;
    else y += (to.t + to.b) / 2 - (b.t + b.b) / 2;
    out.set(r.id, { x: r6(x), y: r6(y) });
  }
  return out;
}

/** Three or more layers spread along an axis, the outer two staying put:
 * "centers" spaces their centres evenly, "gaps" the space between them. */
export function distributeRects(rects: LayerRect[], axis: "h" | "v", mode: "centers" | "gaps", canvas: Size): Move {
  const out: Move = new Map();
  if (rects.length < 3) return out;
  const items = rects
    .map((r) => {
      const b = rectBounds(r, canvas);
      return axis === "h" ? { r, lo: b.l, hi: b.r, c: r.x } : { r, lo: b.t, hi: b.b, c: r.y };
    })
    .sort((a, b) => a.c - b.c);
  const first = items[0];
  const last = items[items.length - 1];
  const n = items.length;
  let cursor = first.hi;
  const gap = (last.lo - first.hi - items.slice(1, -1).reduce((s, i) => s + (i.hi - i.lo), 0)) / (n - 1);
  items.forEach((it, i) => {
    let c = it.c;
    if (i > 0 && i < n - 1) {
      if (mode === "centers") c = first.c + ((last.c - first.c) * i) / (n - 1);
      else {
        c = cursor + gap + (it.hi - it.lo) / 2;
        cursor += gap + (it.hi - it.lo);
      }
    }
    out.set(it.r.id, axis === "h" ? { x: r6(c), y: it.r.y } : { x: it.r.x, y: r6(c) });
  });
  return out;
}

/** How much each layer's size is multiplied by to match the `key` layer's
 * width or height (proportions kept). */
export function equalSize(rects: LayerRect[], dim: "width" | "height", keyId?: string): Map<string, number> {
  const out = new Map<string, number>();
  const key = rects.find((r) => r.id === keyId) ?? rects[0];
  if (!key) return out;
  for (const r of rects) {
    const f = dim === "width" ? key.w / Math.max(1e-6, r.w) : key.h / Math.max(1e-6, r.h);
    out.set(r.id, r6(f));
  }
  return out;
}

/** The patch that multiplies a layer's size on screen by `factor` at `t`
 * (a text layer's size is its font size). */
export function sizePatch(o: Overlay, factor: number, t: number): Partial<Overlay> {
  const s = overlayValues(o, t).scale * factor;
  if (o.kind === "text") return { text: { ...o.text, size: clamp(o.text.size * s, 0.015, 0.5) } } as Partial<Overlay>;
  return { width: clamp(o.width * s, 0.03, 3) };
}

/** Size factor and centre that fit a layer's box inside the canvas. */
export function fitToCanvas(r: LayerRect, canvas: Size): { factor: number; x: number; y: number } {
  const { ex, ey } = extents(r, canvas);
  return { factor: r6(0.5 / Math.max(ex, ey, 1e-6)), x: 0.5, y: 0.5 };
}

// --- snapping -----------------------------------------------------------------

export interface Snap {
  /** How far to move to land on the lines. */
  dx: number;
  dy: number;
  /** The lines landed on (fractions of the canvas), to draw as guides. */
  x: number[];
  y: number[];
}

function snapAxis(points: number[], lines: number[], threshold: number): { d: number; lines: number[] } {
  let best: number | null = null;
  for (const p of points) {
    for (const l of lines) {
      const d = l - p;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  if (best === null) return { d: 0, lines: [] };
  const d = best;
  const hit = lines.filter((l) => points.some((p) => Math.abs(p + d - l) < 1e-6));
  return { d, lines: [...new Set(hit.map(r6))] };
}

/** Pulls a moving rectangle's edges and centre onto the edges and centres
 * of `targets` (the canvas and the other layers) within `threshold`
 * (fractions of the canvas width and height). */
export function snapBounds(moving: Bounds, targets: Bounds[], threshold: { x: number; y: number }): Snap {
  const xs = targets.flatMap((b) => [b.l, (b.l + b.r) / 2, b.r]);
  const ys = targets.flatMap((b) => [b.t, (b.t + b.b) / 2, b.b]);
  const sx = snapAxis([moving.l, (moving.l + moving.r) / 2, moving.r], xs, threshold.x);
  const sy = snapAxis([moving.t, (moving.t + moving.b) / 2, moving.b], ys, threshold.y);
  return { dx: sx.d, dy: sy.d, x: sx.lines, y: sy.lines };
}

// --- placement ----------------------------------------------------------------

export type Corner = "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";

export const CORNER_LABELS: Record<Corner, string> = {
  "top-left": "Top left",
  top: "Top",
  "top-right": "Top right",
  left: "Left",
  center: "Center",
  right: "Right",
  "bottom-left": "Bottom left",
  bottom: "Bottom",
  "bottom-right": "Bottom right",
};

/** Margin to the canvas edge for corner placement, fraction of its short side. */
export const CORNER_MARGIN = 0.04;

/** The centre that puts a box in a corner, on an edge or in the middle. */
export function cornerPosition(r: LayerRect, canvas: Size, corner: Corner, margin = CORNER_MARGIN): { x: number; y: number } {
  const { ex, ey } = extents(r, canvas);
  const short = Math.min(canvas.width, canvas.height);
  const mx = (margin * short) / canvas.width;
  const my = (margin * short) / canvas.height;
  const x = corner.endsWith("left") ? mx + ex : corner.endsWith("right") ? 1 - mx - ex : 0.5;
  const y = corner.startsWith("top") ? my + ey : corner.startsWith("bottom") ? 1 - my - ey : 0.5;
  return { x: r6(x), y: r6(y) };
}

/** The centred part of a picture of proportions `srcAr` that has proportions `ar`. */
export function centerCrop(srcAr: number, ar: number): Crop {
  if (!(srcAr > 0) || !(ar > 0)) return WHOLE;
  if (srcAr > ar) {
    const w = Math.max(MIN_CROP, r6(ar / srcAr));
    return { x: r6((1 - w) / 2), y: 0, w, h: 1 };
  }
  const h = Math.max(MIN_CROP, r6(srcAr / ar));
  return { x: 0, y: r6((1 - h) / 2), w: 1, h };
}

export type CellFit = "fill" | "fit" | "stretch";

export interface CellPlacement {
  x: number;
  y: number;
  width: number;
  crop?: Crop;
  aspect?: number;
}

/** A video layer placed in a rectangle of the canvas: "fill" crops it to
 * the rectangle's shape (from its whole frame), "fit" shows all of what
 * `crop` keeps inside it, "stretch" pulls that to the rectangle's shape. */
export function placeInCell(natural: Size, crop: Crop | undefined, cell: Cell, canvas: Size, fit: CellFit): CellPlacement {
  const n = natural.width > 0 && natural.height > 0 ? natural.width / natural.height : 16 / 9;
  const cellAr = (cell.w * canvas.width) / (cell.h * canvas.height);
  const centre = { x: r6(cell.x + cell.w / 2), y: r6(cell.y + cell.h / 2) };
  if (fit === "fill") {
    const c = centerCrop(n, cellAr);
    return { ...centre, width: r6(cell.w), crop: isCropped(c) ? c : undefined };
  }
  if (fit === "stretch") return { ...centre, width: r6(cell.w), crop, aspect: r6(cellAr) };
  const c = crop ?? WHOLE;
  const a = (n * c.w) / c.h;
  return { ...centre, width: r6(a > cellAr ? cell.w : (cell.w * a) / cellAr), crop };
}

// --- cropping a video layer ------------------------------------------------------

/** The layer with `next` as its crop, the picture staying the size and in
 * the place it is on screen: the box shrinks or grows around what's kept.
 * The base width changes (so an animated layer's every keyframe follows),
 * and the centre moves with the kept part. Not a keyframe: a crop is the
 * same over the whole layer. */
export function applyCrop(o: VideoLayer, natural: Size, canvas: Size, next: Crop, t: number): Partial<VideoLayer> {
  const c = layerCrop(o);
  const n: Crop = {
    // 0.9: the furthest the export lets a crop start (main.py _EditorCrop).
    x: clamp(next.x, 0, 0.9),
    y: clamp(next.y, 0, 0.9),
    w: clamp(next.w, MIN_CROP, 1),
    h: clamp(next.h, MIN_CROP, 1),
  };
  n.w = Math.min(n.w, 1 - n.x);
  n.h = Math.min(n.h, 1 - n.y);
  const v = overlayValues(o, t);
  const box = layerRect(o, o.width, natural, canvas, t);
  // The whole picture's size on screen, fractions of the canvas.
  const pw = box.w / c.w;
  const ph = box.h / c.h;
  // How far the kept part's centre moved, along the layer's own axes, in pixels.
  const du = (n.x + n.w / 2 - (c.x + c.w / 2)) * pw * canvas.width;
  const dv = (n.y + n.h / 2 - (c.y + c.h / 2)) * ph * canvas.height;
  const a = (v.rotation * Math.PI) / 180;
  const dx = (du * Math.cos(a) - dv * Math.sin(a)) / canvas.width;
  const dy = (du * Math.sin(a) + dv * Math.cos(a)) / canvas.height;
  const fw = n.w / c.w;
  const fh = n.h / c.h;
  const round: Crop = { x: r6(n.x), y: r6(n.y), w: r6(n.w), h: r6(n.h) };
  return {
    crop: isCropped(round) ? round : undefined,
    width: r6(o.width * fw),
    ...(o.aspect ? { aspect: r6((o.aspect * fw) / fh) } : {}),
    ...(o.keyframes?.length ? { keyframes: o.keyframes.map((k) => ({ ...k, x: r6(k.x + dx), y: r6(k.y + dy) })) } : { x: r6(o.x + dx), y: r6(o.y + dy) }),
  };
}

export type Edge = "left" | "right" | "top" | "bottom";

/** One edge of a video layer dragged outward by `delta` along the layer's
 * own axis (a fraction of the canvas width for left/right, of its height
 * for top/bottom; negative = inward): crops the picture, or gives back
 * what was cropped, up to the frame's edge. */
export function cropEdge(o: VideoLayer, natural: Size, canvas: Size, edge: Edge, delta: number, t: number): Partial<VideoLayer> {
  const c = layerCrop(o);
  const box = layerRect(o, o.width, natural, canvas, t);
  const next = { ...c };
  if (edge === "left" || edge === "right") {
    const d = (delta / Math.max(1e-6, box.w)) * c.w;
    if (edge === "right") next.w = clamp(c.w + d, MIN_CROP, 1 - c.x);
    else {
      next.x = clamp(c.x - d, 0, c.x + c.w - MIN_CROP);
      next.w = c.w + (c.x - next.x);
    }
  } else {
    const d = (delta / Math.max(1e-6, box.h)) * c.h;
    if (edge === "bottom") next.h = clamp(c.h + d, MIN_CROP, 1 - c.y);
    else {
      next.y = clamp(c.y - d, 0, c.y + c.h - MIN_CROP);
      next.h = c.h + (c.y - next.y);
    }
  }
  return applyCrop(o, natural, canvas, next, t);
}

/** A video layer over the whole canvas: all of it showing ("fit"), cropped
 * to cover it ("fill") or pulled to its shape ("stretch"). Position and
 * size go through the layer's animation (a keyframe at `t` when it has one). */
export function frameLayer(o: VideoLayer, natural: Size, canvas: Size, fit: CellFit, t: number): VideoLayer {
  const p = placeInCell(natural, fit === "fill" ? undefined : o.crop, { x: 0, y: 0, w: 1, h: 1 }, canvas, fit);
  const base: VideoLayer = { ...o, crop: p.crop, aspect: p.aspect, camLayout: undefined, slot: undefined, mask: o.camLayout ? null : o.mask };
  return { ...base, ...animateOverlayPatch(base, { x: p.x, y: p.y, width: p.width, rotation: 0 }, t) } as VideoLayer;
}

/** A layer back to the middle at its default size: no rotation, crop,
 * stretch or transparency. Its animation, if any, gets these at `t`. */
export function resetTransform(o: Overlay, natural: Size, canvas: Size, t: number): Overlay {
  if (o.kind === "text") return { ...o, ...animateOverlayPatch(o, { x: 0.5, y: 0.5, rotation: 0, opacity: 1 }, t) } as Overlay;
  const base = o.kind === "video" ? ({ ...o, crop: undefined, aspect: undefined, camLayout: undefined, slot: undefined, mask: o.camLayout ? null : o.mask } as Overlay) : o;
  const n = natural.width > 0 && natural.height > 0 ? natural.width / natural.height : 1;
  const canvasAr = canvas.width / canvas.height;
  // 40% of the canvas on the picture's long side, as a new layer is added.
  const width = n > canvasAr ? 0.4 : (0.4 * n) / canvasAr;
  return { ...base, ...animateOverlayPatch(base, { x: 0.5, y: 0.5, rotation: 0, opacity: 1, width: r6(width) }, t) } as Overlay;
}
