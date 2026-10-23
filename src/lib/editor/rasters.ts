import { useEffect, useState } from "react";
import { rasterizeSticker, type RasterSticker } from "./stickers";
import { rasterizeShape, shapeKey } from "./shapes";
import { rasterizeText, textKey } from "./textRaster";
import { keyId, keyImage } from "./chromaKey";
import { isAnimatedText, rasterizeAnimatedText, textAnimKey } from "./textAnim";
import { drawShapeMask, maskKey } from "./shapeMask";
import type { MediaSource, Overlay } from "./types";

/** Every overlay is drawn from one PNG: a rasterized sticker, rasterized
 * text, or a normalized uploaded image. The key identifies that PNG, so
 * identical layers share it in the preview and are uploaded once on export.
 * Video layers have no PNG: their "raster" is the source video itself
 * (url + display size), which the preview plays and the export sends as a
 * source video instead.
 */
export function rasterKey(o: Overlay): string {
  const base = baseKey(o);
  // A masked image/text/sticker/shape is its own PNG with the mask baked in.
  return o.mask && o.kind !== "video" ? `${base}|m:${maskKey(o.mask)}` : base;
}

function baseKey(o: Overlay): string {
  if (o.kind === "sticker") return `s:${o.stickerId}`;
  if (o.kind === "image") return o.key ? `i:${o.sourceId}:k:${keyId(o.key)}` : `i:${o.sourceId}`;
  if (o.kind === "video") return `v:${o.sourceId}`;
  if (o.kind === "shape") return shapeKey(o.shape);
  if (o.kind === "text" && isAnimatedText(o)) return `ta:${textKey(o.text)}|${textAnimKey(o)}`;
  return `t:${textKey(o.text)}`;
}

export function loadRaster(o: Overlay, sources: Record<string, MediaSource>): Promise<RasterSticker> {
  const raw = loadBaseRaster(o, sources);
  if (!o.mask || o.kind === "video") return raw;
  const key = rasterKey(o);
  let p = masked.get(key);
  if (!p) {
    const mask = o.mask;
    p = raw.then((r) => maskRaster(r, mask));
    masked.set(key, p);
    if (masked.size > 60) masked.delete(masked.keys().next().value!);
    p.catch(() => masked.delete(key));
  }
  return p;
}

const masked = new Map<string, Promise<RasterSticker>>();

/** The raster with its alpha multiplied by the mask - per cell for an
 * animated text's sprite sheet. */
async function maskRaster(r: RasterSticker, m: NonNullable<Overlay["mask"]>): Promise<RasterSticker> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Layer image failed to load"));
    el.src = r.url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const cols = r.sprite?.cols ?? 1;
  const rows = r.sprite?.rows ?? 1;
  const cw = canvas.width / cols;
  const ch = canvas.height / rows;
  const mask = drawShapeMask(m, cw / ch);
  ctx.globalCompositeOperation = "destination-in";
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) ctx.drawImage(mask, col * cw, row * ch, cw, ch);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not mask the layer"))), "image/png"));
  return { ...r, blob, url: URL.createObjectURL(blob) };
}

function loadBaseRaster(o: Overlay, sources: Record<string, MediaSource>): Promise<RasterSticker> {
  if (o.kind === "sticker") return rasterizeSticker(o.stickerId);
  if (o.kind === "text" && isAnimatedText(o)) return rasterizeAnimatedText(o, baseKey(o));
  if (o.kind === "text") return rasterizeText(o.text);
  if (o.kind === "shape") return rasterizeShape(o.shape);
  const src = sources[o.sourceId];
  if (!src) return Promise.reject(new Error(o.kind === "video" ? "Missing video" : "Missing image"));
  // A keyed image is its own PNG, which the export uploads as is.
  if (o.kind === "image" && o.key) return keyImage(src.url, o.key);
  // Only image layers' blobs are exported; video layers go as sources, and
  // only videos stay on disk (file null), so they never need this blob.
  return Promise.resolve({ blob: src.file ?? new Blob(), url: src.url, width: src.width, height: src.height });
}

/** Rasters for the given overlays, filled in as they become ready. Text is
 * debounced slightly so typing doesn't render a PNG per keystroke. */
export function useOverlayRasters(
  overlays: Overlay[],
  sources: Record<string, MediaSource>,
  onError: (message: string) => void
): { byKey: Record<string, RasterSticker>; byId: Record<string, RasterSticker> } {
  const [rasters, setRasters] = useState<Record<string, RasterSticker>>({});
  // Last raster each layer finished with - shown while an edited text
  // layer re-renders, so it doesn't flicker out.
  const [byId, setById] = useState<Record<string, RasterSticker>>({});

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      for (const o of overlays) {
        const key = rasterKey(o);
        const ready = rasters[key];
        if (ready) {
          if (byId[o.id] !== ready) setById((m) => ({ ...m, [o.id]: ready }));
          continue;
        }
        loadRaster(o, sources)
          .then((r) => {
            if (cancelled) return;
            setRasters((m) => (m[key] ? m : { ...m, [key]: r }));
            setById((m) => ({ ...m, [o.id]: r }));
          })
          .catch(() => {
            if (!cancelled) onError(o.kind === "text" ? "Text couldn't be rendered." : "A layer couldn't be loaded.");
          });
      }
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [overlays, sources, rasters, byId, onError]);

  return { byKey: rasters, byId };
}
