import type { RasterSticker } from "./stickers";
import type { Overlay, TextStyle } from "./types";

/** Text layers are rasterized in the browser to a PNG - the same PNG the
 * preview shows and the export composites - so fonts, outline, shadow and
 * background look identical in both, whatever fonts the server has.
 */

export const TEXT_FONTS: Record<string, { label: string; css: string }> = {
  inter: { label: "Inter", css: "var(--font-inter), Arial, sans-serif" },
  jakarta: { label: "Jakarta", css: "var(--font-jakarta), Arial, sans-serif" },
  impact: { label: "Impact", css: "Impact, 'Arial Black', sans-serif" },
  serif: { label: "Serif", css: "Georgia, 'Times New Roman', serif" },
  mono: { label: "Mono", css: "ui-monospace, Menlo, Consolas, monospace" },
  rounded: { label: "Rounded", css: "'Arial Rounded MT Bold', 'Trebuchet MS', sans-serif" },
  hand: { label: "Handwritten", css: "'Segoe Print', 'Comic Sans MS', 'Bradley Hand', cursive" },
};

/** Font px the raster is drawn at; display size scales from this. */
export const TEXT_RASTER_PX = 160;

export const DEFAULT_TEXT: TextStyle = {
  content: "Your text",
  font: "jakarta",
  size: 0.08,
  weight: 900,
  italic: false,
  color: "#ffffff",
  background: "#000000",
  backgroundOpacity: 0,
  strokeColor: "#000000",
  strokeWidth: 0,
  shadow: true,
  align: "center",
  letterSpacing: 0,
  lineHeight: 1.15,
};

export const TEXT_TEMPLATES: { label: string; style: Partial<TextStyle>; y: number }[] = [
  { label: "Title", style: { content: "Big Title", size: 0.11, weight: 900, font: "jakarta" }, y: 0.4 },
  { label: "Subtitle", style: { content: "A short subtitle", size: 0.05, weight: 700, font: "inter" }, y: 0.55 },
  {
    label: "Caption",
    style: { content: "Caption text goes here", size: 0.045, weight: 700, font: "inter", background: "#000000", backgroundOpacity: 0.6, shadow: false },
    y: 0.85,
  },
  {
    label: "Lower third",
    style: { content: "Your Name\nTitle or handle", size: 0.045, weight: 700, font: "inter", align: "left", background: "#7c5cff", backgroundOpacity: 0.9, shadow: false },
    y: 0.8,
  },
  {
    label: "Outline",
    style: { content: "OUTLINE", size: 0.1, weight: 900, font: "impact", color: "#ffffff", strokeColor: "#000000", strokeWidth: 0.08, shadow: false },
    y: 0.5,
  },
  {
    label: "Neon",
    style: { content: "NEON", size: 0.1, weight: 900, font: "jakarta", color: "#22d3ee", strokeColor: "#7c5cff", strokeWidth: 0.04, shadow: true },
    y: 0.5,
  },
];

function resolveFamily(css: string): string {
  // next/font exposes its generated family names as CSS variables; canvas
  // can't read var(), so resolve them first.
  return css.replace(/var\((--[\w-]+)\)/g, (_, name) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || "sans-serif";
  });
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const cache = new Map<string, Promise<RasterSticker>>();

export function textKey(style: TextStyle): string {
  return JSON.stringify(style);
}

export function rasterizeText(style: TextStyle): Promise<RasterSticker> {
  const key = textKey(style);
  const hit = cache.get(key);
  if (hit) return hit;
  const p = draw(style);
  cache.set(key, p);
  // Keep the cache small - text is re-rasterized as the user types.
  if (cache.size > 80) {
    const first = cache.keys().next().value;
    if (first !== undefined) {
      cache.get(first)?.then((r) => URL.revokeObjectURL(r.url)).catch(() => {});
      cache.delete(first);
    }
  }
  p.catch(() => cache.delete(key));
  return p;
}

async function draw(s: TextStyle): Promise<RasterSticker> {
  const px = TEXT_RASTER_PX;
  const family = resolveFamily((TEXT_FONTS[s.font] ?? TEXT_FONTS.inter).css);
  const font = `${s.italic ? "italic " : ""}${s.weight} ${px}px ${family}`;
  try {
    await document.fonts.load(font, s.content || "A");
  } catch {
    // fall back to whatever the browser has
  }

  const measureCanvas = document.createElement("canvas");
  const m = measureCanvas.getContext("2d")!;
  m.font = font;
  (m as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${s.letterSpacing * px}px`;
  const lines = (s.content || " ").split("\n");
  const widths = lines.map((l) => Math.max(1, m.measureText(l).width));
  const blockW = Math.max(...widths);
  const lineH = px * s.lineHeight;
  const hasBg = s.backgroundOpacity > 0;
  const pad = hasBg ? px * 0.35 : 0;
  const margin = px * (s.strokeWidth + (s.shadow ? 0.2 : 0)) + 4;
  const w = Math.ceil(blockW + 2 * (pad + margin));
  const h = Math.ceil(lines.length * lineH + 2 * (pad + margin));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${s.letterSpacing * px}px`;
  ctx.textBaseline = "middle";

  if (hasBg) {
    ctx.fillStyle = hexToRgba(s.background, s.backgroundOpacity);
    const r = px * 0.25;
    ctx.beginPath();
    ctx.roundRect(margin, margin, w - 2 * margin, h - 2 * margin, r);
    ctx.fill();
  }

  const left = margin + pad;
  ctx.lineJoin = "round";
  lines.forEach((line, i) => {
    const lw = widths[i];
    const x = s.align === "left" ? left : s.align === "right" ? left + blockW - lw : left + (blockW - lw) / 2;
    const y = margin + pad + lineH * (i + 0.5);
    if (s.shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = px * 0.15;
      ctx.shadowOffsetY = px * 0.04;
    }
    if (s.strokeWidth > 0) {
      ctx.strokeStyle = s.strokeColor;
      ctx.lineWidth = s.strokeWidth * px * 2;
      ctx.strokeText(line, x, y);
      ctx.shadowColor = "transparent";
    }
    ctx.fillStyle = s.color;
    ctx.fillText(line, x, y);
    ctx.shadowColor = "transparent";
  });

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not render text"))), "image/png")
  );
  return { blob, url: URL.createObjectURL(blob), width: w, height: h };
}

/** On-canvas width of an overlay as a fraction of canvas width. Stickers
 * and images store it directly; text derives it from its font size (a
 * fraction of canvas height) and its raster's proportions. Used by both
 * the preview and the export payload, so they size text identically.
 */
export function overlayWidth(o: Overlay, raster: { width: number; height: number }, canvas: { width: number; height: number }): number {
  if (o.kind !== "text") return o.width;
  return ((raster.width / TEXT_RASTER_PX) * o.text.size * canvas.height) / canvas.width;
}
