/** A recording folder's files as editor media sources - shared by opening
 * a recording as a project (VideoEditor importRecording) and replacing a
 * section with a retake (useTutorialTools). Local only: recordings are the
 * user's own captures on their disk and aren't uploaded for a check; they
 * stay in their folder and play from there (disk sources). */
import { newId } from "@/lib/editor/timeline";
import type { MediaSource } from "@/lib/editor/types";
import { diskMediaUrl } from "@/lib/platform/media";
import { probeRecordedMedia, type RecordingBundle } from "./bundle";
import { alignRecording, type ImportedTrack } from "./importPlan";

export async function recordingToSources(
  bundle: RecordingBundle,
  screenKind: "original" | "take"
): Promise<{ made: MediaSource[]; imported: ImportedTrack[] }> {
  const { manifest, files } = bundle;
  const made: MediaSource[] = [];
  const imported: ImportedTrack[] = [];
  for (const track of manifest.tracks) {
    const disk = files[track.kind];
    if (!disk) continue;
    const url = await diskMediaUrl(disk.path);
    let meta: { duration: number; width: number; height: number };
    try {
      meta = await probeRecordedMedia(url, track.hasVideo, track.durationMs / 1000);
    } catch (e) {
      if (track.kind === "screen") throw e;
      continue; // a broken side track shouldn't block the screen video
    }
    const kind = track.kind === "screen" ? screenKind : track.kind === "webcam" ? "layer" : "audio";
    const src: MediaSource = {
      id: newId(track.kind === "screen" ? "src" : kind === "layer" ? "lyr" : "snd"),
      kind,
      file: null,
      disk,
      url,
      duration: meta.duration,
      width: meta.width,
      height: meta.height,
      fps: track.hasVideo ? manifest.capture.video.frameRate || 30 : 0,
      hasAudio: track.hasAudio,
      recording: { trackKind: track.kind, folder: bundle.path, manifest, events: track.kind === "screen" ? bundle.events : [] },
    };
    made.push(src);
    imported.push({ track, sourceId: src.id, duration: meta.duration, width: meta.width, height: meta.height });
  }
  // Correct timing from the decoded lengths (see alignRecording).
  const { tracks, lagMs } = alignRecording(manifest, imported);
  const screen = made.find((s) => s.recording?.trackKind === "screen");
  if (screen?.recording && lagMs) {
    screen.recording = { ...screen.recording, timeOffsetMs: lagMs, events: screen.recording.events.map((e) => ({ ...e, t: e.t + lagMs })) };
  }
  return { made, imported: tracks };
}
