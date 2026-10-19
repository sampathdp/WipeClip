/** A recording folder's files as editor media sources - shared by opening
 * a recording as a project (VideoEditor importRecording) and replacing a
 * section with a retake (useTutorialTools). Local only: recordings are the
 * user's own captures on their disk and aren't uploaded for a check. */
import { newId } from "@/lib/editor/timeline";
import type { MediaSource } from "@/lib/editor/types";
import { probeRecordedMedia, type RecordingBundle } from "./bundle";
import { alignRecording, type ImportedTrack } from "./importPlan";

export async function recordingToSources(
  bundle: RecordingBundle,
  screenKind: "original" | "take"
): Promise<{ made: MediaSource[]; imported: ImportedTrack[] }> {
  const { manifest, files } = bundle;
  const made: MediaSource[] = [];
  const imported: ImportedTrack[] = [];
  try {
    for (const track of manifest.tracks) {
      const file = files[track.kind];
      if (!file) continue;
      const url = URL.createObjectURL(file);
      let meta: { duration: number; width: number; height: number };
      try {
        meta = await probeRecordedMedia(url, track.hasVideo, track.durationMs / 1000);
      } catch (e) {
        URL.revokeObjectURL(url);
        if (track.kind === "screen") throw e;
        continue; // a broken side track shouldn't block the screen video
      }
      const kind = track.kind === "screen" ? screenKind : track.kind === "webcam" ? "layer" : "audio";
      const src: MediaSource = {
        id: newId(track.kind === "screen" ? "src" : kind === "layer" ? "lyr" : "snd"),
        kind,
        file,
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
  } catch (e) {
    made.forEach((s) => URL.revokeObjectURL(s.url));
    throw e;
  }
}
