import type { Adjustments, FilterId, Look } from "./types";
import { curvesActive } from "./curves.ts";

/** Color math shared by the preview and the export. MUST stay identical to
 * backend/app/pipeline/look.py - the preview applies it as an SVG filter
 * (per-channel transfer table + color matrix), the export bakes the exact
 * same functions into a 3D LUT for ffmpeg's lut3d.
 *
 * A "grade" is applied as: filter transfer -> filter matrix -> adjustment
 * transfer -> adjustment matrix, all in gamma-encoded sRGB 0..1.
 */

export interface Transfer {
  gain: [number, number, number];
  exposure: number; // stops
  contrast: number; // multiplier around mid-grey
  brightness: number; // added
  shadows: number; // -1..1
  highlights: number; // -1..1
  lift: number; // 0..0.3, raises blacks
}

export type Matrix = [number, number, number, number, number, number, number, number, number];

const IDENTITY_T: Transfer = { gain: [1, 1, 1], exposure: 0, contrast: 1, brightness: 0, shadows: 0, highlights: 0, lift: 0 };
const IDENTITY_M: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function saturationMatrix(s: number): Matrix {
  const lr = 0.2126 * (1 - s);
  const lg = 0.7152 * (1 - s);
  const lb = 0.0722 * (1 - s);
  return [lr + s, lg, lb, lr, lg + s, lb, lr, lg, lb + s];
}

const SEPIA: Matrix = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];

function mixM(a: Matrix, b: Matrix, k: number): Matrix {
  return a.map((v, i) => v + (b[i] - v) * k) as Matrix;
}

export const FILTERS: Record<FilterId, { label: string; t: Partial<Transfer>; m: Matrix }> = {
  original: { label: "Original", t: {}, m: IDENTITY_M },
  cinematic: {
    label: "Cinematic",
    t: { contrast: 1.18, brightness: -0.02, gain: [1.03, 1, 0.95], shadows: -0.15, highlights: -0.1, lift: 0.02 },
    m: saturationMatrix(0.85),
  },
  warm: { label: "Warm", t: { gain: [1.1, 1.02, 0.86] }, m: saturationMatrix(1.08) },
  cool: { label: "Cool", t: { gain: [0.88, 1, 1.12] }, m: saturationMatrix(0.95) },
  vintage: { label: "Vintage", t: { contrast: 0.88, lift: 0.08, gain: [1.05, 1, 0.9] }, m: mixM(IDENTITY_M, SEPIA, 0.6) },
  bw: { label: "Black & White", t: { contrast: 1.1 }, m: saturationMatrix(0) },
  vibrant: { label: "Vibrant", t: { contrast: 1.06 }, m: saturationMatrix(1.5) },
  dramatic: {
    label: "Dramatic",
    t: { contrast: 1.4, shadows: -0.25, highlights: -0.2, brightness: -0.03 },
    m: saturationMatrix(0.8),
  },
  soft: { label: "Soft", t: { contrast: 0.85, lift: 0.05, highlights: -0.15 }, m: saturationMatrix(0.92) },
  fade: { label: "Fade", t: { contrast: 0.82, lift: 0.14 }, m: saturationMatrix(0.75) },
};

export const FILTER_ORDER = Object.keys(FILTERS) as FilterId[];

function lerpT(t: Partial<Transfer>, k: number): Transfer {
  const g = t.gain ?? IDENTITY_T.gain;
  const l = (key: Exclude<keyof Transfer, "gain">) => IDENTITY_T[key] + ((t[key] ?? IDENTITY_T[key]) - IDENTITY_T[key]) * k;
  return {
    gain: [1 + (g[0] - 1) * k, 1 + (g[1] - 1) * k, 1 + (g[2] - 1) * k],
    exposure: l("exposure"),
    contrast: l("contrast"),
    brightness: l("brightness"),
    shadows: l("shadows"),
    highlights: l("highlights"),
    lift: l("lift"),
  };
}

function adjustTransfer(a: Adjustments): Transfer {
  return {
    gain: [1 + (0.15 * a.temperature) / 100, 1 - (0.12 * a.tint) / 100, 1 - (0.15 * a.temperature) / 100],
    exposure: (a.exposure / 100) * 1.5,
    contrast: 1 + (a.contrast / 100) * 0.6,
    brightness: (a.brightness / 100) * 0.3,
    shadows: a.shadows / 100,
    highlights: a.highlights / 100,
    lift: 0,
  };
}

export interface Grade {
  stages: { t: Transfer; m: Matrix }[];
  sharpness: number; // 0..1
  blur: number; // fraction of canvas height used as gaussian sigma
  opacity: number; // 0..1
}

export function gradeOf(look: Look): Grade {
  const f = FILTERS[look.filter] ?? FILTERS.original;
  const k = Math.max(0, Math.min(1, look.intensity / 100));
  const a = look.adjust;
  return {
    stages: [
      { t: lerpT(f.t, k), m: mixM(IDENTITY_M, f.m, k) },
      { t: adjustTransfer(a), m: saturationMatrix(1 + a.saturation / 100) },
    ],
    sharpness: Math.max(0, a.sharpness) / 100,
    blur: (Math.max(0, a.blur) / 100) * 0.02,
    opacity: Math.max(0, Math.min(1, a.opacity / 100)),
  };
}

export function isNeutralColor(look: Look): boolean {
  const a = look.adjust;
  return (
    (look.filter === "original" || look.intensity === 0) &&
    !a.brightness && !a.contrast && !a.saturation && !a.exposure && !a.temperature && !a.tint && !a.highlights && !a.shadows &&
    !curvesActive(look.curves)
  );
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Per-channel transfer; `c` is 0/1/2 for R/G/B. */
export function applyTransfer(t: Transfer, v: number, c: number): number {
  const v1 = v * t.gain[c] * Math.pow(2, t.exposure);
  const v2 = (v1 - 0.5) * t.contrast + 0.5 + t.brightness;
  const v2c = clamp01(v2);
  const v3 = v2 + 0.25 * (t.shadows * (1 - v2c) ** 2 + t.highlights * v2c ** 2);
  return clamp01(t.lift + v3 * (1 - t.lift));
}

/** feComponentTransfer tableValues for one channel. */
export function transferTable(t: Transfer, c: number, samples = 33): string {
  const out: string[] = [];
  for (let i = 0; i < samples; i++) out.push(applyTransfer(t, i / (samples - 1), c).toFixed(4));
  return out.join(" ");
}

/** feColorMatrix values (4x5) for a 3x3 RGB matrix. */
export function matrixValues(m: Matrix): string {
  return [m[0], m[1], m[2], 0, 0, m[3], m[4], m[5], 0, 0, m[6], m[7], m[8], 0, 0, 0, 0, 0, 1, 0]
    .map((v) => +v.toFixed(5))
    .join(" ");
}

