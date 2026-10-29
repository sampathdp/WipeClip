// Run with: npm run desktop:test:js
// Automatic cleanup (silence review): the cases from the Phase 3 brief,
// on synthetic audio with known pauses, plus the picture check, the cached
// levels and "Preview the result".
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SILENCE, analyzeAudio, detectAudio, measureLevels, type SilenceSettings } from "../../src/lib/editor/audioAnalysis.ts";
import { historyReducer, type HistoryState } from "../../src/lib/editor/history.ts";
import { MOVING_SHARE, cutCandidates, previewSkips, skipTarget, suggestEdits, type Act } from "../../src/lib/editor/insights.ts";
import { rippleCut } from "../../src/lib/editor/ripple.ts";
import { ActivityCache, screenPieces } from "../../src/lib/editor/screenActivity.ts";
import { layout } from "../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, migrateProject, newClip, type EditSuggestion, type MediaSource, type Overlay, type Project } from "../../src/lib/editor/types.ts";

const RATE = 16000;
let n = 0;
const ids = () => `s${++n}`;

/** Noise floor plus speech-like bursts (220 Hz, 4 Hz syllable envelope). */
function speech(spans: [number, number, number?][], total: number, noise = 0.003, seed0 = 1): Float32Array {
  const s = new Float32Array(Math.round(total * RATE));
  let seed = seed0;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < s.length; i++) s[i] = rnd() * noise;
  for (const [a, b, amp = 0.3] of spans) {
    for (let i = Math.round(a * RATE); i < Math.min(s.length, Math.round(b * RATE)); i++) {
      const t = i / RATE;
      s[i] += amp * Math.sin(2 * Math.PI * 220 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t));
    }
  }
  return s;
}

/** Continuous music-like sound: chords that hold, no gaps. */
function music(total: number, amp = 0.15): Float32Array {
  const s = new Float32Array(Math.round(total * RATE));
  for (let i = 0; i < s.length; i++) {
    const t = i / RATE;
    const chord = Math.floor(t / 2) % 3;
    const f = [261.6, 293.7, 329.6][chord];
    s[i] = amp * (Math.sin(2 * Math.PI * f * t) + 0.6 * Math.sin(2 * Math.PI * f * 1.5 * t) + 0.4 * Math.sin(2 * Math.PI * f * 2 * t)) / 2;
  }
  return s;
}

const mixOf = (...tracks: Float32Array[]) => {
  const out = new Float32Array(Math.max(...tracks.map((t) => t.length)));
  for (const t of tracks) for (let i = 0; i < t.length; i++) out[i] += t[i];
  return out;
};

function project(total: number, over: Partial<Project> = {}): Project {
  return { clips: [newClip("c1", "s", 0, total)], overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS, ...over };
}

function review(samples: Float32Array, opts: { acts?: Act[] | null; motion?: (a: number, b: number) => number | null; silence?: SilenceSettings } = {}) {
  const total = samples.length / RATE;
  const lay = layout(project(total), 30);
  const audio = analyzeAudio(samples, opts.silence ?? DEFAULT_SILENCE);
  const list = suggestEdits({ lay, acts: opts.acts ?? null, audio, motion: opts.motion }, { silence: opts.silence ?? DEFAULT_SILENCE, idle: 12, aspect: 16 / 9 }, ids);
  return { audio, list, cuts: list.filter((s) => s.action === "cut"), reviews: list.filter((s) => s.action === "review") };
}

test("long speech pauses become cuts that keep a natural pause; the length decides the confidence", () => {
  const { cuts } = review(
    speech(
      [
        [0.3, 6],
        [11, 15],
        [17.2, 25],
      ],
      25.3
    )
  );
  // 6..11 (5 s): high; 15..17.2 (2.2 s): low. Nothing at the very edges here.
  const long = cuts.find((c) => c.start > 5 && c.end < 12)!;
  assert.ok(long, "the 5 s pause is suggested");
  assert.equal(long.confidence, "high");
  assert.ok(Math.abs(long.start - (6 + DEFAULT_SILENCE.keep)) < 0.06 && Math.abs(long.end - (11 - DEFAULT_SILENCE.keep)) < 0.06, `${long.start}..${long.end}`);
  const short = cuts.find((c) => c.start > 14 && c.end < 18)!;
  assert.equal(short.confidence, "low");
  assert.equal(cuts.length, 2);
});

test("intentional pauses while working on screen are review items, never cuts", () => {
  const acts: Act[] = [
    { t: 8, kind: "click", x: 0.4, y: 0.4 },
    { t: 9.5, kind: "key", x: NaN, y: NaN },
  ];
  const { cuts, reviews } = review(
    speech(
      [
        [0.3, 6],
        [11, 15],
      ],
      15.3
    ),
    { acts }
  );
  assert.equal(cuts.length, 0);
  assert.ok(reviews.some((r) => r.kind === "silence" && /while you work on screen/.test(r.title)));
});

test("gameplay without narration: game sound isn't silence, and a silent but moving picture is reviewed, not cut", () => {
  // 60 s of continuous game/music sound: nothing to cut.
  assert.equal(review(music(60)).cuts.length, 0);
  // A quiet cutscene (no sound, no input, the picture moving) between talk.
  const samples = speech(
    [
      [0.3, 5],
      [20, 25],
    ],
    25.3
  );
  const moving = review(samples, { acts: [], motion: () => 0.9 });
  assert.equal(moving.cuts.filter((c) => c.start > 4 && c.end < 21).length, 0, "the moving stretch isn't proposed as a cut");
  const item = moving.reviews.find((r) => /picture keeps changing/.test(r.title))!;
  assert.ok(item && item.confidence === "low" && /90%/.test(item.detail));
  // The same stretch with a still picture is dead time again.
  const still = review(samples, { acts: [], motion: () => 0.05 });
  assert.ok(still.cuts.some((c) => c.kind === "dead-time" && c.start > 4 && c.end < 21));
  // Picture not checked (no local engine): unchanged behaviour.
  assert.ok(review(samples, { acts: [], motion: () => null }).cuts.some((c) => c.kind === "dead-time"));
  assert.equal(MOVING_SHARE, 0.25);
});

test("background music: a pause under quieter music is found, under music near speech level it isn't (measured limit)", () => {
  const talk = speech(
    [
      [0.3, 6],
      [11, 15],
    ],
    15.3
  );
  const pauseFound = (amp: number) => review(mixOf(talk, music(15.3, amp))).cuts.filter((c) => c.start > 5 && c.end < 12).length === 1;
  // Music level relative to the speech (amplitude 0.3).
  assert.ok(pauseFound(0.01), "-30 dB");
  assert.ok(pauseFound(0.08), "-11 dB");
  assert.ok(!pauseFound(0.15), "-6 dB: the music fills the pause (false negative, documented)");
  assert.ok(!pauseFound(0.3), "0 dB");
  assert.equal(review(music(60)).cuts.length, 0, "music alone: nothing to cut");
});

test("non-stop talk has no silences (the floor estimate doesn't land on speech)", () => {
  assert.equal(analyzeAudio(speech([[0, 120]], 120)).silences.length, 0);
  // Pauses under 10% of the time: each still found (this used to turn the whole talk into one silence).
  const spans: [number, number][] = [];
  for (let m = 0; m < 5; m++) spans.push([m * 60, m * 60 + 55]);
  const a = analyzeAudio(speech(spans, 300));
  assert.equal(a.silences.length, 5);
  assert.ok(a.silences.every((s) => s.end - s.start < 6));
});

test("low-volume speech is speech, not silence; its pause is still found", () => {
  const quiet = speech(
    [
      [0.3, 6, 0.02],
      [11, 15, 0.02],
    ],
    15.3,
    0.0005
  );
  const { audio, cuts } = review(quiet);
  assert.equal(cuts.length, 1, "only the real pause");
  assert.ok(cuts[0].start > 5.9 && cuts[0].end < 11.1);
  assert.ok(!audio.silences.some((s) => s.start < 5 && s.end > 1), "quiet talk isn't silence");
});

test("multiple audio tracks: a pause on one track that the other fills isn't a pause", () => {
  const mic = speech(
    [
      [0.3, 6],
      [11, 15],
    ],
    15.3
  );
  const guest = speech([[6.5, 10.5, 0.25]], 15.3, 0, 7);
  assert.equal(review(mixOf(mic, guest)).cuts.filter((c) => c.start > 5 && c.end < 12).length, 0);
  assert.equal(review(mic).cuts.length, 1);
});

test("short and long recordings; detection time", () => {
  // 2 s: no crash, nothing meaningful to cut.
  assert.equal(review(speech([[0.2, 1.8]], 2)).cuts.length, 0);
  assert.equal(review(new Float32Array(0)).list.length, 0);
  // 60 minutes with a pause every minute.
  const spans: [number, number][] = [];
  for (let m = 0; m < 60; m++) spans.push([m * 60 + 0.5, m * 60 + 55]);
  const long = speech(spans, 3600);
  let t = performance.now();
  const levels = measureLevels(long);
  const measureMs = performance.now() - t;
  t = performance.now();
  const audio = detectAudio(levels, DEFAULT_SILENCE);
  const detectMs = performance.now() - t;
  console.log(`60 min: measure ${measureMs.toFixed(0)} ms, detect ${detectMs.toFixed(0)} ms, levels ${((levels.frameDb.byteLength + levels.peaks.byteLength + levels.clipMask.byteLength) / 1024).toFixed(0)} KB vs mix ${(long.byteLength / 1048576).toFixed(0)} MB`);
  assert.equal(audio.silences.filter((s) => s.end - s.start > 4 && s.end < 3599.9).length, 59, "every inner pause");
  assert.equal(audio.silences.length, 60, "plus the trailing one");
  assert.ok(detectMs < 1000);
});

test("cached levels give exactly the same result as a fresh analysis, for any settings", () => {
  const s = speech(
    [
      [0.3, 6],
      [8, 12],
      [16, 20],
    ],
    20.3
  );
  const levels = measureLevels(s);
  for (const settings of [DEFAULT_SILENCE, { sensitivity: 0.1, minPause: 0.8, keep: 0.1 }, { sensitivity: 0.9, minPause: 3, keep: 0.6 }]) {
    const a = analyzeAudio(s, settings);
    const b = detectAudio(levels, settings);
    assert.deepEqual({ ...b, frameDb: null }, { ...a, frameDb: null });
  }
});

test("picture pieces follow trims, speed and reverse; only files on disk; cached once", () => {
  const disk = (id: string, path: string): MediaSource => ({ id, kind: "original", file: null, disk: { path, name: "v.mp4", size: 1, type: "video/mp4" }, url: "", duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: true }) as MediaSource;
  const memory = { ...disk("m", ""), disk: undefined } as MediaSource;
  const p = project(0, {
    clips: [{ ...newClip("a", "s", 10, 20) }, { ...newClip("b", "s", 30, 40), speed: 2 }, { ...newClip("c", "s", 0, 10), reverse: true }, newClip("d", "m", 0, 10)],
  });
  const lay = layout(p, 30);
  const sources = { s: disk("s", "C:/v.mp4"), m: memory };
  // Timeline: a 0-10 (src 10-20), b 10-15 (src 30-40 at 2x), c 15-25 (src 10-0), d 25-35 (in memory).
  const pieces = screenPieces(lay, sources, 8, 27);
  assert.deepEqual(
    pieces.map((x) => [x.sourceStart, x.sourceEnd, x.length].map((v) => Math.round(v * 100) / 100)),
    [
      [18, 20, 2],
      [30, 40, 5],
      [0, 10, 10],
    ]
  );
  const cache = new ActivityCache();
  assert.equal(cache.share(pieces), null, "unknown until measured");
  assert.equal(cache.missing([...pieces, ...pieces]).length, 3, "no duplicate measurements");
  cache.set(pieces[0], 1);
  cache.set(pieces[1], 0);
  assert.equal(cache.missing(pieces).length, 1);
  assert.ok(Math.abs(cache.share(pieces)! - 2 / 7) < 1e-9, "weighted by timeline length, unknown pieces left out");
});

test("cut candidates are the silences outside on-screen work", () => {
  const audio = analyzeAudio(
    speech(
      [
        [0.3, 4],
        [8, 12],
        [16, 20],
      ],
      20.3
    )
  );
  const all = cutCandidates(audio, null);
  const some = cutCandidates(audio, [{ t: 6, kind: "click", x: 0.5, y: 0.5 }]);
  assert.equal(all.length - some.length, 1);
});

test("preview the result: pending cuts are skipped, merged; accepted and rejected ones aren't", () => {
  const sg = (start: number, end: number, status: EditSuggestion["status"] = "pending", action: EditSuggestion["action"] = "cut"): EditSuggestion => ({
    id: ids(),
    kind: "silence",
    start,
    end,
    title: "",
    detail: "",
    action,
    status,
    confidence: "high",
  });
  const ranges = previewSkips([sg(10, 12), sg(2, 4), sg(3.5, 5), sg(20, 22, "rejected"), sg(30, 32, "accepted"), sg(40, 45, "pending", "review")]);
  assert.deepEqual(ranges, [
    { start: 2, end: 5 },
    { start: 10, end: 12 },
  ]);
  assert.equal(skipTarget(ranges, 1), 1);
  assert.equal(skipTarget(ranges, 2), 5);
  assert.equal(skipTarget(ranges, 4.999), 4.999, "at the end: no jump again");
  assert.equal(skipTarget(ranges, 11), 12);
  assert.equal(skipTarget(ranges, 20), 20);
});

test("cuts next to text, effects and transitions; undo, save and reopen", () => {
  const text = { id: "t1", kind: "text", start: 9, end: 14, x: 0.5, y: 0.5, width: 0.3, rotation: 0, opacity: 1, animIn: "none", animOut: "none", hidden: false, locked: false, text: { content: "Hello" } } as unknown as Overlay;
  const p = project(30, {
    clips: [newClip("c1", "s", 0, 20), { ...newClip("c2", "s", 20, 30), transition: null }],
    overlays: [text],
    effects: [{ id: "e1", type: "blur", start: 12, end: 16, intensity: 50 } as Project["effects"][number]],
  });
  // With a transition into c2, a cut touching 20 s is refused, one before it works.
  const withTransition = { ...p, clips: [{ ...p.clips[0], transition: { type: "fade", duration: 1 } }, p.clips[1]] } as Project;
  const lay = layout(withTransition, 30);
  assert.equal(rippleCut(withTransition, lay, 18.5, 20).ok, false, "a cut touching a transition is refused, not half-applied");
  const ok = rippleCut(withTransition, lay, 10, 12);
  assert.ok(ok.ok);
  if (!ok.ok) return;
  const t = ok.project.overlays[0];
  assert.deepEqual([t.start, t.end], [9, 12], "text across the cut keeps its parts before and after");
  const e = ok.project.effects[0];
  assert.deepEqual([e.start, e.end], [10, 14], "effect after the cut moves up");
  assert.equal(layout(ok.project, 30).total, layout(withTransition, 30).total - 2);
  // Undo / redo / reopen.
  let h: HistoryState = { past: [], present: withTransition, future: [], gestureBase: null };
  h = historyReducer(h, { type: "apply", fn: () => ok.project, record: true });
  const reopened = migrateProject(JSON.parse(JSON.stringify(h.present)));
  assert.equal(layout(reopened, 30).total, layout(ok.project, 30).total);
  h = historyReducer(h, { type: "undo" });
  assert.equal(h.present, withTransition);
});
