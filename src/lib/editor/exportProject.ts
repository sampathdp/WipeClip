import { exportEditorProject, type RenderProgress, type Resolution } from "@/lib/toolsApi";
import { loadRaster, rasterKey } from "./rasters";
import { overlayWidth } from "./textRaster";
import { canvasSize, layout, videoBox } from "./timeline";
import { shapeMaskBlob } from "./shapeMask";
import { curveTables, curvesActive } from "./curves";
import { EXPORT_LUT_SIZE, loadLut, resampleLut } from "./lut";
import { sourceFile } from "./sourceFile";
import { cameraPayload, pointerRows } from "./focusExport";
import { maskRows } from "./masks";
import { RING_SPRITE_R, pointerSprites } from "./pointerDraw";
import type { Clip, MediaSource, Overlay, Project } from "./types";
import { sourceInput } from "./sourceFile";
import { clipKeyTimeToLocal } from "./keyframes";
import { activeRamp, rampSegments } from "./speed";

/** What file the export makes: an MP4 (at a quality and, optionally, a
 * frame rate), an animated GIF, or the sound alone (M4A). */
export interface ExportOutput {
  format: "mp4" | "gif" | "audio";
  quality: "standard" | "high" | "max";
  /** Frames per second; null = the original's. */
  fps: number | null;
}

export const DEFAULT_OUTPUT: ExportOutput = { format: "mp4", quality: "standard", fps: null };

export const OUTPUT_EXT: Record<ExportOutput["format"], string> = { mp4: "mp4", gif: "gif", audio: "m4a" };

/** Serializes the project into the backend's export payload (see
 * api_video_export in backend/app/main.py):
 *  - `sources`: videos, original first (it sets frame rate and canvas
 *    size); only ones a clip or an extracted-audio track uses are sent.
 *  - `overlays`: one PNG per distinct sticker/text/image raster - the same
 *    PNGs the preview draws - referenced by index. Video layers reference a
 *    source video instead.
 *  - `audios`: uploaded audio files.
 *  - `background`: the canvas background image, if one is set.
 * Hidden layers and muted audio are left out entirely.
 *
 * Focus zooms travel as per-clip `camera` rows and pointer effects as
 * `pointer` (rows + sprite PNGs in `overlays`), both evaluated here with
 * the preview's own functions (focusExport.ts).
 */
export async function exportProject(
  project: Project,
  sources: Record<string, MediaSource>,
  originalId: string,
  resolution: Resolution,
  signal?: AbortSignal,
  onProgress?: (p: RenderProgress) => void,
  output: ExportOutput = DEFAULT_OUTPUT
): Promise<Blob> {
  const original = sources[originalId];
  const canvas = canvasSize(project.canvas.aspect, original.width, original.height);

  const sourceIds = [originalId];
  const addSourceRef = (id: string) => {
    if (!sourceIds.includes(id)) sourceIds.push(id);
    return sourceIds.indexOf(id);
  };
  for (const clip of project.clips) addSourceRef(clip.sourceId);

  const overlays = project.overlays.filter((o) => !o.hidden);
  // Raster key -> index in imageBlobs (which also holds mask PNGs).
  const imageIndex = new Map<string, number>();
  const imageBlobs: Blob[] = [];
  const overlayPayload = [];
  for (const o of overlays) {
    if (o.kind === "video") {
      // Sent as a source video; the backend plays it (and its sound) itself.
      if (!sources[o.sourceId]) continue;
      overlayPayload.push({
        video: addSourceRef(o.sourceId),
        offset: round(o.offset),
        volume: o.volume,
        start: round(o.start),
        end: round(o.end),
        x: o.x,
        y: o.y,
        width: o.width,
        rotation: o.rotation,
        opacity: o.opacity,
        animIn: o.animIn,
        animOut: o.animOut,
        ...blendKey(o),
        ...(o.key ? { key: o.key } : {}),
        ...overlayKeyframes(o),
        ...planHints(o),
        // Shape mask as a PNG at the layer's proportions.
        ...(o.mask ? { mask: imageBlobs.push(await shapeMaskBlob(o.mask, sources[o.sourceId].width / Math.max(1, sources[o.sourceId].height))) - 1 } : {}),
      });
      continue;
    }
    const key = rasterKey(o);
    const raster = await loadRaster(o, sources);
    if (!imageIndex.has(key)) imageIndex.set(key, imageBlobs.push(raster.blob) - 1);
    overlayPayload.push({
      image: imageIndex.get(key)!,
      start: round(o.start),
      end: round(o.end),
      x: o.x,
      y: o.y,
      width: overlayWidth(o, raster, canvas),
      rotation: o.rotation,
      opacity: o.opacity,
      animIn: o.animIn,
      animOut: o.animOut,
      // Keyed images arrive already keyed (rasters.ts), so only the blend goes.
      ...blendKey(o),
      ...planHints(o),
      // Animated text: the PNG is a grid of states (textAnim.ts).
      ...(raster.sprite
        ? { sprite: { cols: raster.sprite.cols, rows: raster.sprite.rows, times: raster.sprite.times.map((t) => round(o.start + t)) } }
        : {}),
      ...overlayKeyframes(o),
    });
  }

  const audioIds: string[] = [];
  const audioPayload = [];
  for (const a of project.audio) {
    if (a.muted || a.volume === 0) continue;
    const src = sources[a.sourceId];
    if (!src) continue;
    const ref =
      src.kind === "audio"
        ? { audio: audioIds.includes(src.id) ? audioIds.indexOf(src.id) : audioIds.push(src.id) - 1 }
        : { video: addSourceRef(src.id) };
    audioPayload.push({
      ...ref,
      start: round(a.start),
      offset: round(a.offset),
      duration: round(a.duration),
      volume: a.volume,
      fadeIn: a.fadeIn,
      fadeOut: a.fadeOut,
      ...(a.duck && a.duck.amount > 0 && a.duck.regions.length ? { duck: a.duck } : {}),
      ...(a.voice && a.voice !== "none" ? { voice: a.voice } : {}),
    });
  }

  // Imported LUTs, resampled small enough for the project data.
  const luts = new Map<string, { size: number; data: number[] }>();
  for (const c of project.clips) {
    const ref = c.look.lut;
    const src = ref ? sources[ref.sourceId] : undefined;
    if (!ref || !src || luts.has(src.id)) continue;
    const lut = resampleLut(await loadLut(src.id, () => sourceFile(src)), EXPORT_LUT_SIZE);
    luts.set(src.id, { size: lut.size, data: Array.from(lut.data, (v) => Math.round(v * 10000) / 10000) });
  }

  // Clip shape masks as PNGs at their boxes' proportions.
  const clipMasks: (number | undefined)[] = [];
  for (const c of project.clips) {
    const src = sources[c.sourceId];
    if (!c.mask || !src) {
      clipMasks.push(undefined);
      continue;
    }
    const box = videoBox(c, src, canvas, project.canvas);
    clipMasks.push(imageBlobs.push(await shapeMaskBlob(c.mask, (box.w * canvas.width) / Math.max(1, box.h * canvas.height))) - 1);
  }

  const bg = project.canvas.background;
  const bgSource = bg.type === "image" ? sources[bg.sourceId] : undefined;

  const lay = layout(project, original.fps);
  const camera = cameraPayload(project, lay, sources, canvas);
  const rows = pointerRows(project, lay, sources, canvas);
  // Privacy masks: the rectangles the preview draws, per frame where they move.
  const masks = (project.masks ?? [])
    .filter((m) => m.enabled && m.end > m.start)
    .map((m) => ({ m, rows: maskRows(m, lay, project, sources, canvas) }))
    .filter(({ rows }) => rows.some((r) => r[3] > 0 && r[4] > 0))
    .map(({ m, rows }) => ({ mode: m.mode, start: round(m.start), end: round(m.end), strength: m.strength, color: m.color, rows }));
  let pointer = null;
  if (rows && project.pointer) {
    const sprites = await pointerSprites(project.pointer, canvas.height, rows.cursorUsed);
    const addImage = (blob: Blob) => imageBlobs.push(blob) - 1;
    pointer = {
      cursor: sprites.cursor
        ? {
            image: addImage(sprites.cursor.blob),
            // Sizes as fractions of the canvas height; hotspot as fractions of the sprite.
            width: sprites.cursor.width / canvas.height,
            height: sprites.cursor.height / canvas.height,
            hotX: sprites.cursor.hotX / sprites.cursor.width,
            hotY: sprites.cursor.hotY / sprites.cursor.height,
          }
        : null,
      rings: rows.ringsUsed ? sprites.rings.map((r) => ({ image: addImage(r.blob), size: r.size / RING_SPRITE_R })) : [],
      cursorRows: rows.cursor,
      ringRows: rows.rings,
    };
  }

  const payload = {
    canvas: {
      aspect: project.canvas.aspect,
      fit: project.canvas.fit,
      ...(project.canvas.frame ? { frame: project.canvas.frame } : {}),
      background: {
        type: bg.type === "image" && !bgSource ? "color" : bg.type,
        color: bg.type === "color" || bg.type === "gradient" ? bg.color : "#000000",
        color2: bg.type === "gradient" ? bg.color2 : "#000000",
      },
    },
    clips: project.clips.map((c, i) => ({
      source: sourceIds.indexOf(c.sourceId),
      start: round(c.start),
      end: round(c.end),
      freeze: c.freeze === null ? null : round(c.freeze),
      reverse: c.reverse,
      crop: c.crop,
      transition: c.transition ? { type: c.transition.type, duration: c.transition.duration } : null,
      speed: c.speed,
      volume: c.volume,
      transform: c.transform,
      look: {
        filter: c.look.filter,
        intensity: c.look.intensity,
        adjust: c.look.adjust,
        // Curves as sampled tables, the LUT as its data (look.py bakes both).
        ...(curvesActive(c.look.curves) ? { curve: curveTables(c.look.curves) } : {}),
        ...(c.look.lut && luts.has(c.look.lut.sourceId) && c.look.lut.intensity > 0
          ? { lut: { ...luts.get(c.look.lut.sourceId)!, intensity: c.look.lut.intensity } }
          : {}),
      },
      ...(camera[i] ? { camera: camera[i] } : {}),
      ...clipKeyframes(c),
      ...(clipMasks[i] !== undefined ? { mask: clipMasks[i], maskStyle: { shape: c.mask!.shape, invert: c.mask!.invert } } : {}),
      ...(c.stabilize && c.freeze === null ? { stabilize: c.stabilize } : {}),
      // Speed curve as its constant-speed pieces (speed.ts).
      ...(activeRamp(c) ? { ramp: rampSegments(activeRamp(c)!) } : {}),
    })),
    overlays: overlayPayload,
    audio: audioPayload,
    effects: project.effects.map((e) => ({ type: e.type, start: round(e.start), end: round(e.end), intensity: e.intensity })),
    ...(pointer ? { pointer } : {}),
    ...(masks.length ? { masks } : {}),
    // Screen recordings are variable frame rate: the server's probe would
    // see their average (often ~15 fps) instead of the capture rate the
    // preview, zooms and click rings run at.
    ...(output.fps ? { fps: output.fps } : original.recording && lay.fps > 0 ? { fps: lay.fps } : {}),
    format: output.format,
    quality: output.quality,
    fpsChosen: output.fps !== null,
  };

  return exportEditorProject(
    payload,
    sourceIds.map((id) => sourceInput(sources[id])),
    imageBlobs,
    audioIds.map((id) => sourceInput(sources[id])),
    bgSource?.file ?? null,
    resolution,
    signal,
    onProgress
  );
}

/** Layer keyframes in timeline seconds. */
function overlayKeyframes(o: Overlay) {
  if (!o.keyframes?.length) return {};
  return { keyframes: o.keyframes.map((k) => ({ ...k, t: round(o.start + k.t) })) };
}

const MIRROR_EASE = { linear: "linear", smooth: "smooth", in: "out", out: "in" } as const;

/** Clip keyframes in clip-local seconds (the export's clip time). A
 * reversed clip plays them backwards: the curve between two keyframes then
 * runs from the later one, mirrored. */
function clipKeyframes(c: Clip) {
  if (!c.keyframes?.length) return {};
  let kfs = c.keyframes.map((k) => ({ t: round(clipKeyTimeToLocal(c, k.t)), x: k.x, y: k.y, scale: k.scale, rotation: k.rotation, ease: k.ease }));
  if (c.reverse && c.freeze === null) {
    kfs = kfs.reverse().map((k, i, all) => ({ ...k, ease: i + 1 < all.length ? MIRROR_EASE[all[i + 1].ease] : k.ease }));
  }
  return { keyframes: kfs };
}

/** What the plan check (entitlements.ts premiumFeaturesUsed) can't read
 * from the rendered layer: its mask's shape, a keyed image, the text
 * animation and an uploaded font. The backend ignores these. */
function planHints(o: Overlay) {
  return {
    ...(o.mask ? { maskStyle: { shape: o.mask.shape, invert: o.mask.invert } } : {}),
    ...(o.kind === "image" && o.key ? { keyed: true } : {}),
    ...(o.kind === "text" && o.text.anim && o.text.anim !== "none" ? { textAnim: o.text.anim } : {}),
    ...(o.kind === "text" && o.text.font.startsWith("src:") ? { customFont: true } : {}),
  };
}

function blendKey(o: Overlay): { blend?: string } {
  return o.blend && o.blend !== "normal" ? { blend: o.blend } : {};
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
