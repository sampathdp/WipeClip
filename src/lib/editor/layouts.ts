/** Split-screen layouts: the main video and video layers arranged as
 * screens - side by side, stacked, a grid, one large with smaller ones, or
 * a small one over the main video.
 *
 * A layout is only a list of rectangles. Applying one places what's there
 * (the main video row, then the video layers showing at the playhead) into
 * them with the model every layer already has - position, width and crop -
 * so each screen stays its own layer: moved, resized, cropped, animated
 * and exported like any other. Nothing is flattened.
 *
 * The rectangle is kept on what fills it (`slot`, `mainSlot`) only to place
 * it again when the canvas size changes, and only while it still sits where
 * the layout put it.
 *
 * Pure - see tests/desktop/layouts.test.ts.
 */
import { animateOverlayPatch } from "./keyframes.ts";
import { centerCrop, placeInCell, type Cell, type Size, type VideoLayer } from "./layerGeometry.ts";
import { videoBox, type BoxLayout } from "./timeline.ts";
import type { Clip, LayoutSlot, MediaSource, Project } from "./types.ts";

export interface LayoutPreset {
  id: string;
  label: string;
  hint: string;
  cells: Cell[];
  /** The later screens sit over the first (picture in picture): no spacing
   * is applied, and the first is the main video. */
  over?: true;
}

const T = 1 / 3;

/** A grid of equal screens, row by row. */
export function gridCells(cols: number, rows: number): Cell[] {
  const out: Cell[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: c / cols, y: r / rows, w: 1 / cols, h: 1 / rows });
  return out;
}

export const LAYOUT_PRESETS: { group: string; presets: LayoutPreset[] }[] = [
  {
    group: "Two screens",
    presets: [
      { id: "2-side", label: "Side by side", hint: "Two equal screens, left and right", cells: gridCells(2, 1) },
      { id: "2-stack", label: "Stacked", hint: "Two equal screens, top and bottom", cells: gridCells(1, 2) },
      { id: "2-left", label: "Large left", hint: "A large screen on the left, a small one on the right", cells: [{ x: 0, y: 0, w: 2 * T, h: 1 }, { x: 2 * T, y: 0, w: T, h: 1 }] },
      { id: "2-right", label: "Large right", hint: "A large screen on the right, a small one on the left", cells: [{ x: T, y: 0, w: 2 * T, h: 1 }, { x: 0, y: 0, w: T, h: 1 }] },
      { id: "2-bottom", label: "Bottom overlay", hint: "The main video with a smaller one over its bottom", cells: [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0.32, y: 0.6, w: 0.36, h: 0.36 }], over: true },
      { id: "2-top", label: "Top overlay", hint: "The main video with a smaller one over its top", cells: [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0.32, y: 0.04, w: 0.36, h: 0.36 }], over: true },
    ],
  },
  {
    group: "Three screens",
    presets: [
      { id: "3-large", label: "Large + two", hint: "A large screen and two small ones beside it", cells: [{ x: 0, y: 0, w: 2 * T, h: 1 }, { x: 2 * T, y: 0, w: T, h: 0.5 }, { x: 2 * T, y: 0.5, w: T, h: 0.5 }] },
      { id: "3-cols", label: "Three columns", hint: "Three equal columns", cells: gridCells(3, 1) },
      { id: "3-top", label: "One over two", hint: "One screen across the top, two below it", cells: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] },
    ],
  },
  {
    group: "Four screens",
    presets: [
      { id: "4-grid", label: "2 x 2 grid", hint: "Four equal screens", cells: gridCells(2, 2) },
      { id: "4-cols", label: "Four columns", hint: "Four equal columns", cells: gridCells(4, 1) },
      { id: "4-rows", label: "Four rows", hint: "Four equal rows", cells: gridCells(1, 4) },
      {
        id: "4-large",
        label: "Large + three",
        hint: "A large screen and three small ones beside it",
        cells: [{ x: 0, y: 0, w: 0.75, h: 1 }, { x: 0.75, y: 0, w: 0.25, h: T }, { x: 0.75, y: T, w: 0.25, h: T }, { x: 0.75, y: 2 * T, w: 0.25, h: T }],
      },
    ],
  },
];

export function findPreset(id: string): LayoutPreset | undefined {
  for (const g of LAYOUT_PRESETS) {
    const p = g.presets.find((x) => x.id === id);
    if (p) return p;
  }
  return undefined;
}

/** Largest spacing between screens, fraction of the canvas's short side. */
export const MAX_GAP = 0.06;

/** Screens with `gap` (fraction of the canvas's short side) between them
 * and to the canvas edge: each is drawn in by half of it. */
export function insetCells(cells: Cell[], gap: number, canvas: Size): Cell[] {
  const g = Math.min(MAX_GAP, Math.max(0, gap)) * Math.min(canvas.width, canvas.height);
  if (g <= 0) return cells;
  const gx = g / 2 / canvas.width;
  const gy = g / 2 / canvas.height;
  return cells.map((c) => ({ x: c.x + gx, y: c.y + gy, w: Math.max(0.02, c.w - 2 * gx), h: Math.max(0.02, c.h - 2 * gy) }));
}

/** A clip of the main video row placed in a screen: "fill" crops it to the
 * screen's shape (from its whole frame), "fit" shows all of it inside.
 * Only its crop, position and scale change. */
export function clipInCell(clip: Clip, src: Size, canvas: Size, box: BoxLayout, cell: Cell, fit: "fill" | "fit"): Pick<Clip, "crop" | "transform"> {
  const cellAr = (cell.w * canvas.width) / (cell.h * canvas.height);
  const crop = fit === "fill" ? centerCrop(src.width / Math.max(1, src.height), cellAr) : clip.crop;
  // The clip's box at scale 1 (fitted or filling the canvas, inside its frame).
  const base = videoBox({ ...clip, crop, transform: { ...clip.transform, scale: 1 } }, src, canvas, box);
  const scale = fit === "fill" ? Math.max(cell.w / base.w, cell.h / base.h) : Math.min(cell.w / base.w, cell.h / base.h);
  // Within what the export takes (main.py _EditorTransform).
  const s = Math.min(4, Math.max(0.1, Math.round(scale * 1e6) / 1e6));
  return { crop, transform: { ...clip.transform, x: cell.x + cell.w / 2, y: cell.y + cell.h / 2, scale: s } };
}

/** The video layers a layout can place: showing at `time`, not hidden or
 * locked, bottom to top. */
export function layoutCandidates(project: Project, time: number): VideoLayer[] {
  return project.overlays.filter((o): o is VideoLayer => o.kind === "video" && !o.hidden && !o.locked && time >= o.start && time < o.end);
}

export interface LayoutOptions {
  fit: "fill" | "fit";
  /** The main video row takes the first screen. */
  main: boolean;
  /** Video layers for the screens after it, in order. */
  layerIds: string[];
  /** The playhead: an animated layer gets its place as a keyframe here. */
  time: number;
}

export interface LayoutResult {
  project: Project;
  /** Screens filled, and screens left empty (not enough videos). */
  filled: number;
  empty: number;
  /** Clips of the main row left as they are, because they're animated. */
  animatedClips: number;
}

/** Places the main video and the given layers into `cells` (already drawn
 * in for spacing). Keyframes are never removed: an animated layer gets a
 * keyframe at the playhead, an animated clip is left where it is. */
export function applyLayout(project: Project, sources: Record<string, MediaSource>, canvas: Size, cells: Cell[], opts: LayoutOptions): LayoutResult {
  let filled = 0;
  let animatedClips = 0;
  let next = project;
  let at = 0;
  if (opts.main && cells.length) {
    const cell = cells[at++];
    const clips = project.clips.map((c) => {
      const src = sources[c.sourceId];
      if (!src || !(src.width > 0 && src.height > 0)) return c;
      if (c.keyframes?.length) {
        animatedClips++;
        return c;
      }
      return { ...c, ...clipInCell(c, src, canvas, project.canvas, cell, opts.fit) };
    });
    next = { ...next, clips, mainSlot: { ...cell, fit: opts.fit } };
    filled++;
  }
  const first = at;
  const order = opts.layerIds.filter((id) => project.overlays.some((o) => o.id === id && o.kind === "video" && sources[o.sourceId]));
  const overlays = next.overlays.map((o) => {
    const i = order.indexOf(o.id);
    const cell = i < 0 ? undefined : cells[first + i];
    if (!cell || o.kind !== "video") return o;
    return layerInCell(o, sources[o.sourceId], canvas, { ...cell, fit: opts.fit }, opts.time);
  });
  filled += Math.min(order.length, Math.max(0, cells.length - first));
  return { project: { ...next, overlays }, filled, empty: Math.max(0, cells.length - filled), animatedClips };
}

/** A video layer placed in a screen. A webcam layout it had is dropped
 * (with the mask that layout made). */
export function layerInCell(o: VideoLayer, src: Size, canvas: Size, slot: LayoutSlot, time: number): VideoLayer {
  const p = placeInCell(src, o.crop, slot, canvas, slot.fit);
  const base: VideoLayer = { ...o, crop: p.crop, aspect: undefined, slot, camLayout: undefined, mask: o.camLayout ? null : o.mask };
  return { ...base, ...animateOverlayPatch(base, { x: p.x, y: p.y, width: p.width, rotation: 0 }, time) } as VideoLayer;
}

/** The main video row back over the whole canvas, as it was before a
 * layout: centred at full size, and uncropped if the layout cropped it.
 * Animated clips are left alone. */
export function releaseMain(project: Project): Project {
  const slot = project.mainSlot;
  if (!slot) return project;
  const clips = project.clips.map((c) =>
    c.keyframes?.length ? c : { ...c, transform: { ...c.transform, x: 0.5, y: 0.5, scale: 1 }, ...(slot.fit === "fill" ? { crop: { x: 0, y: 0, w: 1, h: 1 } } : {}) }
  );
  const { mainSlot: _drop, ...rest } = project;
  void _drop;
  return { ...rest, clips };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;

/** Screens placed again after the canvas changed from `from` to `to`: every
 * layer and clip that still sits where its layout put it. Ones moved or
 * resized by hand since, and animated ones, are left as they are. The same
 * project when nothing moves. */
export function relayoutSlots(project: Project, sources: Record<string, MediaSource>, from: Size, to: Size): Project {
  if (from.width * to.height === to.width * from.height) return project;
  let changed = false;
  const overlays = project.overlays.map((o) => {
    if (o.kind !== "video" || !o.slot || o.keyframes?.length) return o;
    const src = sources[o.sourceId];
    if (!src || !(src.width > 0 && src.height > 0)) return o;
    const was = placeInCell(src, o.crop, o.slot, from, o.slot.fit);
    if (!near(o.x, was.x) || !near(o.y, was.y) || !near(o.width, was.width)) return o;
    const now = placeInCell(src, o.crop, o.slot, to, o.slot.fit);
    changed = true;
    return { ...o, x: now.x, y: now.y, width: now.width, crop: now.crop };
  });
  let clips = project.clips;
  const slot = project.mainSlot;
  if (slot) {
    clips = project.clips.map((c) => {
      const src = sources[c.sourceId];
      if (!src || !(src.width > 0 && src.height > 0) || c.keyframes?.length) return c;
      const was = clipInCell(c, src, from, project.canvas, slot, slot.fit);
      if (!near(c.transform.x, was.transform.x) || !near(c.transform.y, was.transform.y) || !near(c.transform.scale, was.transform.scale)) return c;
      changed = true;
      return { ...c, ...clipInCell(c, src, to, project.canvas, slot, slot.fit) };
    });
  }
  return changed ? { ...project, clips, overlays } : project;
}
