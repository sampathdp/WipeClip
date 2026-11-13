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
  /** Highest resolution of the website's cloud export (it costs bandwidth). */
  maxResolution: Resolution;
  /** Highest resolution of the desktop app's export, rendered on the
   * user's own computer. */
  maxDesktopResolution: Resolution;
  /** Lite tools allowed in exports: premium transitions, filters and
   * effects, karaoke text, voice effects, auto-ducking, webcam background
   * remove or replace (FEATURE_TIER). */
  premiumEffects: boolean;
  /** Starter tools allowed in exports: green screen, blend modes, speed
   * curves, masks, LUTs, curves, stabilization, GIF, audio-only,
   * high-quality and over 30 fps export (FEATURE_TIER). */
  proTools: boolean;
  /** Exports carry a small "Made with WipeClip" mark (currently off for every tier). */
  exportBranding: boolean;
  /** Editor exports per day for a signed-in user. */
  dailyExports: number;
  /** Encoded smaller (more compression) to keep bandwidth costs down. */
  compactExport: boolean;
  /** Longest edit the desktop app exports, in seconds; null = no limit.
   * The website's cloud exports stay capped at 10 minutes for every tier. */
  maxExportSeconds: number | null;
  /** Longest voice translation (dub.ts) an export may carry, in seconds
   * of the translated track; null = no limit. Translating is free to try
   * on any length; the export is where this is checked. */
  maxDubSeconds: number | null;
  /** Full Clean up audio runs (CleanupDialog) per project; null = no limit.
   * One-click Enhance voice and noise reduction don't count. */
  cleanupRuns: number | null;
  /** Longest timeline the Draft (draft.ts) is made for, in seconds; null = no limit. */
  maxDraftSeconds: number | null;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    maxResolution: "720p",
    maxDesktopResolution: "1080p",
    premiumEffects: false,
    proTools: false,
    exportBranding: false,
    dailyExports: 5,
    compactExport: true,
    maxExportSeconds: 10 * 60,
    maxDubSeconds: 60,
    cleanupRuns: 1,
    maxDraftSeconds: 5 * 60,
  },
  lite: {
    maxResolution: "1080p",
    maxDesktopResolution: "1080p",
    premiumEffects: true,
    proTools: false,
    exportBranding: false,
    dailyExports: 20,
    compactExport: false,
    maxExportSeconds: null,
    maxDubSeconds: 10 * 60,
    cleanupRuns: null,
    maxDraftSeconds: 5 * 60,
  },
  starter: {
    maxResolution: "1080p",
    maxDesktopResolution: "1080p",
    premiumEffects: true,
    proTools: true,
    exportBranding: false,
    dailyExports: 50,
    compactExport: false,
    maxExportSeconds: null,
    maxDubSeconds: 30 * 60,
    cleanupRuns: null,
    maxDraftSeconds: null,
  },
  pro: {
    maxResolution: "4k",
    maxDesktopResolution: "4k",
    premiumEffects: true,
    proTools: true,
    exportBranding: false,
    dailyExports: 200,
    compactExport: false,
    maxExportSeconds: null,
    maxDubSeconds: null,
    cleanupRuns: null,
    maxDraftSeconds: null,
  },
};

const RESOLUTION_ORDER: Resolution[] = ["720p", "1080p", "4k"];

export function toTier(plan: string | null | undefined): Tier {
  return TIERS.includes(plan as Tier) ? (plan as Tier) : "free";
}

/** `tier` includes everything `needed` does. */
export const tierAtLeast = (tier: Tier, needed: Tier) => TIERS.indexOf(tier) >= TIERS.indexOf(needed);

/** The tier's highest resolution: `local` for the desktop app's own render. */
export const maxResolutionFor = (tier: Tier, local: boolean): Resolution =>
  local ? TIER_LIMITS[tier].maxDesktopResolution : TIER_LIMITS[tier].maxResolution;

export function canExportAt(tier: Tier, resolution: Resolution, local = false): boolean {
  return RESOLUTION_ORDER.indexOf(resolution) <= RESOLUTION_ORDER.indexOf(maxResolutionFor(tier, local));
}

/** Cheapest tier that exports at this resolution. */
export function tierForResolution(resolution: Resolution, local = false): Tier {
  return TIERS.find((t) => canExportAt(t, resolution, local)) ?? "pro";
}

/** Cheapest tier whose voice translation limit covers `seconds`. */
export function tierForDub(seconds: number): Tier {
  return TIERS.find((t) => {
    const max = TIER_LIMITS[t].maxDubSeconds;
    return max === null || seconds <= max + 0.5;
  }) ?? "pro";
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
  webcamBackground: "Webcam background remove or replace",
  gif: "GIF export",
  audioOnly: "Audio-only export",
  quality: "High-quality export",
  fps: "Over 30 fps export",
} as const;

export type PremiumKey = keyof typeof PREMIUM;

/** The cheapest tier each premium tool is in. Premium transitions, filters
 * and effects are Lite; voice translation follows TIER_LIMITS.maxDubSeconds. */
export const FEATURE_TIER: Record<PremiumKey, Exclude<Tier, "free">> = {
  karaoke: "lite",
  ducking: "lite",
  voice: "lite",
  webcamBackground: "lite",
  chromaKey: "starter",
  blend: "starter",
  speedCurve: "starter",
  maskShape: "starter",
  lut: "starter",
  curves: "starter",
  stabilize: "starter",
  gif: "starter",
  audioOnly: "starter",
  quality: "starter",
  fps: "starter",
  customFont: "pro",
};

/** Free masks: circle and rectangle, not inverted. */
export const isPremiumMask = (m: { shape?: string; invert?: boolean } | null | undefined) => !!m && (m.invert === true || (m.shape !== "circle" && m.shape !== "rect"));

export const isPremiumTransition = (t: TransitionType) => !FREE_TRANSITIONS.has(t);
export const isPremiumFilter = (f: FilterId) => !FREE_FILTERS.has(f);
export const isPremiumEffect = (e: EffectType) => !FREE_EFFECTS.has(e);

/** Sizes of the transition, filter and effect sets, for the pricing page. */
export const LOOK_COUNTS = {
  transitions: { all: Object.keys(TRANSITION_LABELS).length, free: FREE_TRANSITIONS.size },
  // "Original" is no look, so it isn't counted.
  filters: { all: Object.keys(FILTERS).length - 1, free: FREE_FILTERS.size - 1 },
  effects: { all: Object.keys(EFFECT_LABELS).length, free: FREE_EFFECTS.size },
};

/** Webcam background modes in the free plan: the webcam's own background, blurred. */
const FREE_MATTE_MODES: ReadonlySet<string> = new Set(["blur"]);

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
    /** Webcam background (WebcamMatte), on video layers. */
    matte?: unknown;
  }[];
  /** `dub`: an English voice track (or part of one) from voice
   * translation (dub.ts), `duration` seconds long. */
  audio?: { duck?: unknown; voice?: string; dub?: unknown; duration?: number; muted?: boolean }[];
  /** Export settings (payload; the export dialog adds them too). */
  format?: string;
  quality?: string;
  fps?: number;
  fpsChosen?: boolean;
}

/** A premium feature a project uses and the cheapest tier that exports it. */
export interface PlanFeature {
  name: string;
  tier: Exclude<Tier, "free">;
}

const asMask = (v: unknown) => (v && typeof v === "object" ? (v as { shape?: string; invert?: boolean }) : null);

function curvesUsed(look: PremiumCheckable["clips"][number]["look"]): boolean {
  if (Array.isArray(look?.curve)) return true;
  const c = look?.curves as Record<string, [number, number][]> | undefined;
  return !!c && Object.values(c).some((pts) => Array.isArray(pts) && pts.some((p) => Array.isArray(p) && Math.abs(p[0] - p[1]) > 1e-4));
}

/** Seconds of translated voice the project plays: every part of the English
 * voice tracks together, so splitting one doesn't change it. */
export function dubSeconds(project: Pick<PremiumCheckable, "audio">): number {
  let total = 0;
  for (const a of project.audio ?? []) {
    if (a?.dub && a.muted !== true && typeof a.duration === "number" && a.duration > 0) total += a.duration;
  }
  return total;
}

/** The premium features a project uses, deduped and in timeline order,
 * each with the cheapest tier that exports it. Unknown names are ignored
 * here - the backend rejects those itself.
 */
export function planFeaturesUsed(project: PremiumCheckable): PlanFeature[] {
  const used = new Map<string, PlanFeature["tier"]>();
  const add = (key: PremiumKey) => used.set(PREMIUM[key], FEATURE_TIER[key]);
  project.clips.forEach((c, i) => {
    // The last clip's transition never plays, so it doesn't count.
    const t = c?.transition?.type as TransitionType | undefined;
    if (t && i < project.clips.length - 1 && Object.hasOwn(TRANSITION_LABELS, t) && isPremiumTransition(t)) {
      used.set(`${TRANSITION_LABELS[t].label} transition`, "lite");
    }
    const f = c?.look?.filter as FilterId | undefined;
    if (f && Object.hasOwn(FILTERS, f) && isPremiumFilter(f)) used.set(`${FILTERS[f].label} filter`, "lite");
  });
  for (const e of project.effects) {
    const t = e?.type as EffectType | undefined;
    if (t && Object.hasOwn(EFFECT_LABELS, t) && isPremiumEffect(t)) used.set(`${EFFECT_LABELS[t]} effect`, "lite");
  }
  for (const c of project.clips) {
    if (Array.isArray(c?.ramp) && c.ramp.length) add("speedCurve");
    if (typeof c?.stabilize === "number" && c.stabilize > 0) add("stabilize");
    const lut = c?.look?.lut as { intensity?: number } | null | undefined;
    if (lut && (lut.intensity ?? 100) > 0) add("lut");
    if (curvesUsed(c?.look)) add("curves");
    if (isPremiumMask(asMask(c?.maskStyle) ?? asMask(c?.mask))) add("maskShape");
  }
  for (const o of project.overlays ?? []) {
    if (o?.blend && o.blend !== "normal") add("blend");
    if (o?.key || o?.keyed) add("chromaKey");
    if (isPremiumMask(asMask(o?.maskStyle) ?? asMask(o?.mask))) add("maskShape");
    if ((o?.textAnim ?? o?.text?.anim) === "karaoke") add("karaoke");
    if (o?.customFont || o?.text?.font?.startsWith("src:")) add("customFont");
    const mode = o?.matte && typeof o.matte === "object" ? (o.matte as { mode?: unknown }).mode : undefined;
    if (typeof mode === "string" && !FREE_MATTE_MODES.has(mode)) add("webcamBackground");
  }
  for (const a of project.audio ?? []) {
    if (a?.duck) add("ducking");
    if (a?.voice && a.voice !== "none") add("voice");
  }
  const dub = dubSeconds(project);
  const dubTier = tierForDub(dub);
  if (dubTier !== "free") used.set(`Voice translation of ${Math.ceil((dub - 0.5) / 60)} min`, dubTier);
  if (project.format === "gif") add("gif");
  if (project.format === "audio") add("audioOnly");
  if (project.quality && project.quality !== "standard") add("quality");
  if (project.fpsChosen && typeof project.fps === "number" && project.fps > 30) add("fps");
  return [...used].map(([name, tier]) => ({ name, tier }));
}

/** Names of the premium features a project uses, on any paid tier. */
export function premiumFeaturesUsed(project: PremiumCheckable): string[] {
  return planFeaturesUsed(project).map((f) => f.name);
}

/** The premium features a project uses that `tier` doesn't export. */
export function featuresAboveTier(project: PremiumCheckable, tier: Tier): PlanFeature[] {
  return planFeaturesUsed(project).filter((f) => !tierAtLeast(tier, f.tier));
}

/** Cheapest tier that exports all of `features`. */
export function tierForFeatures(features: PlanFeature[]): Tier {
  return features.reduce<Tier>((best, f) => (tierAtLeast(best, f.tier) ? best : f.tier), "free");
}
