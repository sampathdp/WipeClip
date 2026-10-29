/** Project-wide focus controls, kept apart from the zooms themselves so
 * every one of them is reversible: a global intensity, an "original view"
 * switch, time ranges where no zooms are suggested, and recorded clicks to
 * leave out. None of them changes a zoom or the recording; they apply where
 * zooms and rings are evaluated, which the preview and the export share
 * (camera tracks via appliedZooms, rings via pointerScene). Pure - see
 * tests/desktop/focus.test.ts.
 */
import type { InteractionEvent } from "../recorder/format.ts";
import type { CameraZoom, FocusExclusion, FocusPrefs, Project } from "./types.ts";
import { MAX_ZOOM } from "./camera.ts";

export const DEFAULT_FOCUS_PREFS: FocusPrefs = { intensity: 1, bypass: false, excluded: [], ignoredClicks: [] };
export const MIN_INTENSITY = 0.25;
export const MAX_INTENSITY = 1.5;
/** Clicks are matched by their press time; recorded times are whole ms. */
const CLICK_MATCH_S = 0.0015;

export function focusPrefs(p: Pick<Project, "focus">): FocusPrefs {
  return p.focus ?? DEFAULT_FOCUS_PREFS;
}

/** A zoom's strength above 1x scaled by `intensity`. */
export function scaledZoom(zoom: number, intensity: number): number {
  const k = Math.min(MAX_INTENSITY, Math.max(MIN_INTENSITY, intensity));
  return Math.min(MAX_ZOOM, Math.max(1, 1 + (zoom - 1) * k));
}

const NO_ZOOMS: CameraZoom[] = [];
const applied = new WeakMap<CameraZoom[], { intensity: number; bypass: boolean; out: CameraZoom[] }>();

/** The zooms as the camera shows them. The same array for the same input,
 * so the camera caches keep hitting while nothing changes. */
export function appliedZooms(p: Pick<Project, "zooms" | "focus">): CameraZoom[] | undefined {
  const zooms = p.zooms;
  const { intensity, bypass } = focusPrefs(p);
  if (!zooms) return zooms;
  if (bypass) return NO_ZOOMS;
  if (intensity === 1) return zooms;
  const hit = applied.get(zooms);
  if (hit && hit.intensity === intensity && hit.bypass === bypass) return hit.out;
  const out = zooms.map((z) => ({ ...z, zoom: scaledZoom(z.zoom, intensity) }));
  applied.set(zooms, { intensity, bypass, out });
  return out;
}

export function isClickIgnored(prefs: FocusPrefs, sourceId: string, t: number): boolean {
  return prefs.ignoredClicks.some((c) => c.sourceId === sourceId && Math.abs(c.t - t) < CLICK_MATCH_S);
}

function excludedAt(ranges: FocusExclusion[], t: number): boolean {
  return ranges.some((r) => t >= r.start && t <= r.end);
}

/** The recording's events as zoom suggestions should see them: nothing
 * from an excluded range, no ignored click (press and its release). Pause,
 * resume and surface events are kept everywhere - they're structure, not
 * activity. */
export function eventsForSuggestions(events: InteractionEvent[], sourceId: string, prefs: FocusPrefs): InteractionEvent[] {
  const ranges = prefs.excluded.filter((r) => r.sourceId === sourceId);
  const ignored = prefs.ignoredClicks.filter((c) => c.sourceId === sourceId);
  if (!ranges.length && !ignored.length) return events;
  const dropUp = new Set<string>();
  const out: InteractionEvent[] = [];
  for (const e of events) {
    if (e.type === "pause" || e.type === "resume" || e.type === "surface") {
      out.push(e);
      continue;
    }
    if (e.type === "button") {
      if (e.down && ignored.some((c) => Math.abs(c.t - e.t / 1000) < CLICK_MATCH_S)) {
        dropUp.add(e.button);
        continue;
      }
      if (!e.down && dropUp.delete(e.button)) continue;
    }
    if (excludedAt(ranges, e.t / 1000)) continue;
    out.push(e);
  }
  return out;
}

/** Turns zoom suggestions off for a source-time range and removes the
 * unedited suggestions it overlaps. The user's own zooms stay. */
export function excludeRange(p: Project, ex: FocusExclusion): Project {
  const prefs = focusPrefs(p);
  const start = Math.min(ex.start, ex.end);
  const end = Math.max(ex.start, ex.end);
  if (!(end > start)) return p;
  return {
    ...p,
    focus: { ...prefs, excluded: [...prefs.excluded, { ...ex, start, end }] },
    zooms: (p.zooms ?? []).filter((z) => !(z.auto && z.sourceId === ex.sourceId && z.start < end && start < z.end)),
  };
}

export function removeExclusion(p: Project, id: string): Project {
  const prefs = focusPrefs(p);
  return { ...p, focus: { ...prefs, excluded: prefs.excluded.filter((r) => r.id !== id) } };
}

/** Ignores (or restores) one recorded click: no ring, and the next
 * analysis leaves it out. Existing zooms are left as they are. */
export function setClickIgnored(p: Project, sourceId: string, t: number, ignore: boolean): Project {
  const prefs = focusPrefs(p);
  const rest = prefs.ignoredClicks.filter((c) => !(c.sourceId === sourceId && Math.abs(c.t - t) < CLICK_MATCH_S));
  return { ...p, focus: { ...prefs, ignoredClicks: ignore ? [...rest, { sourceId, t }] : rest } };
}

export function patchFocusPrefs(p: Project, patch: Partial<Pick<FocusPrefs, "intensity" | "bypass">>): Project {
  return { ...p, focus: { ...focusPrefs(p), ...patch } };
}
