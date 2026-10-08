/** Browser editor project model. Non-destructive: the uploaded files are
 * never modified - the project only describes which source ranges play in
 * which order, how they look, what joins them, what's drawn on top and what
 * audio plays. The backend's export (backend/app/pipeline/editor.py)
 * renders exactly this model; everything here is plain JSON so it fits in
 * undo history and IndexedDB.
 */

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
}

export type Overlay =
  | (OverlayBase & { kind: "sticker"; stickerId: string })
  | (OverlayBase & { kind: "image"; sourceId: string })
  | (OverlayBase & { kind: "text"; text: TextStyle })
  /** Picture-in-picture: a video playing from `offset` (source seconds)
   * for the layer's time range, with its own sound at `volume` (0..2). */
  | (OverlayBase & { kind: "video"; sourceId: string; offset: number; volume: number });

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

export interface Canvas {
  aspect: CanvasAspect;
  fit: "fit" | "fill";
  background:
    | { type: "color"; color: string }
    | { type: "gradient"; color: string; color2: string }
    | { type: "blur" }
    | { type: "image"; sourceId: string };
}

/** The undoable part of the editor state. */
export interface Project {
  clips: Clip[];
  /** Bottom-to-top stacking order. */
  overlays: Overlay[];
  audio: AudioClip[];
  effects: EffectClip[];
  canvas: Canvas;
}

/** An imported or generated file. Kept outside Project (and so outside
 * undo history - it holds the actual File) and only ever added to, so
 * undoing e.g. an AI cleanup just points the clip back at the original.
 */
export interface MediaSource {
  id: string;
  /** "layer": a video imported for a picture-in-picture layer. */
  kind: "original" | "cleaned" | "audio" | "image" | "layer";
  file: File;
  url: string; // object URL
  duration: number; // 0 for images
  width: number; // display size; 0 for audio
  height: number;
  fps: number;
  hasAudio: boolean;
}

export type Selection =
  | { kind: "clip"; id: string }
  | { kind: "transition"; clipId: string }
  | { kind: "overlay"; id: string }
  | { kind: "audio"; id: string }
  | { kind: "effect"; id: string }
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
  };
}
