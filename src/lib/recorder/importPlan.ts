/** How a finished recording becomes an editor project: the screen video is
 * the main clip (cropped to the selected region, non-destructively),
 * system audio and microphone become their own audio tracks, the webcam a
 * picture-in-picture layer - all lined up by each track's start offset so
 * they stay in sync. Pure - see tests/desktop/recorder.test.ts.
 */
import { DEFAULT_MATTE } from "../editor/matte.ts";
import { DEFAULT_CANVAS, newClip, type AudioClip, type Overlay, type Project } from "../editor/types.ts";
import type { RecordingManifest, RecordingTrack, TrackKind } from "./format.ts";

export interface ImportedTrack {
  track: RecordingTrack;
  sourceId: string;
  /** Duration the browser decoded, seconds. */
  duration: number;
  width: number;
  height: number;
}

export interface RecordingPlan {
  project: Project;
  /** Tracks that couldn't be placed (e.g. zero length), with why. */
  skipped: { kind: TrackKind; reason: string }[];
}

const AUDIO_LABELS: Partial<Record<TrackKind, string>> = { "system-audio": "System audio", microphone: "Microphone" };

/** A track starting `offsetSec` after the screen sits there on the
 * timeline; one that started earlier is trimmed so it still lines up. */
function align(offsetSec: number) {
  return offsetSec >= 0 ? { start: offsetSec, offset: 0 } : { start: 0, offset: -offsetSec };
}

export function planRecordingProject(manifest: RecordingManifest, tracks: ImportedTrack[], ids: () => string): RecordingPlan {
  const screen = tracks.find((t) => t.track.kind === "screen");
  if (!screen) throw new Error("This recording has no screen video.");
  const skipped: RecordingPlan["skipped"] = [];
  const total = screen.duration;

  const clip = newClip(ids(), screen.sourceId, 0, total);
  const region = manifest.capture.region;
  if (region) clip.crop = { x: region.x, y: region.y, w: region.width, h: region.height };

  const audio: AudioClip[] = [];
  const overlays: Overlay[] = [];
  for (const t of tracks) {
    if (t === screen) continue;
    const { start, offset } = align(t.track.startOffsetMs / 1000);
    const duration = Math.min(t.duration - offset, total - start);
    if (!(duration > 0.05)) {
      skipped.push({ kind: t.track.kind, reason: "too short to place on the timeline" });
      continue;
    }
    if (t.track.kind === "webcam") {
      overlays.push(webcamLayer(ids(), t, start, start + duration, offset, screenAspect(screen, manifest)));
    } else {
      audio.push({
        id: ids(),
        sourceId: t.sourceId,
        label: AUDIO_LABELS[t.track.kind] ?? t.track.kind,
        start,
        offset,
        duration,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        muted: false,
      });
    }
  }

  return { project: { clips: [clip], overlays, audio, effects: [], canvas: DEFAULT_CANVAS }, skipped };
}

/** Aspect ratio of the canvas a recording opens in: the cropped region's,
 * since the canvas follows the (cropped) original. */
function screenAspect(screen: ImportedTrack, manifest: RecordingManifest): number {
  const r = manifest.capture.region;
  const w = screen.width * (r ? r.width : 1);
  const h = screen.height * (r ? r.height : 1);
  return w > 0 && h > 0 ? w / h : 16 / 9;
}

/** Bottom-right corner, a quarter of the canvas wide, 3% margins. */
function webcamLayer(id: string, cam: ImportedTrack, start: number, end: number, offset: number, canvasAspect: number): Overlay {
  const width = 0.25;
  const camAspect = cam.width > 0 && cam.height > 0 ? cam.width / cam.height : 16 / 9;
  const heightFrac = (width / camAspect) * canvasAspect;
  return {
    id,
    kind: "video",
    sourceId: cam.sourceId,
    offset,
    volume: 0, // its sound is the microphone track
    start,
    end,
    x: 1 - 0.03 - width / 2,
    y: 1 - 0.03 * canvasAspect - heightFrac / 2,
    width,
    rotation: 0,
    opacity: 1,
    animIn: "none",
    animOut: "none",
    hidden: false,
    locked: false,
    // The background picked in the recorder (validated: the manifest is a file on disk).
    ...(cam.track.background === "remove" || cam.track.background === "blur" ? { matte: { ...DEFAULT_MATTE, mode: cam.track.background } } : {}),
  };
}

/** Re-derives timing from what the files actually contain, because a
 * recorder's "start" event can lag the media it records (measured on
 * WebView2: the H.264 screen recorder's start event ~0.35 s after the
 * audio ones, while all three files covered the same span).
 *
 * - `lagMs`: how much longer the decoded screen video is than the
 *   recording clock measured; events were timed from the clock's start, so
 *   they're shifted by it to land on the right frames.
 * - Other tracks stop together with the screen (unless they ended early),
 *   so each one's start offset is the difference of the decoded lengths.
 * Differences over 2 s are treated as unreliable and left alone. */
export function alignRecording(manifest: RecordingManifest, tracks: ImportedTrack[]): { tracks: ImportedTrack[]; lagMs: number } {
  const screen = tracks.find((t) => t.track.kind === "screen");
  if (!screen || !(screen.duration > 0)) return { tracks, lagMs: 0 };
  const lag = screen.duration - manifest.durationMs / 1000;
  const lagMs = manifest.durationMs > 0 && lag > 0.03 && lag < 2 ? Math.round(lag * 1000) : 0;
  const aligned = tracks.map((t) => {
    if (t === screen || t.track.endedEarly || !(t.duration > 0)) return t;
    const off = screen.duration - t.duration;
    return Math.abs(off) <= 2 ? { ...t, track: { ...t.track, startOffsetMs: Math.round(off * 1000) } } : t;
  });
  return { tracks: aligned, lagMs };
}
