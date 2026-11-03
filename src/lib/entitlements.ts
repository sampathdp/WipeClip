import type { Resolution } from "./toolsApi";
import type { EffectType, FilterId, TransitionType } from "./editor/types";
import { EFFECT_LABELS, TRANSITION_LABELS } from "./editor/timeline.ts";
import { FILTERS } from "./editor/look.ts";

/** What each subscription tier unlocks. Every tool is
 * usable in the editor on any tier, premium ones carry a badge, and the
 * export is where the plan is enforced (see /api/export) - so a free user
 * can try a Pro transition, then upgrade or swap it out before exporting.
 * Shared by the editor UI, the pricing page and the export route, so the
 * three can never disagree about what a plan includes.
 */
export type Tier = "free" | "lite" | "starter" | "pro";

/** Lowest to highest. */
export const TIERS: Tier[] = ["free", "lite", "starter", "pro"];

export const TIER_LABELS: Record<Tier, string> = { free: "Free", lite: "Lite", starter: "Starter", pro: "Pro" };

export interface TierLimits {
  /** Highest export resolution. */
  maxResolution: Resolution;
  /** Premium transitions, filters and effects allowed in exports. */
  premiumEffects: boolean;
  /** Exports carry a small "Made with WipeClip" mark (currently off for every tier). */
  exportBranding: boolean;
  /** Editor exports per day for a signed-in user. */
  dailyExports: number;
  /** Encoded smaller (more compression) to keep bandwidth costs down. */
  compactExport: boolean;
  /** Longest edit the desktop app exports, in seconds; null = no limit.
   * The website's cloud exports stay capped at 10 minutes for every tier. */
  maxExportSeconds: number | null;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: { maxResolution: "720p", premiumEffects: false, exportBranding: false, dailyExports: 5, compactExport: true, maxExportSeconds: 10 * 60 },
  lite: { maxResolution: "720p", premiumEffects: true, exportBranding: false, dailyExports: 20, compactExport: false, maxExportSeconds: null },
  starter: { maxResolution: "1080p", premiumEffects: true, exportBranding: false, dailyExports: 50, compactExport: false, maxExportSeconds: null },
  pro: { maxResolution: "4k", premiumEffects: true, exportBranding: false, dailyExports: 200, compactExport: false, maxExportSeconds: null },
};

const RESOLUTION_ORDER: Resolution[] = ["720p", "1080p", "4k"];

export function toTier(plan: string | null | undefined): Tier {
  return TIERS.includes(plan as Tier) ? (plan as Tier) : "free";
}

export function canExportAt(tier: Tier, resolution: Resolution): boolean {
  return RESOLUTION_ORDER.indexOf(resolution) <= RESOLUTION_ORDER.indexOf(TIER_LIMITS[tier].maxResolution);
}

/** Cheapest tier that exports at this resolution. */
export function tierForResolution(resolution: Resolution): Tier {
  return resolution === "4k" ? "pro" : resolution === "1080p" ? "starter" : "free";
}

// Everything not listed as free is premium, so a newly added transition,
// filter or effect defaults to a paid feature.
const FREE_TRANSITIONS: ReadonlySet<TransitionType> = new Set([
  "fade",
  "crossfade",
  "dipblack",
  "slideleft",
  "slideright",
  "slideup",
  "slidedown",
  "wipeleft",
  "wiperight",
]);
const FREE_FILTERS: ReadonlySet<FilterId> = new Set(["original", "warm", "cool", "bw"]);
const FREE_EFFECTS: ReadonlySet<EffectType> = new Set(["blur", "flash", "zoom", "bw", "vignette", "letterbox"]);

/** Premium editor tools beyond transitions, filters and effects, by the
 * name the export refusal and the editor badges use. */
export const PREMIUM = {
  chromaKey: "Green screen",
  blend: "Blend modes",
  speedCurve: "Speed curves",
  karaoke: "Karaoke text",
  maskShape: "Linear, mirror and inverted masks",
  lut: "LUT import",
  curves: "Curves",
  ducking: "Auto-ducking",
  voice: "Voice effects",
  stabilize: "Stabilization",
  customFont: "Custom fonts",
  gif: "GIF export",
  audioOnly: "Audio-only export",
  quality: "High-quality export",
  fps: "Over 30 fps export",
} as const;

/** Free masks: circle and rectangle, not inverted. */
export const isPremiumMask = (m: { shape?: string; invert?: boolean } | null | undefined) => !!m && (m.invert === true || (m.shape !== "circle" && m.shape !== "rect"));

export const isPremiumTransition = (t: TransitionType) => !FREE_TRANSITIONS.has(t);
export const isPremiumFilter = (f: FilterId) => !FREE_FILTERS.has(f);
export const isPremiumEffect = (e: EffectType) => !FREE_EFFECTS.has(e);

/** Minimal shape of a project (client model or export payload) needed to
 * find which premium features it uses. Read defensively: on the server it
 * comes straight from the request body. Where the two shapes differ, the
 * payload carries the client's value under another name (exportProject.ts):
 * a shape mask as `maskStyle`, a text animation as `textAnim`, ...
 *
 * Things drawn into PNGs by the browser (masks on image layers, keyed
 * images, animated text, uploaded fonts) are only declared by those
 * fields - the server can't see them in the pixels. */
export interface PremiumCheckable {
  clips: {
    transition: { type: string } | null;
    look: { filter: string; lut?: unknown; curve?: unknown; curves?: unknown };
    ramp?: unknown[];
    stabilize?: number;
    mask?: unknown;
    maskStyle?: unknown;
  }[];
  effects: { type: string }[];
  overlays?: {
    blend?: string;
    key?: unknown;
    keyed?: boolean;
    mask?: unknown;
    maskStyle?: unknown;
    textAnim?: string;
    customFont?: boolean;
    text?: { anim?: string; font?: string };
  }[];
  audio?: { duck?: unknown; voice?: string }[];
  /** Export settings (payload; the export dialog adds them too). */
  format?: string;
  quality?: string;
  fps?: number;
  fpsChosen?: boolean;
}

const asMask = (v: unknown) => (v && typeof v === "object" ? (v as { shape?: string; invert?: boolean }) : null);

function curvesUsed(look: PremiumCheckable["clips"][number]["look"]): boolean {
  if (Array.isArray(look?.curve)) return true;
  const c = look?.curves as Record<string, [number, number][]> | undefined;
  return !!c && Object.values(c).some((pts) => Array.isArray(pts) && pts.some((p) => Array.isArray(p) && Math.abs(p[0] - p[1]) > 1e-4));
}

/** Human-readable names of the premium features a project uses, deduped
 * and in timeline order. Unknown names are ignored here - the backend
 * rejects those itself.
 */
export function premiumFeaturesUsed(project: PremiumCheckable): string[] {
  const used = new Set<string>();
  project.clips.forEach((c, i) => {
    // The last clip's transition never plays, so it doesn't count.
    const t = c?.transition?.type as TransitionType | undefined;
    if (t && i < project.clips.length - 1 && Object.hasOwn(TRANSITION_LABELS, t) && isPremiumTransition(t)) {
      used.add(`${TRANSITION_LABELS[t].label} transition`);
    }
    const f = c?.look?.filter as FilterId | undefined;
    if (f && Object.hasOwn(FILTERS, f) && isPremiumFilter(f)) used.add(`${FILTERS[f].label} filter`);
  });
  for (const e of project.effects) {
    const t = e?.type as EffectType | undefined;
    if (t && Object.hasOwn(EFFECT_LABELS, t) && isPremiumEffect(t)) used.add(`${EFFECT_LABELS[t]} effect`);
  }
  for (const c of project.clips) {
    if (Array.isArray(c?.ramp) && c.ramp.length) used.add(PREMIUM.speedCurve);
    if (typeof c?.stabilize === "number" && c.stabilize > 0) used.add(PREMIUM.stabilize);
    const lut = c?.look?.lut as { intensity?: number } | null | undefined;
    if (lut && (lut.intensity ?? 100) > 0) used.add(PREMIUM.lut);
    if (curvesUsed(c?.look)) used.add(PREMIUM.curves);
    if (isPremiumMask(asMask(c?.maskStyle) ?? asMask(c?.mask))) used.add(PREMIUM.maskShape);
  }
  for (const o of project.overlays ?? []) {
    if (o?.blend && o.blend !== "normal") used.add(PREMIUM.blend);
    if (o?.key || o?.keyed) used.add(PREMIUM.chromaKey);
    if (isPremiumMask(asMask(o?.maskStyle) ?? asMask(o?.mask))) used.add(PREMIUM.maskShape);
    if ((o?.textAnim ?? o?.text?.anim) === "karaoke") used.add(PREMIUM.karaoke);
    if (o?.customFont || o?.text?.font?.startsWith("src:")) used.add(PREMIUM.customFont);
  }
  for (const a of project.audio ?? []) {
    if (a?.duck) used.add(PREMIUM.ducking);
    if (a?.voice && a.voice !== "none") used.add(PREMIUM.voice);
  }
  if (project.format === "gif") used.add(PREMIUM.gif);
  if (project.format === "audio") used.add(PREMIUM.audioOnly);
  if (project.quality && project.quality !== "standard") used.add(PREMIUM.quality);
  if (project.fpsChosen && typeof project.fps === "number" && project.fps > 30) used.add(PREMIUM.fps);
  return [...used];
}
