/** Webcam background removal (desktop app): settings, the math the preview
 * shares with the export, the engine's matted files, and the preview's
 * drawing.
 *
 * The engine turns a webcam video once into a *matted* video - its picture
 * on top and the person's mask (white = person) below, in one file
 * (backend/app/pipeline/matte.py). The preview draws from that file here and
 * the export composites from it (editor.py _matte_head), with the same edge
 * curve, softness and blur sizes (relative to the height, so they match at
 * any size) - see tests/desktop/matte.test.ts and backend/tests/test_matte.py.
 * Picture and mask come from one decoded frame, so they can't drift apart.
 */
import { useSyncExternalStore } from "react";
import type { MediaSource, WebcamMatte } from "./types.ts";

export const DEFAULT_MATTE: WebcamMatte = { mode: "remove", detail: "fine", edge: 0, soft: 25, blur: 50, fit: "fill", x: 0.5, y: 0.5, scale: 1, loop: true };

export const MATTE_MODE_LABELS: Record<WebcamMatte["mode"], string> = {
  remove: "Remove",
  blur: "Blur",
  image: "Image",
  video: "Video",
};

/** A saved matte with every field (older or partial ones get defaults). */
export function fullMatte(m: Partial<WebcamMatte>): WebcamMatte {
  return { ...DEFAULT_MATTE, ...m };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The mask's edge curve, 0..1 in and out (editor.py matte_curve): twice as
 * steep as the mask, around a threshold `edge` moves. Steepening drops the
 * faint halo the model leaves; moving the threshold over the softened mask
 * grows or shrinks the outline. */
export function edgeCurve(m: number, edge: number): number {
  const c = 0.5 - (clamp(edge, -100, 100) / 100) * 0.4;
  return clamp((m - c) * 2 + 0.5, 0, 1);
}

/** Edge softness as a Gaussian sigma in pixels of a mask `height` tall. */
export function softSigma(soft: number, height: number): number {
  return (0.002 + (0.02 * clamp(soft, 0, 100)) / 100) * height;
}

/** Background blur's sigma in pixels of a layer `height` tall. */
export function blurSigma(blur: number, height: number): number {
  return ((0.05 * clamp(blur, 0, 100)) / 100) * height;
}

/** Where an image or video background goes in a box: left, top, width and
 * height in the box's units. "fill" covers it, "fit" shows all of it;
 * `scale` enlarges; x/y pick which part of an overflowing background shows. */
export function bgRect(boxW: number, boxH: number, bgW: number, bgH: number, m: Pick<WebcamMatte, "fit" | "scale" | "x" | "y">) {
  const bw = Math.max(1, bgW);
  const bh = Math.max(1, bgH);
  const k = (m.fit === "fill" ? Math.max : Math.min)(boxW / bw, boxH / bh) * clamp(m.scale, 1, 4);
  const w = bw * k;
  const h = bh * k;
  return { left: (boxW - w) * m.x, top: (boxH - h) * m.y, width: w, height: h };
}

/** A background video's time, `t` seconds into the layer: it starts with
 * the layer, then loops or holds its last frame. */
export function bgVideoTime(t: number, duration: number, loop: boolean): number {
  if (!(duration > 0)) return 0;
  const at = Math.max(0, t);
  return loop ? at % duration : Math.min(at, Math.max(0, duration - 0.04));
}

/** Why a webcam layer's background can't be removed, or null if it can.
 * It runs in the desktop app's engine, on this computer; the website has
 * no engine, and webcam frames are never sent to a server for this. */
export function matteUnsupported(src: MediaSource | undefined, desktop: boolean): string | null {
  if (!desktop) return "Background removal runs on your computer, in the WipeClip desktop app.";
  if (!src || (!src.disk && !src.file)) return "This layer's video is missing.";
  return null;
}

/** What the engine is given: a file on disk by path, or a video the editor
 * holds in memory - by a key the engine keeps it under after the first time. */
export type MatteInput = { path: string } | { key: string; file: File };

export function matteInput(src: MediaSource): MatteInput {
  if (src.disk) return { path: src.disk.path };
  if (!src.file) throw new Error("This layer's video is missing.");
  return { key: memoryKey(src.file), file: src.file };
}

/** A stable key for an in-memory video across sessions (its name, size and
 * modification time - kept by the project store), 32 hex digits. */
export function memoryKey(f: { name: string; size: number; lastModified: number }): string {
  const text = `${f.name}|${f.size}|${f.lastModified}`;
  let out = "";
  for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]) {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out;
}

/** Which job (and cached file) a layer's settings need: per video and detail. */
export function matteJobKey(src: MediaSource | undefined, detail: WebcamMatte["detail"]): string | null {
  if (!src || (!src.disk && !src.file)) return null;
  return `${src.disk ? src.disk.path : `mem:${memoryKey(src.file!)}`}|${detail ?? "fine"}`;
}

// --- matted files (the engine's) ------------------------------------------------

export type MatteJob =
  | { status: "working"; progress: number }
  | { status: "ready"; path: string; url: string }
  | { status: "error"; message: string };

type Engine = {
  render: (input: MatteInput, duration: number, detail: "fine" | "fast", onProgress: (v: number) => void) => Promise<{ path: string }>;
  url: (path: string) => Promise<string>;
};

const jobs = new Map<string, MatteJob>();
const running = new Map<string, Promise<{ path: string; url: string }>>();
const listeners = new Set<() => void>();
let engine: Engine | null = null;

const set = (key: string, job: MatteJob) => {
  jobs.set(key, job);
  listeners.forEach((l) => l());
};

/** How the editor reaches the engine (toolsApi engineMatte, media.ts
 * matteUrl); kept out of this module so its math stays testable in Node. */
export function setMatteEngine(e: Engine): void {
  engine = e;
}

/** The matted file of a layer's video at a detail level, made first if
 * needed; one job per video and detail however many layers or callers
 * ask. A failed job is tried again on the next call. */
export function ensureMatte(src: MediaSource, detail: WebcamMatte["detail"] = "fine"): Promise<{ path: string; url: string }> {
  const key = matteJobKey(src, detail);
  if (!key) return Promise.reject(new Error("This layer's video is missing."));
  const job = jobs.get(key);
  if (job?.status === "ready") return Promise.resolve(job);
  const pending = running.get(key);
  if (pending) return pending;
  if (!engine) return Promise.reject(new Error("Background removal isn't available here."));
  const e = engine;
  set(key, { status: "working", progress: 0 });
  const p = (async () => {
    try {
      const made = await e.render(matteInput(src), src.duration, detail ?? "fine", (v) => set(key, { status: "working", progress: v }));
      const ready = { status: "ready" as const, path: made.path, url: await e.url(made.path) };
      set(key, ready);
      return ready;
    } catch (err) {
      set(key, { status: "error", message: err instanceof Error ? err.message : "Couldn't remove the background." });
      throw err;
    } finally {
      running.delete(key);
    }
  })();
  running.set(key, p);
  return p;
}

/** A job's state by matteJobKey (null key: none). */
export function useMatteJob(key: string | null): MatteJob | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (key ? (jobs.get(key) ?? null) : null),
    () => null
  );
}

// --- preview drawing ------------------------------------------------------------

/** Most the preview draws a matted layer at (it's shown at layer size). */
export const PREVIEW_MAX_WIDTH = 640;

interface Scratch {
  pad: HTMLCanvasElement;
  blurred: HTMLCanvasElement;
  fg: HTMLCanvasElement;
  lut: Uint8ClampedArray;
  lutEdge: number;
}
const scratch = new WeakMap<HTMLCanvasElement, Scratch>();

function canvas2d(c: HTMLCanvasElement, w: number, h: number) {
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return c.getContext("2d", { willReadFrequently: true })!;
}

/** Part (sx, sy, sw, sh) of `src`, blurred by `sigma` px at w x h, into
 * `out`. Drawn first with its edge pixels stretched outwards, so the blur
 * doesn't fade to clear at the frame's edges - ffmpeg's gblur (the export)
 * doesn't either. */
function blurInto(out: HTMLCanvasElement, pad: HTMLCanvasElement, src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, w: number, h: number, sigma: number) {
  const ctx = canvas2d(out, w, h);
  ctx.clearRect(0, 0, w, h);
  if (sigma < 0.3) {
    ctx.filter = "none";
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    return;
  }
  const p = Math.ceil(sigma * 3);
  const pc = canvas2d(pad, w + 2 * p, h + 2 * p);
  pc.filter = "none";
  const fx = sw / w;
  const fy = sh / h;
  pc.drawImage(src, sx, sy, sw, sh, p, p, w, h);
  // Edges: the outermost source row/column stretched over the padding.
  pc.drawImage(src, sx, sy, sw, fy, p, 0, w, p);
  pc.drawImage(src, sx, sy + sh - fy, sw, fy, p, p + h, w, p);
  pc.drawImage(src, sx, sy, fx, sh, 0, p, p, h);
  pc.drawImage(src, sx + sw - fx, sy, fx, sh, p + w, p, p, h);
  // Blurred whole (so the padding feeds the edges), offset so only the
  // frame itself lands on `out`.
  ctx.filter = `blur(${sigma}px)`;
  ctx.drawImage(pad, -p, -p);
  ctx.filter = "none";
}

/** Draws one matted frame of `video` (picture over mask) onto `canvas`, as
 * the export composites it: the background (clear, the picture blurred, or
 * `bg` placed by bgRect), then the person. False until a frame is ready. */
export function drawMatteFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  m: WebcamMatte,
  bg: { el: CanvasImageSource; width: number; height: number } | null
): boolean {
  if (video.readyState < 2 || !video.videoWidth) return false;
  const vw = video.videoWidth;
  const vh = Math.floor(video.videoHeight / 2);
  const w = Math.min(PREVIEW_MAX_WIDTH, vw);
  const h = Math.max(1, Math.round((vh * w) / vw));
  let s = scratch.get(canvas);
  if (!s) {
    s = { pad: document.createElement("canvas"), blurred: document.createElement("canvas"), fg: document.createElement("canvas"), lut: new Uint8ClampedArray(256), lutEdge: NaN };
    scratch.set(canvas, s);
  }
  if (s.lutEdge !== m.edge) {
    for (let i = 0; i < 256; i++) s.lut[i] = Math.round(edgeCurve(i / 255, m.edge) * 255);
    s.lutEdge = m.edge;
  }

  // The mask: softened at this size, then the edge curve as alpha.
  blurInto(s.blurred, s.pad, video, 0, vh, vw, vh, w, h, softSigma(m.soft, h));
  const mask = canvas2d(s.blurred, w, h).getImageData(0, 0, w, h).data;
  const fctx = canvas2d(s.fg, w, h);
  fctx.filter = "none";
  fctx.clearRect(0, 0, w, h);
  fctx.drawImage(video, 0, 0, vw, vh, 0, 0, w, h);
  const person = fctx.getImageData(0, 0, w, h);
  const px = person.data;
  for (let i = 3; i < px.length; i += 4) px[i] = s.lut[mask[i - 3]];
  fctx.putImageData(person, 0, 0);

  const ctx = canvas2d(canvas, w, h);
  ctx.clearRect(0, 0, w, h);
  if (m.mode === "blur") {
    blurInto(s.blurred, s.pad, video, 0, 0, vw, vh, w, h, blurSigma(m.blur, h));
    ctx.drawImage(s.blurred, 0, 0);
  } else if ((m.mode === "image" || m.mode === "video") && bg) {
    const r = bgRect(w, h, bg.width, bg.height, m);
    ctx.drawImage(bg.el, r.left, r.top, r.width, r.height);
  }
  ctx.drawImage(s.fg, 0, 0);
  return true;
}
