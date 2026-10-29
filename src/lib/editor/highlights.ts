/** Highlight suggestions: moments of a timeline that may be worth their own
 * clip, from signals the user can check. Pure - see
 * tests/desktop/highlights.test.ts.
 *
 * Signals, each judged against the timeline's own typical level (so a loud
 * game or a busy screen isn't "exciting" all the way through):
 * - sound: the level jumps well above both the few seconds before and the
 *   timeline's typical level (a shout, a laugh, an explosion). Speech
 *   starting after a pause is not a jump: it only reaches the usual level.
 * - picture: the picture changes much more than it usually does
 *   (activity.py motion_profile, local engine only).
 * - scene: the footage cuts to something else (a weak signal: in a screen
 *   recording that's usually just a window switch). Also used to start a
 *   clip on the cut instead of just before it.
 * - input: a burst of clicks, keys or scrolling (recordings).
 * - marker: a moment the user marked while recording - always suggested.
 *
 * Nothing here knows what is on screen or what is said. Loud or busy is not
 * the same as good, so one signal alone only makes a low-confidence
 * suggestion ranked below moments where several agree, and the panel says
 * what each suggestion is based on.
 *
 * Every suggestion is a range [peak - preRoll, peak + postRoll], moved
 * slightly so it doesn't start or end in the middle of loud sound when a
 * quieter frame is close, and on a scene cut when one is just before it.
 */
import type { AudioLevels } from "./audioAnalysis.ts";
import type { Act } from "./insights.ts";
import { rippleCut } from "./ripple.ts";
import { formatTime, layout } from "./timeline.ts";
import type { Highlight, HighlightSet, HighlightSignal, Project } from "./types.ts";

export interface HighlightSettings {
  /** Seconds kept before the peak moment. */
  preRoll: number;
  /** Seconds kept after it. */
  postRoll: number;
  /** Most suggestions made. */
  maxCount: number;
  /** 0..1: higher suggests more (weaker) moments. */
  sensitivity: number;
}

export const DEFAULT_HIGHLIGHTS: HighlightSettings = { preRoll: 5, postRoll: 3, maxCount: 8, sensitivity: 0.5 };

/** A sampled frame of the picture, in timeline time (activity.py motion_profile:
 * motion = mean frame difference, scene = scene-change score, both 0..100). */
export interface PictureSample {
  t: number;
  motion: number;
  scene: number;
}

export interface HighlightInputs {
  total: number;
  /** 20 ms levels of the timeline's sound; null without sound. */
  levels: AudioLevels | null;
  /** Null when the picture couldn't be measured (no local engine). */
  picture: PictureSample[] | null;
  /** Recording events in timeline time; null for plain videos. */
  acts: Act[] | null;
}

/** Analysis step, seconds. */
export const BIN = 0.5;
/** Signals within this many seconds of each other count as one moment. */
const AGREE = 2;
const WEIGHTS: Record<Exclude<HighlightSignal, "marker">, number> = { sound: 0.4, picture: 0.3, input: 0.2, scene: 0.1 };
/** dB above the louder of the moment before and the typical level. */
const SOUND_JUMP_DB = 6;
/** Scene-change score that counts as a cut (activity.py; hard cuts score ~18). */
export const SCENE_CUT = 8;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function quantile(values: ArrayLike<number>, q: number): number {
  const a = Array.from(values).filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))];
}

/** Mean of each bin (energy mean for dB), NaN for an empty bin. */
function binDb(levels: AudioLevels, bins: number): Float32Array {
  const out = new Float32Array(bins).fill(NaN);
  const per = Math.max(1, Math.round(BIN / levels.sec));
  for (let b = 0; b < bins; b++) {
    let sum = 0;
    let n = 0;
    for (let f = b * per; f < Math.min(levels.frameDb.length, (b + 1) * per); f++) {
      sum += Math.pow(10, levels.frameDb[f] / 10);
      n++;
    }
    if (n) out[b] = 10 * Math.log10(Math.max(1e-12, sum / n));
  }
  return out;
}

interface SignalCurve {
  value: Float32Array; // 0..1 per bin
  text: (b: number) => string;
}

function soundCurve(levels: AudioLevels, bins: number): SignalCurve | null {
  const loud = binDb(levels, bins);
  const typical = quantile(loud, 0.5);
  const high = quantile(loud, 0.9);
  // Under -50 dBFS almost everywhere: no meaningful sound to compare.
  if (high < -50) return null;
  const value = new Float32Array(bins);
  const jump = new Float32Array(bins);
  const back = Math.round(4 / BIN);
  for (let b = 0; b < bins; b++) {
    if (!Number.isFinite(loud[b])) continue;
    const before = Array.from(loud.subarray(Math.max(0, b - back), Math.max(0, b - 1))).filter(Number.isFinite);
    const base = Math.max(typical, before.length ? quantile(before, 0.5) : typical);
    jump[b] = loud[b] - base;
    // A jump that doesn't reach the timeline's loud moments isn't one.
    value[b] = loud[b] >= high - 3 ? clamp01((jump[b] - SOUND_JUMP_DB) / 12) : 0;
  }
  return { value, text: (b) => `Sound jumps ${Math.round(jump[b])} dB above the moments before` };
}

function pictureCurves(picture: PictureSample[], bins: number): { picture: SignalCurve | null; scene: SignalCurve | null; cuts: number[] } {
  const motion = new Float32Array(bins).fill(NaN);
  const scene = new Float32Array(bins);
  const counts = new Uint16Array(bins);
  const cuts: number[] = [];
  for (const s of picture) {
    const b = Math.floor(s.t / BIN);
    if (b < 0 || b >= bins) continue;
    motion[b] = (Number.isFinite(motion[b]) ? motion[b] * counts[b] : 0) + s.motion;
    counts[b]++;
    motion[b] /= counts[b];
    if (s.scene >= SCENE_CUT) {
      scene[b] = Math.max(scene[b], s.scene);
      cuts.push(s.t);
    }
  }
  const median = quantile(motion, 0.5);
  const p90 = quantile(motion, 0.9);
  // The usual amount of movement: a picture busy all the time (a game) has
  // a high median, a screen recording a median near 0.
  const usual = Math.max(0.15, median * 2, p90);
  const value = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    // A scene cut's own frame always differs completely: not movement.
    if (Number.isFinite(motion[b]) && scene[b] === 0) value[b] = clamp01((motion[b] / usual - 1.5) / 2.5);
  }
  const anyMotion = value.some((v) => v > 0);
  const sceneValue = new Float32Array(bins);
  for (let b = 0; b < bins; b++) if (scene[b] > 0) sceneValue[b] = 1;
  return {
    picture: anyMotion
      ? { value, text: (b) => `The picture moves ${Math.max(2, Math.round(motion[b] / Math.max(0.05, median)))}× more than usual` }
      : null,
    scene: cuts.length ? { value: sceneValue, text: () => "The footage cuts to a new scene" } : null,
    cuts,
  };
}

function inputCurve(acts: Act[], bins: number, total: number): SignalCurve | null {
  const per = new Float32Array(bins);
  for (const a of acts) {
    if (a.kind !== "click" && a.kind !== "key" && a.kind !== "scroll") continue;
    const b = Math.floor(a.t / BIN);
    if (b >= 0 && b < bins) per[b]++;
  }
  // Inputs in a 3 s window around each bin.
  const win = Math.round(1.5 / BIN);
  const count = new Float32Array(bins);
  for (let b = 0; b < bins; b++) for (let k = Math.max(0, b - win); k <= Math.min(bins - 1, b + win); k++) count[b] += per[k];
  const totalInputs = per.reduce((x, y) => x + y, 0);
  if (totalInputs < 3) return null;
  const typical = (totalInputs / Math.max(1, total)) * 3;
  const value = new Float32Array(bins);
  for (let b = 0; b < bins; b++) value[b] = count[b] >= 4 ? clamp01((count[b] / Math.max(1, typical) - 2) / 4) : 0;
  return { value, text: (b) => `A burst of input: ${Math.round(count[b])} clicks, keys or scrolls in 3 s` };
}

/** Max of `v` over b ± r, and where it is. */
function around(v: Float32Array, b: number, r: number): [number, number] {
  let best = 0;
  let at = b;
  for (let k = Math.max(0, b - r); k <= Math.min(v.length - 1, b + r); k++) {
    if (v[k] > best) {
      best = v[k];
      at = k;
    }
  }
  return [best, at];
}

/** Moves `t` (by up to `reach` s, in `dir`) to a frame where the sound is
 * no longer loud, so a clip doesn't begin or end mid-shout or mid-word. */
function quieter(levels: AudioLevels | null, t: number, dir: -1 | 1, reach: number, threshold: number, total: number): number {
  if (!levels) return t;
  const f0 = Math.round(t / levels.sec);
  const steps = Math.round(reach / levels.sec);
  for (let k = 0; k <= steps; k++) {
    const f = f0 + dir * k;
    if (f < 0 || f >= levels.frameDb.length) break;
    if (levels.frameDb[f] < threshold) return Math.min(total, Math.max(0, f * levels.sec));
  }
  return t;
}

export interface HighlightResult {
  items: Omit<Highlight, "id" | "status">[];
  notes: string[];
}

export function findHighlights(input: HighlightInputs, s: HighlightSettings = DEFAULT_HIGHLIGHTS): HighlightResult {
  const { total } = input;
  const bins = Math.ceil(total / BIN);
  const notes: string[] = [];
  if (bins === 0) return { items: [], notes };
  const curves: Partial<Record<Exclude<HighlightSignal, "marker">, SignalCurve>> = {};
  let cuts: number[] = [];
  if (input.levels) {
    const c = soundCurve(input.levels, bins);
    if (c) curves.sound = c;
  } else notes.push("There's no sound to analyze.");
  if (input.picture?.length) {
    const p = pictureCurves(input.picture, bins);
    if (p.picture) curves.picture = p.picture;
    if (p.scene) curves.scene = p.scene;
    cuts = p.cuts;
  } else notes.push("The picture wasn't measured here (desktop app only), so suggestions use the sound and inputs.");
  if (input.acts) {
    const c = inputCurve(input.acts, bins, total);
    if (c) curves.input = c;
  }
  const markers = (input.acts ?? []).filter((a) => a.kind === "marker" && a.t >= 0 && a.t <= total);

  // Combined score per bin: each signal's strongest value nearby, weighted;
  // one signal alone counts much less (loud or busy alone isn't proof).
  const r = Math.round(AGREE / BIN);
  const score = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    let sum = 0;
    let n = 0;
    for (const [k, c] of Object.entries(curves) as [keyof typeof WEIGHTS, SignalCurve][]) {
      const [v] = around(c.value, b, r);
      if (v >= 0.15) {
        sum += WEIGHTS[k] * v;
        if (k !== "scene") n++;
      }
    }
    score[b] = n >= 2 ? sum * 1.6 : sum * 0.4;
  }
  // Where inside a candidate's window the signals themselves are strongest:
  // the peak moment (the combined score is spread over +-AGREE).
  const raw = new Float32Array(bins);
  for (const [k, c] of Object.entries(curves) as [keyof typeof WEIGHTS, SignalCurve][]) for (let b = 0; b < bins; b++) raw[b] += WEIGHTS[k] * c.value[b];
  const peakOf = (b: number) => {
    const [v, at] = around(raw, b, r);
    return ((v > 0 ? at : b) + 0.5) * BIN;
  };

  // Peaks: best bins first, at least one clip length apart.
  const threshold = 0.32 - 0.24 * clamp01(s.sensitivity);
  const span = s.preRoll + s.postRoll;
  const order = Array.from(score.keys()).filter((b) => score[b] >= threshold * 0.5).sort((a, b) => score[b] - score[a]);
  const peaks: { t: number; marker?: Act }[] = markers.map((m) => ({ t: m.t, marker: m }));
  for (const b of order) {
    if (score[b] < threshold) break;
    const t = peakOf(b);
    if (peaks.some((p) => Math.abs(p.t - t) < span * 0.8)) continue;
    peaks.push({ t });
  }

  // Halfway between the quiet parts and typical sound: below it is a pause.
  const speechLoud = input.levels ? (quantile(input.levels.frameDb, 0.1) + quantile(input.levels.frameDb, 0.5)) / 2 : 0;
  const items: HighlightResult["items"] = peaks.map(({ t, marker }) => {
    const b = Math.min(bins - 1, Math.floor(t / BIN));
    const reasons: Highlight["reasons"] = [];
    let agreeing = 0;
    for (const [k, c] of Object.entries(curves) as [keyof typeof WEIGHTS, SignalCurve][]) {
      const [v, at] = around(c.value, b, r);
      if (v >= 0.15) {
        reasons.push({ signal: k, text: c.text(at) });
        if (k !== "scene") agreeing++;
      }
    }
    if (marker) reasons.unshift({ signal: "marker", text: marker.label ? `You marked this moment: “${marker.label}”` : "You marked this moment while recording" });
    let start = Math.max(0, t - s.preRoll);
    let end = Math.min(total, t + s.postRoll);
    // Start on a scene cut just inside the pre-roll rather than a moment
    // of the previous scene.
    const cut = cuts.find((c) => c > start && c < t - 0.5 && c - start < s.preRoll * 0.5);
    if (cut !== undefined) start = cut;
    else start = quieter(input.levels, start, -1, 1.0, speechLoud, total);
    end = quieter(input.levels, end, 1, 1.0, speechLoud, total);
    const confidence: Highlight["confidence"] = marker || agreeing >= 3 ? "high" : agreeing === 2 ? "medium" : "low";
    const sc = marker ? Math.max(0.9, score[b]) : score[b];
    return {
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      peak: Math.round(t * 100) / 100,
      score: Math.round(clamp01(sc) * 1000) / 1000,
      confidence,
      reasons,
      title: marker?.label || `Moment at ${formatTime(t)}`,
    };
  });
  items.sort((a, b) => b.score - a.score);
  const kept = items.slice(0, Math.max(s.maxCount, markers.length));
  if (!kept.length) notes.push("Nothing stood out from the rest of the timeline. Try a higher sensitivity, or mark moments while recording.");
  return { items: kept, notes };
}

/** A new set from fresh results. Kept and edited highlights of the previous
 * set survive (they are the user's choices); its pending and rejected ones
 * are replaced. */
export function buildHighlightSet(
  prev: HighlightSet | undefined,
  result: HighlightResult,
  keys: { timelineKey: string; inputsKey: string },
  ids: () => string,
  now = new Date()
): HighlightSet {
  const keep = prev && prev.timelineKey === keys.timelineKey ? prev.items.filter((h) => h.status === "kept" || h.edited) : [];
  const fresh = result.items
    .filter((h) => !keep.some((k) => Math.min(k.end, h.end) - Math.max(k.start, h.start) > 0.5 * (h.end - h.start)))
    .map((h) => ({ ...h, id: ids(), status: "pending" as const }));
  const stats = prev?.stats ?? { suggested: 0, kept: 0, rejected: 0, edited: 0, exported: 0 };
  return {
    version: 1,
    createdAt: now.toISOString(),
    ...keys,
    items: [...keep, ...fresh].sort((a, b) => a.start - b.start),
    notes: result.notes,
    stats: { ...stats, suggested: stats.suggested + fresh.length },
  };
}

export function setHighlightStatus(set: HighlightSet, id: string, status: Highlight["status"]): HighlightSet {
  const h = set.items.find((x) => x.id === id);
  if (!h || h.status === status) return set;
  const stats = { ...set.stats };
  if (status === "kept") stats.kept++;
  if (status === "rejected") stats.rejected++;
  return { ...set, stats, items: set.items.map((x) => (x.id === id ? { ...x, status } : x)) };
}

/** Changes a highlight's range (clamped to the timeline, at least 0.5 s). */
export function editHighlight(set: HighlightSet, id: string, start: number, end: number, total: number): HighlightSet {
  const a = Math.max(0, Math.min(start, total - 0.5));
  const b = Math.min(total, Math.max(end, a + 0.5));
  const h = set.items.find((x) => x.id === id);
  if (!h || (h.start === a && h.end === b)) return set;
  const stats = h.edited ? set.stats : { ...set.stats, edited: set.stats.edited + 1 };
  return { ...set, stats, items: set.items.map((x) => (x.id === id ? { ...x, start: a, end: b, edited: true } : x)) };
}

/** Picture samples of source seconds mapped onto the timeline through the
 * clips that show them (trims, speed, reverse; freeze frames have none). */
export function pictureOnTimeline(
  clips: { start: number; duration: number; path: string | null; toTimeline: (s: number) => number | null }[],
  profiles: Map<string, { times: number[]; motion: number[]; scene: number[] }[]>
): PictureSample[] {
  const out: PictureSample[] = [];
  for (const c of clips) {
    if (!c.path) continue;
    for (const p of profiles.get(c.path) ?? []) {
      for (let i = 0; i < p.times.length; i++) {
        const t = c.toTimeline(p.times[i]);
        if (t !== null && t >= c.start && t < c.start + c.duration) out.push({ t, motion: p.motion[i], scene: p.scene[i] });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Source chunks the motion profile is fetched in: aligned to a grid so
 * trimming a clip reuses what was measured. */
export const PROFILE_CHUNK = 60;

export function profileChunks(sourceStart: number, sourceEnd: number): [number, number][] {
  const out: [number, number][] = [];
  for (let a = Math.floor(sourceStart / PROFILE_CHUNK) * PROFILE_CHUNK; a < sourceEnd; a += PROFILE_CHUNK) out.push([a, a + PROFILE_CHUNK]);
  return out;
}

/** A copy of the project holding only start..end of its timeline - every
 * track cut the way an accepted cut is (ripple.ts) - for exporting one
 * highlight through the normal export. The project itself is unchanged. */
export function highlightProject(project: Project, fps: number, start: number, end: number): { ok: true; project: Project } | { ok: false; error: string } {
  let p = project;
  const total = layout(p, fps).total;
  if (end < total - 1 / fps) {
    const r = rippleCut(p, layout(p, fps), end, total);
    if (!r.ok) return r;
    p = r.project;
  }
  if (start > 1 / fps) {
    const r = rippleCut(p, layout(p, fps), 0, start);
    if (!r.ok) return r;
    p = r.project;
  }
  // Review data of the full timeline means nothing in the clip.
  const clip: Project = { ...p, suggestions: [] };
  delete clip.draft;
  delete clip.highlights;
  delete clip.transcript;
  return { ok: true, project: clip };
}
