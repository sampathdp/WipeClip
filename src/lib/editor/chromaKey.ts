import type { ChromaKey } from "./types";

/** Chroma key ("green screen") for image and video layers - ffmpeg's
 * colorkey filter, which the export runs on video layers (editor.py
 * _overlay_filters), pixel for pixel: the RGB distance to the key color,
 * normalized to 0..1, against `similarity`, with a soft ramp `blend` wide.
 * Image layers are keyed here instead, into the PNG the export uploads.
 */
export const DEFAULT_KEY: ChromaKey = { color: "#00ff00", similarity: 30, smoothness: 10 };

export function keyParams(k: ChromaKey): { r: number; g: number; b: number; similarity: number; blend: number } {
  const hex = k.color.replace("#", "");
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    similarity: Math.max(0.01, Math.min(1, k.similarity / 100)),
    blend: Math.max(0, Math.min(1, k.smoothness / 100)),
  };
}

/** Keys RGBA pixels in place; existing transparency is kept (the key's
 * alpha multiplies it). */
export function applyKey(data: Uint8ClampedArray, k: ChromaKey): void {
  const { r, g, b, similarity, blend } = keyParams(k);
  const norm = 1 / (255 * 255 * 3);
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - r;
    const dg = data[i + 1] - g;
    const db = data[i + 2] - b;
    const diff = Math.sqrt((dr * dr + dg * dg + db * db) * norm);
    const a = blend > 0.0001 ? Math.min(1, Math.max(0, (diff - similarity) / blend)) : diff > similarity ? 1 : 0;
    if (a < 1) data[i + 3] = data[i + 3] * a;
  }
}

export function keyId(k: ChromaKey | null | undefined): string {
  return k ? `${k.color}:${k.similarity}:${k.smoothness}` : "";
}

/** An image keyed into a new PNG, at its own size. */
export async function keyImage(url: string, k: ChromaKey): Promise<{ blob: Blob; url: string; width: number; height: number }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Image failed to load"));
    el.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyKey(pixels.data, k);
  ctx.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), "image/png")
  );
  return { blob, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
}

/** Draws a video frame keyed onto `canvas`, at most `maxWidth` wide (the
 * preview only needs layer size). */
export function drawKeyedFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, k: ChromaKey, maxWidth = 640): void {
  if (video.readyState < 2 || !video.videoWidth) return;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const w = Math.max(1, Math.round(video.videoWidth * scale));
  const h = Math.max(1, Math.round(video.videoHeight * scale));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(video, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h);
  applyKey(pixels.data, k);
  ctx.putImageData(pixels, 0, 0);
}
