/** Videos that stay where they are on disk (desktop app; see
 * src-tauri/src/media.rs). Played through the asset protocol, so a large
 * video is streamed rather than loaded into memory; read whole only when
 * bytes are really needed (waveform, captions, project files, the cloud
 * fallback without the local engine).
 */
import type { DiskMedia } from "../editor/types.ts";
import { IS_DESKTOP } from "./env.ts";

const TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

/** Media type from a file name's extension ("" when unknown). */
export function mediaTypeFor(name: string): string {
  return TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

async function core() {
  return import("@tauri-apps/api/core");
}

/** The OS open dialog for a video to edit in place; null if cancelled or
 * not the desktop app. `locate`: name of a missing video being found again. */
export async function chooseVideoOnDisk(locate?: string): Promise<DiskMedia | null> {
  if (!IS_DESKTOP) return null;
  const { invoke } = await core();
  const f = await invoke<{ path: string; name: string; size: number } | null>("media_choose", { locate: locate ?? null });
  return f ? { ...f, type: mediaTypeFor(f.name) } : null;
}

/** Makes paths playable; per path whether it exists and may be used. */
export async function openDiskMedia(paths: string[]): Promise<Map<string, { ok: boolean; size: number }>> {
  if (!IS_DESKTOP || paths.length === 0) return new Map();
  const { invoke } = await core();
  const list = await invoke<{ path: string; ok: boolean; size: number }[]>("media_open", { paths });
  return new Map(list.map((m) => [m.path, { ok: m.ok, size: m.size }]));
}

/** The URL a disk file plays from (after openDiskMedia or chooseVideoOnDisk). */
export async function diskMediaUrl(path: string): Promise<string> {
  const { convertFileSrc } = await core();
  return convertFileSrc(path);
}

/** A disk file's contents as a File. Reads it whole (the browser may keep
 * a large one in its own temporary storage rather than memory). */
export async function readDiskFile(media: DiskMedia): Promise<File> {
  const res = await fetch(await diskMediaUrl(media.path));
  if (!res.ok) throw new Error(`"${media.name}" can't be read. It may have been moved or deleted.`);
  return new File([await res.blob()], media.name, { type: media.type });
}
