// Run with: npm run desktop:test:js
// The draft assistant (src/lib/editor/draft.ts): building, conflicts,
// review, applying through the existing edit functions, undo, reopen.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cameraPayload } from "../../src/lib/editor/focusExport.ts";
import { zoomSpans } from "../../src/lib/editor/camera.ts";
import { INSIDE_SHARE, applyDraft, buildDraft, draftSkips, isStale, setDraftStatus, timelineKey, willApply } from "../../src/lib/editor/draft.ts";
import { FOCUS_PRESETS, analyzeFocus } from "../../src/lib/editor/focus.ts";
import { historyReducer, type HistoryState } from "../../src/lib/editor/history.ts";
import { layout } from "../../src/lib/editor/timeline.ts";
import {
  DEFAULT_CANVAS,
  DRAFT_VERSION,
  migrateProject,
  newClip,
  validDraft,
  type AudioClip,
  type CameraZoom,
  type Chapter,
  type EditSuggestion,
  type MediaSource,
  type Overlay,
  type Project,
} from "../../src/lib/editor/types.ts";

let n = 0;
const ids = () => `d${++n}`;

const zoom = (over: Partial<CameraZoom>): CameraZoom => ({
  id: `z${++n}`,
  sourceId: "s",
  start: 2,
  end: 5,
  zoom: 2,
  x: 0.3,
  y: 0.3,
  easeIn: 0.5,
  easeOut: 0.5,
  ease: "smooth",
  enabled: true,
  auto: true,
  reason: "Click",
  ...over,
});
const sg = (start: number, end: number, over: Partial<EditSuggestion> = {}): EditSuggestion => ({
  id: `g${++n}`,
  kind: "silence",
  start,
  end,
  title: `${(end - start).toFixed(1)} s pause in speech`,
  detail: "",
  action: "cut",
  status: "pending",
  confidence: "high",
  ...over,
});
const chapter = (t: number, title = "Part"): Chapter => ({ id: `c${++n}`, t, title, auto: true });

const textLayer = (start: number, end: number, caption = false): Overlay =>
  ({
    id: `t${++n}`,
    kind: "text",
    start,
    end,
    x: 0.5,
    y: 0.9,
    width: 0.4,
    rotation: 0,
    opacity: 1,
    animIn: "none",
    animOut: "none",
    hidden: false,
    locked: false,
    ...(caption ? { caption: true } : {}),
    text: { content: caption ? "Hello there" : "Title" },
  }) as unknown as Overlay;
const sticker = (start: number, end: number): Overlay =>
  ({ id: `st${++n}`, kind: "sticker", start, end, x: 0.2, y: 0.2, width: 0.1, rotation: 0, opacity: 1, animIn: "none", animOut: "none", hidden: false, locked: false, emoji: "⭐" }) as unknown as Overlay;
const audio = (over: Partial<AudioClip>): AudioClip => ({ id: `a${++n}`, sourceId: "mic", label: "Microphone", start: 0, offset: 0, duration: 40, volume: 1, fadeIn: 0, fadeOut: 0, muted: false, ...over });

/** A 40 s recording with a microphone track, a title, a caption, a sticker
 * and a second clip after a transition at 30 s. */
function base(): Project {
  return {
    clips: [newClip("c1", "s", 0, 30), { ...newClip("c2", "s", 30, 40) }],
    overlays: [textLayer(0, 4), textLayer(12, 16, true), sticker(20, 26)],
    audio: [audio({})],
    effects: [],
    canvas: DEFAULT_CANVAS,
    zooms: [zoom({ id: "mine", auto: false, start: 33, end: 36 })],
  };
}

function draftFor(p: Project, extra: { zooms?: CameraZoom[]; suggestions?: EditSuggestion[]; chapters?: Chapter[]; clicks?: number } = {}) {
  const lay = layout(p, 30);
  return buildDraft(
    {
      lay,
      project: p,
      zooms: extra.zooms ?? [],
      suggestions: extra.suggestions ?? [],
      chapters: extra.chapters ?? [],
      clicks: extra.clicks ?? 0,
      inputsKey: "k",
      notes: [],
    },
    ids,
    new Date("2026-10-29T00:00:00Z")
  );
}

test("overlapping cut suggestions become one cut with the lower confidence", () => {
  const d = draftFor(base(), { suggestions: [sg(6, 9), sg(8.5, 11, { confidence: "low" }), sg(20, 22)] });
  const cuts = d.items.filter((i) => i.kind === "cut");
  assert.deepEqual(
    cuts.map((c) => [c.start, c.end, c.confidence]),
    [
      [6, 11, "low"],
      [20, 22, "high"],
    ]
  );
  assert.match(cuts[0].title, /2 overlapping suggestions/);
  assert.equal(d.version, DRAFT_VERSION);
});

test("conflicts: a zoom mostly inside a cut is flagged, the user's zoom wins, trimmed-away zooms aren't proposed", () => {
  const p = base();
  const inside = zoom({ start: 6.5, end: 9.5 }); // 3 s, all inside 6..10
  const edge = zoom({ start: 9, end: 13 }); // 1 of 4 s inside: kept
  const onMine = zoom({ start: 34, end: 35 }); // overlaps the user's zoom
  const gone = zoom({ start: 41, end: 43 }); // beyond the clips
  const d = draftFor(p, { zooms: [inside, edge, onMine, gone], suggestions: [sg(6, 10)], chapters: [chapter(0), chapter(8), chapter(25)] });
  const zi = d.items.filter((i) => i.kind === "zoom");
  assert.equal(zi.length, 2, "user's zoom wins; off-timeline zoom left out");
  const cutId = d.items.find((i) => i.kind === "cut")!.id;
  assert.equal(zi.find((i) => i.zoom!.start === 6.5)!.insideCut, cutId);
  assert.equal(zi.find((i) => i.zoom!.start === 9)!.insideCut, undefined);
  const ch = d.items.filter((i) => i.kind === "chapter");
  assert.equal(ch.length, 2, "the opening chapter is implied");
  assert.equal(ch.find((c) => c.start === 8)!.insideCut, cutId);
  assert.equal(INSIDE_SHARE, 0.5);
});

test("click highlights are proposed only when there are clicks and they're off", () => {
  assert.equal(draftFor(base(), { clicks: 4 }).items.filter((i) => i.kind === "highlights").length, 1);
  assert.equal(draftFor(base(), { clicks: 0 }).items.filter((i) => i.kind === "highlights").length, 0);
  const on = { ...base(), pointer: { cursor: false, cursorSize: 0.04, cursorColor: "#fff", smoothing: 0.5, clicks: true, leftColor: "#0ff", rightColor: "#f90", ringSize: 0.05, ringDuration: 0.5, intensity: 0.8 } };
  assert.equal(draftFor(on, { clicks: 4 }).items.filter((i) => i.kind === "highlights").length, 0);
});

test("accept/reject all, by kind, one by one; items inside an accepted cut won't apply", () => {
  let d = draftFor(base(), { zooms: [zoom({ start: 6.5, end: 9.5 }), zoom({ start: 14, end: 17 })], suggestions: [sg(6, 10)], chapters: [chapter(8)] });
  d = setDraftStatus(d, "accepted", "all");
  const zin = d.items.find((i) => i.kind === "zoom" && i.insideCut)!;
  assert.equal(willApply(d, zin), false);
  d = setDraftStatus(d, "rejected", "cut");
  assert.equal(willApply(d, d.items.find((i) => i.id === zin.id)!), true, "cut rejected: the zoom applies again");
  d = setDraftStatus(d, "rejected", [zin.id]);
  assert.equal(d.items.find((i) => i.id === zin.id)!.status, "rejected");
  d = setDraftStatus(d, "rejected", "all");
  assert.ok(d.items.every((i) => i.status === "rejected"));
});

test("applying: cuts ripple through text, captions, stickers, audio and chapters; zooms stay on their moment; one undo step", () => {
  const p0 = base();
  const keepZoom = zoom({ start: 14, end: 17, reason: "Click" });
  const droppedZoom = zoom({ start: 6.5, end: 9.5 });
  let d = draftFor(p0, {
    zooms: [keepZoom, droppedZoom],
    suggestions: [sg(6, 10), sg(18, 19, { action: "review", kind: "loud", title: "Sudden loud sound" })],
    chapters: [chapter(8, "Inside"), chapter(25, "Later")],
    clicks: 3,
  });
  d = setDraftStatus(d, "accepted", "all");
  const p = { ...p0, draft: d };
  const res = applyDraft(p, 30);
  assert.ok(!("error" in res), "error" in res ? res.error : "");
  if ("error" in res) return;
  const q = res.project;
  assert.deepEqual(res.applied, { zoom: 1, highlights: 1, cut: 1, chapter: 1, review: 1, annotation: 0, privacy: 0 });
  assert.deepEqual(res.skipped, []);
  const lay0 = layout(p0, 30);
  const lay1 = layout(q, 30);
  assert.ok(Math.abs(lay1.total - (lay0.total - 4)) < 1e-6, "4 s removed");
  // Overlays after the cut moved up 4 s.
  assert.deepEqual(q.overlays.map((o) => [o.start, o.end]), [
    [0, 4],
    [8, 12],
    [16, 22],
  ]);
  // The microphone track is split around the cut and keeps playing the right moment.
  const mic = q.audio.filter((a) => a.sourceId === "mic").sort((a, b) => a.start - b.start);
  assert.equal(mic.length, 2);
  assert.ok(Math.abs(mic[1].start - 6) < 1e-6 && Math.abs(mic[1].offset - 10) < 1e-6, `${mic[1].start} ${mic[1].offset}`);
  // Zooms: the kept one is in source time; on the timeline it shows 4 s earlier.
  const zs = q.zooms!.filter((z) => z.id === keepZoom.id);
  assert.equal(zs.length, 1);
  assert.ok(zs[0].auto && zs[0].enabled);
  assert.ok(!q.zooms!.some((z) => z.id === droppedZoom.id), "the zoom inside the cut isn't applied");
  assert.ok(q.zooms!.some((z) => z.id === "mine"), "the user's zoom is kept");
  const span = zoomSpans(lay1.clips, zs[0])[0];
  assert.ok(Math.abs(span.start - 10) < 1e-6 && Math.abs(span.end - 13) < 1e-6, `${span.start}..${span.end}`);
  assert.equal(q.pointer?.clicks, true);
  // Chapter inside the cut left out, the later one shifted by ripple; review item shifted too.
  assert.deepEqual(q.chapters!.map((c) => [c.title, c.t]), [["Later", 21]]);
  assert.deepEqual(q.suggestions!.map((s) => [s.title, s.start]), [["Sudden loud sound", 14]]);
  assert.ok(q.draft!.appliedAt);
  // Export rows come from the applied project like any other zoom.
  const src = { id: "s", kind: "original", url: "", duration: 40, width: 1920, height: 1080, fps: 30, hasAudio: true } as unknown as MediaSource;
  const rows = cameraPayload(q, lay1, { s: src }, { width: 1920, height: 1080 });
  const withRows = rows.findIndex((r) => r && r.length > 1);
  assert.ok(withRows >= 0 && lay1.clips[withRows].clip.start <= 14 && lay1.clips[withRows].clip.end >= 17, "the clip piece after the cut carries the zoom's camera rows");

  // Undo restores everything at once; redo re-applies.
  let h: HistoryState = { past: [], present: p, future: [], gestureBase: null };
  h = historyReducer(h, { type: "apply", fn: () => q, record: true });
  h = historyReducer(h, { type: "undo" });
  assert.equal(h.present, p);
  h = historyReducer(h, { type: "redo" });
  assert.equal(h.present, q);
  // A second apply is refused.
  const again = applyDraft(q, 30);
  assert.ok("error" in again);
});

test("a cut that touches a transition is skipped with a reason; the rest applies", () => {
  const p0 = base();
  const withFade: Project = { ...p0, clips: [{ ...p0.clips[0], transition: { type: "fade", duration: 1 } }, p0.clips[1]] };
  let d = draftFor(withFade, { suggestions: [sg(29, 31), sg(6, 10)] });
  d = setDraftStatus(d, "accepted", "all");
  const res = applyDraft({ ...withFade, draft: d }, 30);
  assert.ok(!("error" in res));
  if ("error" in res) return;
  assert.equal(res.applied.cut, 1);
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0], /transition/);
});

test("stale drafts: cuts and chapters refused after the timeline changed, zooms still apply", () => {
  const p0 = base();
  let d = draftFor(p0, { zooms: [zoom({ start: 14, end: 17 })], suggestions: [sg(6, 10)] });
  d = setDraftStatus(d, "accepted", "all");
  const trimmed: Project = { ...p0, clips: [{ ...p0.clips[0], end: 28 }, p0.clips[1]], draft: d };
  assert.ok(isStale(d, layout(trimmed, 30)));
  const refused = applyDraft(trimmed, 30);
  assert.ok("error" in refused && /timeline changed/.test(refused.error));
  assert.deepEqual(draftSkips(d, layout(trimmed, 30)), [], "no preview skips for a stale draft");
  const zoomsOnly = applyDraft({ ...trimmed, draft: setDraftStatus(d, "rejected", "cut") }, 30);
  assert.ok(!("error" in zoomsOnly));
  assert.equal(timelineKey(layout(p0, 30)), d.timelineKey);
});

test("nothing accepted, no draft: clear errors", () => {
  const p0 = base();
  assert.ok("error" in applyDraft(p0, 30));
  assert.ok("error" in applyDraft({ ...p0, draft: draftFor(p0, { suggestions: [sg(6, 10)] }) }, 30));
});

test("preview skips: the draft's cuts that aren't rejected, merged", () => {
  const p0 = base();
  let d = draftFor(p0, { suggestions: [sg(6, 10), sg(20, 22), sg(24, 26)] });
  d = setDraftStatus(d, "rejected", [d.items.find((i) => i.start === 20)!.id]);
  assert.deepEqual(draftSkips(d, layout(p0, 30)), [
    { start: 6, end: 10 },
    { start: 24, end: 26 },
  ]);
});

test("saved drafts survive reopening; invalid or newer ones are dropped safely", () => {
  const p0 = base();
  const d = draftFor(p0, { zooms: [zoom({ start: 14, end: 17 })], suggestions: [sg(6, 10)], chapters: [chapter(25)], clicks: 2 });
  const reopened = migrateProject(JSON.parse(JSON.stringify({ ...p0, draft: d })));
  assert.deepEqual(reopened.draft, d);
  assert.ok(validDraft(d));
  for (const bad of [{ ...d, version: 2 }, { ...d, items: [{ ...d.items[0], start: "x" }] }, { ...d, items: [{ ...d.items[0], kind: "magic" }] }, { ...d, items: "nope" }, null, 7]) {
    assert.equal(migrateProject({ ...p0, draft: bad }).draft, undefined);
  }
  const zoomItem = d.items.find((i) => i.kind === "zoom")!;
  assert.equal(validDraft({ ...d, items: [{ ...zoomItem, zoom: undefined }] }), false, "a zoom item without its zoom");
});

test("a cancelled zoom analysis throws AbortError and produces nothing", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(
    analyzeFocus({ events: [{ type: "button", t: 1000, button: "left", down: true, x: 0.5, y: 0.5 }], duration: 10, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.balanced, ids, { signal: ctrl.signal }),
    (e: Error) => e.name === "AbortError"
  );
});
