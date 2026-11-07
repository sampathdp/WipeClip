// Run with: npm run desktop:test:js
// Scene understanding (src/lib/editor/sceneAnalysis.ts) on a synthetic
// engine result, and its suggestions through the draft (draft.ts):
// grounded descriptions, scenes and chapters, waiting cuts, annotations
// from clicked labels, privacy masks that need one-by-one approval.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDraft, buildDraft, setDraftStatus, timelineKey } from "../../src/lib/editor/draft.ts";
import { DEFAULT_UNDERSTAND, sourceToCanvas, toTimeline, understand, type AnalysisFrame, type ScreenAnalysis } from "../../src/lib/editor/sceneAnalysis.ts";
import { layout } from "../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, migrateProject, newClip, validDraft, type Overlay, type Project } from "../../src/lib/editor/types.ts";
import type { InteractionEvent } from "../../src/lib/recorder/format.ts";

let n = 0;
const ids = (p = "x") => `${p}${++n}`;

const frame = (t: number, over: Partial<AnalysisFrame> = {}): AnalysisFrame => ({
  t,
  preview: "data:image/jpeg;base64,",
  region: null,
  lines: 5,
  headings: [],
  labels: [],
  terminal: false,
  command: null,
  code: false,
  settings: false,
  form: false,
  error: null,
  success: null,
  host: null,
  dialog: false,
  ...over,
});

/** 120 s: a settings page (0-40), a long wait (40-60), a terminal with an
 * error then success (60-90), a result page (90-120). */
function analysis(): ScreenAnalysis {
  return {
    version: 1,
    level: "quick",
    duration: 120,
    width: 1920,
    height: 1080,
    scanFps: 4,
    segments: [
      { start: 0, end: 38, kind: "active" },
      { start: 38, end: 60, kind: "still" },
      { start: 60, end: 120, kind: "active" },
    ],
    cuts: [60, 90],
    frames: [
      frame(1, { headings: [{ text: "Project Settings", box: [0.05, 0.05, 0.2, 0.05] }], settings: true }),
      frame(20, { headings: [{ text: "Project Settings", box: [0.05, 0.05, 0.2, 0.05] }], settings: true }),
      frame(61, { terminal: true, command: "$ npm run dev", error: "Error: build failed" }),
      frame(75, { terminal: true, command: "$ npm run dev -- --port 4000", success: "compiled successfully" }),
      frame(91, { host: "localhost:4000", headings: [{ text: "Welcome back", box: [0.3, 0.1, 0.3, 0.06] }] }),
    ],
    clicks: [
      { t: 10, x: 0.8, y: 0.9, label: "Save", box: [0.78, 0.88, 0.05, 0.03] },
      { t: 12, x: 0.5, y: 0.5, label: null, box: null },
    ],
    privacy: [{ id: "p1", category: "email", box: [0.1, 0.2, 0.2, 0.03], start: 0.5, end: 37, confidence: 0.85, reason: "An email address", frame: 0 }],
    stats: { scanSeconds: 3, readSeconds: 8, framesRead: 5, clicksRead: 2 },
  };
}

function project(): Project {
  return { clips: [newClip("c1", "scr", 0, 120)], overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS };
}

const events: InteractionEvent[] = [
  { type: "button", t: 10000, button: "left", down: true, x: 0.8, y: 0.9 },
  { type: "button", t: 30000, button: "left", down: true, x: 0.5, y: 0.5 },
  { type: "button", t: 95000, button: "left", down: true, x: 0.5, y: 0.5 },
];

function run(p = project()) {
  const lay = layout(p, 30);
  return { lay, u: understand({ analysis: analysis(), sourceId: "scr", lay, events, cues: [] }, (prefix) => ids(prefix)) };
}

test("events quote only what was read, with evidence and confidence", () => {
  const { u } = run();
  const types = u.events.map((e) => e.type);
  for (const t of ["settings", "command", "error", "success", "navigation", "click", "idle"]) assert.ok(types.includes(t as never), `missing ${t}: ${types}`);
  const click = u.events.find((e) => e.type === "click")!;
  assert.equal(click.description, "Clicked “Save”");
  assert.ok(click.evidence.length > 0);
  // A click on no readable label isn't described as anything.
  assert.equal(u.events.filter((e) => e.type === "click").length, 1);
  const nav = u.events.find((e) => e.type === "navigation" && e.description.includes("localhost"))!;
  assert.match(nav.description, /localhost:4000/);
  for (const e of u.events) {
    assert.ok(e.confidence > 0 && e.confidence <= 1);
    assert.ok(e.evidence.every((x) => x.length > 0));
  }
});

test("scenes: boundaries at real changes, titles from the screen, unknown when unsure", () => {
  const { u } = run();
  assert.ok(u.scenes.length >= 3 && u.scenes.length <= 5, JSON.stringify(u.scenes.map((s) => [s.start, s.title, s.tags])));
  assert.equal(u.scenes[0].title, "Project Settings");
  assert.equal(u.scenes[0].titleFrom, "screen");
  assert.ok(u.scenes[0].tags.includes("configuration"));
  const wait = u.scenes.find((s) => s.tags.includes("idle"));
  assert.ok(wait, "the long wait is its own scene");
  const term = u.scenes.find((s) => s.tags.includes("terminal"))!;
  assert.ok(term.tags.includes("troubleshooting"), "an error then success");
  // Scenes cover the timeline without gaps.
  for (let i = 1; i < u.scenes.length; i++) assert.equal(u.scenes[i].start, u.scenes[i - 1].end);
  // Nothing to go on: unknown.
  const lay = layout(project(), 30);
  const bare = understand({ analysis: { ...analysis(), frames: [], clicks: [], privacy: [], segments: [{ start: 0, end: 120, kind: "active" }] }, sourceId: "scr", lay, events: null, cues: [] }, (p) => ids(p));
  assert.deepEqual(bare.scenes.map((s) => s.tags), [["unknown"]]);
  assert.equal(bare.chapters.length, 1);
});

test("chapters skip waiting and short scenes; titles come from evidence", () => {
  const { u } = run();
  assert.equal(u.chapters[0].t, 0);
  assert.ok(u.chapters.every((c, i) => i === 0 || c.t - u.chapters[i - 1].t >= DEFAULT_UNDERSTAND.minChapter));
  assert.ok(u.chapters.some((c) => c.title === "Welcome back"), JSON.stringify(u.chapters));
  assert.ok(!u.chapters.some((c) => c.title === "Waiting"));
});

test("waiting becomes a cut suggestion, keeping a second each side", () => {
  const { u } = run();
  assert.equal(u.cuts.length, 1);
  assert.equal(u.cuts[0].start, 39);
  assert.equal(u.cuts[0].end, 59);
  assert.equal(u.cuts[0].action, "cut");
  // Not when something is said or done during it.
  const lay = layout(project(), 30);
  const spoken = understand({ analysis: analysis(), sourceId: "scr", lay, events, cues: [{ start: 45, end: 50, text: "now we wait" }] }, (p) => ids(p));
  assert.equal(spoken.cuts.length, 0);
});

test("annotations from a clicked label and a command; masks in video space", () => {
  const { u } = run();
  assert.deepEqual(u.annotations.map((a) => a.text), ["Click “Save”", "Run “npm run dev”", "Run “npm run dev -- --port 4000”"]);
  assert.equal(u.masks.length, 1);
  const m = u.masks[0].mask;
  assert.equal(m.space, "video");
  assert.equal(m.sourceId, "scr");
  assert.deepEqual([m.x, m.y, m.w, m.h], [0.1, 0.2, 0.2, 0.03]);
  assert.ok(m.start <= 0.5 && m.end >= 37);
});

test("trimmed and moved footage: times follow the timeline", () => {
  const p = project();
  p.clips = [newClip("a", "scr", 30, 120)]; // the first 30 s trimmed off
  const { lay, u } = run(p);
  assert.equal(toTimeline(lay, "scr", 10), null);
  assert.equal(toTimeline(lay, "scr", 61), 31);
  assert.ok(!u.events.some((e) => e.description === "Clicked “Save”"), "a trimmed-away click is dropped");
  assert.equal(u.masks[0].mask.start, 0); // from 30 s in the source
  assert.ok(Math.abs(u.masks[0].mask.end - 7.2) < 0.01);
});

test("a source point lands on the canvas through the clip's crop and position", () => {
  const p = project();
  const clip = { ...p.clips[0], crop: { x: 0.5, y: 0, w: 0.5, h: 1 } };
  const at = sourceToCanvas(clip, { width: 1920, height: 1080 }, { width: 1920, height: 1080 }, p.canvas, 0.75, 0.5);
  assert.ok(Math.abs(at.x - 0.5) < 1e-9 && Math.abs(at.y - 0.5) < 1e-9);
});

test("through the draft: privacy needs a deliberate accept; applying adds layers and masks", () => {
  const p = project();
  const { lay, u } = run(p);
  const overlay: Overlay = {
    id: "ann1",
    kind: "text",
    start: u.annotations[0].start,
    end: u.annotations[0].end,
    x: 0.5,
    y: 0.8,
    width: 0.25,
    rotation: 0,
    opacity: 1,
    animIn: "fade",
    animOut: "fade",
    hidden: false,
    locked: false,
    text: { content: u.annotations[0].text } as never,
  };
  const draft = buildDraft(
    {
      lay,
      project: p,
      zooms: [],
      suggestions: u.cuts,
      chapters: u.chapters,
      clicks: 0,
      inputsKey: "k",
      notes: [],
      annotations: [{ overlay, title: "Annotation", detail: "d", confidence: "high" }],
      masks: u.masks.map((m) => ({ mask: m.mask, title: "Hide: Email address", detail: m.reason, confidence: "high" as const })),
    },
    () => ids("di")
  );
  assert.equal(draft.timelineKey, timelineKey(lay));
  assert.ok(validDraft(draft), "survives saving and reopening");
  assert.ok(validDraft(JSON.parse(JSON.stringify(draft))));
  const all = setDraftStatus(draft, "accepted", "all");
  assert.equal(all.items.find((i) => i.kind === "privacy")!.status, "pending", "accept all leaves privacy alone");
  const privacyId = all.items.find((i) => i.kind === "privacy")!.id;
  const chosen = setDraftStatus(all, "accepted", [privacyId]);
  const res = applyDraft({ ...p, draft: chosen }, 30);
  assert.ok(!("error" in res), "error" in res ? res.error : "");
  if ("error" in res) return;
  assert.equal(res.applied.privacy, 1);
  assert.equal(res.applied.annotation, 1);
  assert.equal(res.applied.cut, 1);
  // The waiting cut removed 20 s; layers and masks after it moved along.
  assert.equal(res.project.masks?.length, 1);
  assert.ok(res.project.overlays.some((o) => o.id === "ann1"));
  assert.ok(Math.abs(layout(res.project, 30).total - 100) < 0.05);
  // Reopened as saved.
  assert.equal(migrateProject(JSON.parse(JSON.stringify(res.project))).masks?.length, 1);
});
