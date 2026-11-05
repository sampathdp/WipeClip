/** Drawing of the reconstructed cursor and click rings. The preview draws
 * with these every frame; the export rasterizes the same shapes into
 * sprites (pointerSprites) that the backend positions per frame. */
import type { PointerScene } from "./pointer";
import type { PointerStyle } from "./types";

/** Arrow outline in units of its height, tip (hotspot) at the origin. */
const ARROW: [number, number][] = [
  [0, 0],
  [0, 0.8],
  [0.2, 0.62],
  [0.33, 0.95],
  [0.46, 0.9],
  [0.33, 0.58],
  [0.58, 0.58],
];
/** Sprite padding around the arrow (outline + shadow), in heights. */
const CURSOR_PAD = 0.1;

export function drawCursor(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ARROW.forEach(([px, py], i) => (i ? ctx.lineTo(px * h, py * h) : ctx.moveTo(px * h, py * h)));
  ctx.closePath();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = h * 0.08;
  ctx.shadowOffsetY = h * 0.03;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, h * 0.055);
  ctx.strokeStyle = isLight(color) ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.9)";
  ctx.stroke();
  ctx.restore();
}

export function drawRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number) {
  if (r <= 0 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha * 0.22;
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

export const ringColor = (style: PointerStyle, button: string) => (button === "left" ? style.leftColor : style.rightColor);

/** Preview: the scene on a canvas covering the stage. */
export function drawScene(c: HTMLCanvasElement, scene: PointerScene, style: PointerStyle | null | undefined) {
  const w = c.clientWidth;
  const h = c.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!style) return;
  for (const r of scene.rings) drawRing(ctx, r.cx * w, r.cy * h, r.r * h, ringColor(style, r.button), r.alpha);
  if (scene.cursor) drawCursor(ctx, scene.cursor.x * w, scene.cursor.y * h, style.cursorSize * scene.cursor.scale * h, style.cursorColor);
}

/** Ring sprite radius in pixels (scaled per frame by the export). */
export const RING_SPRITE_R = 128;

export interface PointerSprites {
  cursor: { blob: Blob; width: number; height: number; hotX: number; hotY: number } | null;
  /** [left, right] */
  rings: { blob: Blob; size: number }[];
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode_failed"))), "image/png"));
}

/** Export: the cursor at its largest output size (`cursorScale` x
 * cursorSize; the backend shrinks it per frame by the rows' scale column)
 * and full-size rings. */
export async function pointerSprites(style: PointerStyle, canvasHeightPx: number, withCursor: boolean, cursorScale = 1): Promise<PointerSprites> {
  let cursor: PointerSprites["cursor"] = null;
  if (withCursor) {
    const h = Math.max(8, Math.round(style.cursorSize * cursorScale * canvasHeightPx));
    const pad = Math.ceil(h * CURSOR_PAD);
    const c = document.createElement("canvas");
    c.width = Math.ceil(h * 0.62) + pad * 2;
    c.height = Math.ceil(h * 1.0) + pad * 2;
    drawCursor(c.getContext("2d")!, pad, pad, h, style.cursorColor);
    cursor = { blob: await toPng(c), width: c.width, height: c.height, hotX: pad, hotY: pad };
  }
  const rings = [];
  for (const color of [style.leftColor, style.rightColor]) {
    const size = Math.ceil(RING_SPRITE_R * 2.2);
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    drawRing(c.getContext("2d")!, size / 2, size / 2, RING_SPRITE_R, color, 1);
    rings.push({ blob: await toPng(c), size });
  }
  return { cursor, rings };
}

function isLight(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return true;
  const n = parseInt(m[1], 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 150;
}
