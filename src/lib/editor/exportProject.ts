import { exportEditorProject, type Resolution } from "@/lib/toolsApi";
import { loadRaster, rasterKey } from "./rasters";
import { overlayWidth } from "./textRaster";
import { canvasSize } from "./timeline";
import type { MediaSource, Project } from "./types";

/** Serializes the project into the backend's export payload (see
 * api_video_export in backend/app/main.py):
 *  - `sources`: videos, original first (it sets frame rate and canvas
 *    size); only ones a clip or an extracted-audio track uses are sent.
 *  - `overlays`: one PNG per distinct sticker/text/image raster - the same
 *    PNGs the preview draws - referenced by index.
 *  - `audios`: uploaded audio files.
 *  - `background`: the canvas background image, if one is set.
 * Hidden layers and muted audio are left out entirely.
 */
export async function exportProject(
  project: Project,
  sources: Record<string, MediaSource>,
  originalId: string,
  resolution: Resolution,
  signal?: AbortSignal
): Promise<Blob> {
  const original = sources[originalId];
  const canvas = canvasSize(project.canvas.aspect, original.width, original.height);

  const sourceIds = [originalId];
  const addSourceRef = (id: string) => {
    if (!sourceIds.includes(id)) sourceIds.push(id);
    return sourceIds.indexOf(id);
  };
  for (const clip of project.clips) addSourceRef(clip.sourceId);

  const overlays = project.overlays.filter((o) => !o.hidden);
  const imageKeys: string[] = [];
  const imageBlobs: Blob[] = [];
  const overlayPayload = [];
  for (const o of overlays) {
    const key = rasterKey(o);
    const raster = await loadRaster(o, sources);
    if (!imageKeys.includes(key)) {
      imageKeys.push(key);
      imageBlobs.push(raster.blob);
    }
    overlayPayload.push({
      image: imageKeys.indexOf(key),
      start: round(o.start),
      end: round(o.end),
      x: o.x,
      y: o.y,
      width: overlayWidth(o, raster, canvas),
      rotation: o.rotation,
      opacity: o.opacity,
      animIn: o.animIn,
      animOut: o.animOut,
    });
  }

  const audioIds: string[] = [];
  const audioPayload = [];
  for (const a of project.audio) {
    if (a.muted || a.volume === 0) continue;
    const src = sources[a.sourceId];
    if (!src) continue;
    const ref =
      src.kind === "audio"
        ? { audio: audioIds.includes(src.id) ? audioIds.indexOf(src.id) : audioIds.push(src.id) - 1 }
        : { video: addSourceRef(src.id) };
    audioPayload.push({
      ...ref,
      start: round(a.start),
      offset: round(a.offset),
      duration: round(a.duration),
      volume: a.volume,
      fadeIn: a.fadeIn,
      fadeOut: a.fadeOut,
    });
  }

  const bg = project.canvas.background;
  const bgSource = bg.type === "image" ? sources[bg.sourceId] : undefined;

  const payload = {
    canvas: {
      aspect: project.canvas.aspect,
      fit: project.canvas.fit,
      background: {
        type: bg.type === "image" && !bgSource ? "color" : bg.type,
        color: bg.type === "color" || bg.type === "gradient" ? bg.color : "#000000",
        color2: bg.type === "gradient" ? bg.color2 : "#000000",
      },
    },
    clips: project.clips.map((c) => ({
      source: sourceIds.indexOf(c.sourceId),
      start: round(c.start),
      end: round(c.end),
      transition: c.transition ? { type: c.transition.type, duration: c.transition.duration } : null,
      speed: c.speed,
      volume: c.volume,
      transform: c.transform,
      look: c.look,
    })),
    overlays: overlayPayload,
    audio: audioPayload,
    effects: project.effects.map((e) => ({ type: e.type, start: round(e.start), end: round(e.end), intensity: e.intensity })),
  };

  return exportEditorProject(
    payload,
    sourceIds.map((id) => sources[id].file),
    imageBlobs,
    audioIds.map((id) => sources[id].file),
    bgSource?.file ?? null,
    resolution,
    signal
  );
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
