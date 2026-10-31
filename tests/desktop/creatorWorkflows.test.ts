// Run with: npm run desktop:test:js
// Creator workflows for highlights (src/lib/editor/highlights.ts WORKFLOWS),
// keeping highlights on their footage after timeline edits (anchors), and
// rename. Signals are synthetic but shaped like real recordings.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AudioLevels } from "../../src/lib/editor/audioAnalysis.ts";
import {
  WORKFLOWS,
  anchorFor,
  buildHighlightSet,
  editHighlight,
  findHighlights,
  placeHighlights,
  renameHighlight,
  speechFromWords,
  workflowSettings,
  type HighlightWorkflow,
  type PictureSample,
} from "../../src/lib/editor/highlights.ts";
import type { Act } from "../../src/lib/editor/insights.ts";
import { rippleCut } from "../../src/lib/editor/ripple.ts";
import { layout } from "../../src/lib/editor/timeline.ts";
import { timelineKey } from "../../src/lib/editor/draft.ts";
import { DEFAULT_CANVAS, newClip, validHighlights, type HighlightSet, type Project } from "../../src/lib/editor/types.ts";

const SEC = 0.02;
function levels(duration: number, db: (t: number) => number): AudioLevels {
  const n = Math.round(duration / SEC);
  const frameDb = new Float32Array(n);
  for (let i = 0; i < n; i++) frameDb[i] = db(i * SEC);
  return { frameDb, peaks: new Float32Array(n), clipMask: new Uint8Array(n), sec: SEC, duration };
}
const picture = (duration: number, motion: (t: number) => number): PictureSample[] =>
  Array.from({ length: Math.floor(duration / 0.25) }, (_, i) => ({ t: i * 0.25, motion: motion(i * 0.25), scene: 0 }));

/** A settled click: the pointer rests at (x, y) for 0.5 s first. */
const settledClick = (t: number, x = 0.4, y = 0.4): Act[] => [
  ...Array.from({ length: 5 }, (_, i) => ({ t: t - 0.5 + i * 0.1, kind: "move" as const, x, y })),
  { t, kind: "click", x, y },
];
/** A hurried click: the pointer flies in during the last 0.3 s. */
const hurriedClick = (t: number): Act[] => [
  ...Array.from({ length: 6 }, (_, i) => ({ t: t - 0.3 + i * 0.05, kind: "move" as const, x: 0.1 + i * 0.1, y: 0.5 })),
  { t, kind: "click", x: 0.6, y: 0.5 },
];
const windowSwitch = (t: number, app: string): Act => ({ t, kind: "window", x: NaN, y: NaN, label: app });

/** Steady narration: phrases of 2 s, 0.4 s breaths (not a pause), with
 * real pauses of 2.5 s before the points at `points`. */
function narration(total: number, points: number[]) {
  const words: { start: number; end: number; text: string }[] = [];
  for (let t = 0.5; t < total; ) {
    const point = points.find((p) => p > t - 0.01 && p < t + 2.9);
    if (point !== undefined && point - t > 0.01) {
      t = point;
      continue;
    }
    for (let k = 0; k < 6 && t < total; k++, t += 0.33) words.push({ start: t, end: t + 0.28, text: "word" });
    t += 0.4;
    if (points.some((p) => Math.abs(p - (t + 2.5)) < 0.01)) t += 2.5;
  }
  return words;
}

const run = (w: HighlightWorkflow, input: Parameters<typeof findHighlights>[0], sensitivity = 0.5) => findHighlights(input, workflowSettings(w, sensitivity));
const signals = (r: ReturnType<typeof findHighlights>) => r.items.map((h) => h.reasons.map((x) => x.signal).sort().join("+"));

test("each workflow states its rules: weights, agreement, clip length", () => {
  for (const [w, r] of Object.entries(WORKFLOWS)) {
    const total = Object.values(r.weights).reduce((a, b) => a + (b ?? 0), 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${w} weights sum to 1`);
    assert.ok(r.summary.length > 20 && r.preRoll >= 0 && r.postRoll > 0 && r.maxCount > 0, w);
  }
  assert.deepEqual(workflowSettings("social").workflow, "social");
  assert.ok(WORKFLOWS.social.vertical && !WORKFLOWS.tutorial.vertical);
});

test("gameplay: sound, movement and input together; a busy game alone isn't a highlight everywhere", () => {
  const total = 600; // 10 minutes
  // Loud game all the way through with a few real moments.
  const moments = [120, 300, 480];
  const db = (t: number) => (moments.some((m) => t >= m && t < m + 1.5) ? -3 : -18 + 2 * Math.sin(t * 7));
  const pic = picture(total, (t) => (moments.some((m) => t >= m - 0.5 && t < m + 2) ? 12 : 4 + Math.sin(t)));
  const acts: Act[] = moments.flatMap((m) => Array.from({ length: 8 }, (_, i) => ({ t: m + i * 0.2, kind: "key" as const, x: NaN, y: NaN })));
  const r = run("gameplay", { total, levels: levels(total, db), picture: pic, acts });
  assert.equal(r.items.length, 3, JSON.stringify(r.items.map((h) => h.peak)));
  for (const h of r.items) {
    assert.ok(moments.some((m) => Math.abs(h.peak - m) < 3), String(h.peak));
    // Two or three signals agree (three: high).
    assert.ok(h.confidence !== "low" && h.reasons.length >= 2, JSON.stringify(h.reasons));
  }
  // Clicks without settling (gameplay doesn't weigh deliberate clicks).
  assert.ok(!signals(r).some((s) => s.includes("click")));
});

test("software tutorial: new explanation + app switch + deliberate click mark each step; hurried clicks don't", () => {
  const total = 300;
  const steps = [40, 120, 210];
  const words = narration(total, steps);
  const acts: Act[] = [
    ...steps.flatMap((s, i) => [windowSwitch(s + 0.5, ["Settings", "Terminal", "Browser"][i]), ...settledClick(s + 3)]),
    ...[70, 90, 160].flatMap(hurriedClick),
  ];
  const r = run("tutorial", { total, levels: levels(total, () => -24), picture: null, acts, speech: speechFromWords(words) });
  assert.equal(r.items.length, 3, JSON.stringify(r.items.map((h) => [h.peak, h.reasons.map((x) => x.text)])));
  for (const h of r.items) {
    const step = steps.find((s) => Math.abs(h.peak - s) < 4);
    assert.ok(step !== undefined, String(h.peak));
    const kinds = h.reasons.map((x) => x.signal);
    assert.ok(kinds.includes("speech") && kinds.includes("app"), kinds.join());
    // A step: starts just before, runs on through the explanation.
    assert.ok(h.start <= step! && h.end - h.start >= 10, `${h.start}-${h.end}`);
  }
  assert.ok(r.items.some((h) => h.reasons.some((x) => x.text === "Switches to Terminal")));
});

test("product demo: deliberate clicks with explanation rank first", () => {
  const total = 180;
  const words = narration(total, [30, 100]);
  const acts: Act[] = [...settledClick(31), ...settledClick(101), ...settledClick(150), ...[60, 61, 62].flatMap(hurriedClick)];
  const r = run("demo", { total, levels: levels(total, () => -24), picture: null, acts, speech: speechFromWords(words) });
  assert.ok(r.items.length >= 2);
  // The two moments with click + speech come before the click alone.
  const top = r.items.slice(0, 2).map((h) => Math.round(h.peak / 10) * 10).sort((a, b) => a - b);
  assert.deepEqual(top, [30, 100]);
  for (const h of r.items.slice(0, 2)) assert.ok(h.reasons.some((x) => x.signal === "click") && h.reasons.some((x) => x.signal === "speech"));
});

test("talking head: each new point after a pause; without a transcript speech comes from the sound", () => {
  const total = 240;
  const points = [20, 90, 170];
  const fromWords = run("talking-head", { total, levels: null, picture: null, acts: null, speech: speechFromWords(narration(total, points)) });
  assert.deepEqual(
    fromWords.items.map((h) => points.find((p) => Math.abs(h.peak - p) < 3)).sort((a, b) => a! - b!),
    points
  );
  // Same structure, sound levels only (no transcript): still found, with a note.
  const db = (t: number) => (points.some((p) => t >= p - 2.5 && t < p) ? -70 : -24 + 3 * Math.sin(t * 25));
  const fromSound = run("talking-head", { total, levels: levels(total, db), picture: null, acts: null });
  assert.ok(fromSound.notes.some((n) => /estimated from the sound/.test(n)));
  for (const p of points) assert.ok(fromSound.items.some((h) => Math.abs(h.peak - p) < 3), `point at ${p}`);
});

test("sparse, quiet, constant: nothing is invented", () => {
  const total = 3600;
  // An hour of near-silence, no input: nothing for any workflow.
  for (const w of Object.keys(WORKFLOWS) as HighlightWorkflow[]) {
    const r = run(w, { total, levels: levels(total, () => -75), picture: null, acts: [] });
    assert.equal(r.items.length, 0, `${w}: ${r.items.length}`);
  }
  // Music at one steady level all the way: no speech structure, no jumps.
  const music = run("talking-head", { total: 600, levels: levels(600, (t) => -16 + Math.sin(t * 40)), picture: null, acts: null });
  assert.equal(music.items.length, 0);
  // Continuous motion (a game menu animating): movement alone isn't a highlight.
  const motion = run("gameplay", { total: 600, levels: levels(600, () => -20), picture: picture(600, () => 8), acts: null });
  assert.equal(motion.items.length, 0);
});

test("invalid timestamps and events are ignored, not turned into highlights", () => {
  const total = 60;
  const bad: Act[] = [
    { t: Number.NaN, kind: "click", x: 0.5, y: 0.5 },
    { t: -5, kind: "window", x: NaN, y: NaN, label: "X" },
    { t: 9999, kind: "window", x: NaN, y: NaN, label: "Y" },
    { t: 10, kind: "click", x: Number.NaN, y: 0.5 },
  ];
  const speech = [{ start: Number.NaN, end: 5 }, { start: 20, end: 10 }, { start: 30, end: 40 }];
  for (const w of Object.keys(WORKFLOWS) as HighlightWorkflow[]) {
    const r = run(w, { total, levels: levels(total, () => -30), picture: null, acts: bad, speech: speechFromWords(speech) }, 1);
    for (const h of r.items) {
      assert.ok(Number.isFinite(h.start) && Number.isFinite(h.end) && h.start >= 0 && h.end <= total && h.end > h.start, `${w}: ${JSON.stringify(h)}`);
    }
  }
  // A saved set with a broken anchor is dropped on load like any invalid set.
  const set = { version: 1, createdAt: "", timelineKey: "k", inputsKey: "", notes: [], stats: { suggested: 0, kept: 0, rejected: 0, edited: 0, exported: 0 } };
  const item = { id: "h", start: 1, end: 2, peak: 1.5, score: 1, confidence: "high", reasons: [], status: "kept" };
  assert.ok(validHighlights({ ...set, items: [item] }));
  assert.ok(!validHighlights({ ...set, items: [{ ...item, anchor: { sourceId: "s", start: Number.NaN, end: 2 } }] }));
});

// --- after timeline edits ---------------------------------------------------------

function project(): Project {
  return { clips: [newClip("c1", "s", 0, 120)], overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS };
}
let n = 0;
const ids = () => `h${++n}`;

function setOn(p: Project, ranges: [number, number][], status: "kept" | "pending" = "kept"): HighlightSet {
  const lay = layout(p, 30);
  const set = buildHighlightSet(
    undefined,
    { items: ranges.map(([start, end]) => ({ start, end, peak: start + 1, score: 0.8, confidence: "high", reasons: [], title: `At ${start}` })), notes: [] },
    { timelineKey: timelineKey(lay), inputsKey: "", lay },
    ids
  );
  return { ...set, items: set.items.map((h) => ({ ...h, status })) };
}

test("after a cut elsewhere, a highlight follows its footage; one whose footage was cut is out of date", () => {
  const p = project();
  const set = setOn(p, [[10, 15], [50, 58], [90, 95]]);
  assert.deepEqual(set.items[1].anchor, { sourceId: "s", start: 50, end: 58 });
  // Cut 20-30 (before the 2nd) and 52-54 (inside the 2nd).
  let edited = rippleCut(p, layout(p, 30), 52, 54);
  assert.ok(edited.ok);
  edited = rippleCut(edited.project, layout(edited.project, 30), 20, 30);
  assert.ok(edited.ok);
  const lay = layout(edited.project, 30);
  const placed = placeHighlights(set, lay, timelineKey(lay));
  const [a, b, c] = placed.items;
  assert.deepEqual([a.start, a.end, a.outdated], [10, 15, undefined], "before the cuts: unchanged");
  assert.equal(b.outdated, true, "its footage was split by a cut");
  assert.deepEqual([c.start, c.end, c.outdated], [78, 83, undefined], "after both cuts: moved 12 s earlier");
  // Setting the range again makes it usable, with a new anchor.
  // (Timeline 20-42 now plays source 30-52 in one piece.)
  const fixed = editHighlight(placed, b.id, 30, 36, lay.total, lay);
  const b2 = fixed.items.find((h) => h.id === b.id)!;
  assert.equal(b2.outdated, undefined);
  assert.ok(b2.anchor);
  // The set itself is unchanged until something is saved.
  assert.equal(set.items[2].start, 90);
});

test("moving clips: a highlight follows its clip to the new place", () => {
  const p: Project = { ...project(), clips: [newClip("a", "s", 0, 60), newClip("b", "s", 60, 120)] };
  const set = setOn(p, [[70, 75]]);
  const swapped: Project = { ...p, clips: [p.clips[1], p.clips[0]] };
  const lay = layout(swapped, 30);
  const [h] = placeHighlights(set, lay, timelineKey(lay)).items;
  assert.deepEqual([h.start, h.end, h.outdated], [10, 15, undefined]);
});

test("a highlight across two clips has no anchor and is out of date after any change", () => {
  const p: Project = { ...project(), clips: [newClip("a", "s", 0, 60), newClip("b", "s", 60, 120)] };
  assert.equal(anchorFor(layout(p, 30), 55, 65), null);
  const set = setOn(p, [[55, 65]]);
  const trimmed: Project = { ...p, clips: [newClip("a", "s", 1, 60), p.clips[1]] };
  const lay = layout(trimmed, 30);
  assert.equal(placeHighlights(set, lay, timelineKey(lay)).items[0].outdated, true);
});

test("finding again after edits keeps the user's kept highlights, moved", () => {
  const p = project();
  const kept = setOn(p, [[90, 95]]);
  const cut = rippleCut(p, layout(p, 30), 0, 10);
  assert.ok(cut.ok);
  const lay = layout(cut.project, 30);
  const again = buildHighlightSet(kept, { items: [], notes: [] }, { timelineKey: timelineKey(lay), inputsKey: "x", lay }, ids);
  assert.equal(again.items.length, 1, "before Phase 5 a kept highlight was dropped when the timeline had changed");
  assert.deepEqual([again.items[0].start, again.items[0].end, again.items[0].status], [80, 85, "kept"]);
});

test("rename: trimmed, capped, empty goes back to the suggested name", () => {
  const set = setOn(project(), [[10, 15]]);
  const id = set.items[0].id;
  assert.equal(renameHighlight(set, id, "  Boss   fight ").items[0].title, "Boss fight");
  assert.equal(renameHighlight(set, id, "x".repeat(200)).items[0].title?.length, 80);
  assert.equal(renameHighlight(set, id, "   ").items[0].title, undefined);
});

test("an hour-long recording with all signals is analyzed quickly for every workflow", () => {
  const total = 3600;
  const lv = levels(total, (t) => -24 + 3 * Math.sin(t * 25) + (t % 300 < 1 ? 20 : 0));
  const pic = picture(total, (t) => (t % 300 < 2 ? 10 : 1));
  const acts: Act[] = [];
  for (let t = 5; t < total; t += 15) acts.push(...settledClick(t), windowSwitch(t + 5, "App"));
  const speech = speechFromWords(narration(total, Array.from({ length: 50 }, (_, i) => 60 + i * 70)));
  for (const w of Object.keys(WORKFLOWS) as HighlightWorkflow[]) {
    const t0 = performance.now();
    const r = run(w, { total, levels: lv, picture: pic, acts, speech });
    const ms = performance.now() - t0;
    console.log(`[workflows] ${w}: ${r.items.length} highlights in ${ms.toFixed(0)} ms`);
    assert.ok(ms < 2000, `${w}: ${ms} ms`);
    assert.ok(r.items.length <= WORKFLOWS[w].maxCount);
  }
});
