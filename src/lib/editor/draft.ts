/** Draft from a recording: the proposals the existing analyses make - focus
 * zooms (focus.ts), click highlights, silence and dead-time cuts and review
 * items (audioAnalysis.ts + insights.ts), chapters (chapters.ts) - gathered
 * into one list, checked against each other, reviewed, then applied to the
 * project as one undo step with the same edit functions the editor uses
 * (zoomEdits.mergeSuggestions, ripple.rippleCut). It is not a second editing
 * engine: nothing here renders or plays, and an applied draft is ordinary
 * project data. Deterministic, no model involved. Pure - see
 * tests/desktop/draft.test.ts.
 *
 * Times: zooms stay in source time (like every zoom); cuts, review items and
 * chapters are in timeline time and are only valid for the timeline they
 * were made for (`timelineKey`).
 */
import { zoomSpans } from "./camera.ts";
import { rippleCut } from "./ripple.ts";
import { layout, type Layout } from "./timeline.ts";
import {
  DEFAULT_POINTER,
  DRAFT_VERSION,
  type CameraZoom,
  type Chapter,
  type Draft,
  type DraftItem,
  type EditSuggestion,
  type Project,
} from "./types.ts";
import { mergeSuggestions } from "./zoomEdits.ts";

/** A zoom or chapter counts as inside a cut when at least this share of it
 * (a chapter: its moment) would be removed. */
export const INSIDE_SHARE = 0.5;

/** The clip arrangement the draft's timeline times refer to. */
export function timelineKey(lay: Layout): string {
  return JSON.stringify([
    lay.fps,
    Math.round(lay.total * 1000),
    lay.clips.map((c) => [c.clip.id, c.clip.sourceId, c.clip.start, c.clip.end, c.clip.speed, c.clip.reverse, c.clip.freeze, c.clip.ramp ?? null, c.transitionOut]),
  ]);
}

export interface DraftInputs {
  lay: Layout;
  project: Project;
  /** Fresh zoom suggestions (focus.ts), source time. */
  zooms: CameraZoom[];
  /** Fresh cut and review suggestions (insights.ts), timeline time. */
  suggestions: EditSuggestion[];
  /** Fresh chapter suggestions (chapters.ts). */
  chapters: Chapter[];
  /** Recorded clicks that could be highlighted; 0 = none. */
  clicks: number;
  inputsKey: string;
  notes: string[];
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const RANK = { low: 0, medium: 1, high: 2 } as const;
const withCut = (id: string | undefined) => (id ? { insideCut: id } : {});

export function buildDraft(input: DraftInputs, ids: () => string, now = new Date()): Draft {
  const { lay, project } = input;
  const items: DraftItem[] = [];

  // Cuts: overlapping suggestions become one cut (the lower confidence wins).
  const cuts = input.suggestions.filter((s) => s.action === "cut" && s.end > s.start).sort((a, b) => a.start - b.start);
  const groups: EditSuggestion[][] = [];
  for (const s of cuts) {
    const g = groups[groups.length - 1];
    if (g && s.start <= Math.max(...g.map((x) => x.end))) g.push(s);
    else groups.push([s]);
  }
  for (const g of groups) {
    const start = g[0].start;
    const end = Math.max(...g.map((x) => x.end));
    const confidence = g.reduce((c, x) => (RANK[x.confidence] < RANK[c] ? x.confidence : c), g[0].confidence);
    const merged: EditSuggestion = g.length === 1 ? g[0] : { ...g[0], end, confidence, title: `${(end - start).toFixed(1)} s cut (${g.length} overlapping suggestions)`, detail: g.map((x) => x.title).join("; ") };
    items.push({ id: ids(), kind: "cut", status: "pending", title: merged.title, detail: merged.detail, confidence, start, end, suggestion: merged });
  }
  const cutItems = items.slice();
  const cutAround = (spans: { start: number; end: number }[]) => {
    const len = spans.reduce((n, s) => n + s.end - s.start, 0);
    if (len <= 0) return undefined;
    return cutItems.find((c) => spans.reduce((n, s) => n + overlap(s.start, s.end, c.start, c.end), 0) >= INSIDE_SHARE * len)?.id;
  };

  for (const s of input.suggestions.filter((x) => x.action !== "cut")) {
    items.push({ id: ids(), kind: "review", status: "pending", title: s.title, detail: s.detail, confidence: s.confidence, start: s.start, end: s.end, suggestion: s });
  }

  // Zooms: the user's own zooms win (as when analyzing in the Focus panel);
  // a zoom that isn't on the timeline (trimmed away) isn't proposed.
  const sources = [...new Set(input.zooms.map((z) => z.sourceId))];
  let kept = project.zooms ?? [];
  for (const sid of sources) kept = mergeSuggestions(kept, sid, input.zooms.filter((z) => z.sourceId === sid));
  const fresh = new Set(input.zooms.map((z) => z.id));
  for (const z of kept.filter((k) => fresh.has(k.id))) {
    const spans = zoomSpans(lay.clips, z);
    if (!spans.length) continue;
    items.push({
      id: ids(),
      kind: "zoom",
      status: "pending",
      title: `Zoom ${z.zoom.toFixed(1)}×${z.reason ? ` on ${z.reason.toLowerCase()}` : ""}`,
      detail: "From the recorded clicks, typing and pointer movement - not from what is on screen.",
      confidence: "medium",
      start: spans[0].start,
      end: spans[spans.length - 1].end,
      zoom: z,
      ...withCut(cutAround(spans)),
    });
  }
  if (input.clicks > 0 && !project.pointer?.clicks) {
    items.push({
      id: ids(),
      kind: "highlights",
      status: "pending",
      title: `Highlight ${input.clicks} click${input.clicks === 1 ? "" : "s"}`,
      detail: "A ring where each recorded click happened.",
      confidence: "high",
      start: 0,
      end: lay.total,
    });
  }
  for (const ch of input.chapters) {
    if (ch.t <= 0.01) continue; // the opening chapter is implied
    items.push({
      id: ids(),
      kind: "chapter",
      status: "pending",
      title: `Chapter: ${ch.title}`,
      detail: "Where something changed (a marker, another app, a long pause) - not an understanding of the content.",
      confidence: "low",
      start: ch.t,
      end: ch.t,
      chapter: ch,
      ...withCut(cutItems.find((c) => ch.t > c.start && ch.t < c.end)?.id),
    });
  }
  items.sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind));
  return { version: DRAFT_VERSION, createdAt: now.toISOString(), timelineKey: timelineKey(lay), inputsKey: input.inputsKey, items, notes: input.notes };
}

/** Accept or reject items (all of them, all of one kind, or by id). */
export function setDraftStatus(d: Draft, status: DraftItem["status"], which: "all" | DraftItem["kind"] | string[]): Draft {
  const hit = (i: DraftItem) => (which === "all" ? true : Array.isArray(which) ? which.includes(i.id) : i.kind === which);
  return { ...d, items: d.items.map((i) => (hit(i) ? { ...i, status } : i)) };
}

/** Whether `item` would be applied: accepted, and not inside a cut that is
 * also accepted (applying that cut removes its moment). */
export function willApply(d: Draft, item: DraftItem): boolean {
  if (item.status !== "accepted") return false;
  if (!item.insideCut) return true;
  return d.items.find((c) => c.id === item.insideCut)?.status !== "accepted";
}

export function isStale(d: Draft, lay: Layout): boolean {
  return d.timelineKey !== timelineKey(lay);
}

export interface ApplyResult {
  project: Project;
  applied: Record<DraftItem["kind"], number>;
  /** Accepted items that couldn't be applied, in words. */
  skipped: string[];
}

/** Applies the accepted items of `project.draft`. One call = one undo step
 * for the editor. Timeline-time items go in first and the cuts last, back
 * to front, so ripple moves the chapters and review items along. */
export function applyDraft(project: Project, fps: number): ApplyResult | { error: string } {
  const d = project.draft;
  if (!d) return { error: "There is no draft to apply." };
  if (d.appliedAt) return { error: "This draft was already applied. Generate a new one, or undo to apply it differently." };
  const lay = layout(project, fps);
  const go = d.items.filter((i) => willApply(d, i));
  if (!go.length) return { error: "Nothing is accepted yet." };
  if (isStale(d, lay) && go.some((i) => i.kind !== "zoom" && i.kind !== "highlights")) {
    return { error: "The timeline changed since this draft was made, so its cuts and chapters no longer line up. Generate the draft again." };
  }
  const applied: ApplyResult["applied"] = { zoom: 0, highlights: 0, cut: 0, chapter: 0, review: 0 };
  const skipped: string[] = [];
  let p: Project = project;

  const zooms = go.filter((i) => i.kind === "zoom" && i.zoom).map((i) => ({ ...i.zoom!, auto: true, enabled: true }));
  for (const sid of [...new Set(zooms.map((z) => z.sourceId))]) {
    p = { ...p, zooms: mergeSuggestions(p.zooms ?? [], sid, zooms.filter((z) => z.sourceId === sid)) };
  }
  applied.zoom = zooms.length;
  if (go.some((i) => i.kind === "highlights")) {
    p = { ...p, pointer: { ...DEFAULT_POINTER, ...p.pointer, clicks: true } };
    applied.highlights = 1;
  }
  const chapters = go.filter((i) => i.kind === "chapter" && i.chapter).map((i) => ({ ...i.chapter!, auto: true }));
  if (chapters.length) {
    const mine = (p.chapters ?? []).filter((c) => !c.auto);
    const added = chapters.filter((c) => !mine.some((m) => Math.abs(m.t - c.t) < 5));
    p = { ...p, chapters: [...mine, ...added].sort((a, b) => a.t - b.t) };
    applied.chapter = added.length;
  }
  const reviews = go.filter((i) => i.kind === "review" && i.suggestion).map((i) => ({ ...i.suggestion!, status: "pending" as const }));
  if (reviews.length) {
    p = { ...p, suggestions: [...(p.suggestions ?? []).filter((s) => s.kind === "retake"), ...reviews] };
    applied.review = reviews.length;
  }
  for (const c of go.filter((i) => i.kind === "cut").sort((a, b) => b.start - a.start)) {
    const res = rippleCut(p, layout(p, fps), c.start, c.end);
    if (res.ok) {
      p = res.project;
      applied.cut++;
    } else skipped.push(`Cut at ${c.start.toFixed(1)} s: ${res.error}`);
  }
  p = { ...p, draft: { ...d, appliedAt: new Date().toISOString() } };
  return { project: p, applied, skipped };
}

/** Timeline ranges "Preview the result" skips for this draft: its cuts that
 * aren't rejected, merged. Empty once applied or stale. */
export function draftSkips(d: Draft | undefined, lay: Layout): { start: number; end: number }[] {
  if (!d || d.appliedAt || isStale(d, lay)) return [];
  const out: { start: number; end: number }[] = [];
  for (const c of d.items.filter((i) => i.kind === "cut" && i.status !== "rejected").sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
    else out.push({ start: c.start, end: c.end });
  }
  return out;
}
