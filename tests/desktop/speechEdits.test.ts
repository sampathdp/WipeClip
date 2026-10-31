// Run with: npm run desktop:test:js
// Transcript-based edit suggestions (src/lib/editor/speechEdits.ts) and
// applying them through the review's accept path (acceptedCuts + ripple).
import assert from "node:assert/strict";
import { test } from "node:test";
import { historyReducer, type HistoryState } from "../../src/lib/editor/history.ts";
import { acceptedCuts } from "../../src/lib/editor/insights.ts";
import { rippleCut } from "../../src/lib/editor/ripple.ts";
import { fillersSupported, speechAwarePauses, transcriptSuggestions, uncertainTiming } from "../../src/lib/editor/speechEdits.ts";
import { layout } from "../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, newClip, type AudioClip, type EditSuggestion, type Overlay, type Project, type Transcript, type TranscriptWord } from "../../src/lib/editor/types.ts";
import { transcriptCurrent } from "../../src/lib/editor/wordEdit.ts";

let n = 0;
const ids = () => `sg${++n}`;
const close = (a: number, b: number, eps = 0.04) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

/** Words from "text@start" items, each 0.25 s long. */
function words(spec: string): TranscriptWord[] {
  return spec.split(" ").map((item) => {
    const [text, at] = item.split("@");
    return { text, start: Number(at), end: Number(at) + 0.25 };
  });
}
const tr = (w: TranscriptWord[], total = 20, language = "en"): Transcript => ({ language, words: w, total });

// "So um we can we can open the file, uh, and the the save it."
const SPEECH = words("So@0.5 um@1.0 we@1.6 can@1.9 we@2.3 can@2.6 open@3.0 the@3.3 file,@3.6 uh,@4.4 and@5.0 the@5.3 the@5.6 save@5.9 it.@6.2");

test("fillers and immediate repeats become cut suggestions with reasons and confidence", () => {
  const list = transcriptSuggestions(tr(SPEECH), ids);
  const by = (kind: string) => list.filter((s) => s.kind === kind);
  assert.equal(by("filler").length, 2);
  const um = by("filler")[0];
  assert.equal(um.title, 'Filler: "um"');
  assert.equal(um.confidence, "high");
  // From the filler to where the next word begins.
  close(um.start, 1.0);
  close(um.end, 1.6);
  const repeats = by("repeat");
  assert.equal(repeats.length, 2);
  const weCan = repeats.find((s) => s.title.includes("we can"))!;
  assert.equal(weCan.confidence, "medium");
  // The first "we can" goes; the second stays.
  close(weCan.start, 1.6);
  close(weCan.end, 2.3);
  const theThe = repeats.find((s) => s.title === 'Said twice: "the"')!;
  assert.equal(theThe.confidence, "low", "a single repeated word may be deliberate");
  assert.ok(list.every((s) => s.action === "cut" && s.status === "pending" && s.detail.length > 0));
  // Sorted by time, never overlapping.
  for (let i = 1; i < list.length; i++) assert.ok(list[i].start >= list[i - 1].end - 1e-9);
});

test("a restarted sentence is found after a breath; a later repeat isn't", () => {
  const restart = words("Let@1 me@1.3 show@1.6 you@1.9 Let@4.0 me@4.3 show@4.6 you@4.9 how@5.2");
  const [s] = transcriptSuggestions(tr(restart), ids);
  assert.equal(s.kind, "repeat");
  assert.match(s.title, /^Sentence started again/);
  assert.equal(s.confidence, "high");
  close(s.start, 1);
  close(s.end, 4.0);
  const later = words("Let@1 me@1.3 show@1.6 you@1.9 Let@6.0 me@6.3 show@6.6 you@6.9");
  assert.equal(transcriptSuggestions(tr(later), ids).length, 0);
});

test("filler words only for English; repeats in any language", () => {
  assert.ok(fillersSupported("en") && fillersSupported("en-GB") && !fillersSupported("de"));
  const german = words("Also@0.5 äh@1.0 wir@1.5 wir@1.8 öffnen@2.2");
  const list = transcriptSuggestions(tr(german, 10, "de"), ids);
  assert.equal(list.filter((s) => s.kind === "filler").length, 0);
  assert.equal(list.filter((s) => s.kind === "repeat").length, 1);
});

test("uncertain word timings lower the confidence and say so", () => {
  const w = words("so@0.5 um@1.0 we@1.6");
  w[1] = { ...w[1], end: w[1].start }; // zero length
  assert.ok(uncertainTiming(w, 1));
  const [s] = transcriptSuggestions(tr(w), ids);
  assert.equal(s.confidence, "low");
  assert.match(s.detail, /timings here look uncertain/);
  // Overlapping words, and empty or missing transcripts, don't throw.
  const overlap = [{ text: "we", start: 1, end: 2 }, { text: "we", start: 1.2, end: 1.4 }];
  assert.doesNotThrow(() => transcriptSuggestions(tr(overlap), ids));
  assert.deepEqual(transcriptSuggestions(tr([]), ids), []);
});

test("pauses are checked against the words: quiet speech is review, sound without words is review", () => {
  const silence: EditSuggestion = { id: "s1", kind: "silence", start: 1.0, end: 3.0, title: "2.0 s pause in speech", detail: "", action: "cut", status: "pending", confidence: "medium" };
  const t = tr(words("hello@0.2 quietly@1.8 there@3.2 back@12"), 14);
  // Level-based silence only from 3.5 to 4.5: the 3.45-12 gap is mostly sound.
  const out = speechAwarePauses([silence], t, [{ start: 3.5, end: 4.5 }], ids);
  const quiet = out.find((s) => s.id === "s1")!;
  assert.equal(quiet.action, "review", "a word was heard inside the 'pause'");
  assert.match(quiet.detail, /quietly/);
  const sound = out.find((s) => s.kind === "no-speech")!;
  assert.equal(sound.action, "review");
  close(sound.start, 3.45);
  close(sound.end, 12);
  // The same gap, but silent: an ordinary pause, not "sound without speech".
  const silent = speechAwarePauses([], t, [{ start: 3.45, end: 12 }], ids);
  assert.equal(silent.filter((s) => s.kind === "no-speech").length, 0);
  // Without the audio analysis, only the transcript check runs.
  assert.equal(speechAwarePauses([], t, null, ids).length, 0);
});

// --- applying: one undo step, everything stays in sync ------------------------------

const caption = (id: string, start: number, end: number, content: string): Overlay =>
  ({
    id,
    kind: "text",
    start,
    end,
    x: 0.5,
    y: 0.9,
    width: 0.3,
    rotation: 0,
    opacity: 1,
    animIn: "none",
    animOut: "none",
    hidden: false,
    locked: false,
    caption: true,
    text: { content, font: "inter", size: 0.05, weight: 700, italic: false, color: "#fff", background: "#000", backgroundOpacity: 0, strokeColor: "#000", strokeWidth: 0, shadow: false, align: "center", letterSpacing: 0, lineHeight: 1.1 },
  }) as Overlay;

const mic: AudioClip = { id: "mic", sourceId: "mic", label: "Microphone", start: 0, offset: 0, duration: 20, volume: 1, fadeIn: 0, fadeOut: 0, muted: false };

function recording(): Project {
  return {
    clips: [newClip("c1", "s", 0, 20)],
    overlays: [caption("cap1", 3.0, 3.9, "open the file"), caption("cap2", 5.0, 6.5, "and the the save it.")],
    audio: [mic],
    effects: [],
    canvas: DEFAULT_CANVAS,
    chapters: [{ id: "ch", t: 5.0, title: "Saving", auto: true }],
    transcript: tr(SPEECH.map((w) => ({ ...w }))),
  };
}

/** What the review's "Apply accepted" does (useTutorialTools cut). */
function applyAccepted(p: Project, list: EditSuggestion[]): Project {
  let next = p;
  for (const r of acceptedCuts(list)) {
    const res = rippleCut(next, layout(next, 30), r.start, r.end);
    assert.ok(res.ok, res.ok ? "" : res.error);
    next = res.project;
  }
  return next;
}

test("accepted speech cuts: transcript, captions, chapters and microphone stay in sync, as one undo step", () => {
  const before = recording();
  const list = transcriptSuggestions(before.transcript!, ids).map((s) => ({ ...s, status: s.confidence === "low" ? ("rejected" as const) : ("accepted" as const) }));
  const after = applyAccepted(before, list);
  const lay = layout(after, 30);
  // Removed: "um", the first "we can", "uh," (the low-confidence "the the" was rejected).
  const removed = 0.6 + 0.7 + 0.6;
  close(lay.total, 20 - removed);
  assert.ok(transcriptCurrent(after.transcript, lay), "the transcript still matches the timeline");
  assert.deepEqual(
    after.transcript!.words.map((w) => w.text),
    ["So", "we", "can", "open", "the", "file,", "and", "the", "the", "save", "it."]
  );
  // A word after all three cuts moved by exactly the removed time.
  const save = after.transcript!.words.find((w) => w.text === "save")!;
  close(save.start, 5.9 - removed);
  // Captions and the chapter moved with the words they belong to.
  const cap2 = after.overlays.find((o) => o.id === "cap2")!;
  close(cap2.start, 5.0 - removed);
  close(after.chapters![0].t, 5.0 - removed);
  // The microphone is split at the cuts and plays the same moment as the video.
  const micParts = after.audio.filter((a) => a.sourceId === "mic");
  // "um" and the first "we can" touch, so they are one cut: 2 cuts, 3 pieces.
  assert.equal(micParts.length, 3);
  const at = save.start;
  const part = micParts.find((a) => at >= a.start && at < a.start + a.duration)!;
  close(part.offset + (at - part.start), 5.9, 1e-6);

  // One undo step back to exactly the original.
  let h: HistoryState = { past: [], present: before, future: [], gestureBase: null };
  h = historyReducer(h, { type: "apply", fn: () => after, record: true });
  h = historyReducer(h, { type: "undo" });
  assert.deepEqual(h.present, before);
  h = historyReducer(h, { type: "redo" });
  assert.equal(h.present, after);

  // Regenerating on the edited transcript finds only what was left (the rejected repeat).
  const again = transcriptSuggestions(after.transcript!, ids);
  assert.deepEqual(
    again.map((s) => s.title),
    ['Said twice: "the"']
  );
});

test("an hour of transcript is analyzed quickly", () => {
  const vocab = ["so", "we", "open", "the", "file", "and", "then", "um", "save", "it", "uh", "click", "here"];
  const w: TranscriptWord[] = [];
  let t = 0;
  for (let i = 0; t < 3600; i++) {
    w.push({ text: vocab[(i * 7) % vocab.length], start: t, end: t + 0.25 });
    t += i % 40 === 39 ? 3 : 0.4;
  }
  const t0 = performance.now();
  const list = transcriptSuggestions(tr(w, 3600), ids);
  const checked = speechAwarePauses([], tr(w, 3600), [], ids);
  const ms = performance.now() - t0;
  console.log(`[speechEdits] ${w.length} words: ${list.length} suggestions, ${checked.length} no-speech checks in ${ms.toFixed(0)} ms`);
  assert.ok(ms < 1000, `${ms} ms`);
});
