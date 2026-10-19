/** Coordinate spaces for interaction events. Pure - see
 * tests/desktop/recorder.test.ts.
 *
 *  desktop  OS global coordinates in DesktopUnit (what the input monitor
 *           reports). Multi-display: one space spanning all displays, can
 *           be negative left of / above the primary display.
 *  capture  fractions of the captured surface: (0,0) its top-left,
 *           (1,1) its bottom-right. Independent of encoded resolution, so
 *           it survives downscaling and matches any export size.
 *  region   fractions of the user's selected region inside the capture.
 *  video    pixels of the encoded video frame.
 */
import { round5, type DisplayInfo, type Rect } from "./format.ts";

export interface Point {
  x: number;
  y: number;
}

export function desktopToCapture(p: Point, surface: Rect): Point {
  return {
    x: round5((p.x - surface.x) / surface.width),
    y: round5((p.y - surface.y) / surface.height),
  };
}

export function captureToDesktop(p: Point, surface: Rect): Point {
  return { x: surface.x + p.x * surface.width, y: surface.y + p.y * surface.height };
}

export function captureToRegion(p: Point, region: Rect | null): Point {
  if (!region) return p;
  return { x: round5((p.x - region.x) / region.width), y: round5((p.y - region.y) / region.height) };
}

export function captureToVideo(p: Point, video: { width: number; height: number }): Point {
  return { x: p.x * video.width, y: p.y * video.height };
}

export function rectDesktopToCapture(r: Rect, surface: Rect): Rect {
  const tl = desktopToCapture(r, surface);
  return { x: tl.x, y: tl.y, width: round5(r.width / surface.width), height: round5(r.height / surface.height) };
}

export function isInside(p: Point): boolean {
  return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}

/** Normalizes a region dragged on the preview (any corner order, possibly
 * past the edges) to a rect inside 0..1, or null if it's too small to be
 * meant as a region (under 2% either way). */
export function normalizeRegion(a: Point, b: Point): Rect | null {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x1 = clamp(Math.min(a.x, b.x));
  const y1 = clamp(Math.min(a.y, b.y));
  const x2 = clamp(Math.max(a.x, b.x));
  const y2 = clamp(Math.max(a.y, b.y));
  if (x2 - x1 < 0.02 || y2 - y1 < 0.02) return null;
  return { x: round5(x1), y: round5(y1), width: round5(x2 - x1), height: round5(y2 - y1) };
}

/** Even pixel size of a region in a video of the given size (encoders
 * need even dimensions). */
export function regionPixels(region: Rect, video: { width: number; height: number }) {
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return { width: even(region.width * video.width), height: even(region.height * video.height) };
}

export interface DisplayMatch {
  display: DisplayInfo | null;
  /** More than one display could be the captured one; ask the user. */
  candidates: DisplayInfo[];
}

/** Which display a full-screen capture shows. Browsers don't say, so this
 * compares the capture's native size with each display's size in physical
 * pixels (both Windows and macOS capture at physical resolution). Exact
 * size first, then same aspect ratio (capture downscaled by the OS). */
export function matchDisplay(displays: DisplayInfo[], native: { width: number; height: number }, unit: "physical-pixels" | "points"): DisplayMatch {
  if (!native.width || !native.height || displays.length === 0) return { display: null, candidates: displays };
  const physical = (d: DisplayInfo) =>
    unit === "points" ? { w: d.bounds.width * d.scaleFactor, h: d.bounds.height * d.scaleFactor } : { w: d.bounds.width, h: d.bounds.height };
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
  const exact = displays.filter((d) => {
    const p = physical(d);
    return near(p.w, native.width, 2) && near(p.h, native.height, 2);
  });
  const pool =
    exact.length > 0
      ? exact
      : displays.filter((d) => {
          const p = physical(d);
          return near(p.w / p.h, native.width / native.height, 0.01);
        });
  if (pool.length === 1) return { display: pool[0], candidates: pool };
  if (pool.length === 0 && displays.length === 1) return { display: displays[0], candidates: displays };
  return { display: null, candidates: pool.length ? pool : displays };
}
