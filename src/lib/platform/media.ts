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
/** A playable URL for a matted webcam video the engine made (webcam
 * background removal; media.rs matte_open allows only its cache). */
export async function matteUrl(path: string): Promise<string> {
  const { invoke, convertFileSrc } = await core();
  await invoke("matte_open", { path });
  return convertFileSrc(path);
}

export async function diskMediaUrl(path: string): Promise<string> {
  const { convertFileSrc } = await core();
  return convertFileSrc(path);
}

/** Bytes asked for per request; the asset protocol answers at most about
 * 1 MB of a range, and the loop takes whatever comes. */
const RANGE_BYTES = 8 * 1024 * 1024;
const RETRY_MS = [300, 1000, 3000];

/** A disk file's contents as a File. Reads it whole (the browser may keep
 * a large one in its own temporary storage rather than memory).
 *
 * In range requests, the way the video player reads it: whole-file
 * requests to the asset protocol fail ("Failed to fetch" after a 200)
 * when two run at once - the waveform and captions reading the same video -
 * and keep failing for a few seconds after, so captions said the video had
 * no sound. Range requests didn't fail, even three readers at once (WebView2,
 * Windows 11). A failed range is tried again a few times. */
export async function readDiskFile(media: DiskMedia): Promise<File> {
  const url = await diskMediaUrl(media.path);
  const unreadable = () => new Error(`"${media.name}" can't be read. It may have been moved or deleted.`);
  const parts: Blob[] = [];
  let at = 0;
  let total = Infinity;
  while (at < total) {
    const { status, part, range } = await readRange(url, at, unreadable);
    if (status === 200) return new File([part], media.name, { type: media.type }); // the whole file after all
    total = Number(/\/(\d+)$/.exec(range ?? "")?.[1] ?? at + part.size);
    if (part.size === 0) throw unreadable();
    parts.push(part);
    at += part.size;
  }
  return new File(parts, media.name, { type: media.type });
}

/** One range, fetched and read, tried again after a failure. */
async function readRange(url: string, at: number, unreadable: () => Error): Promise<{ status: number; part: Blob; range: string | null }> {
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${at}-${at + RANGE_BYTES - 1}` } });
      status = res.status;
      if (res.ok) return { status, part: await res.blob(), range: res.headers.get("content-range") };
    } catch {
      // Failed to fetch, or the body broke off: try again.
    }
    // Not allowed or gone: trying again won't help.
    if (status === 403 || status === 404 || attempt >= RETRY_MS.length) throw unreadable();
    await new Promise((r) => setTimeout(r, RETRY_MS[attempt]));
  }
}
