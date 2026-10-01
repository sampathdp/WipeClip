import type { Clip, Project, Sticker, TransitionType } from "./types";

/** Shortest clip any trim/split can produce. */
export const MIN_CLIP_SECONDS = 0.2;
export const TRANSITION_DURATIONS = [0.2, 0.5, 1, 1.5, 2] as const;

// Must match STICKER_ANIM_SECONDS / STICKER_SLIDE_DISTANCE in
// backend/app/pipeline/editor.py - preview and export animate identically.
export const STICKER_ANIM_SECONDS = 0.35;
export const STICKER_SLIDE_DISTANCE = 0.15;

export const TRANSITION_LABELS: Record<TransitionType, { label: string; hint: string }> = {
  fade: { label: "Fade", hint: "Picture blends, sound dips between clips" },
  crossfade: { label: "Crossfade", hint: "Picture and sound blend together" },
  dipblack: { label: "Dip to Black", hint: "Fades out to black, then in" },
  dipwhite: { label: "Dip to White", hint: "Fades out to white, then in" },
  slideleft: { label: "Slide Left", hint: "Next clip pushes in from the right" },
  slideright: { label: "Slide Right", hint: "Next clip pushes in from the left" },
  zoom: { label: "Zoom", hint: "Zooms into the next clip" },
  blur: { label: "Blur", hint: "Blurs across to the next clip" },
};

/** Transitions whose audio dips (outgoing fades out, then incoming fades
 * in) rather than blending - same split as TRANSITIONS in editor.py.
 */
export const DIP_AUDIO: ReadonlySet<TransitionType> = new Set(["fade", "dipblack", "dipwhite"]);

export interface LaidOutClip {
  clip: Clip;
  index: number;
  /** Timeline time this clip starts playing. */
  start: number;
  /** Frame-quantized playing length. */
  duration: number;
  /** Effective (clamped, quantized) transition into the next clip; 0 = cut. */
  transitionOut: number;
}

export interface Layout {
  clips: LaidOutClip[];
  total: number;
  fps: number;
}

/** Positions every clip on the timeline, applying the same frame
 * quantization and transition clamping as the backend's quantize_plan()
 * so a sticker placed at 0:12.4 here lands on the same frame in the export.
 * A transition overlaps its two clips, so each clip after one starts
 * `transitionOut` seconds before the previous clip ends.
 */
export function layout(project: Project, fps: number): Layout {
  const f = fps > 0 ? fps : 30;
  const q = (d: number) => Math.max(1, Math.round(d * f)) / f;
  const durations = project.clips.map((c) => q(c.end - c.start));
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
        primary: { index: i - 1, sourceTime: prev.clip.start + (t - prev.start) },
        incoming: {
          index: i,
          sourceTime: cur.clip.start + (t - cur.start),
          progress: (t - cur.start) / prev.transitionOut,
          type: prev.clip.transition!.type,
        },
      };
    }
  }
  return { primary: { index: i, sourceTime: cur.clip.start + (t - cur.start) } };
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

export interface StickerFrame {
  opacity: number;
  scale: number;
  dx: number; // fraction of canvas width
}

/** Sticker animation at timeline time `t` - mirrors _sticker_filters() in
 * backend/app/pipeline/editor.py term for term.
 */
export function stickerFrame(s: Sticker, t: number): StickerFrame | null {
  if (t < s.start || t >= s.end) return null;
  const anim = Math.min(STICKER_ANIM_SECONDS, (s.end - s.start) / 2);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const pin = clamp((t - s.start) / anim);
  const pout = clamp((t - (s.end - anim)) / anim);
  let opacity = 1;
  let scale = 1;
  let dx = 0;
  if (s.animIn === "fade" || s.animIn === "slide") opacity *= pin;
  if (s.animOut === "fade" || s.animOut === "slide") opacity *= 1 - pout;
  if (s.animIn === "pop") scale = Math.max(0.02, pin);
  if (s.animIn === "slide") dx -= STICKER_SLIDE_DISTANCE * (1 - pin);
  if (s.animOut === "slide") dx += STICKER_SLIDE_DISTANCE * pout;
  return { opacity, scale, dx };
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
  const { index, sourceTime } = loc.primary;
  const clip = project.clips[index];
  if (sourceTime - clip.start < MIN_CLIP_SECONDS || clip.end - sourceTime < MIN_CLIP_SECONDS) return null;
  const left: Clip = { ...clip, end: sourceTime, transition: null };
  const right: Clip = { ...clip, id: newId("clip"), start: sourceTime };
  const clips = [...project.clips];
  clips.splice(index, 1, left, right);
  return { ...project, clips };
}

export function deleteClip(project: Project, clipId: string): Project | null {
  if (project.clips.length <= 1) return null;
  const clips = project.clips.filter((c) => c.id !== clipId);
  // Stickers past the new end are kept (undo gives the time back); the
  // export skips anything outside the timeline.
  return { ...project, clips };
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

export function updateSticker(project: Project, id: string, patch: Partial<Sticker>): Project {
  return { ...project, stickers: project.stickers.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

export function formatTime(seconds: number, precise = false): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  if (precise) return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
  return `${m}:${String(Math.floor(rest)).padStart(2, "0")}`;
}
