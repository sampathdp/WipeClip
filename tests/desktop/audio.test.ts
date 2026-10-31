// Run with: npm run desktop:test:js
// Phase 6: loudness measurement and normalization gain (loudness.ts), the
// mix model shared by preview and export (mix.ts), ducking and noise
// reduction staying in sync through ripple edits, undo/redo, and webcam
// layouts across canvas sizes (webcamLayout.ts, shapeMask.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LIMIT_CEILING_DB,
  LIMITER_ALLOWANCE_DB,
  MAX_BOOST_DB,
  kWeighting,
  measureLoudness,
  normalizationGain,
} from "../../src/lib/editor/loudness.ts";
import {
  VIDEO_TRACK,
  clipMixVolume,
  heardWithSolo,
  liveSolo,
  loudnessStale,
  masterGainDb,
  meterFraction,
  meterLevel,
  mixKey,
  playedSourceId,
  toggleSolo,
  trackGainAt,
  withCleanup,
} from "../../src/lib/editor/mix.ts";
import { CAM_SIZES, placeWebcam, relayoutWebcams, screenForLayout, applyCamLayout } from "../../src/lib/editor/webcamLayout.ts";
import { coverage } from "../../src/lib/editor/shapeMask.ts";
import { rippleCut, rippleInsert } from "../../src/lib/editor/ripple.ts";
import { layout } from "../../src/lib/editor/timeline.ts";
import { historyReducer, type HistoryState } from "../../src/lib/editor/history.ts";
import {
  DEFAULT_CANVAS,
  DEFAULT_MASTER,
  migrateProject,
  newClip,
  type AudioClip,
  type CamLayout,
  type MediaSource,
  type Overlay,
  type Project,
} from "../../src/lib/editor/types.ts";

const close = (a: number, b: number, eps: number, what = "") => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} != ${b} (±${eps})`);

function sine(rate: number, seconds: number, amp: number, hz = 1000): Float32Array {
  const x = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  return x;
}

function project(over: Partial<Project> = {}): Project {
  return { clips: [newClip("c1", "screen", 0, 20)], overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS, ...over };
}
const track = (over: Partial<AudioClip> = {}): AudioClip => ({
  id: "mic1",
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
const source = (id: string, over: Partial<MediaSource> = {}): MediaSource => ({
  id,
  kind: "original",
  file: null,
  url: `blob:${id}`,
  duration: 20,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: true,
  ...over,
});

// --- Loudness -----------------------------------------------------------

test("K-weighting at 48 kHz matches the coefficients in BS.1770-4", () => {
  const [shelf, hp] = kWeighting(48000);
  // Table 1 and 2 of the standard.
  close(shelf.b[0], 1.53512485958697, 1e-9);
  close(shelf.b[1], -2.69169618940638, 1e-9);
  close(shelf.b[2], 1.19839281085285, 1e-9);
  close(shelf.a[1], -1.69065929318241, 1e-9);
  close(shelf.a[2], 0.73248077421585, 1e-9);
  close(hp.a[1], -1.99004745483398, 1e-9);
  close(hp.a[2], 0.99007225036621, 1e-9);
});

test("integrated loudness of reference tones (stereo-identical, as the export plays a mono mix)", () => {
  // A 1 kHz tone at -20 dBFS on both channels reads -20 LUFS (the -0.691
  // offset cancels K-weighting at 1 kHz); same at the analysis rate.
  for (const rate of [48000, 16000]) {
    close(measureLoudness(sine(rate, 10, 0.1), rate).lufs, -20, 0.1, `${rate} Hz`);
    close(measureLoudness(sine(rate, 10, 0.1), rate, 1).lufs, -23.01, 0.1, `${rate} Hz mono`);
  }
  const r = measureLoudness(sine(16000, 5, 0.5), 16000);
  close(r.peakDb, 20 * Math.log10(0.5), 0.01);
  close(r.duration, 5, 1e-9);
});

test("gating: pauses don't pull speech loudness down, silence has no loudness", () => {
  const rate = 16000;
  // 5 s of tone, 20 s of near-silence, 5 s of tone: the relative gate
  // drops the quiet blocks, so it reads like the tone alone.
  const x = new Float32Array(rate * 30);
  x.set(sine(rate, 5, 0.1), 0);
  x.set(sine(rate, 5, 0.1), rate * 25);
  for (let i = rate * 5; i < rate * 25; i++) x[i] = 1e-5 * Math.sin(i);
  close(measureLoudness(x, rate).lufs, -20, 0.2);
  const silent = measureLoudness(new Float32Array(rate * 3), rate);
  assert.equal(silent.lufs, -Infinity);
  assert.equal(normalizationGain(silent, -16), null);
});

test("normalization gain: reaches the target, caps the boost, and protects peaks", () => {
  // Quiet narration with headroom: straight to the target.
  const quiet = normalizationGain({ lufs: -30, peakDb: -12, duration: 60 }, -16)!;
  assert.equal(quiet.gainDb, 14);
  assert.equal(quiet.short, null);
  // Peaks near full scale: only as far as the limiter is allowed to work.
  const peaky = normalizationGain({ lufs: -30, peakDb: -3, duration: 60 }, -16)!;
  close(peaky.gainDb, LIMIT_CEILING_DB + 3 + LIMITER_ALLOWANCE_DB, 0.06);
  assert.equal(peaky.short, "peaks");
  assert.ok(-3 + peaky.gainDb <= LIMIT_CEILING_DB + LIMITER_ALLOWANCE_DB + 0.05, "limiter takes at most the allowance");
  // Almost silent: capped so the noise floor isn't blown up.
  const faint = normalizationGain({ lufs: -60, peakDb: -40, duration: 60 }, -14)!;
  assert.equal(faint.gainDb, MAX_BOOST_DB);
  assert.equal(faint.short, "boost");
  // Too loud (or clipping already): always turned down to the target.
  const loud = normalizationGain({ lufs: -8, peakDb: 2, duration: 60 }, -16)!;
  assert.equal(loud.gainDb, -8);
  assert.equal(loud.short, null);
  const broadcast = normalizationGain({ lufs: -16, peakDb: -1, duration: 60 }, -23)!;
  assert.equal(broadcast.gainDb, -7);
});

test("measuring an hour of mix is fast enough to run on demand", () => {
  const x = sine(16000, 3600, 0.1, 440);
  const t0 = performance.now();
  measureLoudness(x, 16000);
  const ms = performance.now() - t0;
  assert.ok(ms < 3000, `${ms.toFixed(0)} ms`);
});

// --- Mix model ------------------------------------------------------------

test("the played file: cleaned copy, original when bypassed or when the copy is missing", () => {
  const a = withCleanup(track(), "clean1", 0.5);
  assert.deepEqual(a.clean, { sourceId: "clean1", strength: 0.5, bypass: false });
  assert.equal(playedSourceId(a), "clean1");
  assert.equal(playedSourceId({ ...a, clean: { ...a.clean!, bypass: true } }), "mic");
  assert.equal(playedSourceId(a, { mic: source("mic") }), "mic", "copy not in this project's sources");
  assert.equal(playedSourceId(a, { mic: source("mic"), clean1: source("clean1", { kind: "audio" }) }), "clean1");
  assert.equal(withCleanup(a, null, 0).clean, undefined);
});

test("video-sound track volume and mute multiply every clip; master gain only when a target is on", () => {
  const p = project({ clips: [{ ...newClip("c1", "screen", 0, 5), volume: 1.5 }] });
  assert.equal(clipMixVolume(p, p.clips[0]), 1.5);
  assert.equal(clipMixVolume({ master: { ...DEFAULT_MASTER, videoVolume: 2 } }, p.clips[0]), 3);
  assert.equal(clipMixVolume({ master: { ...DEFAULT_MASTER, videoMuted: true } }, p.clips[0]), 0);
  assert.equal(masterGainDb({ master: { ...DEFAULT_MASTER, gainDb: 6 } }), 0, "off: no gain");
  assert.equal(masterGainDb({ master: { ...DEFAULT_MASTER, loudness: "voice", gainDb: 6 } }), 6);
});

test("a track's gain: volume, fades and ducking, silent when muted or outside it", () => {
  const a = track({ start: 2, duration: 10, volume: 0.8, fadeIn: 1, fadeOut: 2, duck: { amount: 0.5, regions: [[6, 7]] } });
  assert.equal(trackGainAt(a, 1.9), 0);
  close(trackGainAt(a, 2.5), 0.4, 1e-9, "half way into the fade in");
  close(trackGainAt(a, 4), 0.8, 1e-9);
  close(trackGainAt(a, 6.5), 0.4, 1e-9, "ducked by half");
  close(trackGainAt(a, 11), 0.4, 1e-9, "half way out");
  assert.equal(trackGainAt(a, 12), 0);
  assert.equal(trackGainAt({ ...a, muted: true }, 4), 0);
});

test("solo is for listening: toggles, several at once, and forgets deleted tracks", () => {
  let s = toggleSolo(new Set(), "mic1");
  assert.ok(heardWithSolo("mic1", s));
  assert.ok(!heardWithSolo(VIDEO_TRACK, s));
  s = toggleSolo(s, VIDEO_TRACK);
  assert.ok(heardWithSolo(VIDEO_TRACK, s));
  assert.ok(heardWithSolo("anything", new Set()), "no solo: everything heard");
  assert.deepEqual([...liveSolo(s, project({ audio: [] }))], [VIDEO_TRACK]);
  assert.deepEqual([...toggleSolo(s, "mic1")], [VIDEO_TRACK]);
});

test("the mix key changes with what's heard, not with what's seen", () => {
  const p = project({
    audio: [track()],
    overlays: [{ id: "t", kind: "sticker", stickerId: "x", start: 0, end: 2, x: 0.5, y: 0.5, width: 0.2, rotation: 0, opacity: 1, animIn: "none", animOut: "none", hidden: false, locked: false }],
  });
  const k = mixKey(p);
  assert.equal(mixKey({ ...p, overlays: [{ ...p.overlays[0], x: 0.1 }] }), k, "moving a sticker");
  assert.equal(mixKey({ ...p, canvas: { ...p.canvas, aspect: "9:16" } }), k, "canvas size");
  assert.notEqual(mixKey({ ...p, audio: [track({ volume: 0.5 })] }), k, "volume");
  assert.notEqual(mixKey({ ...p, audio: [withCleanup(track(), "c", 0.5)] }), k, "cleaned copy");
  assert.notEqual(mixKey({ ...p, clips: [{ ...p.clips[0], end: 10 }] }), k, "trim");
  assert.notEqual(mixKey({ ...p, master: { ...DEFAULT_MASTER, videoVolume: 0.5 } }), k, "video sound");
  const measured: Project = { ...p, master: { ...DEFAULT_MASTER, loudness: "voice", gainDb: 3, measured: { lufs: -19, peakDb: -6, key: k } } };
  assert.equal(loudnessStale(measured), false);
  assert.equal(loudnessStale({ ...measured, audio: [track({ volume: 1.5 })] }), true);
});

test("meter readings: peak, RMS and the -60..0 dBFS bar", () => {
  const l = meterLevel(sine(48000, 0.1, 0.5));
  close(l.peak, 0.5, 1e-3);
  close(l.rms, 0.5 / Math.SQRT2, 1e-3);
  assert.equal(meterFraction(1), 1);
  assert.equal(meterFraction(0), 0);
  close(meterFraction(0.001), 0, 1e-9, "-60 dBFS");
  close(meterFraction(Math.pow(10, -30 / 20)), 0.5, 1e-9);
  assert.equal(meterFraction(2), 1, "over full scale stays at the end");
});

// --- Sync through edits ---------------------------------------------------

test("ducking follows the speech through ripple cuts and inserts", () => {
  const music = track({ id: "music", sourceId: "song", label: "Music", duck: { amount: 0.7, regions: [[2, 4], [10, 12], [15, 18]] } });
  const p = project({ audio: [music] });
  const cut = rippleCut(p, layout(p, 30), 9, 11);
  assert.ok(cut.ok);
  if (!cut.ok) return;
  const parts = cut.project.audio.filter((a) => a.sourceId === "song");
  // Every part carries the moved regions: before the cut unchanged, the
  // one across the cut trimmed to its edge, later ones 2 s earlier.
  for (const a of parts) assert.deepEqual(a.duck!.regions, [[2, 4], [9, 10], [13, 16]]);
  // The music itself plays on from the right moment of its file.
  const after = parts.find((a) => a.start === 9)!;
  assert.equal(after.offset, 11);

  const ins = rippleInsert(p, layout(p, 30), 3, [newClip("take", "retake", 0, 5)], 5);
  assert.ok(ins.ok);
  if (!ins.ok) return;
  assert.deepEqual(ins.project.audio[0].duck!.regions, [[2, 3], [8, 9], [15, 17], [20, 23]]);
});

test("a cleaned microphone keeps its copy on both sides of a cut, still in sync", () => {
  const mic = withCleanup(track(), "clean1", 0.5);
  const p = project({ audio: [mic] });
  const cut = rippleCut(p, layout(p, 30), 5, 8);
  assert.ok(cut.ok);
  if (!cut.ok) return;
  assert.equal(cut.project.audio.length, 2);
  for (const a of cut.project.audio) assert.equal(playedSourceId(a), "clean1");
  // The copy covers the whole file at the same times as the original, so
  // the split's offset applies to it unchanged.
  const [first, second] = cut.project.audio;
  assert.deepEqual([first.start, first.offset, first.duration], [0, 0, 5]);
  assert.deepEqual([second.start, second.offset, second.duration], [5, 8, 12]);
});

test("audio changes are single undo steps that undo and redo exactly", () => {
  const p0 = project({ audio: [track()] });
  let h: HistoryState = { past: [], present: p0, future: [], gestureBase: null };
  const steps: ((p: Project) => Project)[] = [
    (p) => ({ ...p, audio: p.audio.map((a) => withCleanup(a, "clean1", 0.8)) }),
    (p) => ({ ...p, audio: p.audio.map((a) => ({ ...a, clean: { ...a.clean!, bypass: true } })) }),
    (p) => ({ ...p, master: { ...DEFAULT_MASTER, loudness: "online", gainDb: 7.5, measured: { lufs: -21.5, peakDb: -9, key: mixKey(p) } } }),
    (p) => ({ ...p, master: { ...p.master!, videoMuted: true } }),
  ];
  const states = [p0];
  for (const fn of steps) {
    h = historyReducer(h, { type: "apply", fn, record: true });
    states.push(h.present);
  }
  for (let i = steps.length - 1; i >= 0; i--) {
    h = historyReducer(h, { type: "undo" });
    assert.deepEqual(h.present, states[i]);
  }
  assert.equal(h.present, p0);
  for (let i = 1; i <= steps.length; i++) {
    h = historyReducer(h, { type: "redo" });
    assert.deepEqual(h.present, states[i]);
  }
});

test("projects without the new fields open as before; saved settings get defaults", () => {
  const old = migrateProject({ clips: [newClip("c", "s", 0, 5)], audio: [track()] });
  assert.equal(old.master, undefined);
  assert.equal(masterGainDb(old), 0);
  const saved = migrateProject({ clips: [newClip("c", "s", 0, 5)], master: { loudness: "voice", gainDb: 4 } });
  assert.deepEqual(saved.master, { ...DEFAULT_MASTER, loudness: "voice", gainDb: 4 });
});

// --- Webcam layouts -------------------------------------------------------

const CANVASES: Record<string, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5, "4:3": 4 / 3 };
const CAMS: Record<string, number> = { "16:9": 16 / 9, "4:3": 4 / 3, "9:16": 9 / 16 };

/** The visible part of a placed webcam, in canvas pixels (height 1000). */
function visible(p: ReturnType<typeof placeWebcam>, W: number, cam: number) {
  const H = 1000;
  const cw = W * H;
  const boxW = p.width * cw;
  const boxH = boxW / cam;
  const m = p.mask ?? { x: 0.5, y: 0.5, w: 1, h: 1 };
  const w = m.w * boxW;
  const h = m.h * boxH;
  const cx = p.x * cw + (m.x - 0.5) * boxW;
  const cy = p.y * H + (m.y - 0.5) * boxH;
  return { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2, w, h, cw, H };
}

test("corner bubbles stay inside every canvas size, the same size relative to it, and circles are round", () => {
  for (const [cn, W] of Object.entries(CANVASES)) {
    for (const [camName, cam] of Object.entries(CAMS)) {
      for (const shape of ["circle", "rounded", "rect"] as const) {
        for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
          const l: CamLayout = { shape, size: "medium", corner };
          const p = placeWebcam(l, W, cam);
          const v = visible(p, W, cam);
          const what = `${cn} canvas, ${camName} cam, ${shape} ${corner}`;
          const short = Math.min(v.cw, v.H);
          const margin = 0.04 * short;
          assert.ok(v.left >= margin - 1e-6 && v.right <= v.cw - margin + 1e-6, `${what}: x ${v.left}..${v.right}`);
          assert.ok(v.top >= margin - 1e-6 && v.bottom <= v.H - margin + 1e-6, `${what}: y ${v.top}..${v.bottom}`);
          // Hugs its corner.
          if (corner.endsWith("left")) close(v.left, margin, 1e-6, what);
          else close(v.right, v.cw - margin, 1e-6, what);
          close(v.h, CAM_SIZES.medium * short, 1e-6, `${what}: height`);
          if (shape === "circle") {
            close(v.w, v.h, 1e-6, `${what}: round`);
            assert.equal(p.mask?.shape, "circle");
          }
          if (shape === "rounded") assert.ok((p.mask?.radius ?? 0) > 0);
          if (shape === "rect") assert.equal(p.mask, null);
          assert.equal(p.screen, null);
        }
      }
    }
  }
});

test("side by side: the webcam fills its slot and the screen fills the rest, on landscape and portrait canvases", () => {
  for (const [cn, W] of Object.entries(CANVASES)) {
    for (const [camName, cam] of Object.entries(CAMS)) {
      const p = placeWebcam({ ...{ shape: "rect", size: "medium", corner: "bottom-right" }, split: true }, W, cam, 16 / 9);
      const v = visible(p, W, cam);
      const what = `${cn} canvas, ${camName} cam`;
      assert.ok(p.screen, what);
      if (W >= 1) {
        // Right third, full height; the screen box spans the left two thirds.
        close(v.left, (v.cw * 2) / 3, 1e-6, what);
        close(v.right, v.cw, 1e-6, what);
        close(v.top, 0, 1e-6, what);
        close(v.bottom, v.H, 1e-6, what);
        close(p.screen!.x * v.cw, v.cw / 3, 1e-6, what);
        close(p.screen!.scale, 2 / 3, 1e-9, what);
      } else {
        // Under the screen, full width, down to the bottom.
        close(v.left, 0, 1e-6, what);
        close(v.right, v.cw, 1e-6, what);
        close(v.bottom, v.H, 1e-6, what);
        const screenH = Math.min(0.65, W / (16 / 9)) * v.H;
        close(v.top, screenH, 1e-6, what);
        close(p.screen!.y * v.H, screenH / 2, 1e-6, what);
      }
      assert.ok(p.width <= 3, "within the export's layer width limit");
    }
  }
});

test("rounded corners: the mask is clear inside and cut at the corners", () => {
  const sharp = { shape: "rect" as const, x: 0.5, y: 0.5, w: 1, h: 1, rotation: 0, feather: 0.02, invert: false };
  const round = { ...sharp, radius: 0.35 };
  const [w, h] = [400, 225];
  assert.equal(coverage(round, 200, 112, w, h), 1, "centre");
  assert.ok(coverage(sharp, 3, 3, w, h) > 0.9, "a square corner shows");
  assert.equal(coverage(round, 3, 3, w, h), 0, "a rounded corner is cut");
  assert.ok(coverage(round, 200, 3, w, h) > 0.9, "the edge's middle still shows");
});

test("layouts are placed again when the canvas changes, and only then", () => {
  const cam: Overlay = { id: "cam", kind: "video", sourceId: "webcam", offset: 0, volume: 0, start: 0, end: 20, x: 0.8, y: 0.8, width: 0.25, rotation: 0, opacity: 1, animIn: "none", animOut: "none", hidden: false, locked: false };
  const sources = { screen: source("screen"), webcam: source("webcam", { width: 1280, height: 720, kind: "layer" }) };
  const l: CamLayout = { shape: "circle", size: "large", corner: "bottom-left" };
  const placed = applyCamLayout(cam as Overlay & { kind: "video" }, l, 16 / 9, 16 / 9);
  const p = project({ overlays: [placed] });
  assert.equal(relayoutWebcams(p, sources, 16 / 9), p, "unchanged canvas: same project");
  const vertical = relayoutWebcams(p, sources, 9 / 16);
  assert.notEqual(vertical, p);
  const o = vertical.overlays[0] as Overlay & { kind: "video" };
  const v = visible({ ...placeWebcam(l, 9 / 16, 16 / 9), x: o.x, y: o.y, width: o.width, mask: o.mask ?? null }, 9 / 16, 16 / 9);
  assert.ok(v.left >= 0 && v.right <= v.cw && v.bottom <= v.H, "inside the vertical canvas");
  // A missing webcam file leaves the layer alone instead of failing.
  assert.equal(relayoutWebcams(p, { screen: sources.screen }, 9 / 16), p);
  // Split moves the screen; leaving it puts the clips back.
  const split = relayoutWebcams(project({ overlays: [{ ...placed, camLayout: { ...l, split: true } }] }), sources, 16 / 9);
  close(split.clips[0].transform.scale, 2 / 3, 1e-9);
  assert.equal(screenForLayout(split.clips, null)[0].transform.scale, 1);
});
