/** Webcam layouts: a circle, rounded or square-cornered bubble in a corner,
 * or side by side with the screen. Pure geometry on the existing layer
 * model - a video layer's position and width plus a shape mask - so the
 * preview and the export already draw it the same way (the mask is one PNG
 * for both, shapeMask.ts). The preset is kept on the layer (camLayout) and
 * placed again when the canvas size changes.
 *
 * Sizes are fractions of the canvas's short side, so a medium bubble looks
 * the same in a landscape, square or vertical video.
 * Pure - see tests/desktop/audio.test.ts.
 */
import type { CamLayout, Clip, MediaSource, Overlay, Project, ShapeMask } from "./types.ts";
import { maskKey } from "./shapeMask.ts";

export const CAM_SIZES: Record<CamLayout["size"], number> = { small: 0.22, medium: 0.3, large: 0.4 };
export const CAM_SHAPE_LABELS: Record<CamLayout["shape"], string> = { circle: "Circle", rounded: "Rounded", rect: "Rectangle" };
export const CAM_CORNER_LABELS: Record<CamLayout["corner"], string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
};
export const DEFAULT_CAM_LAYOUT: CamLayout = { shape: "circle", size: "medium", corner: "bottom-right" };

/** Margin to the canvas edge, fraction of the short side. */
const MARGIN = 0.04;
/** Rounded corners: radius as a share of half the short side. */
const ROUNDED = 0.35;
/** Anti-aliased edge (shapeMask feather) - a crisp but smooth outline. */
const EDGE = 0.02;
/** Split: the webcam's share of a landscape canvas's width. */
const SPLIT_SHARE = 1 / 3;

export interface CamPlacement {
  /** Layer centre and width (fractions of the canvas), and its mask. */
  x: number;
  y: number;
  width: number;
  mask: ShapeMask | null;
  /** Split layouts move the screen clips too (centre and scale of their
   * box); null leaves the clips alone. */
  screen: { x: number; y: number; scale: number } | null;
}

/** Where a webcam of aspect `camAspect` goes on a canvas of aspect
 * `canvasAspect` (width / height). `screenAspect` is the main video's,
 * used by the portrait split. Works in units of the canvas height. */
export function placeWebcam(l: CamLayout, canvasAspect: number, camAspect: number, screenAspect = canvasAspect): CamPlacement {
  const W = canvasAspect > 0 ? canvasAspect : 16 / 9;
  const cam = camAspect > 0 ? camAspect : 16 / 9;
  const short = Math.min(W, 1);
  if (l.split) return W >= 1 ? splitSide(W, cam) : splitStacked(W, cam, screenAspect > 0 ? screenAspect : 16 / 9);

  const d = CAM_SIZES[l.size] * short; // visible height (circle: diameter)
  // The layer box is the whole camera frame (centred on the visible part);
  // the mask shows part of it.
  let boxW: number;
  let visW: number;
  let mask: ShapeMask | null;
  if (l.shape === "circle") {
    // A centred square of the frame, as a true circle on any canvas.
    boxW = cam >= 1 ? d * cam : d;
    mask = cam >= 1 ? circle(1 / cam, 1) : circle(1, cam);
    visW = d;
  } else {
    boxW = d * cam;
    visW = boxW;
    mask = l.shape === "rounded" ? { shape: "rect", x: 0.5, y: 0.5, w: 1, h: 1, rotation: 0, feather: EDGE, invert: false, radius: ROUNDED } : null;
  }
  const visH = d;
  const m = MARGIN * short;
  const left = l.corner.endsWith("left");
  const top = l.corner.startsWith("top");
  const cx = left ? m + visW / 2 : W - m - visW / 2;
  const cy = top ? m + visH / 2 : 1 - m - visH / 2;
  return { x: cx / W, y: cy, width: boxW / W, mask, screen: null };
}

function circle(w: number, h: number): ShapeMask {
  return { shape: "circle", x: 0.5, y: 0.5, w, h, rotation: 0, feather: EDGE, invert: false };
}

/** Landscape: screen in the left two thirds, the webcam filling the right
 * third (centre of its frame, cut to fit). */
function splitSide(W: number, cam: number): CamPlacement {
  const slot = W * SPLIT_SHARE;
  // Cover the slot: as tall as the canvas, or wider if the camera is narrow.
  let boxW = cam;
  let boxH = 1;
  if (boxW < slot) {
    boxW = slot;
    boxH = slot / cam;
  }
  const mask: ShapeMask = { shape: "rect", x: 0.5, y: 0.5, w: slot / boxW, h: 1 / boxH, rotation: 0, feather: 0, invert: false };
  const screenW = W - slot;
  return { x: (W - slot / 2) / W, y: 0.5, width: boxW / W, mask, screen: { x: screenW / 2 / W, y: 0.5, scale: screenW / W } };
}

/** Portrait: the screen across the top at full width, the webcam filling
 * the rest below it. */
function splitStacked(W: number, cam: number, screenAspect: number): CamPlacement {
  // The screen fitted to the width; at least 35% of the height is left
  // for the webcam (a squarer screen is scaled down to make room).
  let screenH = W / screenAspect;
  let scale = 1;
  if (screenH > 0.65) {
    scale = 0.65 / screenH;
    screenH = 0.65;
  }
  const slotH = 1 - screenH;
  let boxW = W;
  let boxH = W / cam;
  if (boxH < slotH) {
    boxH = slotH;
    boxW = slotH * cam;
  }
  const mask: ShapeMask = { shape: "rect", x: 0.5, y: 0.5, w: W / boxW, h: slotH / boxH, rotation: 0, feather: 0, invert: false };
  // A fitted clip's box is centred; with scale s it's s * (fitted size).
  // The fitted height of a wider-than-canvas screen is W / screenAspect.
  return { x: 0.5, y: screenH + slotH / 2, width: boxW / W, mask, screen: { x: 0.5, y: screenH / 2, scale } };
}

/** The layer with its layout applied (position, width, mask, the preset). */
export function applyCamLayout<T extends Overlay & { kind: "video" }>(o: T, l: CamLayout, canvasAspect: number, camAspect: number, screenAspect?: number): T {
  const p = placeWebcam(l, canvasAspect, camAspect, screenAspect);
  return { ...o, x: p.x, y: p.y, width: p.width, rotation: 0, mask: p.mask, keyframes: [], camLayout: l };
}

/** Clips placed for a split layout, or back to centre and full size when
 * leaving one. Only position and scale change. */
export function screenForLayout(clips: Clip[], p: CamPlacement | null): Clip[] {
  return clips.map((c) => ({ ...c, transform: { ...c.transform, ...(p?.screen ?? { x: 0.5, y: 0.5, scale: 1 }) } }));
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** The main video's aspect: the first clip's source, as cropped. */
export function screenAspectOf(project: Project, sources: Record<string, MediaSource>): number | undefined {
  const c = project.clips[0];
  const s = c && sources[c.sourceId];
  if (!s || !(s.width > 0 && s.height > 0)) return undefined;
  return (s.width * c.crop.w) / (s.height * c.crop.h);
}

/** Every webcam layer with a layout placed again for the canvas aspect
 * (after a canvas size change); the same project when nothing moves. */
export function relayoutWebcams(project: Project, sources: Record<string, MediaSource>, canvasAspect: number): Project {
  const screenAspect = screenAspectOf(project, sources);
  let clips = project.clips;
  let changed = false;
  const overlays = project.overlays.map((o) => {
    if (o.kind !== "video" || !o.camLayout) return o;
    const src = sources[o.sourceId];
    if (!src || !(src.width > 0 && src.height > 0)) return o;
    const p = placeWebcam(o.camLayout, canvasAspect, src.width / src.height, screenAspect);
    if (p.screen && clips.some((c) => !near(c.transform.x, p.screen!.x) || !near(c.transform.y, p.screen!.y) || !near(c.transform.scale, p.screen!.scale))) {
      clips = screenForLayout(clips, p);
      changed = true;
    }
    if (near(o.x, p.x) && near(o.y, p.y) && near(o.width, p.width) && maskKey(o.mask) === maskKey(p.mask)) return o;
    changed = true;
    return { ...o, x: p.x, y: p.y, width: p.width, mask: p.mask };
  });
  return changed ? { ...project, clips, overlays } : project;
}
