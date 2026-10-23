// Run with: npm run desktop:test:js
// Editing by text (src/lib/editor/wordEdit.ts) and the transcript kept in
// sync by ripple edits (src/lib/editor/ripple.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { rippleCut, rippleInsert } from "../../src/lib/editor/ripple.ts";
import { layout } from "../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, newClip, type Project } from "../../src/lib/editor/types.ts";
import { cutRangesFor, cutWords, fillerIndices, normalizeWord, transcriptCurrent } from "../../src/lib/editor/wordEdit.ts";

// "So um we start here, uh, and then finish." over a 10 s clip.
const WORDS = [
  { start: 0.5, end: 0.8, text: "So" },
  { start: 1.0, end: 1.3, text: "um" },
  { start: 1.5, end: 1.8, text: "we" },
  { start: 1.9, end: 2.3, text: "start" },
  { start: 2.4, end: 2.9, text: "here," },
  { start: 3.4, end: 3.6, text: "uh," },
  { start: 4.0, end: 4.3, text: "and" },
  { start: 4.4, end: 4.7, text: "then" },
  { start: 4.8, end: 5.5, text: "finish." },
];

function project(): Project {
  return {
    clips: [newClip("c1", "s1", 0, 10)],
    overlays: [],
    audio: [],
    effects: [],
    canvas: DEFAULT_CANVAS,
    transcript: { language: "en", words: WORDS.map((w) => ({ ...w })), total: 10 },
  };
}

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.04, `${a} vs ${b}`);

test("filler words are found regardless of case and punctuation", () => {
  assert.deepEqual(fillerIndices(WORDS), [1, 5]);
  assert.equal(normalizeWord("Uh,"), "uh");
  assert.equal(normalizeWord("don't!"), "don't");
});

test("a run of words cuts up to the next word; the last word keeps a short tail", () => {
  assert.deepEqual(cutRangesFor(WORDS, [2, 3], 10), [[1.5, 2.4]]);
  assert.deepEqual(cutRangesFor(WORDS, [1, 5], 10), [[1.0, 1.5], [3.4, 4.0]]);
  const [[a, b]] = cutRangesFor(WORDS, [8], 10);
  assert.equal(a, 4.8);
  close(b, 5.65);
  assert.deepEqual(cutRangesFor(WORDS, [], 10), []);
});

test("cutting the fillers shortens the timeline and keeps every other word in place", () => {
  const res = cutWords(project(), 30, fillerIndices(WORDS));
  assert.ok(res.ok);
  close(res.removed, 0.5 + 0.6);
  const p = res.project;
  const lay = layout(p, 30);
  close(lay.total, 10 - 1.1);
  assert.deepEqual(
    p.transcript!.words.map((w) => w.text),
    ["So", "we", "start", "here,", "and", "then", "finish."]
  );
  // "we" was at 1.5, now right where "um" started; "and" moved up by both cuts.
  close(p.transcript!.words[1].start, 1.0);
  close(p.transcript!.words[4].start, 4.0 - 1.1);
  assert.ok(transcriptCurrent(p.transcript, lay));
  assert.equal(p.clips.length, 3, "two cuts split the clip in three");
});

test("the transcript follows ripple inserts, and other length changes make it stale", () => {
  const p = project();
  const ins = rippleInsert(p, layout(p, 30), 2.35, [newClip("c2", "s2", 0, 2)], 2);
  assert.ok(ins.ok);
  const words = ins.project.transcript!.words;
  assert.equal(words[3].start, 1.9, "before the insert point: unchanged");
  close(words[4].start, 4.4);
  assert.ok(transcriptCurrent(ins.project.transcript, layout(ins.project, 30)));

  const trimmed = { ...p, clips: [{ ...p.clips[0], end: 8 }] };
  assert.ok(!transcriptCurrent(trimmed.transcript, layout(trimmed, 30)));
});

test("a plain ripple cut through a word drops it", () => {
  const p = project();
  const res = rippleCut(p, layout(p, 30), 1.95, 2.25);
  assert.ok(res.ok);
  assert.ok(!res.project.transcript!.words.some((w) => w.text === "start"));
});

test("errors: nothing selected, no transcript", () => {
  assert.equal(cutWords(project(), 30, []).ok, false);
  const { transcript: _t, ...bare } = project();
  void _t;
  assert.equal(cutWords(bare as Project, 30, [1]).ok, false);
});
