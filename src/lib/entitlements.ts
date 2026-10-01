import type { Resolution } from "./toolsApi";
import type { EffectType, FilterId, TransitionType } from "./editor/types";
import { EFFECT_LABELS, TRANSITION_LABELS } from "./editor/timeline";
import { FILTERS } from "./editor/look";

/** What each subscription tier unlocks. Works like CapCut: every tool is
 * usable in the editor on any tier, premium ones carry a badge, and the
 * export is where the plan is enforced (see /api/export) - so a free user
 * can try a Pro transition, then upgrade or swap it out before exporting.
 * Shared by the editor UI, the pricing page and the export route, so the
 * three can never disagree about what a plan includes.
 */
export type Tier = "free" | "starter" | "pro";

export const TIER_LABELS: Record<Tier, string> = { free: "Free", starter: "Starter", pro: "Pro" };

export interface TierLimits {
  /** Highest export resolution. */
  maxResolution: Resolution;
  /** Premium transitions, filters and effects allowed in exports. */
  premiumEffects: boolean;
  /** Free exports carry a small "Made with WipeClip" mark. */
  exportBranding: boolean;
  /** Editor exports per day for a signed-in user. */
  dailyExports: number;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: { maxResolution: "720p", premiumEffects: false, exportBranding: true, dailyExports: 5 },
  starter: { maxResolution: "1080p", premiumEffects: true, exportBranding: false, dailyExports: 50 },
  pro: { maxResolution: "4k", premiumEffects: true, exportBranding: false, dailyExports: 200 },
};

const RESOLUTION_ORDER: Resolution[] = ["720p", "1080p", "4k"];

export function toTier(plan: string | null | undefined): Tier {
  return plan === "starter" || plan === "pro" ? plan : "free";
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
const FREE_TRANSITIONS: ReadonlySet<TransitionType> = new Set(["fade", "crossfade", "dipblack"]);
const FREE_FILTERS: ReadonlySet<FilterId> = new Set(["original", "warm", "cool", "bw"]);
const FREE_EFFECTS: ReadonlySet<EffectType> = new Set(["blur", "flash", "zoom"]);

export const isPremiumTransition = (t: TransitionType) => !FREE_TRANSITIONS.has(t);
export const isPremiumFilter = (f: FilterId) => !FREE_FILTERS.has(f);
export const isPremiumEffect = (e: EffectType) => !FREE_EFFECTS.has(e);

/** Minimal shape of a project (client model or export payload) needed to
 * find which premium features it uses. Read defensively: on the server it
 * comes straight from the request body. */
export interface PremiumCheckable {
  clips: { transition: { type: string } | null; look: { filter: string } }[];
  effects: { type: string }[];
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
  return [...used];
}
