/** Focus zooms and pointer effects in the export payload. Every value here
 * comes from the same functions the preview draws with (camera.ts,
 * pointer.ts), evaluated at the output frame times, so the backend only
 * positions sprites and scales frames - it never re-derives easing,
 * smoothing or geometry (app/pipeline/editor.py, _camera_chain and
 * _pointer_filters). Rows only appear when a value changes, so still
 * stretches cost nothing. Pure - see tests/desktop/focus.test.ts.
 */
import { CameraCache, cameraSamples, clipView } from "./camera.ts";
import { appliedZooms } from "./focusPrefs.ts";
import { PointerCache, pointerScene } from "./pointer.ts";
import type { Layout } from "./timeline.ts";
import type { MediaSource, Project } from "./types.ts";

/** Ring layers: two per color so a quick second click doesn't cut the
 * first ring short. 0/1 left, 2/3 right (and other buttons). */
export const RING_LAYERS = 4;
export const MAX_POINTER_ROWS = 200_000;
/** Backend limits (app/main.py): ring radius and cursor sprite height,
 * fractions of the canvas height. */
const MAX_RING_R = 0.5;
const MAX_CURSOR_H = 0.4;

export interface PointerRows {
  /** [t, x, y] canvas fractions; x = -1 hides the cursor. When the cursor
   * changes size (it grows with the zoom) a fourth column holds its size
   * relative to the sprite, which is drawn at `cursorScale`. */
  cursor: number[][];
  /** Scale the cursor sprite is drawn at: the largest scale used. */
  cursorScale: number;
  /** [t, layer, x, y, r, alpha]; r = radius as a fraction of canvas height. */
  rings: number[][];
  cursorUsed: boolean;
  ringsUsed: boolean;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Camera rows per clip (null where the clip has no zoom). */
export function cameraPayload(
  project: Project,
  lay: Layout,
  sources: Record<string, MediaSource>,
  canvas: { width: number; height: number },
  cache = new CameraCache()
): (number[][] | null)[] {
  return lay.clips.map((c) => {
    const view = clipView(c.clip, sources[c.clip.sourceId], canvas, project.canvas);
    const track = cache.track(appliedZooms(project), c.clip, view);
    return track ? cameraSamples(track, c, lay.fps) : null;
  });
}

export function pointerRows(
  project: Project,
  lay: Layout,
  sources: Record<string, MediaSource>,
  canvas: { width: number; height: number },
  caches = { pointer: new PointerCache(), camera: new CameraCache() }
): PointerRows | null {
  const style = project.pointer;
  if (!style || (!style.cursor && !style.clicks)) return null;
  const fps = lay.fps;
  const frames = Math.round(lay.total * fps);
  const cursor: number[][] = [];
  const rings: number[][] = [];
  const scales: number[] = [];
  let lastCursor = "";
  let active = new Array<boolean>(RING_LAYERS).fill(false);
  let cursorUsed = false;
  for (let f = 0; f < frames; f++) {
    const t = r3(f / fps);
    const scene = pointerScene(lay, project, sources, canvas, f / fps, caches);
    const key = scene.cursor ? `${r4(scene.cursor.x)},${r4(scene.cursor.y)},${r4(scene.cursor.scale)}` : "off";
    if (key !== lastCursor) {
      cursor.push(scene.cursor ? [t, r4(scene.cursor.x), r4(scene.cursor.y)] : [t, -1, -1]);
      scales.push(scene.cursor ? r4(scene.cursor.scale) : 0);
      lastCursor = key;
      if (scene.cursor) cursorUsed = true;
    }
    const used = new Array<boolean>(RING_LAYERS).fill(false);
    for (const ring of scene.rings) {
      const layer = (ring.button === "left" ? 0 : 2) + (ring.click % 2);
      if (used[layer]) continue;
      used[layer] = true;
      rings.push([t, layer, r4(ring.cx), r4(ring.cy), r4(Math.min(MAX_RING_R, ring.r)), r3(ring.alpha)]);
    }
    for (let l = 0; l < RING_LAYERS; l++) if (active[l] && !used[l]) rings.push([t, l, 0, 0, 0, 0]);
    active = used;
    if (cursor.length + rings.length > MAX_POINTER_ROWS) {
      throw new Error("This project has too much pointer activity to export in one go. Turn off the drawn cursor or click highlights, or export a shorter part.");
    }
  }
  const ringsUsed = rings.length > 0;
  if (!cursorUsed && !ringsUsed) return null;
  // The sprite is drawn at the largest size (sharp when zoomed in) and
  // each row says how much of it to show. A constant size needs no column
  // - the same rows an older backend accepts.
  const shown = scales.filter((k) => k > 0);
  const top = Math.min(MAX_CURSOR_H / Math.max(1e-6, style.cursorSize), shown.length ? Math.max(...shown) : 1);
  const varies = shown.some((k) => Math.abs(k - shown[0]) > 1e-4);
  if (varies) cursor.forEach((row, i) => row.push(row[1] < 0 ? 1 : Math.round(Math.min(1, scales[i] / top) * 10000) / 10000));
  return { cursor: cursorUsed ? cursor : [], cursorScale: shown.length ? top : 1, rings, cursorUsed, ringsUsed };
}
