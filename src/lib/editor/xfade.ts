/** Transitions whose picture the preview draws per pixel, with the same
 * formulas as ffmpeg's xfade filter that the export uses (libavfilter
 * vf_xfade.c; checked against real renders). Everything is in terms of the
 * preview's progress `p` (0 = outgoing clip, 1 = incoming); xfade's own
 * progress runs the other way (P = 1 - p). */
import type { TransitionType } from "./types.ts";

/** Soft-edged sweeps: how much of the incoming clip shows at each pixel. */
export const SOFT_TRANSITIONS = new Set<TransitionType>([
  "smoothleft",
  "smoothright",
  "smoothup",
  "smoothdown",
  "vertopen",
  "horzopen",
  "radial",
  "diagtl",
  "diagbr",
]);

/** Shape crops: the picture shrinks to a shape over black, then the next
 * clip grows out of it. */
export const CROP_TRANSITIONS = new Set<TransitionType>(["circlecrop", "rectcrop"]);

const smoothstep = (v: number) => {
  const t = Math.min(1, Math.max(0, v));
  return t * t * (3 - 2 * t);
};

/** The incoming clip's opacity at pixel (x, y) of a w×h frame, for a soft
 * transition (SOFT_TRANSITIONS); 0 for any other type. */
export function softAlpha(type: TransitionType, x: number, y: number, w: number, h: number, p: number): number {
  const P = 1 - p;
  const fx = x / w;
  const fy = y / h;
  switch (type) {
    case "smoothleft":
      return smoothstep(1 + fx - 2 * P);
    case "smoothright":
      return smoothstep(1 + (w - 1 - x) / w - 2 * P);
    case "smoothup":
      return smoothstep(1 + fy - 2 * P);
    case "smoothdown":
      return smoothstep(1 + (h - 1 - y) / h - 2 * P);
    case "vertopen":
      return smoothstep(2 - Math.abs((x - w / 2) / (w / 2)) - 2 * P);
    case "horzopen":
      return smoothstep(2 - Math.abs((y - h / 2) / (h / 2)) - 2 * P);
    case "radial":
      return smoothstep(Math.atan2(x - w / 2, y - h / 2) - (P - 0.5) * Math.PI * 2.5);
    case "diagtl":
      return smoothstep(1 + fx * fy - 2 * P);
    case "diagbr":
      return smoothstep(1 + ((w - 1 - x) / w) * ((h - 1 - y) / h) - 2 * P);
    default:
      return 0;
  }
}

/** A crop transition at `p`: which clip shows (the outgoing one for the
 * first half) and whether pixel (x, y) is inside the shape (else black). */
export function cropInside(type: TransitionType, x: number, y: number, w: number, h: number, p: number): boolean {
  const k = Math.abs(1 - p - 0.5);
  if (type === "circlecrop") return Math.hypot(x - w / 2, y - h / 2) <= (2 * k) ** 3 * Math.hypot(w / 2, h / 2);
  return Math.abs(x - w / 2) <= k * w && Math.abs(y - h / 2) <= k * h;
}

/** Width of the preview's mask images; height follows the frame's shape.
 * Fine enough for soft edges, scaled up smoothly. */
export const MASK_WIDTH = 128;

/** The mask for a soft or crop transition at `p` as RGBA pixels (alpha =
 * what shows of the clip it's applied to), `mw`×`mh`. */
export function maskPixels(type: TransitionType, p: number, mw: number, mh: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(mw * mh * 4);
  const crop = CROP_TRANSITIONS.has(type);
  for (let j = 0; j < mh; j++) {
    for (let i = 0; i < mw; i++) {
      // Pixel centers, in a frame of the mask's size.
      const a = crop ? (cropInside(type, i + 0.5, j + 0.5, mw, mh, p) ? 1 : 0) : softAlpha(type, i + 0.5, j + 0.5, mw, mh, p);
      px[(j * mw + i) * 4 + 3] = Math.round(a * 255);
    }
  }
  return px;
}
