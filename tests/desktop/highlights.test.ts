// Run with: npm run desktop:test:js
// Highlight suggestions (src/lib/editor/highlights.ts): signals, ranking,
// pre/post roll, markers, keeping the user's choices, saved sets.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AudioLevels } from "../../src/lib/editor/audioAnalysis.ts";
import {
  DEFAULT_HIGHLIGHTS,
  PROFILE_CHUNK,
  buildHighlightSet,
  editHighlight,
  findHighlights,
  highlightProject,
  pictureOnTimeline,
  profileChunks,
  setHighlightStatus,
  type PictureSample,
} from "../../src/lib/editor/highlights.ts";
import type { Act } from "../../src/lib/editor/insights.ts";
import { layout } from "../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, migrateProject, newClip, type AudioClip, type Project } from "../../src/lib/editor/types.ts";

const SEC = 0.02;

/** 20 ms levels from a dB-per-time function. */
function levels(duration: number, db: (t: number) => number): AudioLevels {
  const n = Math.round(duration / SEC);
  const frameDb = new Float32Array(n);
  for (let i = 0; i < n; i++) frameDb[i] = db(i * SEC);
  return { frameDb, peaks: new Float32Array(n), clipMask: new Uint8Array(n), sec: SEC, duration };
}

/** Talk at about -24 dB: 3 s phrases, 1 s pauses, syllable wobble. */
const talk = (t: number) => (t % 4 < 3 ? -24 + 3 * Math.sin(t * 25) : -70);

function picture(duration: number, motion: (t: number) => number, cuts: number[] = []): PictureSample[] {
  const out: PictureSample[] = [];
  for (let t = 0; t < duration; t += 0.25) {
    const cut = cuts.some((c) => Math.abs(c - t) < 0.01);
    out.push({ t, motion: cut ? 19 : motion(t), scene: cut ? 18 : 0 });
  }
  return out;
}

const clicks = (from: number, count: number, every = 0.3): Act[] =>
  Array.from({ length: count }, (_, i) => ({ t: from + i * every, kind: "click" as const, x: 0.5, y: 0.5 }));

test("speech starting after pauses isn't a highlight; a shout alone is a low-confidence one", () => {
  const plain = findHighlights({ total: 120, levels: levels(120, talk), picture: null, acts: null });
  assert.equal(plain.items.length, 0, JSON.stringify(plain.items));
  const shout = findHighlights({ total: 120, levels: levels(120, (t) => (t >= 60 && t < 61 ? -4 : talk(t))), picture: null, acts: null }, { ...DEFAULT_HIGHLIGHTS, sensitivity: 1 });
  assert.equal(shout.items.length, 1);
  const h = shout.items[0];
  assert.ok(Math.abs(h.peak - 60.5) <= 1, String(h.peak));
  assert.equal(h.confidence, "low");
  assert.deepEqual(h.reasons.map((r) => r.signal), ["sound"]);
  assert.match(h.reasons[0].text, /Sound jumps \d+ dB/);
  // At the default sensitivity one signal alone isn't enough.
  assert.equal(findHighlights({ total: 120, levels: levels(120, (t) => (t >= 60 && t < 61 ? -4 : talk(t))), picture: null, acts: null }).items.length, 0);
});

test("agreeing signals rank above a single one and are more confident", () => {
  const db = (t: number) => ((t >= 30 && t < 31) || (t >= 90 && t < 91) ? -4 : talk(t));
  const pic = picture(120, (t) => (t >= 89 && t < 93 ? 3 : 0.02));
  const r = findHighlights({ total: 120, levels: levels(120, db), picture: pic, acts: clicks(89.5, 8) }, { ...DEFAULT_HIGHLIGHTS, sensitivity: 1 });
  assert.equal(r.items.length, 2);
  const [first, second] = r.items;
  assert.ok(Math.abs(first.peak - 90.5) <= 2, String(first.peak));
  assert.equal(first.confidence, "high");
  assert.deepEqual(first.reasons.map((x) => x.signal).sort(), ["input", "picture", "sound"]);
  assert.ok(Math.abs(second.peak - 30.5) <= 1);
  assert.equal(second.confidence, "low");
  assert.ok(first.score > second.score);
});

test("a picture that is busy all the time (a game) only stands out where it's busier still", () => {
  const loudGame = (t: number) => -12 + 2 * Math.sin(t * 7);
  const pic = picture(180, (t) => (t >= 100 && t < 104 ? 9 : 2 + Math.sin(t)));
  const r = findHighlights({ total: 180, levels: levels(180, (t) => (t >= 101 && t < 102 ? 0 : loudGame(t))), picture: pic, acts: null });
  assert.equal(r.items.length, 1, JSON.stringify(r.items.map((h) => h.peak)));
  assert.ok(Math.abs(r.items[0].peak - 101.5) <= 2);
  assert.equal(r.items[0].confidence, "medium");
  // Constant loud sound and steady movement alone: nothing.
  assert.equal(findHighlights({ total: 180, levels: levels(180, loudGame), picture: picture(180, (t) => 2 + Math.sin(t)), acts: null }).items.length, 0);
});

test("markers are always suggested, with their label", () => {
  const acts: Act[] = [{ t: 42, kind: "marker", x: NaN, y: NaN, label: "Boss fight" }, { t: 2, kind: "marker", x: NaN, y: NaN }];
  const r = findHighlights({ total: 120, levels: levels(120, talk), picture: null, acts }, { ...DEFAULT_HIGHLIGHTS, maxCount: 0 });
  assert.equal(r.items.length, 2);
  const boss = r.items.find((h) => h.peak === 42)!;
  assert.equal(boss.confidence, "high");
  assert.equal(boss.title, "Boss fight");
  assert.match(boss.reasons[0].text, /Boss fight/);
  // Pre-roll clamped at the start of the timeline.
  assert.equal(r.items.find((h) => h.peak === 2)!.start, 0);
});

test("pre-roll and post-roll; a clip starts on a nearby scene cut and avoids starting mid-sound", () => {
  const pic = picture(120, (t) => (t >= 60 && t < 63 ? 4 : 0.02), [57]);
  const db = (t: number) => (t >= 60 && t < 61 ? -4 : t >= 61 && t < 64.6 ? -20 : talk(t));
  const s = { ...DEFAULT_HIGHLIGHTS, preRoll: 6, postRoll: 3 };
  const [h] = findHighlights({ total: 120, levels: levels(120, db), picture: pic, acts: null }, s).items;
  assert.ok(h, "found");
  assert.equal(h.start, 57, "starts on the cut");
  assert.ok(h.end >= h.peak + 3 && h.end <= h.peak + 4.01, `end ${h.end} after peak ${h.peak}`);
  // Without the cut: the start is the pre-roll, moved back at most 1 s to a quiet frame.
  const [g] = findHighlights({ total: 120, levels: levels(120, db), picture: picture(120, (t) => (t >= 60 && t < 63 ? 4 : 0.02)), acts: null }, s).items;
  assert.ok(g.start <= g.peak - 6 + 0.02 && g.start >= g.peak - 7.01, `start ${g.start} peak ${g.peak}`);
});

test("max count, sensitivity, spacing", () => {
  const moments = [20, 50, 80, 110, 140, 170];
  const db = (t: number) => (moments.some((m) => t >= m && t < m + 1) ? -4 : talk(t));
  const pic = picture(200, (t) => (moments.some((m) => t >= m - 1 && t < m + 2) ? 3 : 0.02));
  const all = findHighlights({ total: 200, levels: levels(200, db), picture: pic, acts: null }, { ...DEFAULT_HIGHLIGHTS, maxCount: 10 });
  assert.equal(all.items.length, 6);
  const three = findHighlights({ total: 200, levels: levels(200, db), picture: pic, acts: null }, { ...DEFAULT_HIGHLIGHTS, maxCount: 3 });
  assert.equal(three.items.length, 3);
  for (const a of all.items) for (const b of all.items) if (a !== b) assert.ok(Math.abs(a.peak - b.peak) >= 6);
  // Nothing at all: a note instead.
  const none = findHighlights({ total: 60, levels: null, picture: null, acts: null });
  assert.equal(none.items.length, 0);
  assert.ok(none.notes.length >= 2);
});

test("an hour of sound and picture is analyzed quickly", () => {
  const total = 3600;
  const t0 = performance.now();
  const r = findHighlights({ total, levels: levels(total, talk), picture: picture(total, (t) => 0.05 + (Math.floor(t / 300) % 2) * 0.02), acts: clicks(10, 2000, 1.7) });
  const ms = performance.now() - t0;
  console.log(`an hour analyzed in ${Math.round(ms)} ms`);
  assert.ok(ms < 3000, `${ms} ms`);
  assert.ok(r.items.length <= DEFAULT_HIGHLIGHTS.maxCount);
});

test("new sets keep the user's kept and edited highlights; counts; edits; status", () => {
  let n = 0;
  const ids = () => `h${++n}`;
  const keys = { timelineKey: "T", inputsKey: "I" };
  const result = { items: [10, 40, 70].map((p) => ({ start: p - 5, end: p + 3, peak: p, score: 0.5, confidence: "medium" as const, reasons: [] })), notes: [] };
  let set = buildHighlightSet(undefined, result, keys, ids);
  assert.equal(set.items.length, 3);
  assert.equal(set.stats.suggested, 3);
  set = setHighlightStatus(set, set.items[0].id, "kept");
  set = setHighlightStatus(set, set.items[1].id, "rejected");
  set = editHighlight(set, set.items[2].id, 60, 80, 100);
  set = editHighlight(set, set.items[2].id, 61, 80, 100);
  assert.deepEqual(set.stats, { suggested: 3, kept: 1, rejected: 1, edited: 1, exported: 0 });
  assert.deepEqual([set.items[2].start, set.items[2].end, set.items[2].edited], [61, 80, true]);
  // Clamped to the timeline, at least 0.5 s.
  assert.deepEqual(((s) => [s.start, s.end])(editHighlight(set, set.items[2].id, 99.9, 99.9, 100).items[2]), [99.5, 100]);
  // Again: the kept and the edited one stay, the rejected one is replaced by fresh suggestions, no duplicates.
  const again = buildHighlightSet(set, result, keys, ids);
  assert.equal(again.items.filter((h) => h.status === "kept").length, 1);
  assert.equal(again.items.filter((h) => h.edited).length, 1);
  assert.equal(again.items.length, 3, JSON.stringify(again.items.map((h) => [h.start, h.status])));
  assert.equal(again.items.find((h) => h.peak === 40)!.status, "pending");
  assert.equal(again.stats.suggested, 4);
  // A different timeline: nothing survives (its times would be wrong).
  assert.equal(buildHighlightSet(set, result, { ...keys, timelineKey: "other" }, ids).items.every((h) => h.status === "pending" && !h.edited), true);
});

test("saved with the project; invalid sets dropped on load", () => {
  let n = 0;
  const set = buildHighlightSet(undefined, { items: [{ start: 1, end: 5, peak: 3, score: 0.4, confidence: "low", reasons: [{ signal: "sound", text: "x" }] }], notes: [] }, { timelineKey: "T", inputsKey: "I" }, () => `h${++n}`);
  const project = { clips: [], overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS, highlights: set } as Project;
  const back = migrateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(back.highlights, set);
  for (const bad of [{ ...set, version: 2 }, { ...set, items: [{ ...set.items[0], end: 0 }] }, { ...set, stats: undefined }, "x"]) {
    assert.equal(migrateProject({ ...project, highlights: bad }).highlights, undefined);
  }
});

test("picture samples through trims and speed; aligned profile chunks", () => {
  const profiles = new Map([["a.mp4", [{ times: [0, 10, 20, 30], motion: [1, 2, 3, 4], scene: [0, 0, 18, 0] }]]]);
  // Clip shows source 10..30 at 2x speed from timeline 5.
  const clip = { start: 5, duration: 10, path: "a.mp4", toTimeline: (s: number) => (s < 10 || s > 30 ? null : 5 + (s - 10) / 2) };
  assert.deepEqual(pictureOnTimeline([clip, { ...clip, path: null }], profiles), [
    { t: 5, motion: 2, scene: 0 },
    { t: 10, motion: 3, scene: 18 },
  ]);
  assert.deepEqual(profileChunks(70, 130), [
    [PROFILE_CHUNK, 2 * PROFILE_CHUNK],
    [2 * PROFILE_CHUNK, 3 * PROFILE_CHUNK],
  ]);
});

test("a highlight exports from a copy holding only its range, in sync", () => {
  const mic: AudioClip = { id: "m", sourceId: "mic", label: "Mic", start: 0, offset: 0, duration: 60, volume: 1, fadeIn: 0, fadeOut: 0, muted: false };
  const project = {
    clips: [newClip("c1", "s", 0, 30), newClip("c2", "s", 40, 70)],
    overlays: [],
    audio: [mic],
    effects: [],
    canvas: DEFAULT_CANVAS,
    suggestions: [{ id: "x" }],
  } as unknown as Project;
  const before = JSON.stringify(project);
  const r = highlightProject(project, 30, 25, 35);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(JSON.stringify(project), before, "the project itself is unchanged");
  const lay = layout(r.project, 30);
  assert.ok(Math.abs(lay.total - 10) < 0.05, String(lay.total));
  // Source 25..30 of the first clip, then 40..45 of the second.
  assert.deepEqual(r.project.clips.map((c) => [c.start, c.end]), [[25, 30], [40, 45]]);
  // The microphone track: the same moments of its file.
  assert.deepEqual(r.project.audio.map((a) => [a.start, a.offset, a.duration].map((v) => Math.round(v * 100) / 100)), [[0, 25, 10]]);
  assert.deepEqual(r.project.suggestions, []);
  // The whole timeline: unchanged length.
  const all = highlightProject(project, 30, 0, 60);
  assert.ok(all.ok && Math.abs(layout(all.project, 30).total - 60) < 0.05);
});
