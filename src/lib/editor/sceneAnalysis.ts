/** Scene understanding for screen recordings: the engine's screen evidence
 * (backend/app/pipeline/scenes.py - what changed when, what the screen
 * showed where it settled, which button was clicked, possible sensitive
 * text) combined with the recording's input events and the transcript into
 * events, scenes, chapters and suggestions. Pure - see
 * tests/desktop/scenes.test.ts.
 *
 * Every result says what it's based on, with a confidence, and only quotes
 * what was actually on screen or said: a heading that was read, a button
 * label under a click, a command at a prompt. Where the evidence is thin,
 * an event is "screen-change" and a scene "unknown" - never a guess dressed
 * up as understanding. Nothing here changes the project: suggestions go to
 * the draft (draft.ts), where the user accepts or rejects each one.
 */
import { timelineTimeOf } from "./camera.ts";
import type { InteractionEvent } from "../recorder/format.ts";
import { formatTime, videoBox, type Layout } from "./timeline.ts";
import type { Cue } from "./transcript.ts";
import type { BoxLayout } from "./timeline.ts";
import type { Chapter, Clip, EditSuggestion, PrivacyMask } from "./types.ts";

// --- the engine's result (scenes.py analyze) ------------------------------------

export type Box = [number, number, number, number]; // x, y, w, h: fractions of the frame

export interface AnalysisFrame {
  t: number; // source seconds
  preview: string; // small JPEG data URL
  region: Box | null; // the part that was read; null = whole frame
  lines: number;
  headings: { text: string; box: Box }[];
  labels: { text: string; box: Box }[];
  terminal: boolean;
  command: string | null;
  code: boolean;
  settings: boolean;
  form: boolean;
  error: string | null;
  success: string | null;
  host: string | null;
  dialog: boolean;
}

export interface ScreenAnalysis {
  version: number;
  level: "quick" | "thorough";
  duration: number;
  width: number;
  height: number;
  scanFps: number;
  segments: { start: number; end: number; kind: "still" | "active" | "scroll" }[];
  cuts: number[];
  frames: AnalysisFrame[];
  clicks: { t: number; x: number; y: number; label: string | null; box: Box | null }[];
  privacy: PrivacyFinding[];
  stats: { scanSeconds: number; readSeconds: number; framesRead: number; clicksRead: number };
}

export type PrivacyCategory = "email" | "phone" | "card" | "iban" | "key" | "token" | "private-key" | "connection" | "password" | "secret";

export interface PrivacyFinding {
  id: string;
  category: PrivacyCategory;
  box: Box;
  start: number;
  end: number;
  confidence: number;
  reason: string;
  frame: number;
}

export const PRIVACY_LABELS: Record<PrivacyCategory, string> = {
  email: "Email address",
  phone: "Phone number",
  card: "Payment card number",
  iban: "Bank account number",
  key: "API key",
  token: "Access token",
  "private-key": "Private key",
  connection: "Connection string with a password",
  password: "Password field",
  secret: "Secret value",
};

// --- what this module makes --------------------------------------------------------

export type EventType =
  | "app-switch"
  | "navigation"
  | "dialog"
  | "settings"
  | "form"
  | "terminal"
  | "command"
  | "coding"
  | "error"
  | "success"
  | "click"
  | "scroll"
  | "idle"
  | "marker"
  | "screen-change";

export interface DetectedEvent {
  id: string;
  /** Timeline seconds. */
  t: number;
  end?: number;
  type: EventType;
  /** 0..1 */
  confidence: number;
  description: string;
  /** What it's based on, in plain words. */
  evidence: string[];
  /** Index into analysis.frames, for a preview. */
  frame?: number;
  app?: string;
}

export type SceneTag =
  | "introduction"
  | "navigation"
  | "configuration"
  | "coding"
  | "terminal"
  | "error"
  | "troubleshooting"
  | "result"
  | "demonstration"
  | "explanation"
  | "idle"
  | "unknown";

export const SCENE_TAG_LABELS: Record<SceneTag, string> = {
  introduction: "Introduction",
  navigation: "Navigation",
  configuration: "Configuration",
  coding: "Coding",
  terminal: "Terminal",
  error: "Error",
  troubleshooting: "Troubleshooting",
  result: "Result",
  demonstration: "Demonstration",
  explanation: "Explanation",
  idle: "Waiting",
  unknown: "Unclear",
};

export interface Scene {
  id: string;
  start: number;
  end: number;
  title: string;
  /** Where the title comes from: read on screen, an app, a command, speech, or just the kind of scene. */
  titleFrom: "screen" | "app" | "address" | "command" | "speech" | "kind";
  tags: SceneTag[];
  confidence: number;
  events: string[];
  frame?: number;
}

export interface AnnotationSuggestion {
  id: string;
  /** Timeline seconds. */
  start: number;
  end: number;
  text: string;
  /** Where on the source frame it points (fractions), for placing it. */
  at: { x: number; y: number };
  /** The thing it's about (a button's box), source fractions. */
  box: Box | null;
  confidence: number;
  evidence: string;
}

export interface MaskSuggestion {
  id: string;
  mask: PrivacyMask;
  category: PrivacyCategory;
  confidence: number;
  reason: string;
  frame: number;
}

export interface Understanding {
  events: DetectedEvent[];
  scenes: Scene[];
  chapters: Chapter[];
  cuts: EditSuggestion[];
  annotations: AnnotationSuggestion[];
  masks: MaskSuggestion[];
}

export interface UnderstandSettings {
  /** Shortest scene; shorter ones join the one before. */
  minScene: number;
  /** Shortest chapter. */
  minChapter: number;
  /** Shortest still, input-free, silent stretch suggested as a cut. */
  minIdle: number;
  /** At most one annotation this often. */
  annotationGap: number;
}

export const DEFAULT_UNDERSTAND: UnderstandSettings = { minScene: 12, minChapter: 20, minIdle: 6, annotationGap: 8 };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const quote = (s: string) => `“${s.length > 50 ? `${s.slice(0, 49)}…` : s}”`;
const level = (c: number): EditSuggestion["confidence"] => (c >= 0.75 ? "high" : c >= 0.5 ? "medium" : "low");

/** Source seconds to timeline seconds through the first clip of
 * `sourceId` that shows that moment; null if it's trimmed away. */
export function toTimeline(lay: Layout, sourceId: string, s: number): number | null {
  for (const c of lay.clips) {
    if (c.clip.sourceId !== sourceId) continue;
    const t = timelineTimeOf(c, s);
    if (t !== null) return t;
  }
  return null;
}

/** A point of a clip's source frame (fractions) on the canvas (fractions),
 * through its crop, size and position - the same placement as masks.ts,
 * without focus zooms (an annotation stays put). */
export function sourceToCanvas(
  clip: Clip,
  src: { width: number; height: number },
  canvas: { width: number; height: number },
  boxLayout: BoxLayout,
  px: number,
  py: number
): { x: number; y: number } {
  const box = videoBox(clip, src, canvas, boxLayout);
  const u = (px - clip.crop.x) / Math.max(1e-6, clip.crop.w);
  const v = (py - clip.crop.y) / Math.max(1e-6, clip.crop.h);
  const dx = (u - 0.5) * box.w * canvas.width;
  const dy = (v - 0.5) * box.h * canvas.height;
  const a = (clip.transform.rotation * Math.PI) / 180;
  return {
    x: clip.transform.x + (dx * Math.cos(a) - dy * Math.sin(a)) / canvas.width,
    y: clip.transform.y + (dx * Math.sin(a) + dy * Math.cos(a)) / canvas.height,
  };
}

export interface UnderstandInput {
  analysis: ScreenAnalysis;
  sourceId: string;
  lay: Layout;
  /** The recording's input events (recordings only), source milliseconds. */
  events: InteractionEvent[] | null;
  /** Spoken words (captions), timeline seconds. */
  cues: Cue[];
}

export function understand(input: UnderstandInput, ids: (prefix: string) => string, settings: UnderstandSettings = DEFAULT_UNDERSTAND): Understanding {
  const { analysis: a, sourceId, lay } = input;
  const tl = (s: number) => toTimeline(lay, sourceId, s);
  const events: DetectedEvent[] = [];
  const add = (e: Omit<DetectedEvent, "id">) => events.push({ ...e, id: ids("ev") });

  const rec = input.events ?? [];
  const windows = rec.filter((e): e is Extract<InteractionEvent, { type: "window" }> => e.type === "window");
  const typing = rec.filter((e) => e.type === "typing").map((e) => e.t / 1000);
  const inputTimes = rec.filter((e) => e.type === "button" || e.type === "key" || e.type === "scroll" || e.type === "typing").map((e) => e.t / 1000);

  // Windows (when the recorder noted them): strong boundaries.
  let lastApp: string | null = null;
  for (const w of windows) {
    if (!w.app || w.app === lastApp) continue;
    const t = tl(w.t / 1000);
    if (t !== null && lastApp !== null) add({ t, type: "app-switch", confidence: 0.9, description: `Switched to ${w.app}`, evidence: ["The recorder noted the active app"], app: w.app });
    lastApp = w.app;
  }
  for (const e of rec) {
    if (e.type !== "marker") continue;
    const t = tl(e.t / 1000);
    if (t !== null) add({ t, type: "marker", confidence: 1, description: e.label ? `Marker: ${e.label}` : "Marker", evidence: ["A marker you added while recording"] });
  }

  // What the read frames show, against the frame before.
  let prev: AnalysisFrame | null = null;
  let lastHost: string | null = null;
  let lastCommand: string | null = null;
  a.frames.forEach((f, k) => {
    const t = tl(f.t);
    if (t === null) {
      prev = f;
      return;
    }
    const heading = f.headings[0]?.text ?? null;
    const prevHeading = prev?.headings[0]?.text ?? null;
    const before = typeof prev?.t === "number" ? (prev as AnalysisFrame).t : -Infinity;
    const found: Omit<DetectedEvent, "id">[] = [];
    if (f.host && k > 0 && f.host !== lastHost) {
      const why = lastHost ? `The address shown changed from ${lastHost} to ${f.host}` : `An address bar now shows ${f.host}`;
      found.push({ t, type: "navigation", confidence: lastHost ? 0.75 : 0.65, description: `Went to ${f.host}`, evidence: [why], frame: k });
    } else if (k > 0 && heading && heading !== prevHeading && !f.dialog) {
      found.push({ t, type: "navigation", confidence: 0.6, description: `Now showing ${quote(heading)}`, evidence: [`A new heading was read on screen: ${quote(heading)}`], frame: k });
    }
    if (f.dialog) {
      found.push({
        t,
        type: "dialog",
        confidence: heading ? 0.65 : 0.5,
        description: heading ? `A dialog opened: ${quote(heading)}` : "A dialog or panel opened",
        evidence: ["A box in the middle of the screen changed while the rest stayed", ...(heading ? [`Its title reads ${quote(heading)}`] : [])],
        frame: k,
      });
    }
    if (f.settings) found.push({ t, type: "settings", confidence: 0.65, description: heading ? `Settings: ${quote(heading)}` : "Settings are on screen", evidence: ["Settings words were read on screen"], frame: k });
    if (f.form) found.push({ t, type: "form", confidence: 0.55, description: "A form is on screen", evidence: ["Form labels or buttons were read (name, email, sign in…)"], frame: k });
    if (f.terminal) {
      if (f.command && f.command !== lastCommand) {
        found.push({ t, type: "command", confidence: 0.7, description: `Command: ${quote(f.command)}`, evidence: ["A new line at a terminal prompt was read"], frame: k });
        lastCommand = f.command;
      } else found.push({ t, type: "terminal", confidence: 0.6, description: "Terminal on screen", evidence: ["A terminal prompt was read"], frame: k });
    }
    if (f.code) {
      const typed = typing.some((s) => s > before && s <= f.t);
      found.push({
        t,
        type: "coding",
        confidence: typed ? 0.75 : 0.5,
        description: typed ? "Editing code" : "Code on screen",
        evidence: ["Several lines that look like code were read", ...(typed ? ["The recorder noted typing just before"] : [])],
        frame: k,
      });
    }
    if (f.error) found.push({ t, type: "error", confidence: 0.65, description: `Error shown: ${quote(f.error)}`, evidence: ["An error message was read on screen"], frame: k });
    if (f.success) found.push({ t, type: "success", confidence: 0.6, description: `Shown: ${quote(f.success)}`, evidence: ["A success message was read on screen"], frame: k });
    if (!found.length && k > 0) {
      const cut = a.cuts.some((c) => c > before && c <= f.t + 0.5);
      found.push({ t, type: "screen-change", confidence: cut ? 0.5 : 0.35, description: "The screen changed", evidence: [cut ? "Most of the picture changed at once" : "Part of the picture changed"], frame: k });
    }
    for (const e of found) add(e);
    if (f.host) lastHost = f.host;
    prev = f;
  });

  for (const c of a.clicks) {
    const t = tl(c.t);
    if (t === null || !c.label) continue;
    add({ t, type: "click", confidence: 0.8, description: `Clicked ${quote(c.label)}`, evidence: ["A click landed on this label (read on screen)"] });
  }

  // Scrolling and waiting from the scan.
  const cueTimes = input.cues;
  for (const s of a.segments) {
    const t0 = tl(s.start);
    const t1 = tl(s.end) ?? tl(Math.max(s.start, s.end - 0.01));
    if (t0 === null || t1 === null || t1 <= t0) continue;
    if (s.kind === "scroll" && t1 - t0 >= 1) add({ t: t0, end: t1, type: "scroll", confidence: 0.85, description: "Scrolling", evidence: ["The picture moved as a whole"] });
    if (s.kind === "still" && t1 - t0 >= settings.minIdle) {
      const busy = inputTimes.some((x) => x >= s.start && x <= s.end);
      const spoken = cueTimes.some((c) => c.end > t0 && c.start < t1);
      if (!busy && !spoken) {
        add({
          t: t0,
          end: t1,
          type: "idle",
          confidence: rec.length ? 0.8 : 0.6,
          description: `Nothing happens for ${(t1 - t0).toFixed(0)} s`,
          evidence: ["The screen didn't change", ...(rec.length ? ["No clicks, keys or scrolling were recorded"] : []), "Nothing was said (captions)"],
        });
      }
    }
  }
  events.sort((x, y) => x.t - y.t);

  const scenes = groupScenes(events, input, settings, ids);
  return {
    events,
    scenes,
    chapters: chaptersFrom(scenes, settings, ids),
    cuts: cutsFrom(events, ids),
    annotations: annotationsFrom(input, settings, ids),
    masks: masksFrom(input, ids),
  };
}

// --- scenes ---------------------------------------------------------------------

const BOUNDARY: EventType[] = ["app-switch", "navigation", "marker"];

function groupScenes(events: DetectedEvent[], input: UnderstandInput, settings: UnderstandSettings, ids: (p: string) => string): Scene[] {
  const total = input.lay.total;
  if (total <= 0) return [];
  // Boundaries: strong changes, and both ends of long waits.
  const marks = new Set<number>([0]);
  for (const e of events) {
    if (BOUNDARY.includes(e.type) && e.confidence >= 0.6) marks.add(e.t);
    if (e.type === "idle" && e.end !== undefined && e.end - e.t >= 2 * settings.minIdle) {
      marks.add(e.t);
      marks.add(e.end);
    }
  }
  const starts = [...marks].filter((t) => t >= 0 && t < total).sort((x, y) => x - y);
  // Too-short scenes join the one before (the first one joins the next).
  const kept: number[] = [];
  for (const t of starts) {
    if (kept.length && t - kept[kept.length - 1] < settings.minScene) continue;
    kept.push(t);
  }
  if (kept.length > 1 && total - kept[kept.length - 1] < settings.minScene) kept.pop();

  const scenes: Scene[] = [];
  kept.forEach((start, i) => {
    const end = kept[i + 1] ?? total;
    const inside = events.filter((e) => e.t >= start && e.t < end);
    const tags = tagsFor(inside, start, end, i === 0, i === kept.length - 1, input);
    const { title, from, frame } = titleFor(inside, start, end, tags, input);
    const conf = inside.length ? inside.reduce((n, e) => n + e.confidence, 0) / inside.length : 0.2;
    scenes.push({ id: ids("sc"), start, end, title, titleFrom: from, tags, confidence: Math.round(clamp01(conf) * 100) / 100, events: inside.map((e) => e.id), frame });
  });
  return scenes;
}

function tagsFor(inside: DetectedEvent[], start: number, end: number, first: boolean, last: boolean, input: UnderstandInput): SceneTag[] {
  const count = (...types: EventType[]) => inside.filter((e) => types.includes(e.type)).length;
  const idle = inside.filter((e) => e.type === "idle").reduce((n, e) => n + ((e.end ?? e.t) - e.t), 0);
  const spoken = input.cues.filter((c) => c.end > start && c.start < end).reduce((n, c) => n + Math.min(end, c.end) - Math.max(start, c.start), 0);
  const acts = count("click", "scroll", "command", "coding", "form", "settings", "dialog", "navigation");
  const tags: SceneTag[] = [];
  const score: [SceneTag, number][] = [
    ["coding", count("coding") * 2],
    ["terminal", count("command") * 2 + count("terminal")],
    ["configuration", count("settings") * 2 + count("form", "dialog")],
    ["navigation", count("navigation", "app-switch")],
  ];
  const errorAt = inside.find((e) => e.type === "error")?.t;
  const successAt = inside.filter((e) => e.type === "success").map((e) => e.t);
  if (errorAt !== undefined) tags.push(successAt.some((t) => t > errorAt) ? "troubleshooting" : "error");
  for (const [tag, n] of score.sort((x, y) => y[1] - x[1])) if (n >= 2 || (n >= 1 && tags.length === 0)) tags.push(tag);
  if (successAt.length && (last || errorAt !== undefined)) tags.push("result");
  if (idle > 0.6 * (end - start)) return ["idle"];
  if (!tags.length && count("click", "scroll") >= 2) tags.push("demonstration");
  if (spoken > 0.5 * (end - start) && acts <= 1) tags.push(first ? "introduction" : "explanation");
  return tags.length ? [...new Set(tags)] : ["unknown"];
}

function titleFor(inside: DetectedEvent[], start: number, end: number, tags: SceneTag[], input: UnderstandInput): { title: string; from: Scene["titleFrom"]; frame?: number } {
  const frames = input.analysis.frames
    .map((f, k) => ({ f, k, t: toTimeline(input.lay, input.sourceId, f.t) }))
    .filter((x) => x.t !== null && x.t >= start && x.t < end);
  // The heading seen most often (ties: the earliest), read on screen.
  const counts = new Map<string, { n: number; k: number }>();
  for (const { f, k } of frames) {
    const h = f.headings[0]?.text;
    if (!h) continue;
    const c = counts.get(h) ?? { n: 0, k };
    counts.set(h, { n: c.n + 1, k: c.k });
  }
  const best = [...counts.entries()].sort((x, y) => y[1].n - x[1].n || x[1].k - y[1].k)[0];
  const frame = frames[0]?.k;
  if (best) return { title: best[0], from: "screen", frame: best[1].k };
  const app = inside.find((e) => e.type === "app-switch")?.app;
  if (app) return { title: app, from: "app", frame };
  const host = frames.find((x) => x.f.host)?.f.host;
  if (host) return { title: host, from: "address", frame };
  const cmd = frames.find((x) => x.f.command)?.f.command;
  if (cmd) return { title: cmd, from: "command", frame };
  const cue = input.cues.find((c) => c.start >= start - 0.5 && c.start < end);
  if (cue) {
    const words = cue.text.split(/\s+/).slice(0, 6).join(" ");
    return { title: words.length < cue.text.length ? `${words}…` : words, from: "speech", frame };
  }
  return { title: SCENE_TAG_LABELS[tags[0]], from: "kind", frame };
}

// --- suggestions --------------------------------------------------------------------

function chaptersFrom(scenes: Scene[], settings: UnderstandSettings, ids: (p: string) => string): Chapter[] {
  const out: Chapter[] = [];
  for (const s of scenes) {
    if (s.tags.includes("idle")) continue;
    const last = out[out.length - 1];
    if (last && s.start - last.t < settings.minChapter) continue;
    if (last && last.title === s.title) continue;
    out.push({ id: ids("ch"), t: Math.round(s.start * 100) / 100, title: s.title, auto: true });
  }
  return out;
}

function cutsFrom(events: DetectedEvent[], ids: (p: string) => string): EditSuggestion[] {
  return events
    .filter((e) => e.type === "idle" && e.end !== undefined)
    .map((e) => {
      // Keep a second each side, so the cut doesn't feel abrupt.
      const start = e.t + 1;
      const end = e.end! - 1;
      return {
        id: ids("sg"),
        kind: "idle" as const,
        start,
        end,
        title: `Shorten ${(e.end! - e.t).toFixed(0)} s of waiting at ${formatTime(e.t)}`,
        detail: e.evidence.join(". ") + ".",
        action: "cut" as const,
        status: "pending" as const,
        confidence: level(e.confidence),
      };
    })
    .filter((s) => s.end - s.start >= 2);
}

function annotationsFrom(input: UnderstandInput, settings: UnderstandSettings, ids: (p: string) => string): AnnotationSuggestion[] {
  const { analysis: a, lay, sourceId } = input;
  const out: AnnotationSuggestion[] = [];
  const cands: AnnotationSuggestion[] = [];
  for (const c of a.clicks) {
    const t = toTimeline(lay, sourceId, c.t);
    if (t === null || !c.label || c.label.length > 30) continue;
    cands.push({
      id: ids("an"),
      start: Math.max(0, t - 0.6),
      end: t + 2.4,
      text: `Click ${quote(c.label)}`,
      at: { x: c.x, y: c.y },
      box: c.box,
      confidence: 0.75,
      evidence: `The click at ${formatTime(t)} landed on the label ${quote(c.label)}.`,
    });
  }
  for (const f of a.frames) {
    if (!f.terminal || !f.command) continue;
    const t = toTimeline(lay, sourceId, f.t);
    if (t === null) continue;
    cands.push({
      id: ids("an"),
      start: t,
      end: t + 3,
      text: `Run ${quote(f.command.replace(/^\W{0,3}/, ""))}`,
      at: { x: 0.5, y: 0.85 },
      box: null,
      confidence: 0.6,
      evidence: `This command was read at a terminal prompt at ${formatTime(t)}.`,
    });
  }
  // Best first, at most one every few seconds.
  for (const c of cands.sort((x, y) => y.confidence - x.confidence || x.start - y.start)) {
    if (out.some((o) => Math.abs(o.start - c.start) < settings.annotationGap)) continue;
    out.push(c);
  }
  return out.sort((x, y) => x.start - y.start);
}

function masksFrom(input: UnderstandInput, ids: (p: string) => string): MaskSuggestion[] {
  const { analysis: a, lay, sourceId } = input;
  const out: MaskSuggestion[] = [];
  for (const p of a.privacy) {
    // Its time span through every clip showing it: one mask per piece.
    for (const c of lay.clips) {
      if (c.clip.sourceId !== sourceId || c.clip.freeze !== null) continue;
      const s0 = Math.max(p.start, c.clip.start);
      const s1 = Math.min(p.end, c.clip.end);
      if (s1 - s0 < 0.05) continue;
      const t0 = timelineTimeOf(c, s0);
      const t1 = timelineTimeOf(c, s1);
      if (t0 === null || t1 === null) continue;
      const [start, end] = t0 <= t1 ? [t0, t1] : [t1, t0];
      out.push({
        id: ids("pm"),
        category: p.category,
        confidence: p.confidence,
        reason: p.reason,
        frame: p.frame,
        mask: {
          id: ids("mask"),
          start: Math.max(0, start - 0.2),
          end: end + 0.2,
          mode: "blur",
          strength: 70,
          color: "#000000",
          x: p.box[0],
          y: p.box[1],
          w: p.box[2],
          h: p.box[3],
          space: "video",
          sourceId,
          follow: "none",
          enabled: true,
          label: PRIVACY_LABELS[p.category],
        },
      });
    }
  }
  return out;
}
