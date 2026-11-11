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
  | "blur"
  | "slideup"
  | "slidedown"
  | "wipeleft"
  | "wiperight"
  | "wipeup"
  | "wipedown"
  | "circleopen"
  | "circleclose"
  | "smoothleft"
  | "smoothright"
  | "smoothup"
  | "smoothdown"
  | "vertopen"
  | "horzopen"
  | "radial"
  | "diagtl"
  | "diagbr"
  | "circlecrop"
  | "rectcrop"
  | "fadegrays";

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

/** Tone curves through (x, y) control points, 0..1 (curves.ts). */
export interface Curves {
  rgb: [number, number][];
  r: [number, number][];
  g: [number, number][];
  b: [number, number][];
}

export interface Look {
  filter: FilterId;
  intensity: number; // 0..100
  adjust: Adjustments;
  /** Applied after the filter and adjustments; absent = none. */
  curves?: Curves;
  /** An imported .cube LUT (a "lut" source), applied first (lut.ts). */
  lut?: { sourceId: string; name: string; intensity: number } | null;
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

export type KeyframeEase = "linear" | "smooth" | "in" | "out";

/** A soft-edged shape that cuts out part of a clip or layer (shapeMask.ts).
 * x/y (center) and w/h are fractions of the clip's box or the layer. */
export interface ShapeMask {
  shape: "circle" | "rect" | "linear" | "mirror";
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number; // degrees
  /** 0..1: edge softness, as a share of half the short side. */
  feather: number;
  /** Shows the outside instead. */
  invert: boolean;
  /** Rectangles: corner radius as a share of half the short side (0..1);
   * absent = square corners. */
  radius?: number;
}

/** One keyframe of a clip's or layer's animation (see keyframes.ts). */
export interface Keyframe {
  /** Clips: source seconds. Layers: seconds from the layer's start. */
  t: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  /** Curve towards the next keyframe. */
  ease: KeyframeEase;
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
  /** Animates transform (x, y, scale, rotation); absent/empty = static. */
  keyframes?: Keyframe[];
  /** Speed curve: speeds at evenly spaced points over the clip, used
   * instead of `speed` (speed.ts). Absent = constant speed. */
  ramp?: number[];
  /** Shape mask over the clip's box; absent = none. */
  mask?: ShapeMask | null;
  /** Stabilization strength 1..100, applied by the export; absent = off. */
  stabilize?: number;
}

// --- Overlays: stickers, text and images share one layer model ----------

export type AnimIn = "none" | "fade" | "pop" | "bounce" | "spin" | "zoomin" | "slideup" | "slidedown" | "slideleft" | "slideright";
export type AnimOut = "none" | "fade" | "pop" | "spin" | "zoomout" | "slideup" | "slidedown" | "slideleft" | "slideright";

/** How a layer mixes with what's under it - CSS mix-blend-mode in the
 * preview, ffmpeg's blend filter in the export. */
export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "add" | "difference";

/** Chroma key on an image or video layer (see chromaKey.ts). */
export interface ChromaKey {
  color: string;
  /** 0..100: how far from the key color still turns transparent. */
  similarity: number;
  /** 0..100: width of the soft edge past that. */
  smoothness: number;
}

export type TextAnim = "none" | "typewriter" | "words" | "karaoke";

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
  /** Letter / word reveal or karaoke highlight (textAnim.ts); absent = none. */
  anim?: TextAnim;
  /** Karaoke: the current word's color. */
  highlight?: string;
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
  /** Absent = normal. */
  blend?: BlendMode;
  /** Image and video layers only; absent = off. */
  key?: ChromaKey | null;
  /** Animates x, y, size (scale), rotation and opacity; absent/empty = static. */
  keyframes?: Keyframe[];
  /** Captions: when each word is spoken, seconds from the layer's start
   * (timing for word-by-word and karaoke text). */
  words?: { start: number; end: number }[];
  /** Shape mask over the layer; absent = none. */
  mask?: ShapeMask | null;
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
  | (OverlayBase & { kind: "video"; sourceId: string; offset: number; volume: number; camLayout?: CamLayout; matte?: WebcamMatte | null })
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
  /** What captions take this track for. "auto" (or unset): detected from
   * the sound (speechDetect.ts); "speech" is captioned, "music" is not. */
  captions?: "auto" | "speech" | "music";
  /** Lowered by `amount` (0..1) while speech plays in `regions`
   * (timeline seconds; ducking.ts). Absent = never lowered. */
  duck?: { amount: number; regions: [number, number][] };
  /** Voice effect (voiceFx.ts); absent = none. */
  voice?: VoiceFx;
  /** Detected beats (beats.ts), in seconds of the audio file, so trims
   * keep them on the music. */
  beats?: { bpm: number; times: number[] };
  /** Noise reduction (mix.ts): a cleaned copy of the whole source file,
   * made on this device and time-aligned with it, played instead of the
   * original unless bypassed. The original is never changed. Absent = off. */
  clean?: AudioCleanup;
  /** Tone: low cut, EQ, de-esser, compressor (voiceTone.ts); absent = untouched. */
  tone?: VoiceTone;
  /** Volume curve (envelope.ts), sorted by time; absent = flat. */
  envelope?: GainPoint[];
  /** Breaths turned down (breaths.ts): [start, end] in seconds of the file. */
  breaths?: [number, number][];
}

/** A point of a track's volume curve: seconds of the audio file, linear
 * gain 0..2 (+6 dB). */
export interface GainPoint {
  t: number;
  v: number;
}

export type TonePreset = "clear" | "podcast" | "warm" | "thin" | "boom";

/** An audio track's tone (voiceTone.ts). */
export interface VoiceTone {
  /** Removes rumble below 80 Hz. */
  lowCut: boolean;
  /** dB, -12..12: low shelf at 120 Hz, peak at 400 Hz, high shelf at 4 kHz. */
  bass: number;
  mid: number;
  treble: number;
  /** 0..1: how much the level is evened out (0 = off). */
  compress: number;
  /** 0..1: how much harsh "s" sounds are softened (0 = off). */
  deEss: number;
  /** The preset it came from, until it's changed by hand. */
  preset?: TonePreset;
}

export interface AudioCleanup {
  sourceId: string;
  /** 0..1, what the copy was made with (audio_clean.py: 6..40 dB). */
  strength: number;
  /** Plays (and exports) the original instead. */
  bypass: boolean;
  /** Clipped peaks were also redrawn (audio_clean.py repair_clipping). */
  repaired?: boolean;
  /** Wind and rumble cut (a steep 120 Hz low cut), mouth clicks removed. */
  wind?: boolean;
  mouth?: boolean;
  /** Echo and reverb reduced at this strength, 1-3 (dereverb.py). */
  echo?: number;
  /** Only the voice kept: background sound and music removed (the separator). */
  isolated?: boolean;
  /** Linear gain the copy plays at: a repaired copy is scaled under full
   * scale, and this brings it back to the original's level. Absent = 1. */
  gain?: number;
}

/** Loudness targets for the whole mix (loudness.ts LOUDNESS_TARGETS). */
export type LoudnessTarget = "off" | "online" | "voice" | "broadcast";

/** The mix bus (mix.ts): the clips' own sound as one track, and loudness
 * normalization. Absent = defaults (video sound at 100%, no
 * normalization). A peak limiter always protects the export. */
export interface MasterAudio {
  /** The clips' own sound, multiplying every clip's volume (0..2). */
  videoVolume: number;
  videoMuted: boolean;
  loudness: LoudnessTarget;
  /** Gain bringing the measured mix to the target, dB. Applied by the
   * preview and the export alike; 0 when off. */
  gainDb: number;
  /** What it was measured from: integrated loudness (LUFS), sample peak
   * (dBFS) and the mix's key (mix.ts mixKey), to tell when it's out of
   * date. Absent = not measured. */
  measured?: { lufs: number; peakDb: number; key: string };
  /** Every audio part fades over a few ms at its edges (mix.ts EDGE_FADE),
   * so a cut doesn't click. Absent = on. */
  smoothCuts?: boolean;
  /** Audio parts cut from one file stay back to back, like the video row
   * (audioMagnet.ts). Absent = off. */
  magnetic?: boolean;
}

/** Webcam background removal on a video layer (matte.ts). Absent = the
 * original picture. The person's mask is made on this machine and cached
 * outside the project (it's derived, made again when missing). */
export interface WebcamMatte {
  /** "remove": clear background; "blur": the webcam's own background,
   * blurred; "image"/"video": another picture behind the person. */
  mode: "remove" | "blur" | "image" | "video";
  /** "fine": color-guided edges (better hair, slower to make); "fast". */
  detail: "fine" | "fast";
  /** -100..100: shrink .. grow the outline. */
  edge: number;
  /** 0..100: edge softness. */
  soft: number;
  /** 0..100: background blur ("blur"). */
  blur: number;
  /** "image"/"video": the background source. */
  bgSourceId?: string;
  /** Background placement: "fill" covers the layer, "fit" shows all of it. */
  fit: "fill" | "fit";
  /** 0..1: which part of an overflowing background shows (0.5 = centered). */
  x: number;
  y: number;
  /** 1..4: background zoom. */
  scale: number;
  /** "video": loop it, or hold its last frame when it's shorter. */
  loop: boolean;
}

/** A webcam layer's layout preset (webcamLayout.ts), kept so it can be
 * placed again when the canvas size changes. Absent = placed by hand. */
export interface CamLayout {
  shape: "circle" | "rounded" | "rect";
  size: "small" | "medium" | "large";
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Next to the screen (landscape canvas) or under it (portrait), instead
   * of a corner bubble. */
  split?: boolean;
}

export type VoiceFx = "none" | "chipmunk" | "deep" | "robot" | "echo" | "telephone" | "radio";

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
  | "zoom"
  | "bw"
  | "sepia"
  | "invert"
  | "hue"
  | "vignette"
  | "letterbox"
  | "strobe"
  | "mirror";

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

/** "natural" (Smart Zoom 2): a soft-landing curve, and the zoom changes at
 * a steady perceived rate (see camera.ts). The others interpolate the
 * window rectangle directly, as zooms made before it always did. */
export type ZoomEase = "smooth" | "gentle" | "linear" | "natural";

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
  /** The cursor and rings grow with the camera zoom, like the recorded
   * screen under them (Smart Zoom 2). Absent = true. */
  scaleWithZoom?: boolean;
  /** What cursorSize and ringSize are fractions of: the canvas height
   * ("canvas", absent - every project before Smart Zoom 2) or the
   * recording's own frame height ("recording": the same size relative to
   * the screen whatever the canvas shape or fit, like a real cursor;
   * "Match recording" sets it from the display's DPI). */
  sizeBase?: "canvas" | "recording";
}

// --- Tutorial tools (Phase 3) -------------------------------------------------

/** A source-time range where no zooms are suggested. */
export interface FocusExclusion {
  id: string;
  sourceId: string;
  start: number;
  end: number;
}

/** Project-wide focus controls (src/lib/editor/focusPrefs.ts). */
export interface FocusPrefs {
  /** Scales every zoom's strength above 1x (1 = as set, 0.25..1.5). */
  intensity: number;
  /** Original view: zooms are kept but not applied. */
  bypass: boolean;
  excluded: FocusExclusion[];
  /** Recorded clicks left out (no ring, no suggestion), by press time in
   * source seconds. */
  ignoredClicks: { sourceId: string; t: number }[];
}

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
  | "retake"
  // From the transcript (speechEdits.ts).
  | "filler"
  | "repeat"
  // From the sound (hesitations.ts): held "aaa", "mmm".
  | "hesitation"
  | "no-speech";

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

/** Version of `Draft`; a draft with another version is dropped on load
 * (it's only suggestions - generating again recreates it). */
export const DRAFT_VERSION = 1;

export type DraftItemKind = "zoom" | "highlights" | "cut" | "chapter" | "review" | "annotation" | "privacy";

/** One proposal of a draft (src/lib/editor/draft.ts). Nothing in it is
 * applied until the user applies the draft. */
export interface DraftItem {
  id: string;
  kind: DraftItemKind;
  status: "pending" | "accepted" | "rejected";
  title: string;
  /** What it's based on, in plain words. */
  detail: string;
  confidence: "low" | "medium" | "high";
  /** Timeline seconds where it shows (a zoom: its first visible span). */
  start: number;
  end: number;
  /** kind "zoom": the zoom, in source time like every zoom. */
  zoom?: CameraZoom;
  /** kind "cut" / "review": the suggestion, in timeline time. */
  suggestion?: EditSuggestion;
  /** kind "chapter". */
  chapter?: Chapter;
  /** kind "annotation": the text layer it adds (sceneAnalysis.ts). */
  annotation?: Overlay;
  /** kind "privacy": the mask it adds - only ever when accepted one by one. */
  mask?: PrivacyMask;
  /** kind "zoom"/"chapter": the cut that would remove it (mostly inside). */
  insideCut?: string;
}

/** Highlight suggestions (highlights.ts): candidate moments worth a clip,
 * from explainable signals. Suggestions only: nothing in the timeline
 * changes, and a highlight is exported as its own file from a copy of the
 * project. Times are timeline seconds. */
export const HIGHLIGHTS_VERSION = 1;

export type HighlightSignal = "sound" | "picture" | "scene" | "input" | "marker" | "speech" | "app" | "click";

export interface Highlight {
  id: string;
  start: number;
  end: number;
  /** The strongest moment inside the range. */
  peak: number;
  /** 0..1, for ranking. */
  score: number;
  confidence: "high" | "medium" | "low";
  /** What the suggestion is based on, in plain words. */
  reasons: { signal: HighlightSignal; text: string }[];
  status: "pending" | "kept" | "rejected";
  /** Its range was changed by hand. */
  edited?: boolean;
  title?: string;
  /** The same range in the recording's own time (one clip, played forward),
   * so it can be found again after trims, splits and moves (highlights.ts
   * placeHighlights). Missing when it spans clips. */
  anchor?: { sourceId: string; start: number; end: number };
  /** Its footage was cut, split or changed since: preview and export are
   * off until it's found again or its range is set again. */
  outdated?: boolean;
}

export interface HighlightSet {
  version: typeof HIGHLIGHTS_VERSION;
  createdAt: string;
  /** The timeline the times refer to (draft.ts timelineKey). */
  timelineKey: string;
  /** What the suggestions were made from, to skip unchanged work. */
  inputsKey: string;
  items: Highlight[];
  notes: string[];
  /** Local counts for the user's own review (never sent anywhere): how many
   * suggestions were made, kept, rejected and edited. */
  stats: { suggested: number; kept: number; rejected: number; edited: number; exported: number };
}

/** A generated draft: proposals from the recording's events and the
 * analysis results, reviewed before anything changes. */
export interface Draft {
  version: typeof DRAFT_VERSION;
  createdAt: string;
  /** The timeline the times refer to (draft.ts timelineKey). Cuts and
   * chapters can't be applied once it has changed. */
  timelineKey: string;
  /** What the analysis was made from, to skip unchanged work. */
  inputsKey: string;
  items: DraftItem[];
  /** Short notes on what couldn't be analyzed. */
  notes: string[];
  appliedAt?: string;
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
  /** Intensity, original view, excluded ranges, ignored clicks; absent =
   * defaults. */
  focus?: FocusPrefs;
  /** The last generated draft (suggestions only until applied). */
  draft?: Draft;
  /** Privacy masks (blur / pixelate / solid), drawn above the video. */
  masks?: PrivacyMask[];
  /** Review items from silence and interaction analysis, or user marks. */
  suggestions?: EditSuggestion[];
  chapters?: Chapter[];
  /** Word-timed transcript of the timeline's speech, for editing by text
   * (wordEdit.ts). Kept in sync by ripple cuts and inserts; `total` is the
   * timeline length it matches, so other edits show it's out of date. */
  transcript?: Transcript;
  /** The last highlight suggestions (highlights.ts). */
  highlights?: HighlightSet;
  /** Mix bus and loudness (mix.ts); absent = defaults. */
  master?: MasterAudio;
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
  kind: "original" | "cleaned" | "audio" | "image" | "layer" | "take" | "lut" | "font";
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
export const DEFAULT_MASTER: MasterAudio = { videoVolume: 1, videoMuted: false, loudness: "off", gainDb: 0 };
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
    ...(validDraft(p.draft) ? { draft: p.draft } : {}),
    ...(validHighlights(p.highlights) ? { highlights: p.highlights } : {}),
    ...(p.master ? { master: { ...DEFAULT_MASTER, ...(p.master as Partial<MasterAudio>) } } : {}),
    ...(p.focus
      ? {
          focus: {
            intensity: 1,
            bypass: false,
            ...(p.focus as Partial<FocusPrefs>),
            excluded: (p.focus as Partial<FocusPrefs>).excluded ?? [],
            ignoredClicks: (p.focus as Partial<FocusPrefs>).ignoredClicks ?? [],
          },
        }
      : {}),
  };
}

const DRAFT_KINDS = new Set<DraftItemKind>(["zoom", "highlights", "cut", "chapter", "review", "annotation", "privacy"]);

/** A saved draft is kept only if it's this version and every item is
 * well-formed; anything else is dropped (it can be generated again). */
export function validDraft(raw: unknown): raw is Draft {
  const d = raw as Partial<Draft> | null | undefined;
  if (!d || d.version !== DRAFT_VERSION || !Array.isArray(d.items) || typeof d.timelineKey !== "string") return false;
  return d.items.every(
    (i) =>
      i &&
      typeof i.id === "string" &&
      DRAFT_KINDS.has(i.kind) &&
      ["pending", "accepted", "rejected"].includes(i.status) &&
      Number.isFinite(i.start) &&
      Number.isFinite(i.end) &&
      (i.kind !== "zoom" || (!!i.zoom && Number.isFinite(i.zoom.start) && Number.isFinite(i.zoom.end))) &&
      ((i.kind !== "cut" && i.kind !== "review") || !!i.suggestion) &&
      (i.kind !== "chapter" || !!i.chapter) &&
      (i.kind !== "annotation" || (i.annotation?.kind === "text" && Number.isFinite(i.annotation.start) && Number.isFinite(i.annotation.end))) &&
      (i.kind !== "privacy" || (!!i.mask && [i.mask.x, i.mask.y, i.mask.w, i.mask.h, i.mask.start, i.mask.end].every(Number.isFinite)))
  );
}

/** Saved highlights are kept only if they're this version and well-formed;
 * anything else is dropped (they can be found again). */
export function validHighlights(raw: unknown): raw is HighlightSet {
  const h = raw as Partial<HighlightSet> | null | undefined;
  if (!h || h.version !== HIGHLIGHTS_VERSION || !Array.isArray(h.items) || typeof h.timelineKey !== "string" || !h.stats) return false;
  return h.items.every(
    (i) =>
      i &&
      typeof i.id === "string" &&
      Number.isFinite(i.start) &&
      Number.isFinite(i.end) &&
      i.end > i.start &&
      Number.isFinite(i.peak) &&
      ["pending", "kept", "rejected"].includes(i.status) &&
      Array.isArray(i.reasons) &&
      (i.anchor === undefined ||
        (typeof i.anchor?.sourceId === "string" && Number.isFinite(i.anchor.start) && Number.isFinite(i.anchor.end) && i.anchor.end > i.anchor.start))
  );
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
  scaleWithZoom: true,
};
