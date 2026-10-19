import { useEffect, useState } from "react";
import { rasterizeSticker, type RasterSticker } from "./stickers";
import { rasterizeShape, shapeKey } from "./shapes";
import { rasterizeText, textKey } from "./textRaster";
import type { MediaSource, Overlay } from "./types";

/** Every overlay is drawn from one PNG: a rasterized sticker, rasterized
 * text, or a normalized uploaded image. The key identifies that PNG, so
 * identical layers share it in the preview and are uploaded once on export.
 * Video layers have no PNG: their "raster" is the source video itself
 * (url + display size), which the preview plays and the export sends as a
 * source video instead.
 */
export function rasterKey(o: Overlay): string {
  if (o.kind === "sticker") return `s:${o.stickerId}`;
  if (o.kind === "image") return `i:${o.sourceId}`;
  if (o.kind === "video") return `v:${o.sourceId}`;
  if (o.kind === "shape") return shapeKey(o.shape);
  return `t:${textKey(o.text)}`;
}

export function loadRaster(o: Overlay, sources: Record<string, MediaSource>): Promise<RasterSticker> {
  if (o.kind === "sticker") return rasterizeSticker(o.stickerId);
  if (o.kind === "text") return rasterizeText(o.text);
  if (o.kind === "shape") return rasterizeShape(o.shape);
  const src = sources[o.sourceId];
  if (!src) return Promise.reject(new Error(o.kind === "video" ? "Missing video" : "Missing image"));
  return Promise.resolve({ blob: src.file, url: src.url, width: src.width, height: src.height });
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
