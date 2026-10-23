import type { Curves } from "./types";

/** Color curves: a master (RGB) curve and one per channel, each through
 * control points (x, y in 0..1) with a monotone cubic - smooth, and never
 * overshooting between points. Applied after the grade: channel(master(v)).
 *
 * The curves travel as sampled tables (CURVE_SAMPLES per channel) that both
 * sides interpolate linearly - SVG feComponentTransfer in the preview,
 * numpy interp when the export bakes its LUT (look.py) - so they agree. */

export const CURVE_SAMPLES = 64;
export const IDENTITY_CURVE: [number, number][] = [
  [0, 0],
  [1, 1],
];
export const DEFAULT_CURVES: Curves = { rgb: IDENTITY_CURVE, r: IDENTITY_CURVE, g: IDENTITY_CURVE, b: IDENTITY_CURVE };

export function isIdentityCurve(points: [number, number][]): boolean {
  return points.every(([x, y]) => Math.abs(x - y) < 1e-4);
}

export function curvesActive(c: Curves | undefined): c is Curves {
  return !!c && !(isIdentityCurve(c.rgb) && isIdentityCurve(c.r) && isIdentityCurve(c.g) && isIdentityCurve(c.b));
}

/** Monotone cubic (Fritsch-Carlson) through sorted points, as a function. */
export function curveFn(points: [number, number][]): (x: number) => number {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  const n = p.length;
  if (n < 2) return (x) => x;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / Math.max(1e-6, p[i + 1][0] - p[i][0]));
  const m: number[] = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[n - 1][0]) return p[n - 1][1];
    let i = 0;
    while (x > p[i + 1][0]) i++;
    const h = p[i + 1][0] - p[i][0];
    const t = (x - p[i][0]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * m[i + 1];
    return Math.min(1, Math.max(0, y));
  };
}

/** Sampled tables [r, g, b]: channel curve of the master curve. */
export function curveTables(c: Curves): [number[], number[], number[]] {
  const master = curveFn(c.rgb);
  return [c.r, c.g, c.b].map((pts) => {
    const ch = curveFn(pts);
    return Array.from({ length: CURVE_SAMPLES }, (_, i) => Math.round(ch(master(i / (CURVE_SAMPLES - 1))) * 10000) / 10000);
  }) as [number[], number[], number[]];
}
