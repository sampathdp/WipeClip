/** Annotation shapes - arrows, highlight circles, rectangles, numbered
 * steps, text callouts and focus outlines - rasterized to transparent PNGs
 * like text layers, so the preview and the export composite the very same
 * image (rasters.ts; no backend support needed). The layer's `width` sets
 * the size, `rotation` the direction of an arrow, `aspect` the proportions.
 */
import type { RasterSticker } from "./stickers";
import type { ShapeStyle, ShapeType } from "./types";

export const SHAPE_LABELS: Record<ShapeType, string> = {
  arrow: "Arrow",
  circle: "Highlight circle",
  rect: "Rectangle",
  step: "Numbered step",
  callout: "Callout",
  outline: "Focus outline",
};

export function defaultShape(type: ShapeType, n = 1): ShapeStyle {
  const base = { type, color: "#f43f5e", filled: false, stroke: 0.08, aspect: 1, number: n, text: "" };
  switch (type) {
    case "arrow":
      return { ...base, aspect: 3, filled: true };
    case "circle":
      return { ...base, aspect: 1.4, color: "#facc15" };
    case "rect":
      return { ...base, aspect: 1.6 };
    case "step":
      return { ...base, color: "#7c3aed", filled: true };
    case "callout":
      return { ...base, color: "#111827", filled: true, aspect: 2.6, text: "Click here" };
    case "outline":
      return { ...base, color: "#22d3ee", aspect: 1.6, stroke: 0.05 };
  }
}

/** Default layer width (fraction of canvas width). */
export const SHAPE_WIDTH: Record<ShapeType, number> = { arrow: 0.18, circle: 0.16, rect: 0.22, step: 0.06, callout: 0.24, outline: 0.3 };

export function shapeKey(s: ShapeStyle): string {
  return `sh:${s.type}|${s.color}|${s.filled ? 1 : 0}|${s.stroke}|${s.aspect}|${s.number}|${s.text}`;
}

const LONG_SIDE = 640;

function luminance(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Canvas size for a shape: the long side is LONG_SIDE px. */
export function shapeCanvasSize(s: ShapeStyle): { width: number; height: number } {
  const aspect = s.type === "step" ? 1 : Math.min(6, Math.max(0.2, s.aspect));
  return aspect >= 1
    ? { width: LONG_SIDE, height: Math.max(8, Math.round(LONG_SIDE / aspect)) }
    : { width: Math.max(8, Math.round(LONG_SIDE * aspect)), height: LONG_SIDE };
}

export function drawShape(ctx: CanvasRenderingContext2D, s: ShapeStyle, W: number, H: number) {
  const short = Math.min(W, H);
  const lw = Math.max(2, s.stroke * short);
  const pad = lw / 2 + short * 0.04;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = short * 0.04;
  ctx.fillStyle = s.color;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = lw;
  switch (s.type) {
    case "arrow": {
      // Points right; rotate the layer to aim it. Head is 1/3 of the length.
      const shaft = H * 0.28;
      const head = Math.min(W * 0.36, H * 0.95);
      const y = H / 2;
      ctx.beginPath();
      ctx.moveTo(pad, y - shaft / 2);
      ctx.lineTo(W - pad - head, y - shaft / 2);
      ctx.lineTo(W - pad - head, pad);
      ctx.lineTo(W - pad, y);
      ctx.lineTo(W - pad - head, H - pad);
      ctx.lineTo(W - pad - head, y + shaft / 2);
      ctx.lineTo(pad, y + shaft / 2);
      ctx.closePath();
      if (s.filled) ctx.fill();
      else ctx.stroke();
      break;
    }
    case "circle":
      ctx.beginPath();
      ctx.ellipse(W / 2, H / 2, W / 2 - pad, H / 2 - pad, 0, 0, Math.PI * 2);
      if (s.filled) {
        ctx.globalAlpha = 0.28;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.stroke();
      break;
    case "rect":
    case "outline":
      roundRect(ctx, pad, pad, W - 2 * pad, H - 2 * pad, short * (s.type === "outline" ? 0.08 : 0.04));
      if (s.type === "outline") {
        // A glow makes the focus outline read on busy screens.
        ctx.shadowColor = s.color;
        ctx.shadowBlur = short * 0.08;
      }
      if (s.filled) {
        ctx.globalAlpha = 0.25;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.stroke();
      break;
    case "step": {
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, short / 2 - pad, 0, Math.PI * 2);
      if (s.filled) ctx.fill();
      else ctx.stroke();
      ctx.shadowColor = "transparent";
      ctx.fillStyle = s.filled ? (luminance(s.color) > 0.6 ? "#111111" : "#ffffff") : s.color;
      const label = String(Math.max(0, Math.min(999, Math.round(s.number))));
      ctx.font = `800 ${Math.round(short * (label.length > 2 ? 0.34 : label.length > 1 ? 0.42 : 0.52))}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, W / 2, H / 2 + short * 0.02);
      break;
    }
    case "callout": {
      const tail = H * 0.22;
      const bodyH = H - tail - pad;
      roundRect(ctx, pad, pad, W - 2 * pad, bodyH - pad, short * 0.18);
      ctx.moveTo(W * 0.18, bodyH);
      ctx.lineTo(W * 0.14, H - pad);
      ctx.lineTo(W * 0.3, bodyH);
      ctx.closePath();
      if (s.filled) ctx.fill();
      else ctx.stroke();
      ctx.shadowColor = "transparent";
      ctx.fillStyle = s.filled ? (luminance(s.color) > 0.6 ? "#111111" : "#ffffff") : s.color;
      const lines = (s.text || " ").split("\n").slice(0, 3);
      const size = Math.min(((bodyH - 2 * pad) / lines.length) * 0.7, (W * 1.6) / Math.max(4, ...lines.map((l) => l.length)));
      ctx.font = `700 ${Math.max(8, Math.round(size))}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      lines.forEach((l, i) => ctx.fillText(l, W / 2, pad + ((bodyH - pad) * (i + 0.5)) / lines.length));
      break;
    }
  }
}

export async function rasterizeShape(s: ShapeStyle): Promise<RasterSticker> {
  const { width, height } = shapeCanvasSize(s);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  drawShape(c.getContext("2d")!, s, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("encode_failed"))), "image/png"));
  return { blob, url: URL.createObjectURL(blob), width, height };
}
