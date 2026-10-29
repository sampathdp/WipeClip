/** Creator presets: one click sets the canvas (and, for tutorials, the
 * pointer effects and shortcut indicators) for a common destination. They
 * only change ordinary project settings, as one undo step, so everything
 * stays adjustable afterwards in the Canvas, Focus and Tutorial panels, and
 * the export renders them like any other project. Pure - see
 * tests/desktop/creatorPresets.test.ts.
 *
 * Reframing a landscape video into a vertical or square canvas has to cut
 * the sides. Where that would lose what matters, nothing is cut:
 * - recordings: each clip is centered on where the recorded clicks, typing
 *   and pointer were during that clip; if they're spread wider than the
 *   part that stays visible, the clip is shown whole instead (fit, with a
 *   blurred copy behind it), since a crop would hide some of them;
 * - other videos: centered (nothing tells us where the subject is), and
 *   the notes say to check it. Drag the video in the preview to move it.
 */
import type { Act } from "./insights.ts";
import { canvasSize, videoBox, type Layout } from "./timeline.ts";
import { DEFAULT_POINTER, type Canvas, type CanvasAspect, type MediaSource, type Overlay, type Project } from "./types.ts";

export type CreatorPresetId = "landscape" | "vertical" | "square" | "tutorial";

export const CREATOR_PRESETS: { id: CreatorPresetId; label: string; hint: string; aspect: CanvasAspect }[] = [
  { id: "landscape", label: "Landscape", hint: "16:9, whole picture", aspect: "16:9" },
  { id: "vertical", label: "Vertical", hint: "9:16, reframed", aspect: "9:16" },
  { id: "square", label: "Square", hint: "1:1 post, reframed", aspect: "1:1" },
  { id: "tutorial", label: "Software tutorial", hint: "16:9, framed, cursor, clicks, shortcuts", aspect: "16:9" },
];

export interface PresetContext {
  lay: Layout;
  sources: Record<string, MediaSource>;
  originalId: string;
  /** Recording events in timeline time (insights.ts interactionTimeline). */
  acts: Act[] | null;
  /** The recording's source id (acts are for its clips). */
  recSourceId: string | null;
  /** Whether the recording has its own cursor drawn into the video. */
  cursorCaptured: boolean;
  /** Shortcut indicators for the tutorial preset (keystrokes.ts); [] = none. */
  keystrokes: Overlay[];
}

export interface PresetResult {
  project: Project;
  notes: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function quantile(a: number[], q: number): number {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

/** Clip center x (canvas fractions) that puts source fraction `u` of a
 * box `w` canvas-widths wide at the canvas center, kept so the box still
 * covers the canvas. */
export function centerOn(u: number, w: number): number {
  if (w <= 1) return 0.5;
  return clamp(0.5 + w * (0.5 - u), 1 - w / 2, w / 2);
}

export function applyCreatorPreset(project: Project, id: CreatorPresetId, ctx: PresetContext): PresetResult {
  const preset = CREATOR_PRESETS.find((p) => p.id === id)!;
  const notes: string[] = [];
  const original = ctx.sources[ctx.originalId];
  const canvasPx = canvasSize(preset.aspect, original.width, original.height);
  const reframe = id === "vertical" || id === "square";
  let canvas: Canvas = { ...project.canvas, aspect: preset.aspect, fit: reframe ? "fill" : "fit" };
  let clips = project.clips;

  if (id === "tutorial") {
    canvas = { ...canvas, frame: { padding: 0.04, radius: 0.025, shadow: 0.5 }, background: { type: "gradient", color: "#1e1b4b", color2: "#0f766e" } };
  } else if (id === "landscape") {
    const off = clips.some((c) => {
      const src = ctx.sources[c.sourceId];
      return src && Math.abs(src.width / Math.max(1, src.height) - 16 / 9) > 0.02;
    });
    if (off && canvas.background.type === "color") canvas = { ...canvas, background: { type: "blur" } };
    canvas = { ...canvas, frame: undefined };
  } else {
    canvas = { ...canvas, frame: undefined };
  }

  if (reframe) {
    let shownWhole = 0;
    let centered = 0;
    let followed = 0;
    clips = project.clips.map((clip) => {
      const src = ctx.sources[clip.sourceId];
      if (!src || !src.width) return clip;
      const box = videoBox(clip, src, canvasPx, { fit: "fill" });
      if (box.w <= 1.001) return { ...clip, transform: { ...clip.transform, x: 0.5 } };
      const laid = ctx.lay.clips.find((c) => c.clip.id === clip.id);
      const xs =
        ctx.acts && laid && clip.sourceId === ctx.recSourceId
          ? ctx.acts
              .filter((a) => a.t >= laid.start && a.t < laid.start + laid.duration && Number.isFinite(a.x) && a.kind !== "window")
              .map((a) => clamp((a.x - clip.crop.x) / Math.max(0.01, clip.crop.w), 0, 1))
          : [];
      if (xs.length < 3) {
        centered++;
        return { ...clip, transform: { ...clip.transform, x: 0.5 } };
      }
      const visible = 1 / box.w; // share of the source width that stays visible
      const lo = quantile(xs, 0.1);
      const hi = quantile(xs, 0.9);
      if (hi - lo > visible * 0.9) {
        shownWhole++;
        return clip;
      }
      followed++;
      return { ...clip, transform: { ...clip.transform, x: centerOn((lo + hi) / 2, box.w) } };
    });
    if (shownWhole > 0) {
      // A crop would hide some of the action: show the whole picture.
      canvas = { ...canvas, fit: "fit", background: canvas.background.type === "color" ? { type: "blur" } : canvas.background };
      clips = project.clips.map((c) => ({ ...c, transform: { ...c.transform, x: 0.5 } }));
      notes.push(
        "The clicks and typing in this recording are spread too wide to crop without hiding some of them, so the whole picture is shown with a blurred background. Switch Fit mode to Fill in Canvas to crop instead."
      );
    } else {
      if (followed) notes.push(`${followed} clip${followed === 1 ? " is" : "s are"} centered on where you clicked and typed.`);
      if (centered) notes.push(`${centered} clip${centered === 1 ? " is" : "s are"} centered: check the sides that are cut off, and drag the video in the preview to move it.`);
    }
  }

  let pointer = project.pointer;
  let overlays = project.overlays;
  if (id === "tutorial") {
    if (ctx.recSourceId) {
      pointer = { ...DEFAULT_POINTER, ...(project.pointer ?? {}), clicks: true, cursor: !ctx.cursorCaptured };
      if (ctx.keystrokes.length) overlays = [...project.overlays.filter((o) => !o.keystroke), ...ctx.keystrokes];
      notes.push(
        `Click highlights on${!ctx.cursorCaptured ? ", smooth cursor drawn" : ""}${ctx.keystrokes.length ? `, ${ctx.keystrokes.length} shortcut indicators added` : ""}. Fine-tune them in Focus and Tutorial.`
      );
    } else notes.push("Cursor, click and shortcut overlays need a WipeClip screen recording; this video only gets the framed layout.");
  }

  return { project: { ...project, canvas, clips, pointer, overlays }, notes };
}
