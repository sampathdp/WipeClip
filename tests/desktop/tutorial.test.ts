// Run with: npm run desktop:test:js
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SILENCE, analyzeAudio, cutRangeFor } from "../../src/lib/editor/audioAnalysis.ts";
import { CameraCache } from "../../src/lib/editor/camera.ts";
import { suggestChapters, DEFAULT_CHAPTERS } from "../../src/lib/editor/chapters.ts";
import { acceptedCuts, interactionTimeline, suggestEdits, type Act } from "../../src/lib/editor/insights.ts";
import { DEFAULT_KEYSTROKES, comboCounts, displayCombo, keystrokeOverlays } from "../../src/lib/editor/keystrokes.ts";
import { maskRect, maskRows } from "../../src/lib/editor/masks.ts";
import { PointerCache } from "../../src/lib/editor/pointer.ts";
import { rippleCut, rippleInsert, rippleReplace } from "../../src/lib/editor/ripple.ts";
import { layout } from "../../src/lib/editor/timeline.ts";
import { captionCues, chapterList, chaptersVtt, toSrt, toVtt } from "../../src/lib/editor/transcript.ts";
import {
  DEFAULT_CANVAS,
  migrateProject,
  newClip,
  type AudioClip,
  type CameraZoom,
  type MediaSource,
  type Overlay,
  type PrivacyMask,
  type Project,
} from "../../src/lib/editor/types.ts";
import type { InteractionEvent } from "../../src/lib/recorder/format.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const rectIs = (r: { x: number; y: number; w: number; h: number } | null, e: [number, number, number, number]) => {
  assert.ok(r, "rect expected");
  [r!.x, r!.y, r!.w, r!.h].forEach((v, i) => close(v, e[i], 1e-6)); // pointer paths are Float32
};
let n = 0;
const ids = () => `id${++n}`;

function project(over: Partial<Project> = {}): Project {
  return { clips: [newClip("c1", "s", 0, 20)], overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS, ...over };
}
const audioClip = (over: Partial<AudioClip>): AudioClip => ({
  id: "a",
  sourceId: "mic",
  label: "Microphone",
  start: 0,
  offset: 0,
  duration: 20,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  muted: false,
  ...over,
});
const text = (over: Partial<Overlay> & { content?: string }): Overlay =>
  ({
    id: "t",
    kind: "text",
    start: 0,
    end: 1,
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
    text: { content: over.content ?? "hello", font: "inter", size: 0.05, weight: 700, italic: false, color: "#fff", background: "#000", backgroundOpacity: 0, strokeColor: "#000", strokeWidth: 0, shadow: false, align: "center", letterSpacing: 0, lineHeight: 1.1 },
    ...over,
  }) as Overlay;

// --- ripple ---------------------------------------------------------------------

test("cutting a range keeps video, microphone and webcam in sync", () => {
  const webcam = { ...text({ id: "cam", start: 0, end: 20 }), kind: "video", sourceId: "cam", offset: 0, volume: 0 } as unknown as Overlay;
  const p = project({
    audio: [audioClip({})],
    overlays: [webcam, text({ id: "cap1", start: 4, end: 6 }), text({ id: "cap2", start: 12, end: 14 })],
    effects: [{ id: "fx", type: "blur", start: 9, end: 15, intensity: 50 }],
    chapters: [
      { id: "ch1", t: 0, title: "Intro", auto: false },
      { id: "ch2", t: 11, title: "Inside", auto: false },
      { id: "ch3", t: 16, title: "After", auto: false },
    ],
  });
  const lay = layout(p, 30);
  const r = rippleCut(p, lay, 10, 13);
  assert.ok(r.ok);
  if (!r.ok) return;
  const q = r.project;
  close(r.removed, 3);
  // Video: 0-10 then source 13-20.
  assert.deepEqual(
    q.clips.map((c) => [c.start, c.end]),
    [
      [0, 10],
      [13, 20],
    ]
  );
  // Microphone split the same way: the part after the cut plays source 13 s on.
  assert.equal(q.audio.length, 2);
  assert.deepEqual([q.audio[1].start, q.audio[1].offset], [10, 13]);
  close(q.audio[0].duration + q.audio[1].duration, 17);
  // Webcam layer too.
  const cams = q.overlays.filter((o) => o.kind === "video");
  assert.equal(cams.length, 2);
  assert.ok(cams[1].kind === "video" && cams[1].offset === 13 && cams[1].start === 10);
  // Captions: before kept, the one in the cut trimmed and moved.
  const cap2 = q.overlays.find((o) => o.id === "cap2")!;
  assert.deepEqual([cap2.start, cap2.end], [10, 11]);
  assert.deepEqual([q.effects[0].start, q.effects[0].end], [9, 12]);
  assert.deepEqual(
    q.chapters!.map((c) => c.t),
    [0, 10, 13]
  );
  assert.equal(layout(q, 30).total, 17);
});

test("cuts through speed and reversed clips map back to the right source time", () => {
  const p = project({ clips: [{ ...newClip("f", "s", 0, 8), speed: 2 }, { ...newClip("r", "s", 10, 20), reverse: true }] });
  const lay = layout(p, 30); // 4 s + 10 s
  const r = rippleCut(p, lay, 2, 6);
  assert.ok(r.ok);
  if (!r.ok) return;
  // Fast clip keeps its first 2 timeline s = source 0-4; reversed clip loses its first 2 s (source 20..18).
  assert.deepEqual(
    r.project.clips.map((c) => [c.start, c.end, c.reverse]),
    [
      [0, 4, false],
      [10, 18, true],
    ]
  );
});

test("cuts refuse transitions and emptying the project", () => {
  const p = project({ clips: [{ ...newClip("a", "s", 0, 5), transition: { type: "fade", duration: 1 } }, newClip("b", "s", 5, 10)] });
  const lay = layout(p, 30);
  const bad = rippleCut(p, lay, 4.5, 5.5);
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.error : "", /transition/);
  assert.equal(rippleCut(project(), layout(project(), 30), 0, 20).ok, false);
});

test("insert and replace shift later items and keep the original untouched", () => {
  const p = project({ audio: [audioClip({})], chapters: [{ id: "x", t: 15, title: "Later", auto: false }] });
  const before = JSON.stringify(p);
  const lay = layout(p, 30);
  const ins = rippleInsert(p, lay, 5, [newClip("n", "s2", 0, 3)], 3);
  assert.ok(ins.ok);
  if (!ins.ok) return;
  assert.deepEqual(
    ins.project.clips.map((c) => [c.sourceId, c.start, c.end]),
    [
      ["s", 0, 5],
      ["s2", 0, 3],
      ["s", 5, 20],
    ]
  );
  assert.deepEqual(
    ins.project.audio.map((a) => [a.start, a.offset]),
    [
      [0, 0],
      [8, 5],
    ]
  );
  assert.equal(ins.project.chapters![0].t, 18);
  // Replace 5-8 with a 2 s retake that brings its own microphone track.
  const rep = rippleReplace(p, lay, 5, 8, [newClip("re", "take2", 0, 2)], 2, { audio: [audioClip({ id: "m2", sourceId: "mic2", start: 5, duration: 2 })] }, (q) => layout(q, 30));
  assert.ok(rep.ok);
  if (!rep.ok) return;
  assert.equal(layout(rep.project, 30).total, 19);
  assert.ok(rep.project.audio.some((a) => a.sourceId === "mic2" && a.start === 5));
  assert.equal(JSON.stringify(p), before, "pure: the input project is unchanged");
});

// --- audio analysis --------------------------------------------------------------

const RATE = 16000;
/** Speech-like bursts (modulated tone) over low noise. */
function signal(spans: [number, number, number?][], total: number, noise = 0.003): Float32Array {
  const s = new Float32Array(Math.round(total * RATE));
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < s.length; i++) s[i] = rnd() * noise;
  for (const [a, b, amp = 0.3] of spans) {
    for (let i = Math.round(a * RATE); i < Math.round(b * RATE); i++) {
      const t = i / RATE;
      s[i] += amp * Math.sin(2 * Math.PI * 220 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t));
    }
  }
  return s;
}

test("silences are found against the recording's own noise floor", () => {
  const audio = signal(
    [
      [0.5, 4],
      [7, 12],
      [12.6, 18],
    ],
    20,
    0.01 // noticeable background noise
  );
  const r = analyzeAudio(audio, DEFAULT_SILENCE);
  assert.ok(r.noiseFloorDb > -50, "floor reflects the noise");
  const long = r.silences.filter((s) => s.end - s.start >= 1.5);
  // 4-7 s pause and the trailing 18-20 s; the 0.6 s breath at 12 s is not a pause.
  assert.ok(long.some((s) => s.start > 3.8 && s.start < 4.3 && s.end > 6.7 && s.end < 7.2));
  assert.ok(!r.silences.some((s) => s.start > 11.8 && s.end < 12.8));
  const cut = cutRangeFor(long.find((s) => s.start > 3.8)!, 0.35, 20)!;
  close(cut.end - cut.start, long.find((s) => s.start > 3.8)!.end - long.find((s) => s.start > 3.8)!.start - 0.7, 0.05);
});

test("quiet speech isn't mistaken for silence, and sensitivity matters", () => {
  const audio = signal(
    [
      [0, 5, 0.3],
      [6, 10, 0.03], // quiet speaker, still well above the noise
    ],
    10,
    0.001
  );
  const r = analyzeAudio(audio, { ...DEFAULT_SILENCE, sensitivity: 0.3 });
  assert.ok(!r.silences.some((s) => s.start > 6 && s.end < 10), "quiet speech kept");
  const strict = analyzeAudio(audio, { ...DEFAULT_SILENCE, minPause: 0.5, sensitivity: 0.3 });
  const loose = analyzeAudio(audio, { ...DEFAULT_SILENCE, minPause: 3 });
  assert.ok(strict.silences.length >= loose.silences.length);
});

test("clipping and sudden loud sounds are flagged", () => {
  const audio = signal([[0, 10, 0.2]], 10);
  for (let i = 3 * RATE; i < 3.1 * RATE; i++) audio[i] = i % 2 ? 1 : -1; // clipped burst
  const r = analyzeAudio(audio);
  assert.ok(r.clipping.some((c) => c.start >= 2.9 && c.start <= 3.1));
  assert.ok(r.loud.length >= 1);
  assert.deepEqual(analyzeAudio(new Float32Array(0)).silences, []);
});

// --- interaction insights ---------------------------------------------------------

const act = (t: number, kind: Act["kind"], x = 0.5, y = 0.5, label?: string): Act => ({ t, kind, x, y, label });

test("silence while working on screen is a review item, not a cut", () => {
  const p = project();
  const lay = layout(p, 30);
  const audio = analyzeAudio(signal([[0, 3], [8, 20]], 20));
  const working = suggestEdits({ lay, acts: [act(5, "click"), act(6, "key", NaN, NaN, "Ctrl+S")], audio }, { silence: DEFAULT_SILENCE, idle: 8, aspect: 16 / 9 }, ids);
  const sil = working.find((s) => s.start < 5 && s.end > 5)!;
  assert.equal(sil.action, "review");
  const idle = suggestEdits({ lay, acts: [], audio }, { silence: DEFAULT_SILENCE, idle: 8, aspect: 16 / 9 }, ids);
  const dead = idle.find((s) => s.kind === "dead-time" && s.start < 5 && s.end > 5)!;
  assert.equal(dead.kind, "dead-time");
  assert.equal(dead.action, "cut");
  assert.ok(dead.start >= 3 + DEFAULT_SILENCE.keep - 0.1 && dead.end <= 8 - DEFAULT_SILENCE.keep + 0.1, "natural pause kept");
  assert.ok(working.every((s) => s.status === "pending"));
});

test("repeated clicks and repeated step sequences are flagged as possibilities", () => {
  const p = project({ clips: [newClip("c1", "s", 0, 60)] });
  const lay = layout(p, 30);
  const acts = [
    act(2, "click", 0.3, 0.3),
    act(2.4, "click", 0.301, 0.3),
    act(2.9, "click", 0.3, 0.302),
    // steps A B C ... and again later
    act(10, "click", 0.1, 0.1),
    act(12, "click", 0.5, 0.2),
    act(14, "click", 0.8, 0.8),
    act(30, "click", 0.1, 0.11),
    act(32, "click", 0.5, 0.2),
    act(34, "click", 0.81, 0.8),
  ];
  const out = suggestEdits({ lay, acts, audio: null }, { silence: DEFAULT_SILENCE, idle: 8, aspect: 16 / 9 }, ids);
  const rep = out.find((s) => s.kind === "repeated-clicks")!;
  assert.match(rep.title, /3 clicks/);
  assert.equal(rep.confidence, "low");
  const retake = out.find((s) => s.kind === "possible-retake")!;
  assert.ok(retake.start <= 10 && retake.end <= 30 && retake.end > 14);
  assert.match(retake.detail, /If the first attempt went wrong/);
  assert.ok(!out.some((s) => /mistake/i.test(s.title)), "never asserts a mistake");
  // Idle: 14 s -> 30 s without activity.
  assert.ok(out.some((s) => s.kind === "idle" && s.start >= 14 && s.end <= 30));
});

test("long navigation and app switching, markers as milestones", () => {
  const p = project({ clips: [newClip("c1", "s", 0, 40)] });
  const lay = layout(p, 30);
  const acts: Act[] = [];
  for (let i = 0; i < 80; i++) acts.push(act(1 + i * 0.08, "move", i % 2 ? 0.1 : 0.9, 0.5));
  acts.push(act(20, "window", NaN, NaN, "Chrome"), act(22, "window", NaN, NaN, "Code"), act(24, "window", NaN, NaN, "Chrome"), act(26, "window", NaN, NaN, "Slack"));
  acts.push(act(30, "marker", NaN, NaN, "Setup done"));
  const out = suggestEdits({ lay, acts, audio: null }, { silence: DEFAULT_SILENCE, idle: 8, aspect: 16 / 9 }, ids);
  assert.ok(out.filter((s) => s.kind === "navigation").length >= 2);
  assert.ok(out.some((s) => s.kind === "milestone" && s.title === "Setup done"));
});

test("events map to the timeline through trims; accepted cuts merge back to front", () => {
  const p = project({ clips: [newClip("c1", "s", 5, 15)] });
  const ev: InteractionEvent[] = [
    { type: "button", t: 2000, button: "left", down: true, x: 0.5, y: 0.5 },
    { type: "button", t: 7000, button: "left", down: true, x: 0.5, y: 0.5 },
  ];
  const acts = interactionTimeline(layout(p, 30), "s", ev);
  assert.deepEqual(
    acts.map((a) => a.t),
    [2]
  );
  const list = [
    { id: "a", start: 1, end: 3, status: "accepted", action: "cut" },
    { id: "b", start: 2.5, end: 4, status: "accepted", action: "cut" },
    { id: "c", start: 8, end: 9, status: "accepted", action: "cut" },
    { id: "d", start: 10, end: 11, status: "rejected", action: "cut" },
  ] as never;
  assert.deepEqual(
    acceptedCuts(list).map((c) => [c.start, c.end]),
    [
      [8, 9],
      [1, 4],
    ]
  );
});

// --- captions, shortcuts, chapters ----------------------------------------------------

test("SRT and VTT from corrected captions", () => {
  const cues = captionCues([
    text({ id: "b", start: 3.5, end: 5.25, content: "second\n\nline" }),
    text({ id: "a", start: 0, end: 1.5, content: "Hello --> world" }),
    text({ id: "h", start: 6, end: 7, content: "hidden", hidden: true }),
    text({ id: "x", start: 8, end: 9, content: "not a caption", caption: false }),
  ]);
  assert.equal(cues.length, 2);
  assert.equal(toSrt(cues), "1\n00:00:00,000 --> 00:00:01,500\nHello --> world\n\n2\n00:00:03,500 --> 00:00:05,250\nsecond\nline\n");
  assert.equal(toVtt(cues), "WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHello -> world\n\n00:00:03.500 --> 00:00:05.250\nsecond\nline\n");
});

test("shortcut indicators use only recorded shortcuts, honour hidden combos, never stack", () => {
  const acts = [act(1, "key", NaN, NaN, "Ctrl+C"), act(1.5, "key", NaN, NaN, "Ctrl+V"), act(5, "key", NaN, NaN, "Ctrl+Shift+P"), act(8, "click")];
  const out = keystrokeOverlays(acts, { ...DEFAULT_KEYSTROKES, hidden: ["Ctrl+Shift+P"] }, 10, false, ids);
  assert.deepEqual(
    out.map((o) => [o.kind === "text" && o.text.content, o.start, o.end]),
    [
      ["Ctrl + C", 1, 1.5],
      ["Ctrl + V", 1.5, 2.7],
    ]
  );
  assert.ok(out.every((o) => o.keystroke));
  assert.equal(displayCombo("Shift+Cmd+4", true), "⇧⌘4");
  assert.deepEqual(comboCounts(acts)[0], { combo: "Ctrl+C", count: 1 });
});

test("chapters from markers, app switches and pauses; list formats", () => {
  const acts = [act(0.5, "window", NaN, NaN, "Chrome"), act(40, "window", NaN, NaN, "Code"), act(90, "marker", NaN, NaN, "Deploy"), act(95, "window", NaN, NaN, "Terminal")];
  const cues = [
    { start: 0.2, end: 3, text: "welcome to this tutorial about deploying" },
    { start: 41, end: 44, text: "now open the editor" },
  ];
  const ch = suggestChapters({ acts, cues, audio: null, total: 150 }, DEFAULT_CHAPTERS, ids);
  assert.equal(ch[0].t, 0);
  assert.ok(ch.some((c) => c.title === "Code" && c.t === 40));
  const deploy = ch.find((c) => c.title === "Deploy")!;
  assert.equal(deploy.t, 90, "marker wins over the app switch 5 s later");
  assert.ok(!ch.some((c) => c.title === "Terminal"));
  assert.ok(ch.every((c) => c.auto));
  assert.equal(chapterList([{ id: "1", t: 0.4, title: "Intro", auto: true }, { id: "2", t: 3725, title: "  End ", auto: false }]), "0:00 Intro\n1:02:05 End\n");
  assert.match(chaptersVtt(ch, 150), /^WEBVTT/);
});

// --- privacy masks -----------------------------------------------------------------

function recSource(): MediaSource {
  return {
    id: "s",
    kind: "original",
    url: "",
    duration: 20,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: false,
    recording: {
      trackKind: "screen",
      folder: "",
      events: [
        { type: "move", t: 0, x: 0.2, y: 0.2 },
        { type: "move", t: 5000, x: 0.8, y: 0.6 },
      ],
      manifest: { capture: { coordinateSpace: "capture" } },
    },
  } as unknown as MediaSource;
}
const mask = (over: Partial<PrivacyMask>): PrivacyMask => ({
  id: "m",
  start: 1,
  end: 10,
  mode: "blur",
  strength: 60,
  color: "#000",
  x: 0.25,
  y: 0.25,
  w: 0.5,
  h: 0.5,
  space: "canvas",
  follow: "none",
  enabled: true,
  ...over,
});
const caches = () => ({ camera: new CameraCache(), pointer: new PointerCache() });

test("canvas masks are time-limited and clipped to the frame", () => {
  const p = project();
  const lay = layout(p, 30);
  const src = { s: recSource() };
  const canvas = { width: 1920, height: 1080 };
  assert.equal(maskRect(mask({}), 0.5, lay, p, src, canvas, caches()), null);
  rectIs(maskRect(mask({}), 2, lay, p, src, canvas, caches()), [0.25, 0.25, 0.5, 0.5]);
  rectIs(maskRect(mask({ x: 0.8, w: 0.5 }), 2, lay, p, src, canvas, caches()), [0.8, 0.25, 0.2, 0.5]);
  assert.equal(maskRect(mask({ enabled: false }), 2, lay, p, src, canvas, caches()), null);
});

test("video-anchored masks follow crop and focus zoom; pointer masks follow the pointer", () => {
  const zoom: CameraZoom = { id: "z", sourceId: "s", start: 2, end: 9, zoom: 2, x: 0.25, y: 0.25, easeIn: 0.5, easeOut: 0.5, ease: "smooth", enabled: true, auto: false };
  const p = project({ zooms: [zoom] });
  const lay = layout(p, 30);
  const src = { s: recSource() };
  const canvas = { width: 1920, height: 1080 };
  const m = mask({ space: "video", sourceId: "s", x: 0.1, y: 0.1, w: 0.1, h: 0.1 });
  rectIs(maskRect(m, 1.5, lay, p, src, canvas, caches()), [0.1, 0.1, 0.1, 0.1]);
  // Zoomed 2x on the top-left quadrant: the masked content is twice as big.
  const z = maskRect(m, 5, lay, p, src, canvas, caches())!;
  close(z.x, 0.2, 1e-6);
  close(z.w, 0.2, 1e-6);
  // Before the zoom the pointer (0.2, 0.2) is on screen: the mask centers on it.
  rectIs(maskRect(mask({ follow: "pointer", w: 0.1, h: 0.1, start: 0, end: 20 }), 1.5, lay, p, src, canvas, caches()), [0.15, 0.15, 0.1, 0.1]);
  // At 7 s it has moved to (0.8, 0.6), outside the zoomed view: nothing to cover.
  assert.equal(maskRect(mask({ follow: "pointer", start: 0, end: 20 }), 7, lay, p, src, canvas, caches()), null);
  // Other source on screen: a video mask doesn't show.
  assert.equal(maskRect({ ...m, sourceId: "other" }, 5, lay, p, src, canvas, caches()), null);
  // Export rows = the preview's rectangles, only where they change.
  const rows = maskRows(m, lay, p, src, canvas);
  assert.ok(rows.length > 3 && rows.length < 60);
  for (const [t, x, , w] of rows) {
    const r = maskRect(m, t, lay, p, src, canvas, caches());
    if (r) {
      close(x, r.x, 1e-4);
      close(w, r.w, 1e-4);
    }
  }
});

test("new project data survives save/reopen with defaults", () => {
  const back = migrateProject(
    JSON.parse(
      JSON.stringify({
        clips: [newClip("c", "s", 0, 5)],
        masks: [{ id: "m", start: 0, end: 1, x: 0, y: 0, w: 0.1, h: 0.1 }],
        chapters: [{ id: "c", t: 0, title: "Intro", auto: false }],
        suggestions: [{ id: "s", kind: "silence", start: 1, end: 2, title: "", detail: "", action: "cut", status: "rejected", confidence: "low" }],
      })
    )
  );
  assert.equal(back.masks![0].mode, "blur");
  assert.equal(back.masks![0].enabled, true);
  assert.equal(back.chapters![0].title, "Intro");
  assert.equal(back.suggestions![0].status, "rejected");
  const old = migrateProject({ clips: [newClip("c", "s", 0, 1)] });
  assert.deepEqual([old.masks, old.chapters, old.suggestions], [[], [], []]);
});

// --- multiple audio sources, long recordings -------------------------------------------

import { clippedSpans, mergeSpans } from "../../src/lib/editor/audioAnalysis.ts";
import { historyReducer, type HistoryState } from "../../src/lib/editor/history.ts";

test("clipping is judged per source: two loud clean tracks in the mix aren't clipping", () => {
  // Microphone and system sound, each peaking at 0.7 - clean - but their
  // sum peaks at 1.4.
  const mic = signal([[0, 10, 0.7]], 10, 0);
  const sys = signal([[0, 10, 0.7]], 10, 0);
  const mix = mic.map((v, i) => v + sys[i]);
  assert.ok(analyzeAudio(mix).clipping.length > 0, "the mix alone would report clipping");
  const perSource = [...clippedSpans([mic], RATE), ...clippedSpans([sys], RATE)];
  assert.deepEqual(perSource, []);
  assert.deepEqual(analyzeAudio(mix, DEFAULT_SILENCE, RATE, perSource).clipping, []);

  // A 48 kHz stereo source clipped on its right channel only, 3.0-3.2 s.
  const rate = 48000;
  const left = new Float32Array(10 * rate).map((_, i) => 0.3 * Math.sin(i / 20));
  const right = left.map((v, i) => (i >= 3 * rate && i < 3.2 * rate ? Math.max(-1, Math.min(1, v * 6)) : v));
  const spans = clippedSpans([left, right], rate);
  assert.equal(spans.length, 1);
  close(spans[0].start, 3, 0.03);
  close(spans[0].end, 3.2, 0.03);
  // Only the part of the source that's on the timeline is checked.
  assert.deepEqual(clippedSpans([left, right], rate, 5, 10), []);
  const part = clippedSpans([left, right], rate, 3.1, 4);
  assert.ok(part.length === 1 && part[0].start >= 3.08 && part[0].end <= 3.22);
  assert.deepEqual(mergeSpans([{ start: 5, end: 6 }, { start: 1, end: 2 }, { start: 2.1, end: 3 }]), [{ start: 1, end: 3 }, { start: 5, end: 6 }]);
});

test("a 30-minute recording is analyzed quickly and its pauses are all found", () => {
  const total = 30 * 60;
  const spans: [number, number][] = [];
  // 25 s of talking, then a 5 s pause, over and over, in a noisy room.
  for (let t = 0; t < total; t += 30) spans.push([t, t + 25]);
  const audio = signal(spans, total, 0.008);
  const t0 = performance.now();
  const r = analyzeAudio(audio, DEFAULT_SILENCE);
  const ms = performance.now() - t0;
  assert.ok(ms < 5000, `took ${ms.toFixed(0)} ms`);
  const pauses = r.silences.filter((s) => s.end - s.start > 4);
  assert.equal(pauses.length, total / 30);
  for (const [i, p] of pauses.entries()) close(p.start, i * 30 + 25, 0.1);
});

// --- overlapping overlays ------------------------------------------------------------------

test("overlapping masks are independent: each covers its own area in preview and export", () => {
  const p = project();
  const lay = layout(p, 30);
  const src = { s: recSource() };
  const canvas = { width: 1280, height: 720 };
  const a = mask({ id: "a", mode: "blur", x: 0.2, y: 0.2, w: 0.4, h: 0.4, start: 1, end: 6 });
  const b = mask({ id: "b", mode: "solid", x: 0.4, y: 0.4, w: 0.4, h: 0.4, start: 3, end: 9 });
  const c = mask({ id: "c", mode: "pixelate", x: 0.3, y: 0.1, w: 0.2, h: 0.7, start: 0, end: 20 });
  for (const t of [2, 4, 7]) {
    const rects = [a, b, c].map((m) => maskRect(m, t, lay, p, src, canvas, caches()));
    assert.equal(rects[0] !== null, t < 6);
    assert.equal(rects[1] !== null, t >= 3);
    rectIs(rects[2], [0.3, 0.1, 0.2, 0.7]);
  }
  for (const m of [a, b, c]) {
    const rows = maskRows(m, lay, p, src, canvas);
    assert.ok(rows.length >= 1);
    for (const [t, x, y, w, h] of rows) {
      const r = maskRect(m, t, lay, p, src, canvas, caches());
      if (r) [x, y, w, h].forEach((v, i) => close(v, [r.x, r.y, r.w, r.h][i], 1e-4));
    }
  }
});

// --- timeline edits with undo/redo and save/reopen -------------------------------------------

test("accepted cuts are one undo step; undo restores sync, redo reapplies; result survives reopen", () => {
  const p = project({
    audio: [audioClip({ id: "mic", sourceId: "mic" }), audioClip({ id: "sys", sourceId: "sys", volume: 0.6 })],
    overlays: [text({ id: "cap1", start: 9, end: 10, content: "after the pause" })],
    chapters: [{ id: "ch", t: 12, title: "Part 2", auto: true }],
    masks: [mask({ id: "m", start: 11, end: 14 })],
  });
  let h: HistoryState = { past: [], present: p, future: [], gestureBase: null };
  const ranges = acceptedCuts([
    { id: "s1", kind: "silence", start: 4, end: 6, title: "", detail: "", action: "cut", status: "accepted", confidence: "high" },
    { id: "s2", kind: "dead", start: 6, end: 7, title: "", detail: "", action: "cut", status: "accepted", confidence: "high" },
    { id: "s3", kind: "silence", start: 15, end: 16, title: "", detail: "", action: "cut", status: "rejected", confidence: "low" },
  ] as never);
  assert.deepEqual(ranges.map((r) => [r.start, r.end]), [[4, 7]], "touching cuts merge; rejected ones are skipped");
  // Same as the panel: back to front, one apply.
  let next = h.present;
  for (const r of [...ranges].sort((x, y) => y.start - x.start)) {
    const res = rippleCut(next, layout(next, 30), r.start, r.end);
    assert.ok(res.ok);
    if (res.ok) next = res.project;
  }
  h = historyReducer(h, { type: "apply", fn: () => next, record: true });
  const cutP = h.present;
  assert.equal(layout(cutP, 30).total, 17);
  // Microphone and system audio are each split around the cut; the part
  // after it starts at 4 s and plays from 7 s of the source - in sync.
  for (const id of ["mic", "sys"]) {
    const parts = cutP.audio.filter((x) => x.sourceId === id).map((x) => [x.start, x.offset, x.duration]);
    assert.deepEqual(parts, [[0, 0, 4], [4, 7, 13]], id);
  }
  assert.equal(cutP.overlays[0].start, 6, "caption moved up with its speech");
  assert.equal(cutP.chapters![0].t, 9);
  assert.deepEqual([cutP.masks![0].start, cutP.masks![0].end], [8, 11]);

  h = historyReducer(h, { type: "undo" });
  assert.equal(h.present, p);
  h = historyReducer(h, { type: "redo" });
  assert.equal(h.present, cutP);

  const reopened = migrateProject(JSON.parse(JSON.stringify(cutP)));
  assert.deepEqual(reopened.audio, cutP.audio);
  assert.deepEqual(reopened.overlays, cutP.overlays);
  assert.deepEqual(reopened.chapters, cutP.chapters);
  assert.deepEqual(reopened.masks, cutP.masks);
});
