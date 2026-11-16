import type { ShapeMask } from "./types";

/** Shape masks on clips and layers: circle, rectangle, linear and mirror,
 * with a soft edge and an invert switch. One renderer draws the mask as an
 * image - white where the picture shows - used as the preview's CSS mask
 * and, as the same PNG, by the export (editor.py alphamerge) or baked into
 * an image layer's PNG. So both show the same edge.
 */

export const MASK_LABELS: Record<ShapeMask["shape"], string> = {
  circle: "Circle",
  rect: "Rectangle",
  linear: "Linear",
  mirror: "Mirror",
};

export const DEFAULT_MASK: ShapeMask = { shape: "circle", x: 0.5, y: 0.5, w: 0.6, h: 0.6, rotation: 0, feather: 0.1, invert: false };

/** Longest side of a rendered mask: soft edges don't need more. */
const MASK_PX = 512;

export function maskKey(m: ShapeMask | null | undefined): string {
  return m ? `${m.shape}:${m.x}:${m.y}:${m.w}:${m.h}:${m.rotation}:${m.feather}:${m.invert}:${m.radius ?? 0}` : "";
}

/** Coverage 0..1 of a pixel at (px, py) in a w x h mask. */
export function coverage(m: ShapeMask, px: number, py: number, w: number, h: number): number {
  const a = (-m.rotation * Math.PI) / 180;
  const dx = px - m.x * w;
  const dy = py - m.y * h;
  // Into the mask's own (unrotated) frame.
  const u = dx * Math.cos(a) - dy * Math.sin(a);
  const v = dx * Math.sin(a) + dy * Math.cos(a);
  const hw = (m.w * w) / 2;
  const hh = (m.h * h) / 2;
  let d: number; // signed distance to the edge in pixels, negative inside
  if (m.shape === "circle") {
    const r = Math.hypot(u / Math.max(1, hw), v / Math.max(1, hh));
    d = (r - 1) * Math.min(hw, hh);
  } else if (m.shape === "rect") {
    // Rounded box: the distance to a box shrunk by the radius, minus it.
    const r = Math.max(0, Math.min(1, m.radius ?? 0)) * Math.min(hw, hh);
    const qx = Math.abs(u) - hw + r;
    const qy = Math.abs(v) - hh + r;
    d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  } else if (m.shape === "linear") {
    d = v; // above the line shows
  } else {
    d = Math.abs(v) - hh; // a band of height h
  }
  const band = Math.max(1, m.feather * 0.5 * Math.min(w, h));
  const c = Math.min(1, Math.max(0, 0.5 - d / band));
  return m.invert ? 1 - c : c;
}

/** The mask for a box of the given aspect (width / height). */
export function drawShapeMask(m: ShapeMask, aspect: number): HTMLCanvasElement {
  const w = aspect >= 1 ? MASK_PX : Math.max(1, Math.round(MASK_PX * aspect));
  const h = aspect >= 1 ? Math.max(1, Math.round(MASK_PX / aspect)) : MASK_PX;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(coverage(m, x + 0.5, y + 0.5, w, h) * 255);
      const i = (y * w + x) * 4;
      // Gray in color (the export reads luminance) and alpha (CSS masks).
      img.data[i] = img.data[i + 1] = img.data[i + 2] = img.data[i + 3] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** A video layer's whole mask: its shape mask (if any) inside rounded
 * corners of `radius` (LayerFrame.radius; 0 = square). null when it has
 * neither. One PNG for the preview and the export, like any mask. */
export function layerMask(mask: ShapeMask | null | undefined, radius: number): { key: string; draw: (aspect: number) => HTMLCanvasElement } | null {
  const r = Math.min(1, Math.max(0, radius || 0));
  if (!mask && r <= 0) return null;
  if (r <= 0) return { key: maskKey(mask), draw: (aspect) => drawShapeMask(mask!, aspect) };
  const corners: ShapeMask = { shape: "rect", x: 0.5, y: 0.5, w: 1, h: 1, rotation: 0, feather: 0, invert: false, radius: r };
  if (!mask) return { key: maskKey(corners), draw: (aspect) => drawShapeMask(corners, aspect) };
  return {
    key: `${maskKey(mask)}&${maskKey(corners)}`,
    draw: (aspect) => {
      const canvas = drawShapeMask(mask, aspect);
      const ctx = canvas.getContext("2d")!;
      // Alpha times alpha; the gray (what the export reads) follows it.
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(drawShapeMask(corners, aspect), 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < img.data.length; i += 4) img.data[i] = img.data[i + 1] = img.data[i + 2] = img.data[i + 3];
      ctx.globalCompositeOperation = "source-over";
      ctx.putImageData(img, 0, 0);
      return canvas;
    },
  };
}

export function layerMaskUrl(mask: ShapeMask | null | undefined, radius: number, aspect: number): string | null {
  const m = layerMask(mask, radius);
  if (!m) return null;
  const key = `${m.key}@${aspect.toFixed(3)}`;
  let url = urls.get(key);
  if (!url) {
    url = m.draw(aspect).toDataURL("image/png");
    if (urls.size > 60) urls.delete(urls.keys().next().value!);
    urls.set(key, url);
  }
  return url;
}

export async function layerMaskBlob(mask: ShapeMask | null | undefined, radius: number, aspect: number): Promise<Blob | null> {
  const m = layerMask(mask, radius);
  if (!m) return null;
  const canvas = m.draw(aspect);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not draw the mask"))), "image/png"));
}

const urls = new Map<string, string>();

/** The mask as a data URL, cached - for CSS mask-image. */
export function shapeMaskUrl(m: ShapeMask, aspect: number): string {
  const key = `${maskKey(m)}@${aspect.toFixed(3)}`;
  let url = urls.get(key);
  if (!url) {
    url = drawShapeMask(m, aspect).toDataURL("image/png");
    if (urls.size > 60) urls.delete(urls.keys().next().value!);
    urls.set(key, url);
  }
  return url;
}

export async function shapeMaskBlob(m: ShapeMask, aspect: number): Promise<Blob> {
  const canvas = drawShapeMask(m, aspect);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not draw the mask"))), "image/png"));
}

/** Multiplies the alpha of `canvas` by the mask (stretched over it). For
 * image, text and sticker layers, whose PNG carries the mask itself. */
export function applyShapeMask(canvas: HTMLCanvasElement, m: ShapeMask): void {
  const ctx = canvas.getContext("2d")!;
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(drawShapeMask(m, canvas.width / canvas.height), 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";
}
