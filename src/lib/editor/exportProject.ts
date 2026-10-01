import { exportEditorProject, type Resolution } from "@/lib/toolsApi";
import { rasterizeSticker } from "./stickers";
import type { MediaSource, Project } from "./types";

/** Serializes the project into the backend's export payload (see
 * api_video_export in backend/app/main.py): sources by index with the
 * original first (it sets the output canvas), each distinct sticker image
 * uploaded once. Only sources a clip actually uses are sent, plus the
 * original.
 */
export async function exportProject(
  project: Project,
  sources: Record<string, MediaSource>,
  originalId: string,
  resolution: Resolution,
  signal?: AbortSignal
): Promise<Blob> {
  const sourceIds = [originalId];
  for (const clip of project.clips) {
    if (!sourceIds.includes(clip.sourceId)) sourceIds.push(clip.sourceId);
  }

  const stickerIds: string[] = [];
  for (const s of project.stickers) {
    if (!stickerIds.includes(s.stickerId)) stickerIds.push(s.stickerId);
  }
  const images = await Promise.all(stickerIds.map((id) => rasterizeSticker(id)));

  const payload = {
    clips: project.clips.map((c) => ({
      source: sourceIds.indexOf(c.sourceId),
      start: round(c.start),
      end: round(c.end),
      transition: c.transition ? { type: c.transition.type, duration: c.transition.duration } : null,
    })),
    stickers: project.stickers.map((s) => ({
      image: stickerIds.indexOf(s.stickerId),
      start: round(s.start),
      end: round(s.end),
      x: s.x,
      y: s.y,
      width: s.width,
      rotation: s.rotation,
      animIn: s.animIn,
      animOut: s.animOut,
    })),
  };

  return exportEditorProject(
    payload,
    sourceIds.map((id) => sources[id].file),
    images.map((img) => img.blob),
    resolution,
    signal
  );
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
