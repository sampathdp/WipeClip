/** A video layer's frame: rounded corners, a border and a drop shadow.
 *
 * The corners are part of the layer's mask (shapeMask.ts layerMask). The
 * border and the shadow are two pictures drawn here - the shadow goes under
 * the video, the border over it - and the preview shows the very PNGs the
 * export composites (editor.py _overlay_filters), so both look the same.
 * Every size is relative to the layer's box, so the frame scales, turns and
 * fades with the layer.
 *
 * The shadow needs room around the box: its picture is larger than the box
 * by FRAME_PAD of the box's short side on every side.
 */
import type { LayerFrame } from "./types";

export const DEFAULT_FRAME: LayerFrame = { radius: 0, border: 0, borderColor: "#ffffff", shadow: 0 };

/** Room around the box for the shadow, as a share of the box's short side.
 * The export gets the same number (exportProject.ts). */
export const FRAME_PAD = 0.2;
export const MAX_BORDER = 0.1;

/** Long side of the box in the drawn pictures. */
const FRAME_PX = 1024;

export function frameActive(f: LayerFrame | undefined | null): f is LayerFrame {
  return !!f && (f.radius > 0 || f.border > 0 || f.shadow > 0);
}

/** A frame with nothing set is no frame. */
export function cleanFrame(f: LayerFrame): LayerFrame | undefined {
  return frameActive(f) ? f : undefined;
}

function boxSize(aspect: number): { w: number; h: number; short: number } {
  const a = aspect > 0 ? aspect : 1;
  const w = a >= 1 ? FRAME_PX : Math.max(2, Math.round(FRAME_PX * a));
  const h = a >= 1 ? Math.max(2, Math.round(FRAME_PX / a)) : FRAME_PX;
  return { w, h, short: Math.min(w, h) };
}

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** The border: a line just inside the box's edge, following its corners.
 * The size of the box; null when there's no border. */
export function drawFrameOver(f: LayerFrame, aspect: number): HTMLCanvasElement | null {
  if (!(f.border > 0)) return null;
  const { w, h, short } = boxSize(aspect);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const lw = Math.min(MAX_BORDER, f.border) * short;
  const radius = (Math.min(1, Math.max(0, f.radius)) * short) / 2;
  ctx.strokeStyle = f.borderColor;
  ctx.lineWidth = lw;
  roundedPath(ctx, lw / 2, lw / 2, w - lw, h - lw, Math.max(0, radius - lw / 2));
  ctx.stroke();
  return canvas;
}

/** The shadow: soft, a little below the box, and cut out where the box is
 * (so it never darkens a see-through layer). Larger than the box by the
 * pad on every side; null when there's no shadow. */
export function drawFrameUnder(f: LayerFrame, aspect: number): HTMLCanvasElement | null {
  if (!(f.shadow > 0)) return null;
  const { w, h, short } = boxSize(aspect);
  const pad = Math.round(FRAME_PAD * short);
  const canvas = document.createElement("canvas");
  canvas.width = w + 2 * pad;
  canvas.height = h + 2 * pad;
  const ctx = canvas.getContext("2d")!;
  const radius = (Math.min(1, Math.max(0, f.radius)) * short) / 2;
  // Only the shadow is wanted: the shape itself is drawn far off the
  // picture, its shadow offset back onto it.
  const far = canvas.width * 4;
  ctx.shadowColor = `rgba(0,0,0,${0.7 * Math.min(1, f.shadow)})`;
  ctx.shadowBlur = 0.1 * short;
  ctx.shadowOffsetX = far;
  ctx.shadowOffsetY = 0.03 * short;
  ctx.fillStyle = "#000";
  roundedPath(ctx, pad - far, pad, w, h, radius);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.globalCompositeOperation = "destination-out";
  roundedPath(ctx, pad, pad, w, h, radius);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  return canvas;
}

const key = (f: LayerFrame, aspect: number) => `${f.radius}:${f.border}:${f.borderColor}:${f.shadow}@${aspect.toFixed(3)}`;
const cache = new Map<string, { under: string | null; over: string | null }>();

/** The frame's pictures as data URLs, cached - for the preview. */
export function frameUrls(f: LayerFrame, aspect: number): { under: string | null; over: string | null } {
  const k = key(f, aspect);
  let hit = cache.get(k);
  if (!hit) {
    hit = { under: drawFrameUnder(f, aspect)?.toDataURL("image/png") ?? null, over: drawFrameOver(f, aspect)?.toDataURL("image/png") ?? null };
    if (cache.size > 40) cache.delete(cache.keys().next().value!);
    cache.set(k, hit);
  }
  return hit;
}

const toBlob = (canvas: HTMLCanvasElement | null): Promise<Blob | null> =>
  canvas ? new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not draw the layer's frame"))), "image/png")) : Promise.resolve(null);

/** The same pictures as PNGs, for the export. */
export async function frameBlobs(f: LayerFrame, aspect: number): Promise<{ under: Blob | null; over: Blob | null }> {
  return { under: await toBlob(drawFrameUnder(f, aspect)), over: await toBlob(drawFrameOver(f, aspect)) };
}
