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
import { timelineTimeOf } from "./camera.ts";
import type { Act } from "./insights.ts";
import { rippleCut } from "./ripple.ts";
import { formatTime, layout, type Layout } from "./timeline.ts";
import type { Highlight, HighlightSet, HighlightSignal, Project } from "./types.ts";

/** What kind of video the highlights are for. Each workflow weighs the
 * signals differently (WORKFLOWS); none of them understands content. */
export type HighlightWorkflow = "gameplay" | "tutorial" | "demo" | "talking-head" | "social";

type Measured = Exclude<HighlightSignal, "marker">;

export interface WorkflowRules {
  label: string;
  /** What it looks for, for the panel. */
  summary: string;
  /** Signal weights; a signal not listed isn't used. */
  weights: Partial<Record<Measured, number>>;
  /** Signals (other than scene cuts) that must agree for full weight; a
   * moment with fewer counts 0.4x. */
  minAgree: number;
  preRoll: number;
  postRoll: number;
  maxCount: number;
  /** Batch exports default to vertical (9:16). */
  vertical?: boolean;
}

export const WORKFLOWS: Record<HighlightWorkflow, WorkflowRules> = {
  gameplay: {
    label: "Gameplay highlights",
    summary: "Sound jumps, sudden movement, scene cuts and bursts of input, with at least two of them together. Markers always count.",
    weights: { sound: 0.4, picture: 0.3, input: 0.2, scene: 0.1 },
    minAgree: 2,
    preRoll: 5,
    postRoll: 3,
    maxCount: 8,
  },
  tutorial: {
    label: "Software tutorial",
    summary: "A new explanation after a pause, switching apps and deliberate clicks: the start of each step. Markers always count.",
    weights: { speech: 0.35, app: 0.25, click: 0.25, input: 0.15 },
    minAgree: 2,
    preRoll: 1.5,
    postRoll: 12,
    maxCount: 8,
  },
  demo: {
    label: "Product demo",
    summary: "Deliberate clicks first, with the spoken explanation around them and app switches.",
    weights: { click: 0.4, speech: 0.3, app: 0.15, input: 0.15 },
    minAgree: 2,
    preRoll: 2,
    postRoll: 8,
    maxCount: 8,
  },
  "talking-head": {
    label: "Talking-head tutorial",
    summary: "Each new point after a pause in speech, stronger with emphasis (louder) or movement.",
    weights: { speech: 0.55, sound: 0.25, picture: 0.2 },
    minAgree: 1,
    preRoll: 1,
    postRoll: 15,
    maxCount: 6,
  },
  social: {
    label: "Short-form social",
    summary: "Short, busy moments where sound, movement, speech or clicks come together; exported vertical (9:16) by default.",
    weights: { sound: 0.3, picture: 0.25, speech: 0.2, click: 0.15, input: 0.1 },
    minAgree: 2,
    preRoll: 6,
    postRoll: 12,
    maxCount: 5,
    vertical: true,
  },
};

/** The workflow's own clip length and count, for the settings. */
export function workflowSettings(w: HighlightWorkflow, sensitivity = 0.5): HighlightSettings {
  const r = WORKFLOWS[w];
  return { workflow: w, preRoll: r.preRoll, postRoll: r.postRoll, maxCount: r.maxCount, sensitivity };
}

export interface HighlightSettings {
  /** Seconds kept before the peak moment. */
  preRoll: number;
  /** Seconds kept after it. */
  postRoll: number;
  /** Most suggestions made. */
  maxCount: number;
  /** 0..1: higher suggests more (weaker) moments. */
  sensitivity: number;
  /** Default: gameplay (the weights used before workflows existed). */
  workflow?: HighlightWorkflow;
}

export const DEFAULT_HIGHLIGHTS: HighlightSettings = { preRoll: 5, postRoll: 3, maxCount: 8, sensitivity: 0.5, workflow: "gameplay" };

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
  /** Spoken stretches in timeline time, from the transcript; when absent,
   * they're estimated from the sound levels. */
  speech?: { start: number; end: number }[] | null;
}

/** Analysis step, seconds. */
export const BIN = 0.5;
/** Signals within this many seconds of each other count as one moment. */
const AGREE = 2;
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

/** A new spoken stretch after a pause of at least this long (s). */
const SPEECH_PAUSE = 1;

/** Speech segments from a transcript's words (gaps over 0.8 s split them). */
export function speechFromWords(words: { start: number; end: number }[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const w of words) {
    if (!Number.isFinite(w.start) || !(w.end >= w.start)) continue;
    const last = out[out.length - 1];
    if (last && w.start - last.end <= 0.8) last.end = Math.max(last.end, w.end);
    else out.push({ start: w.start, end: w.end });
  }
  return out;
}

/** Speech estimated from the sound: stretches above the level halfway
 * between the quiet parts and typical sound, gaps under 0.6 s bridged.
 * One steady level (music, constant noise) has no such structure. */
function speechFromLevels(levels: AudioLevels): { start: number; end: number }[] {
  // The quiet level from the quietest 2%: pauses can be rare in narration.
  const lo = quantile(levels.frameDb, 0.02);
  if (quantile(levels.frameDb, 0.9) - lo < 6) return [];
  const threshold = (lo + quantile(levels.frameDb, 0.5)) / 2;
  const out: { start: number; end: number }[] = [];
  for (let f = 0; f < levels.frameDb.length; f++) {
    if (levels.frameDb[f] < threshold) continue;
    const t = f * levels.sec;
    const last = out[out.length - 1];
    if (last && t - last.end <= 0.6) last.end = t + levels.sec;
    else out.push({ start: t, end: t + levels.sec });
  }
  return out.filter((s) => s.end - s.start >= 0.8);
}

/** A spoken stretch that starts after a pause: a new point or step.
 * Stronger the longer it runs (up to 8 s). */
function speechCurve(segments: { start: number; end: number }[], bins: number): SignalCurve | null {
  const value = new Float32Array(bins);
  const info = new Map<number, { pause: number; length: number }>();
  // The recording's start counts as the end of speech: talking from the
  // first second isn't "after a pause", a silent opening of 1 s+ is.
  let prevEnd = 0;
  for (const s of segments) {
    const pause = s.start - prevEnd;
    prevEnd = Math.max(prevEnd, s.end);
    if (pause < SPEECH_PAUSE || s.end - s.start < 1.5) continue;
    const b = Math.floor(s.start / BIN);
    if (b < 0 || b >= bins) continue;
    const v = clamp01(0.4 + 0.075 * Math.min(8, s.end - s.start));
    if (v > value[b]) {
      value[b] = v;
      info.set(b, { pause, length: s.end - s.start });
    }
  }
  if (!info.size) return null;
  return {
    value,
    text: (b) => {
      const i = info.get(b);
      if (!i) return "Speech starts after a pause";
      return i.pause > 0 ? `Speech starts after a ${i.pause.toFixed(1)} s pause and runs ${Math.round(i.length)} s` : `Speech starts and runs ${Math.round(i.length)} s`;
    },
  };
}

/** Switching to another app (recorded active-window changes). */
function appCurve(acts: Act[], bins: number): SignalCurve | null {
  const value = new Float32Array(bins);
  const label = new Map<number, string>();
  for (const a of acts) {
    if (a.kind !== "window") continue;
    const b = Math.floor(a.t / BIN);
    if (b < 0 || b >= bins) continue;
    value[b] = 0.8;
    label.set(b, a.label ?? "");
  }
  if (!label.size) return null;
  return { value, text: (b) => (label.get(b) ? `Switches to ${label.get(b)}` : "Switches to another app") };
}

/** A deliberate click: the pointer had settled (moved under 2% of the frame
 * in the 0.4 s before), so it was aimed rather than hurried. */
function clickCurve(acts: Act[], bins: number): SignalCurve | null {
  const value = new Float32Array(bins);
  let any = false;
  const moves = acts.filter((a) => a.kind === "move" && Number.isFinite(a.x));
  let m = 0;
  for (const a of acts) {
    if (a.kind !== "click" || !Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
    while (m < moves.length && moves[m].t < a.t - 0.4) m++;
    let travel = 0;
    let prev = { x: a.x, y: a.y };
    for (let k = m; k < moves.length && moves[k].t < a.t; k++) {
      travel += Math.hypot(moves[k].x - prev.x, moves[k].y - prev.y);
      prev = moves[k];
    }
    if (travel >= 0.02) continue;
    const b = Math.floor(a.t / BIN);
    if (b < 0 || b >= bins) continue;
    value[b] = Math.min(1, value[b] + 0.7);
    any = true;
  }
  return any ? { value, text: () => "A deliberate click (the pointer settled on it first)" } : null;
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
  const rules = WORKFLOWS[s.workflow ?? "gameplay"];
  const WEIGHTS = rules.weights as Record<Measured, number>;
  const uses = (k: Measured) => (rules.weights[k] ?? 0) > 0;
  const curves: Partial<Record<Measured, SignalCurve>> = {};
  let cuts: number[] = [];
  if (input.levels) {
    const c = uses("sound") ? soundCurve(input.levels, bins) : null;
    if (c) curves.sound = c;
  } else notes.push("There's no sound to analyze.");
  if (input.picture?.length) {
    const p = pictureCurves(input.picture, bins);
    if (p.picture && uses("picture")) curves.picture = p.picture;
    if (p.scene && uses("scene")) curves.scene = p.scene;
    cuts = p.cuts;
  } else if (uses("picture") || uses("scene")) notes.push("The picture wasn't measured here (desktop app only), so suggestions use the sound and inputs.");
  if (input.acts) {
    const c = uses("input") ? inputCurve(input.acts, bins, total) : null;
    if (c) curves.input = c;
    const app = uses("app") ? appCurve(input.acts, bins) : null;
    if (app) curves.app = app;
    const click = uses("click") ? clickCurve(input.acts, bins) : null;
    if (click) curves.click = click;
    if (uses("app") && !app) notes.push('No app switches were recorded (turn on "Active window" in the recorder to use them).');
  } else if (uses("click") || uses("app")) notes.push("No recorded clicks or app switches (this isn't a WipeClip recording), so they aren't used.");
  if (uses("speech")) {
    const segments = input.speech ?? (input.levels ? speechFromLevels(input.levels) : []);
    const c = speechCurve(segments, bins);
    if (c) curves.speech = c;
    if (!input.speech && input.levels) notes.push("Speech was estimated from the sound levels; a transcript (Transcript panel) makes it more precise.");
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
    score[b] = n >= rules.minAgree ? sum * 1.6 : sum * 0.4;
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
    const confidence: Highlight["confidence"] = marker || agreeing >= 3 ? "high" : agreeing >= Math.max(2, rules.minAgree) ? "medium" : "low";
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
  keys: { timelineKey: string; inputsKey: string; lay?: Layout },
  ids: () => string,
  now = new Date()
): HighlightSet {
  const { lay, ...setKeys } = keys;
  // Kept and edited highlights survive a new search, moved to where their
  // footage is now (or marked out of date) when the timeline changed.
  const placed = prev && lay ? placeHighlights(prev, lay, keys.timelineKey) : prev;
  const keep = placed && placed.timelineKey === keys.timelineKey ? placed.items.filter((h) => h.status === "kept" || h.edited) : [];
  const fresh = result.items
    .filter((h) => !keep.some((k) => !k.outdated && Math.min(k.end, h.end) - Math.max(k.start, h.start) > 0.5 * (h.end - h.start)))
    .map((h) => {
      const anchor = lay ? anchorFor(lay, h.start, h.end) : null;
      return { ...h, id: ids(), status: "pending" as const, ...(anchor ? { anchor } : {}) };
    });
  const stats = prev?.stats ?? { suggested: 0, kept: 0, rejected: 0, edited: 0, exported: 0 };
  return {
    version: 1,
    createdAt: now.toISOString(),
    ...setKeys,
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

/** Changes a highlight's range (clamped to the timeline, at least 0.5 s).
 * With `lay` its anchor is updated too, so an out-of-date highlight becomes
 * usable again. */
export function editHighlight(set: HighlightSet, id: string, start: number, end: number, total: number, lay?: Layout): HighlightSet {
  const a = Math.max(0, Math.min(start, total - 0.5));
  const b = Math.min(total, Math.max(end, a + 0.5));
  const h = set.items.find((x) => x.id === id);
  if (!h || (h.start === a && h.end === b && !h.outdated)) return set;
  const stats = h.edited ? set.stats : { ...set.stats, edited: set.stats.edited + 1 };
  const anchor = lay ? anchorFor(lay, a, b) : null;
  return {
    ...set,
    stats,
    items: set.items.map((x) => {
      if (x.id !== id) return x;
      const { anchor: _anchor, outdated: _outdated, ...rest } = x;
      void _anchor;
      void _outdated;
      return { ...rest, start: a, end: b, edited: true, ...(anchor ? { anchor } : {}) };
    }),
  };
}

/** A highlight's own name; empty goes back to the suggested one. */
export function renameHighlight(set: HighlightSet, id: string, title: string): HighlightSet {
  const t = title.replace(/\s+/g, " ").trim().slice(0, 80);
  return { ...set, items: set.items.map((x) => (x.id === id ? { ...x, title: t || undefined } : x)) };
}

/** The range in the recording's own time when one clip plays all of it
 * forward at a steady speed (no freeze, reverse or speed curve); null
 * otherwise. */
export function anchorFor(lay: Layout, start: number, end: number): Highlight["anchor"] | null {
  const c = lay.clips.find((lc) => start >= lc.start - 1e-6 && end <= lc.start + lc.duration + 1e-6);
  if (!c || c.clip.freeze !== null || c.clip.reverse || c.clip.ramp?.length) return null;
  const speed = c.clip.speed ?? 1;
  const s = c.clip.start + (start - c.start) * speed;
  const e = c.clip.start + (end - c.start) * speed;
  if (!(e > s)) return null;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { sourceId: c.clip.sourceId, start: r(s), end: r(e) };
}

/** The set moved onto timeline `lay` (whose key is `key`): a highlight whose
 * footage still plays in one clip, forward, gets that clip's times; the
 * others are marked out of date - never moved to a guessed place. The same
 * set when it already belongs to this timeline. */
export function placeHighlights(set: HighlightSet, lay: Layout, key: string): HighlightSet {
  if (set.timelineKey === key) return set;
  const items = set.items.map((h): Highlight => {
    const a = h.anchor;
    if (a) {
      for (const lc of lay.clips) {
        if (lc.clip.sourceId !== a.sourceId || lc.clip.freeze !== null || lc.clip.reverse) continue;
        const s = timelineTimeOf(lc, a.start);
        const e = timelineTimeOf(lc, a.end);
        if (s !== null && e !== null && e > s) {
          const { outdated: _outdated, ...rest } = h;
          void _outdated;
          const r = (v: number) => Math.round(v * 100) / 100;
          return { ...rest, start: r(s), end: r(e), peak: r(Math.min(e, Math.max(s, s + (h.peak - h.start)))) };
        }
      }
    }
    return { ...h, outdated: true };
  });
  return { ...set, timelineKey: key, items };
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
