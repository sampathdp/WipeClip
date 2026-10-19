/** Reading a recording folder back: for the review screen, for opening it
 * in the editor, and for recovering one the app didn't get to finalize.
 */
import { recordingRead, recordingUpdateManifest, type FoundRecording } from "@/lib/platform/recorder";
import {
  decodeEvents,
  parseManifest,
  serializeManifest,
  type InteractionEvent,
  type RecordingManifest,
  type TrackKind,
} from "./format";
import { fileTypeFor } from "./mime";

/** Same limit as the editor's own import (VideoEditor MAX_BYTES): the
 * editor keeps sources in memory and export uploads them. */
export const EDITOR_MAX_VIDEO_BYTES = 300 * 1024 * 1024;

export interface RecordingBundle {
  path: string;
  manifest: RecordingManifest;
  files: Partial<Record<TrackKind, File>>;
  events: InteractionEvent[];
}

export class RecordingTooLargeError extends Error {}

export async function readTrackFile(path: string, manifest: RecordingManifest, kind: TrackKind): Promise<File | null> {
  const track = manifest.tracks.find((t) => t.kind === kind);
  if (!track || track.bytes === 0) return null;
  const bytes = await recordingRead(path, track.path);
  if (bytes.byteLength === 0) return null;
  return new File([bytes], track.path, { type: fileTypeFor(track.mimeType) });
}

export async function readEvents(path: string, manifest: RecordingManifest): Promise<InteractionEvent[]> {
  if (!manifest.input.path) return [];
  try {
    const text = new TextDecoder().decode(await recordingRead(path, manifest.input.path));
    return decodeEvents(text).events;
  } catch (e) {
    console.error("[recorder] events unreadable", e);
    return [];
  }
}

/** Everything the editor needs. Throws RecordingTooLargeError when the
 * screen video is over the editor's limit (it stays on disk either way). */
export async function loadRecordingBundle(path: string, manifest: RecordingManifest): Promise<RecordingBundle> {
  const screenTrack = manifest.tracks.find((t) => t.kind === "screen");
  if (!screenTrack || screenTrack.bytes === 0) throw new Error("This recording has no screen video.");
  const tooBig = manifest.tracks.find((t) => t.hasVideo && t.bytes > EDITOR_MAX_VIDEO_BYTES);
  if (tooBig) {
    throw new RecordingTooLargeError(
      `This recording's ${tooBig.kind === "webcam" ? "webcam video" : "video"} is ${Math.round(tooBig.bytes / 1024 / 1024)} MB; the editor opens videos up to 300 MB. It's saved in its folder - record shorter takes or at a lower quality to edit here.`
    );
  }
  const files: RecordingBundle["files"] = {};
  for (const t of manifest.tracks) {
    const f = await readTrackFile(path, manifest, t.kind);
    if (f) files[t.kind] = f;
  }
  return { path, manifest, files, events: await readEvents(path, manifest) };
}

/** Finalizes an interrupted recording from what reached the disk: track
 * sizes from the folder, length from the last stored event, status
 * "recovered". Media written incrementally (fragmented MP4 / WebM) plays
 * up to the last complete chunk. */
export async function recoverRecording(found: FoundRecording): Promise<{ path: string; manifest: RecordingManifest }> {
  const m = parseManifest(found.manifest);
  const tracks = m.tracks
    .map((t) => ({ ...t, bytes: found.sizes[t.path] ?? 0 }))
    .filter((t) => t.bytes > 0);
  if (!tracks.some((t) => t.kind === "screen")) throw new Error("Nothing of the screen video was saved before WipeClip closed.");
  const events = await readEvents(found.path, m);
  const lastEvent = events.length ? events[events.length - 1].t : 0;
  const durationMs = Math.max(m.durationMs, Math.round(lastEvent));
  const manifest: RecordingManifest = {
    ...m,
    status: "recovered",
    updatedAt: new Date().toISOString(),
    durationMs,
    tracks: tracks.map((t) => ({ ...t, durationMs: t.durationMs || durationMs })),
    input: { ...m.input, eventCount: events.length },
    warnings: [...m.warnings, "Recovered after WipeClip closed during recording; the last seconds may be missing."],
  };
  await recordingUpdateManifest(found.path, serializeManifest(manifest));
  return { path: found.path, manifest };
}

/** Duration and size of a recorded file as the WebView decodes it.
 * MediaRecorder's WebM has no duration in its header (the browser reports
 * Infinity until it has seen the end), so this seeks to the end once to
 * make the browser find it; `fallbackSec` is used if that fails. */
export function probeRecordedMedia(
  url: string,
  video: boolean,
  fallbackSec: number
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(video ? "video" : "audio") as HTMLVideoElement;
    el.muted = true;
    el.preload = "metadata";
    let settled = false;
    // Metadata loaded but the end never found: trust the recorder's clock.
    const timer = setTimeout(() => finish(el.readyState >= 1 && fallbackSec > 0 ? null : new Error("media_error")), 15_000);
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : fallbackSec;
      const result = { duration: d, width: video ? el.videoWidth : 0, height: video ? el.videoHeight : 0 };
      el.removeAttribute("src");
      el.load();
      if (err || !(d > 0)) reject(err ?? new Error("media_error"));
      else resolve(result);
    };
    el.onerror = () => finish(new Error("media_error"));
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) return finish(null);
      el.ondurationchange = () => {
        if (Number.isFinite(el.duration) && el.duration > 0) {
          el.currentTime = 0;
          finish(null);
        }
      };
      el.currentTime = 1e9;
    };
    el.src = url;
  });
}
