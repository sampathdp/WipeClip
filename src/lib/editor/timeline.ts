import type {
  AnimIn,
  AnimOut,
  AudioClip,
  CanvasAspect,
  CanvasFrame,
  Clip,
  EffectClip,
  EffectType,
  Overlay,
  Project,
  TransitionType,
} from "./types";
import { clipTimelineLength, localToSource, rampPart } from "./speed.ts";

/** Shortest clip any trim/split can produce. */
export const MIN_CLIP_SECONDS = 0.2;
export const TRANSITION_DURATIONS = [0.2, 0.5, 1, 1.5, 2] as const;
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5] as const;
/** Any constant speed from 0.1x (slow motion) to 10x (time-lapse). */
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 10;
/** Default and longest hold of a freeze frame. */
export const FREEZE_SECONDS = 3;
export const MAX_FREEZE_SECONDS = 30;
/** Longest source range that can be reversed - ffmpeg's reverse filter
 * buffers every frame in memory. Must match EDITOR_MAX_REVERSE_SECONDS in
 * backend/app/config.py. */
export const MAX_REVERSE_SECONDS = 10;

// Must match ANIM_SECONDS / SLIDE_DISTANCE in backend/app/pipeline/editor.py
// - preview and export animate identically.
export const ANIM_SECONDS = 0.35;
export const SLIDE_DISTANCE = 0.15;

export const TRANSITION_LABELS: Record<TransitionType, { label: string; hint: string }> = {
  fade: { label: "Fade", hint: "Picture blends, sound dips between clips" },
  crossfade: { label: "Crossfade", hint: "Picture and sound blend together" },
  dipblack: { label: "Dip to Black", hint: "Fades out to black, then in" },
  dipwhite: { label: "Dip to White", hint: "Fades out to white, then in" },
  slideleft: { label: "Slide Left", hint: "Next clip pushes in from the right" },
  slideright: { label: "Slide Right", hint: "Next clip pushes in from the left" },
  zoom: { label: "Zoom", hint: "Zooms into the next clip" },
  blur: { label: "Blur", hint: "Blurs across to the next clip" },
  slideup: { label: "Slide Up", hint: "Next clip pushes in from below" },
  slidedown: { label: "Slide Down", hint: "Next clip pushes in from above" },
  wipeleft: { label: "Wipe Left", hint: "Next clip is revealed from the right" },
  wiperight: { label: "Wipe Right", hint: "Next clip is revealed from the left" },
  wipeup: { label: "Wipe Up", hint: "Next clip is revealed from the bottom" },
  wipedown: { label: "Wipe Down", hint: "Next clip is revealed from the top" },
  circleopen: { label: "Circle Open", hint: "Next clip opens out from the center" },
  circleclose: { label: "Circle Close", hint: "Picture closes in to the center" },
  smoothleft: { label: "Smooth Left", hint: "A soft edge sweeps the next clip in from the right" },
  smoothright: { label: "Smooth Right", hint: "A soft edge sweeps the next clip in from the left" },
  smoothup: { label: "Smooth Up", hint: "A soft edge sweeps the next clip up from the bottom" },
  smoothdown: { label: "Smooth Down", hint: "A soft edge sweeps the next clip down from the top" },
  vertopen: { label: "Doors Open", hint: "Next clip opens out from a line down the middle" },
  horzopen: { label: "Split Open", hint: "Next clip opens out from a line across the middle" },
  radial: { label: "Clock Wipe", hint: "Next clip sweeps around like a clock hand" },
  diagtl: { label: "Diagonal", hint: "Next clip sweeps in from the bottom-right corner" },
  diagbr: { label: "Diagonal Back", hint: "Next clip sweeps in from the top-left corner" },
  circlecrop: { label: "Circle Crop", hint: "Picture shrinks to a circle, next clip grows out of it" },
  rectcrop: { label: "Box Crop", hint: "Picture shrinks to a box, next clip grows out of it" },
  fadegrays: { label: "Fade Through Gray", hint: "Colors fade to gray, then into the next clip" },
};

export const ANIM_IN_LABELS: Record<AnimIn, string> = {
  none: "None",
  fade: "Fade in",
  pop: "Pop",
  bounce: "Bounce",
  spin: "Spin in",
  zoomin: "Zoom in",
  slideup: "Slide up",
  slidedown: "Slide down",
  slideleft: "Slide left",
  slideright: "Slide right",
};
export const ANIM_OUT_LABELS: Record<AnimOut, string> = {
  none: "None",
  fade: "Fade out",
  pop: "Pop out",
  spin: "Spin out",
  zoomout: "Zoom out",
  slideup: "Slide up",
  slidedown: "Slide down",
  slideleft: "Slide left",
  slideright: "Slide right",
};

export const EFFECT_LABELS: Record<EffectType, string> = {
  blur: "Blur",
  motionblur: "Motion Blur",
  glitch: "Glitch",
  vhs: "VHS",
  grain: "Film Grain",
  noise: "Noise",
  pixelate: "Pixelate",
  rgbsplit: "RGB Split",
  flash: "Flash",
  shake: "Shake",
  zoom: "Zoom",
  bw: "Black & White",
  sepia: "Sepia",
  invert: "Invert",
  hue: "Color Cycle",
  vignette: "Vignette",
  letterbox: "Letterbox",
  strobe: "Strobe",
  mirror: "Mirror",
};

export const CANVAS_PRESETS: { label: string; hint: string; aspect: CanvasAspect }[] = [
  { label: "Original", hint: "Same as your video", aspect: "original" },
  { label: "16:9", hint: "Landscape · widescreen", aspect: "16:9" },
  { label: "9:16", hint: "Vertical · short-form", aspect: "9:16" },
  { label: "1:1", hint: "Square post", aspect: "1:1" },
  { label: "4:5", hint: "Portrait post", aspect: "4:5" },
  { label: "4:3", hint: "Classic", aspect: "4:3" },
];

const ASPECTS: Record<Exclude<CanvasAspect, "original">, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
  "4:3": 4 / 3,
};

/** Canvas size in "original pixels" - same rule as api_video_export: the
 * chosen aspect at the original's short side. */
export function canvasSize(aspect: CanvasAspect, srcW: number, srcH: number): { width: number; height: number } {
  if (aspect === "original") return { width: srcW, height: srcH };
  const short = Math.min(srcW, srcH);
  const ar = ASPECTS[aspect];
  return ar >= 1 ? { width: short * ar, height: short } : { width: short, height: short / ar };
}

/** Transitions whose audio dips (outgoing fades out, then incoming fades
 * in) rather than blending - same split as TRANSITIONS in editor.py.
 */
export const DIP_AUDIO: ReadonlySet<TransitionType> = new Set(["fade", "dipblack", "dipwhite", "circlecrop", "rectcrop"]);

export interface LaidOutClip {
  clip: Clip;
  index: number;
  /** Timeline time this clip starts playing. */
  start: number;
  /** Frame-quantized playing length (after speed). */
  duration: number;
  /** Effective (clamped, quantized) transition into the next clip; 0 = cut. */
  transitionOut: number;
}

export interface Layout {
  clips: LaidOutClip[];
  total: number;
  fps: number;
}

/** Positions every clip on the timeline, applying the same speed
 * conversion, frame quantization and transition clamping as the backend's
 * quantize_plan() so a layer placed at 0:12.4 here lands on the same frame
 * in the export. A transition overlaps its two clips, so each clip after
 * one starts `transitionOut` seconds before the previous clip ends.
 */
export function layout(project: Project, fps: number): Layout {
  const f = fps > 0 ? fps : 30;
  const q = (d: number) => Math.max(1, Math.round(d * f)) / f;
  const durations = project.clips.map((c) => q(clipTimelineLength(c)));
  const clips: LaidOutClip[] = [];
  let t = 0;
  project.clips.forEach((clip, i) => {
    let transitionOut = 0;
    if (clip.transition && i < project.clips.length - 1) {
      const limit = Math.min(durations[i], durations[i + 1]) / 2;
      transitionOut = Math.floor(Math.min(clip.transition.duration, limit) * f) / f;
    }
    clips.push({ clip, index: i, start: t, duration: durations[i], transitionOut });
    t += durations[i] - transitionOut;
  });
  return { clips, total: Math.max(0, t), fps: f };
}

export interface Located {
  /** Clip on screen (the outgoing one, during a transition). */
  primary: { index: number; sourceTime: number };
  /** Set while a transition from `primary` into the next clip is running. */
  incoming?: { index: number; sourceTime: number; progress: number; type: TransitionType };
}

/** Source time inside a laid-out clip at timeline time `t`. */
export function sourceTimeAt(c: LaidOutClip, t: number): number {
  const { clip } = c;
  if (clip.freeze !== null) return clip.freeze;
  const local = localToSource(clip, t - c.start);
  // Reversed: starts on the range's last frame (just inside `end`).
  return clip.reverse ? Math.max(clip.start, clip.end - 0.001 - local) : clip.start + local;
}

export function locate(lay: Layout, time: number): Located | null {
  if (lay.clips.length === 0) return null;
  const t = Math.min(Math.max(time, 0), Math.max(0, lay.total - 1e-4));
  let i = 0;
  while (i + 1 < lay.clips.length && lay.clips[i + 1].start <= t) i++;
  const cur = lay.clips[i];
  if (i > 0) {
    const prev = lay.clips[i - 1];
    if (prev.transitionOut > 0 && t < cur.start + prev.transitionOut) {
      return {
        primary: { index: i - 1, sourceTime: sourceTimeAt(prev, t) },
        incoming: {
          index: i,
          sourceTime: sourceTimeAt(cur, t),
          progress: (t - cur.start) / prev.transitionOut,
          type: prev.clip.transition!.type,
        },
      };
    }
  }
  return { primary: { index: i, sourceTime: sourceTimeAt(cur, t) } };
}

/** Where a clip's block is drawn: boundaries sit at the middle of each
 * transition overlap, so blocks tile the track without overlapping.
 */
export function clipVisualSpan(lay: Layout, index: number): { from: number; to: number } {
  const c = lay.clips[index];
  const prev = index > 0 ? lay.clips[index - 1] : null;
  const from = prev ? c.start + prev.transitionOut / 2 : c.start;
  const to = c.start + c.duration - c.transitionOut / 2;
  return { from, to };
}

export interface OverlayFrame {
  opacity: number;
  scale: number;
  dx: number; // fraction of canvas width
  dy: number; // fraction of canvas height
  rotate: number; // degrees, added to the overlay's rotation
}

/** easeOutBack: overshoots past 1 and settles - the "bounce" entrance.
 * Same curve as _BACK_OUT in editor.py. */
export function backOut(p: number): number {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (p - 1) ** 3 + c1 * (p - 1) ** 2;
}

/** Overlay animation at timeline time `t` - mirrors _overlay_filters() in
 * backend/app/pipeline/editor.py term for term.
 */
export function overlayFrame(o: Pick<Overlay, "start" | "end" | "animIn" | "animOut" | "opacity">, t: number): OverlayFrame | null {
  if (t < o.start || t >= o.end) return null;
  const anim = Math.min(ANIM_SECONDS, (o.end - o.start) / 2);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const pin = clamp((t - o.start) / anim);
  const pout = clamp((t - (o.end - anim)) / anim);
  let opacity = o.opacity;
  let scale = 1;
  let dx = 0;
  let dy = 0;
  let rotate = 0;
  if (o.animIn === "fade" || o.animIn === "zoomin" || o.animIn === "spin" || o.animIn.startsWith("slide")) opacity *= pin;
  if (o.animOut === "fade" || o.animOut === "zoomout" || o.animOut === "spin" || o.animOut.startsWith("slide")) opacity *= 1 - pout;
  if (o.animIn === "pop" || o.animIn === "spin") scale *= Math.max(0.02, pin);
  if (o.animIn === "bounce") scale *= Math.max(0.02, backOut(pin));
  if (o.animIn === "zoomin") scale *= 0.6 + 0.4 * pin;
  if (o.animOut === "pop" || o.animOut === "spin") scale *= Math.max(0.02, 1 - pout);
  if (o.animOut === "zoomout") scale *= 1 - 0.4 * pout;
  if (o.animIn === "spin") rotate -= 180 * (1 - pin);
  if (o.animOut === "spin") rotate += 180 * pout;
  const D = SLIDE_DISTANCE;
  if (o.animIn === "slideleft") dx += D * (1 - pin);
  if (o.animIn === "slideright") dx -= D * (1 - pin);
  if (o.animIn === "slideup") dy += D * (1 - pin);
  if (o.animIn === "slidedown") dy -= D * (1 - pin);
  if (o.animOut === "slideleft") dx -= D * pout;
  if (o.animOut === "slideright") dx += D * pout;
  if (o.animOut === "slideup") dy -= D * pout;
  if (o.animOut === "slidedown") dy += D * pout;
  return { opacity, scale, dx, dy, rotate };
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

// --- Project operations (pure; each returns a new Project) -------------

export function splitAt(project: Project, lay: Layout, time: number): Project | null {
  const loc = locate(lay, time);
  if (!loc || loc.incoming) return null; // can't cut inside a transition
  const { index } = loc.primary;
  const clip = project.clips[index];
  // Split by how far into the clip the playhead is, not by its source time:
  // a freeze has no source range and a reversed clip reads it backwards.
  const local = localToSource(clip, time - lay.clips[index].start);
  if (local < MIN_CLIP_SECONDS || clip.end - clip.start - local < MIN_CLIP_SECONDS) return null;
  const cut = clip.reverse ? clip.end - local : clip.start + local;
  const first = clip.reverse ? { start: cut, end: clip.end } : { start: clip.start, end: cut };
  const second = clip.reverse ? { start: clip.start, end: cut } : { start: cut, end: clip.end };
  // A speed curve is divided with the clip, each part keeping its piece.
  const frac = local / (clip.end - clip.start);
  // Sound fades stay at the clip's outer edges, not at the cut.
  const left: Clip = { ...clip, ...first, transition: null, fadeOut: undefined, ...(clip.ramp ? { ramp: rampPart(clip.ramp, 0, frac) } : {}) };
  const right: Clip = { ...clip, ...second, id: newId("clip"), fadeIn: undefined, ...(clip.ramp ? { ramp: rampPart(clip.ramp, frac, 1) } : {}) };
  const clips = [...project.clips];
  clips.splice(index, 1, left, right);
  return { ...project, clips };
}

/** Splits an audio clip at timeline time `t`; null if `t` isn't inside it. */
export function splitAudioAt(project: Project, id: string, t: number): Project | null {
  const a = project.audio.find((x) => x.id === id);
  if (!a || t - a.start < MIN_CLIP_SECONDS || a.start + a.duration - t < MIN_CLIP_SECONDS) return null;
  const leftDur = t - a.start;
  const left: AudioClip = { ...a, duration: leftDur, fadeOut: 0 };
  const right: AudioClip = { ...a, id: newId("aud"), start: t, offset: a.offset + leftDur, duration: a.duration - leftDur, fadeIn: 0 };
  return { ...project, audio: project.audio.flatMap((x) => (x.id === id ? [left, right] : [x])) };
}

/** Inserts a FREEZE_SECONDS still of the frame under the playhead, splitting
 * the clip there first (or placing it before/after when at an edge). */
export function insertFreezeAt(project: Project, lay: Layout, time: number): { project: Project; clipId: string } | null {
  const loc = locate(lay, time);
  if (!loc || loc.incoming) return null;
  const laid = lay.clips[loc.primary.index];
  const still: Clip = {
    ...laid.clip,
    id: newId("clip"),
    freeze: loc.primary.sourceTime,
    reverse: false,
    start: 0,
    end: FREEZE_SECONDS,
    speed: 1,
    transition: null,
  };
  const split = splitAt(project, lay, time);
  const atStart = time - laid.start < laid.duration / 2;
  const base = split ?? project;
  const at = split ? loc.primary.index + 1 : atStart ? loc.primary.index : loc.primary.index + 1;
  const clips = [...base.clips];
  // The still takes over the outgoing transition when it lands after the clip.
  if (!split && !atStart) {
    still.transition = clips[at - 1].transition;
    clips[at - 1] = { ...clips[at - 1], transition: null };
  }
  clips.splice(at, 0, still);
  return { project: { ...base, clips }, clipId: still.id };
}

export function deleteClip(project: Project, clipId: string): Project | null {
  if (project.clips.length <= 1) return null;
  // Layers past the new end are kept (undo gives the time back); the
  // export skips anything outside the timeline.
  return { ...project, clips: project.clips.filter((c) => c.id !== clipId) };
}

/** Inserts a copy of a clip right after it. The copy takes over the
 * outgoing transition, so the original cuts straight into its copy. */
export function duplicateClip(project: Project, clipId: string): { project: Project; clipId: string } | null {
  const i = project.clips.findIndex((c) => c.id === clipId);
  if (i < 0) return null;
  const clip = project.clips[i];
  const copy: Clip = { ...clip, id: newId("clip") };
  const clips = [...project.clips];
  clips.splice(i, 1, { ...clip, transition: null }, copy);
  return { project: { ...project, clips }, clipId: copy.id };
}

export function moveClip(project: Project, from: number, to: number): Project {
  if (from === to || from < 0 || from >= project.clips.length) return project;
  const clips = [...project.clips];
  const [c] = clips.splice(from, 1);
  clips.splice(Math.max(0, Math.min(to, clips.length)), 0, c);
  return { ...project, clips };
}

export function updateClip(project: Project, clipId: string, patch: Partial<Clip>): Project {
  return { ...project, clips: project.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) };
}

export function updateOverlay(project: Project, id: string, patch: Partial<Overlay>): Project {
  return {
    ...project,
    overlays: project.overlays.map((o) => (o.id === id ? ({ ...o, ...patch } as Overlay) : o)),
  };
}

export function updateAudio(project: Project, id: string, patch: Partial<AudioClip>): Project {
  return { ...project, audio: project.audio.map((a) => (a.id === id ? { ...a, ...patch } : a)) };
}

export function updateEffect(project: Project, id: string, patch: Partial<EffectClip>): Project {
  return { ...project, effects: project.effects.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

/** Moves an overlay one step up (+1) or down (-1) the stacking order. */
export function restackOverlay(project: Project, id: string, dir: 1 | -1): Project {
  const i = project.overlays.findIndex((o) => o.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= project.overlays.length) return project;
  const overlays = [...project.overlays];
  [overlays[i], overlays[j]] = [overlays[j], overlays[i]];
  return { ...project, overlays };
}

/** Moves an overlay right above or below another in the stacking order
 * (the list is bottom to top). */
export function stackOverlay(project: Project, id: string, targetId: string, where: "above" | "below"): Project {
  const moving = project.overlays.find((o) => o.id === id);
  if (!moving || id === targetId) return project;
  const rest = project.overlays.filter((o) => o.id !== id);
  const at = rest.findIndex((o) => o.id === targetId);
  if (at < 0) return project;
  const overlays = [...rest];
  overlays.splice(where === "above" ? at + 1 : at, 0, moving);
  return overlays.every((o, i) => o === project.overlays[i]) ? project : { ...project, overlays };
}

/** Timing of any timed item (overlay, audio, effect) as [start, end]. */
export function itemSpan(item: Overlay | AudioClip | EffectClip): { start: number; end: number } {
  return "duration" in item ? { start: item.start, end: item.start + item.duration } : { start: item.start, end: item.end };
}

export function formatTime(seconds: number, precise = false): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  if (precise) return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
  return `${m}:${String(Math.floor(rest)).padStart(2, "0")}`;
}

/** The clip's on-canvas box as fractions of canvas width/height: the
 * (cropped) source's aspect contained in (fit) or covering (fill) the
 * canvas, times the clip's scale. Same rule as _clip_video_chain() in editor.py. */
/** What of the canvas decides the main video's box. */
export interface BoxLayout {
  fit: "fit" | "fill";
  frame?: CanvasFrame;
}

/** How much the canvas frame (CanvasFrame.padding) shrinks the video box. */
export function frameInset(frame: CanvasFrame | undefined): number {
  return 1 - 2 * Math.min(0.2, Math.max(0, frame?.padding ?? 0));
}

/** Shadow geometry shared by preview and export, in canvas-height units:
 * offset down, blur (CSS blur radius; the export's sigma is half of it)
 * and opacity. null when there's no shadow. */
export function frameShadow(frame: CanvasFrame | undefined): { dy: number; blur: number; alpha: number } | null {
  const s = Math.min(1, Math.max(0, frame?.shadow ?? 0));
  return s > 0 ? { dy: 0.02 * s, blur: 0.06, alpha: 0.6 * s } : null;
}

export function videoBox(
  clip: Clip,
  src: { width: number; height: number },
  canvas: { width: number; height: number },
  layout: BoxLayout
): { w: number; h: number } {
  const { fit } = layout;
  const srcAr = (src.width * clip.crop.w) / Math.max(1, src.height * clip.crop.h);
  const canvasAr = canvas.width / canvas.height;
  let w: number;
  let h: number;
  if ((fit === "fit") === srcAr > canvasAr) {
    w = 1;
    h = canvasAr / srcAr;
  } else {
    h = 1;
    w = srcAr / canvasAr;
  }
  const s = clip.transform.scale * frameInset(layout.frame);
  return { w: w * s, h: h * s };
}
