/** Preview drawing of privacy masks (geometry from masks.ts, the same the
 * export uses). Strengths match the backend's _mask_filters: blur radius
 * and pixel block size are the same fractions of the canvas height. */
import { maskRect, type MaskCaches } from "./masks";
import type { Layout } from "./timeline";
import type { MediaSource, PrivacyMask, Project } from "./types";

export const blurRadius = (strength: number) => 0.008 + 0.04 * Math.min(1, Math.max(0, strength / 100));
export const pixelBlock = (strength: number) => 0.008 + 0.05 * Math.min(1, Math.max(0, strength / 100));

const scratch = typeof document !== "undefined" ? document.createElement("canvas") : null;

export function drawMasks(
  wrap: HTMLDivElement,
  canvas: HTMLCanvasElement,
  masks: PrivacyMask[],
  t: number,
  lay: Layout,
  project: Project,
  sources: Record<string, MediaSource>,
  canvasSize: { width: number; height: number },
  caches: MaskCaches,
  video: HTMLVideoElement | null
) {
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const blurs = wrap.querySelectorAll<HTMLDivElement>("div[data-mask]");
  let used = 0;
  for (const m of masks) {
    const r = maskRect(m, t, lay, project, sources, canvasSize, caches);
    if (!r) continue;
    const x = r.x * W;
    const y = r.y * H;
    const w = r.w * W;
    const h = r.h * H;
    if (m.mode === "solid") {
      ctx.fillStyle = m.color;
      ctx.fillRect(x, y, w, h);
    } else if (m.mode === "pixelate") {
      drawPixelated(ctx, video, x, y, w, h, Math.max(4, pixelBlock(m.strength) * H));
    } else {
      let div = blurs[used] as HTMLDivElement | undefined;
      if (!div) {
        div = document.createElement("div");
        div.dataset.mask = "1";
        div.style.position = "absolute";
        wrap.appendChild(div);
      }
      used++;
      const f = `blur(${(blurRadius(m.strength) * H).toFixed(1)}px)`;
      Object.assign(div.style, { display: "block", left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, backdropFilter: f });
      div.style.setProperty("-webkit-backdrop-filter", f);
    }
  }
  for (let i = used; i < blurs.length; i++) blurs[i].style.display = "none";
}

/** The covered area of the video, sampled small and drawn back with hard
 * edges. Reads the slot's own placement (PreviewPlayer sizes the element
 * to the whole frame), so crops and zooms map correctly. */
function drawPixelated(ctx: CanvasRenderingContext2D, v: HTMLVideoElement | null, x: number, y: number, w: number, h: number, block: number) {
  if (!v || !scratch || v.readyState < 2 || !v.videoWidth) {
    // Nothing decoded yet: cover it anyway rather than show the content.
    ctx.fillStyle = "#808080";
    ctx.fillRect(x, y, w, h);
    return;
  }
  const left = parseFloat(v.style.left) || 0;
  const top = parseFloat(v.style.top) || 0;
  const ew = parseFloat(v.style.width) || 1;
  const eh = parseFloat(v.style.height) || 1;
  const sx = ((x - left) / ew) * v.videoWidth;
  const sy = ((y - top) / eh) * v.videoHeight;
  const sw = (w / ew) * v.videoWidth;
  const sh = (h / eh) * v.videoHeight;
  const cols = Math.max(1, Math.round(w / block));
  const rows = Math.max(1, Math.round(h / block));
  scratch.width = cols;
  scratch.height = rows;
  const s = scratch.getContext("2d")!;
  s.drawImage(v, sx, sy, sw, sh, 0, 0, cols, rows);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0, cols, rows, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}
