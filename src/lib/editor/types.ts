/** Browser editor project model. Non-destructive: the uploaded files are
 * never modified - the project only describes which source ranges play in
 * which order, how they look, what joins them, what's drawn on top and what
 * audio plays. The backend's export (backend/app/pipeline/editor.py)
 * renders exactly this model; everything here is plain JSON so it fits in
 * undo history and IndexedDB.
 */
import type { InteractionEvent, RecordingManifest, TrackKind } from "../recorder/format.ts";

export type TransitionType =
  | "fade"
  | "crossfade"
  | "dipblack"
  | "dipwhite"
  | "slideleft"
  | "slideright"
  | "zoom"
  | "blur";

export interface Transition {
  type: TransitionType;
  duration: number; // seconds
}

// --- Look: filter preset + manual adjustments (see look.ts) --------------

export type FilterId =
  | "original"
  | "cinematic"
  | "warm"
  | "cool"
  | "vintage"
  | "bw"
  | "vibrant"
  | "dramatic"
  | "soft"
  | "fade";

/** All values are 0 at neutral; ranges are -100..100 except sharpness/blur
 * (0..100) and opacity (0..100, 100 = neutral).
 */
export interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  sharpness: number;
  blur: number;
  opacity: number;
}

export interface Look {
  filter: FilterId;
  intensity: number; // 0..100
  adjust: Adjustments;
}

/** Placement of the video inside the canvas, on top of the fit mode:
 * x/y are the center as a fraction of the canvas, scale multiplies the
 * fitted size, rotation is degrees clockwise.
 */
export interface VideoTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

/** Part of the source frame to keep, as fractions of its width/height. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A playable range of one source. `start`/`end` are source time; where
 * the clip sits on the timeline is derived from clip order (see layout()).
 * A freeze clip shows the single source frame at `freeze` instead, and its
 * `start`/`end` only measure how long it holds.
 */
export interface Clip {
  id: string;
  sourceId: string;
  start: number;
  end: number;
  freeze: number | null;
  /** Plays the range backwards (picture and sound). */
  reverse: boolean;
  crop: Crop;
  /** Transition into the *next* clip; ignored on the last clip. */
  transition: Transition | null;
  speed: number; // 0.5..2
  volume: number; // 0..2 (1 = original); 0 after "Extract audio"
  transform: VideoTransform;
  look: Look;
}

// --- Overlays: stickers, text and images share one layer model ----------

export type AnimIn = "none" | "fade" | "pop" | "zoomin" | "slideup" | "slidedown" | "slideleft" | "slideright";
export type AnimOut = "none" | "fade" | "zoomout" | "slideup" | "slidedown" | "slideleft" | "slideright";

export interface TextStyle {
  content: string;
  font: string; // key of TEXT_FONTS
  size: number; // font size as a fraction of canvas height
  weight: 400 | 700 | 900;
  italic: boolean;
  color: string;
  background: string;
  backgroundOpacity: number; // 0..1
  strokeColor: string;
  strokeWidth: number; // fraction of font size, 0 = none
  shadow: boolean;
  align: "left" | "center" | "right";
  letterSpacing: number; // em
  lineHeight: number; // multiple of font size
}

interface OverlayBase {
  id: string;
  start: number; // timeline seconds
  end: number;
  x: number; // center, fraction of canvas width
  y: number; // center, fraction of canvas height
  /** Width as a fraction of canvas width (stickers/images). Text sizes
   * itself from `text.size` instead and ignores this. */
  width: number;
  rotation: number; // degrees, clockwise
  opacity: number; // 0..1
  animIn: AnimIn;
  animOut: AnimOut;
  hidden: boolean;
  locked: boolean;
  /** Made by auto captions - restyled / replaced together. */
  caption?: boolean;
  /** A keyboard-shortcut indicator made from recorded shortcut events. */
  keystroke?: boolean;
}

// --- Annotations: shapes drawn as PNGs like text (see shapes.ts) ----------

export type ShapeType = "arrow" | "circle" | "rect" | "step" | "callout" | "outline";

export interface ShapeStyle {
  type: ShapeType;
  color: string;
  /** Filled body (circle, rect, step badge, callout) or outline only. */
  filled: boolean;
  /** Line width as a fraction of the shape's short side. */
  stroke: number;
  /** Width / height of the shape (arrow length vs head, rect proportions). */
  aspect: number;
  /** Numbered steps. */
  number: number;
  /** Callout text. */
  text: string;
}

export type Overlay =
  | (OverlayBase & { kind: "sticker"; stickerId: string })
  | (OverlayBase & { kind: "image"; sourceId: string })
  | (OverlayBase & { kind: "text"; text: TextStyle })
  /** Picture-in-picture: a video playing from `offset` (source seconds)
   * for the layer's time range, with its own sound at `volume` (0..2). */
  | (OverlayBase & { kind: "video"; sourceId: string; offset: number; volume: number })
  /** Arrow, highlight circle, rectangle, numbered step, callout, focus outline. */
  | (OverlayBase & { kind: "shape"; shape: ShapeStyle });

// --- Audio and effects ----------------------------------------------------

export interface AudioClip {
  id: string;
  sourceId: string; // an audio upload, or a video source for extracted audio
  label: string;
  start: number; // timeline seconds
  offset: number; // where in the source it starts
  duration: number;
  volume: number; // 0..2
  fadeIn: number; // seconds
  fadeOut: number;
  muted: boolean;
}

export type EffectType =
  | "blur"
  | "motionblur"
  | "glitch"
  | "vhs"
  | "grain"
  | "noise"
  | "pixelate"
  | "rgbsplit"
  | "flash"
  | "shake"
  | "zoom";

export interface EffectClip {
  id: string;
  type: EffectType;
  start: number;
  end: number;
  intensity: number; // 0..100
}

// --- Canvas -----------------------------------------------------------------

export type CanvasAspect = "original" | "16:9" | "9:16" | "1:1" | "4:5" | "4:3";

/** The main video as a card on the background (screen recordings): an
 * inset from the canvas edges, rounded corners and a drop shadow. Absent
 * = none. Preview (PreviewPlayer) and export (editor.py _clip_graph) use
 * the same numbers. */
export interface CanvasFrame {
  /** Inset on each side, 0..0.2 of the canvas: the video box shrinks by
   * 1 - 2 * padding. */
  padding: number;
  /** Corner radius, 0..0.1 of the canvas's short side. */
  radius: number;
  /** Shadow strength, 0..1. */
  shadow: number;
}

export interface Canvas {
  aspect: CanvasAspect;
  fit: "fit" | "fill";
  frame?: CanvasFrame;
  background:
    | { type: "color"; color: string }
    | { type: "gradient"; color: string; color2: string }
    | { type: "blur" }
    | { type: "image"; sourceId: string };
}

// --- Screen-recording focus effects (see camera.ts, pointer.ts, focus.ts) ---

export type ZoomEase = "smooth" | "gentle" | "linear";

/** A focus zoom on a recorded source. Times are *source* seconds (like a
 * clip's start/end), so trimming, splitting or moving clips keeps every
 * zoom on the same moment of the recording. The camera eases in over
 * `easeIn` from `start`, holds, and eases back out over `easeOut` before
 * `end`; zooms closer than CHAIN_GAP pan straight from one to the next.
 */
export interface CameraZoom {
  id: string;
  sourceId: string;
  start: number;
  end: number;
  /** 1 = no zoom; the visible area is 1/zoom of the (cropped) frame. */
  zoom: number;
  /** Focus point, fractions of the full source frame. */
  x: number;
  y: number;
  easeIn: number;
  easeOut: number;
  ease: ZoomEase;
  enabled: boolean;
  /** Made by the analyzer and not edited since - re-analysis replaces it. */
  auto: boolean;
  /** Why it was suggested, e.g. "3 clicks" or "Marker 2". */
  reason?: string;
  /** Where the focus moves while zoomed in (source time, frame fractions):
   * the camera pans so it is at each point by its time - following clicks,
   * a drag or the text cursor while typing. Starts at x/y; sorted by t.
   * Set by the analyzer; moving the focus by hand removes it. */
  path?: ZoomPathPoint[];
}

export interface ZoomPathPoint {
  t: number;
  x: number;
  y: number;
}

/** How recorded pointer activity is drawn over recorded sources. */
export interface PointerStyle {
  /** Draw a reconstructed cursor. Only offered when the recording itself
   * doesn't show the system cursor (no duplicate cursors). */
  cursor: boolean;
  /** Cursor height as a fraction of canvas height. */
  cursorSize: number;
  cursorColor: string;
  /** 0 = raw positions, 1 = heavy smoothing; clicks always stay exact. */
  smoothing: number;
  clicks: boolean;
  leftColor: string;
  rightColor: string;
  /** Ring radius at full size, fraction of canvas height. */
  ringSize: number;
  /** Seconds. */
  ringDuration: number;
  /** 0..1: ring opacity and how far it grows. */
  intensity: number;
}

// --- Tutorial tools (Phase 3) -------------------------------------------------

export type MaskMode = "blur" | "pixelate" | "solid";

/** A privacy mask over part of the picture for a time range (timeline
 * seconds). In "canvas" space the rectangle is fractions of the output
 * canvas; in "video" space it is fractions of a source's frame, so it stays
 * on the same content through crops and focus zooms. "pointer" keeps the
 * rectangle centered on the recorded pointer (recordings only). */
export interface PrivacyMask {
  id: string;
  start: number;
  end: number;
  mode: MaskMode;
  /** 0..100: blur radius / pixel block size. */
  strength: number;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  space: "canvas" | "video";
  sourceId?: string;
  follow: "none" | "pointer";
  enabled: boolean;
  label?: string;
}

export type SuggestionKind =
  | "silence"
  | "dead-time"
  | "clipping"
  | "loud"
  | "quiet"
  | "idle"
  | "repeated-clicks"
  | "possible-retake"
  | "navigation"
  | "milestone"
  | "retake";

/** Something worth a look, in timeline seconds. Suggestions never change
 * the edit by themselves: "cut" ones remove their range only when the
 * user accepts them; "retake" ones are sections the user marked for
 * replacement. */
export interface EditSuggestion {
  id: string;
  kind: SuggestionKind;
  start: number;
  end: number;
  title: string;
  detail: string;
  action: "cut" | "review" | "retake";
  status: "pending" | "accepted" | "rejected";
  confidence: "low" | "medium" | "high";
}

export interface Chapter {
  id: string;
  /** Timeline seconds. */
  t: number;
  title: string;
  /** Suggested and not edited since. */
  auto: boolean;
}

/** The undoable part of the editor state. */
export interface Project {
  clips: Clip[];
  /** Bottom-to-top stacking order. */
  overlays: Overlay[];
  audio: AudioClip[];
  effects: EffectClip[];
  canvas: Canvas;
  /** Focus zooms on recorded sources (desktop recordings). */
  zooms?: CameraZoom[];
  /** Click/cursor drawing for recorded sources; null/absent = off. */
  pointer?: PointerStyle | null;
  /** Privacy masks (blur / pixelate / solid), drawn above the video. */
  masks?: PrivacyMask[];
  /** Review items from silence and interaction analysis, or user marks. */
  suggestions?: EditSuggestion[];
  chapters?: Chapter[];
  /** Word-timed transcript of the timeline's speech, for editing by text
   * (wordEdit.ts). Kept in sync by ripple cuts and inserts; `total` is the
   * timeline length it matches, so other edits show it's out of date. */
  transcript?: Transcript;
}

export interface TranscriptWord {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  language: string;
  words: TranscriptWord[];
  total: number;
}

/** An imported or generated file. Kept outside Project (and so outside
 * undo history - it holds the actual File) and only ever added to, so
 * undoing e.g. an AI cleanup just points the clip back at the original.
 */
export interface MediaSource {
  id: string;
  /** "layer": a video imported for a picture-in-picture layer. */
  kind: "original" | "cleaned" | "audio" | "image" | "layer" | "take";
  /** The file's contents; null for a source that stays on disk (`disk`),
   * whose bytes are read only when needed (sourceFile.ts). */
  file: File | null;
  /** Desktop: the file on the user's disk this source is edited in place
   * from (src-tauri/src/media.rs). */
  disk?: DiskMedia;
  url: string; // object URL, or the asset protocol URL of a disk source
  duration: number; // 0 for images
  width: number; // display size; 0 for audio
  height: number;
  fps: number;
  hasAudio: boolean;
  /** Set on sources that came from a desktop screen recording. */
  recording?: RecordingAttachment;
}

/** A file that stays where it is on the user's disk (desktop app). */
export interface DiskMedia {
  path: string;
  name: string;
  size: number;
  /** Media type from the extension, e.g. "video/mp4". */
  type: string;
}

/** What a recorded source keeps from its recording (src/lib/recorder/
 * format.ts): the capture details, and - on the screen source only - the
 * interaction events, in that source's own time (recording ms), so they
 * map through clip trims and splits like the picture does. */
export interface RecordingAttachment {
  trackKind: TrackKind;
  /** The recording folder on disk. */
  folder: string;
  manifest: RecordingManifest;
  events: InteractionEvent[];
  /** Added to manifest times (markers, screenshots) to match the media;
   * `events` already include it (recorder/importPlan.ts alignRecording). */
  timeOffsetMs?: number;
}

export type Selection =
  | { kind: "clip"; id: string }
  | { kind: "transition"; clipId: string }
  | { kind: "overlay"; id: string }
  | { kind: "audio"; id: string }
  | { kind: "effect"; id: string }
  | { kind: "zoom"; id: string }
  | { kind: "mask"; id: string }
  | { kind: "chapter"; id: string }
  | null;

// --- Defaults & migration ----------------------------------------------------

export const NEUTRAL_ADJUST: Adjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  sharpness: 0,
  blur: 0,
  opacity: 100,
};

export const DEFAULT_LOOK: Look = { filter: "original", intensity: 100, adjust: NEUTRAL_ADJUST };
export const DEFAULT_TRANSFORM: VideoTransform = { x: 0.5, y: 0.5, scale: 1, rotation: 0 };
export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };
export const DEFAULT_CANVAS: Canvas = { aspect: "original", fit: "fit", background: { type: "color", color: "#000000" } };

export function newClip(id: string, sourceId: string, start: number, end: number): Clip {
  return {
    id,
    sourceId,
    start,
    end,
    freeze: null,
    reverse: false,
    crop: FULL_CROP,
    transition: null,
    speed: 1,
    volume: 1,
    transform: DEFAULT_TRANSFORM,
    look: DEFAULT_LOOK,
  };
}

/** Brings a project saved by an earlier editor version (Phase 1: clips +
 * stickers only) up to the current shape, filling defaults.
 */
export function migrateProject(raw: unknown): Project {
  const p = (raw ?? {}) as Record<string, unknown>;
  const clips = ((p.clips as Partial<Clip>[]) ?? []).map((c) => ({
    ...newClip(c.id!, c.sourceId!, c.start!, c.end!),
    ...c,
    look: { ...DEFAULT_LOOK, ...c.look, adjust: { ...NEUTRAL_ADJUST, ...c.look?.adjust } },
    transform: { ...DEFAULT_TRANSFORM, ...c.transform },
    crop: { ...FULL_CROP, ...c.crop },
  })) as Clip[];

  let overlays = (p.overlays as Overlay[]) ?? [];
  const legacyStickers = (p.stickers as Record<string, unknown>[] | undefined) ?? [];
  if (legacyStickers.length && overlays.length === 0) {
    const mapAnim = (a: unknown) => (a === "slide" ? "slideright" : a);
    overlays = legacyStickers.map((s) => ({
      ...(s as object),
      kind: "sticker",
      opacity: 1,
      hidden: false,
      locked: false,
      animIn: mapAnim(s.animIn) as AnimIn,
      animOut: mapAnim(s.animOut) as AnimOut,
    })) as Overlay[];
  }

  return {
    clips,
    overlays,
    audio: (p.audio as AudioClip[]) ?? [],
    effects: (p.effects as EffectClip[]) ?? [],
    canvas: { ...DEFAULT_CANVAS, ...(p.canvas as Canvas | undefined) },
    zooms: ((p.zooms as Partial<CameraZoom>[] | undefined) ?? []).map(
      (z) => ({ ...z, ease: z.ease ?? ("smooth" as ZoomEase), enabled: z.enabled ?? true, auto: z.auto ?? false }) as CameraZoom
    ),
    pointer: p.pointer ? { ...DEFAULT_POINTER, ...(p.pointer as PointerStyle) } : null,
    masks: ((p.masks as Partial<PrivacyMask>[] | undefined) ?? []).map(
      (m) => ({ mode: "blur", strength: 60, color: "#000000", space: "canvas", follow: "none", enabled: true, ...m }) as PrivacyMask
    ),
    suggestions: (p.suggestions as EditSuggestion[] | undefined) ?? [],
    chapters: (p.chapters as Chapter[] | undefined) ?? [],
    ...(p.transcript ? { transcript: p.transcript as Transcript } : {}),
  };
}

export const DEFAULT_POINTER: PointerStyle = {
  cursor: false,
  cursorSize: 0.045,
  cursorColor: "#ffffff",
  smoothing: 0.5,
  clicks: true,
  leftColor: "#22d3ee",
  rightColor: "#f59e0b",
  ringSize: 0.05,
  ringDuration: 0.5,
  intensity: 0.8,
};
