// Run with: npm run desktop:test:js
import assert from "node:assert/strict";
import { test } from "node:test";
import { ClockSync, RecordingClock, formatDuration } from "../../src/lib/recorder/clock.ts";
import { captureToRegion, captureToVideo, desktopToCapture, matchDisplay, normalizeRegion, regionPixels } from "../../src/lib/recorder/coords.ts";
import { EventCollector, type RawInputEvent } from "../../src/lib/recorder/events.ts";
import {
  DEFAULT_INPUT_SETTINGS,
  RECORDING_FORMAT,
  RecordingFormatError,
  decodeEvent,
  decodeEvents,
  encodeEvent,
  encodeHeader,
  parseManifest,
  serializeManifest,
  type DisplayInfo,
  type InteractionEvent,
  type RecordingManifest,
} from "../../src/lib/recorder/format.ts";
import { planRecordingProject, type ImportedTrack } from "../../src/lib/recorder/importPlan.ts";
import { ChunkWriter } from "../../src/lib/recorder/writer.ts";

// --- clock -------------------------------------------------------------------

test("recording time excludes pauses", () => {
  const c = new RecordingClock();
  c.start(1000);
  assert.equal(c.toRecordingTime(1500), 500);
  assert.equal(c.pause(3000), 2000);
  assert.equal(c.state, "paused");
  assert.equal(c.toRecordingTime(4000), null, "events while paused get no time");
  assert.equal(c.resume(6000), 2000);
  assert.equal(c.toRecordingTime(6000), 2000);
  assert.equal(c.toRecordingTime(7000), 3000);
  assert.equal(c.elapsed(7500), 3500);
  assert.deepEqual(c.pauses(), [{ atMs: 2000, durationMs: 3000 }]);
  assert.equal(c.stop(8000), 4000);
  assert.equal(c.toRecordingTime(9000), null, "after stop");
  assert.equal(c.toRecordingTime(500), null, "before start");
  assert.equal(c.elapsed(20000), 4000, "frozen after stop");
});

test("several pauses accumulate, stop while paused keeps the pause point", () => {
  const c = new RecordingClock();
  c.start(0);
  c.pause(100);
  c.resume(200);
  c.pause(300);
  c.resume(1300);
  assert.equal(c.toRecordingTime(1400), 300);
  c.pause(1500);
  assert.equal(c.stop(5000), 400);
  assert.deepEqual(c.pauses(), [
    { atMs: 100, durationMs: 100 },
    { atMs: 200, durationMs: 1000 },
  ]);
});

test("clock misuse throws", () => {
  const c = new RecordingClock();
  assert.throws(() => c.pause(0));
  c.start(0);
  assert.throws(() => c.start(1));
  assert.throws(() => c.resume(1));
});

test("clock sync uses the fastest round trip", () => {
  const sync = new ClockSync([
    { sentHost: 100, monitorUs: 60_000, receivedHost: 140 }, // slow, ignored
    { sentHost: 200, monitorUs: 150_500, receivedHost: 201 },
  ]);
  assert.equal(sync.offsetMs, 50);
  assert.equal(sync.uncertaintyMs, 0.5);
  assert.equal(sync.toHost(1_000_000), 1050);
});

test("duration formatting", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65_400), "1:05");
  assert.equal(formatDuration(3_723_000), "1:02:03");
});

// --- coordinates ---------------------------------------------------------------

const display = (id: string, x: number, y: number, w: number, h: number, scale = 1): DisplayInfo => ({
  id,
  name: id,
  bounds: { x, y, width: w, height: h },
  scaleFactor: scale,
  primary: x === 0 && y === 0,
});

test("desktop to capture space, including a secondary display left of the primary", () => {
  const second = { x: -1920, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(desktopToCapture({ x: -960, y: 540 }, second), { x: 0.5, y: 0.5 });
  assert.deepEqual(desktopToCapture({ x: 0, y: 0 }, second), { x: 1, y: 0 });
  assert.deepEqual(desktopToCapture({ x: 100, y: 0 }, second).x > 1, true, "pointer on another display is outside 0..1");
});

test("region and video mapping", () => {
  const region = { x: 0.25, y: 0.5, width: 0.5, height: 0.25 };
  assert.deepEqual(captureToRegion({ x: 0.5, y: 0.625 }, region), { x: 0.5, y: 0.5 });
  assert.deepEqual(captureToRegion({ x: 0.3, y: 0.3 }, null), { x: 0.3, y: 0.3 });
  assert.deepEqual(captureToVideo({ x: 0.5, y: 0.25 }, { width: 2560, height: 1440 }), { x: 1280, y: 360 });
  assert.deepEqual(regionPixels(region, { width: 1921, height: 1081 }), { width: 960, height: 270 });
});

test("dragged regions are normalized and clamped", () => {
  assert.deepEqual(normalizeRegion({ x: 0.8, y: 0.9 }, { x: 0.2, y: -0.1 }), { x: 0.2, y: 0, width: 0.6, height: 0.9 });
  assert.equal(normalizeRegion({ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.9 }), null, "too thin");
});

test("display matching by native capture size", () => {
  const displays = [display("a", 0, 0, 2560, 1440), display("b", 2560, 0, 1920, 1080)];
  assert.equal(matchDisplay(displays, { width: 1920, height: 1080 }, "physical-pixels").display?.id, "b");
  // Retina display in points: 1512x982 points at 2x = 3024x1964 physical.
  const mac = [display("builtin", 0, 0, 1512, 982, 2), display("ext", 1512, 0, 1920, 1080, 1)];
  assert.equal(matchDisplay(mac, { width: 3024, height: 1964 }, "points").display?.id, "builtin");
  // Two identical monitors: can't tell, the user has to pick.
  const twins = [display("l", 0, 0, 1920, 1080), display("r", 1920, 0, 1920, 1080)];
  const m = matchDisplay(twins, { width: 1920, height: 1080 }, "physical-pixels");
  assert.equal(m.display, null);
  assert.equal(m.candidates.length, 2);
  // Downscaled capture of the only display: same aspect ratio.
  assert.equal(matchDisplay([display("only", 0, 0, 3840, 2160)], { width: 1920, height: 1080 }, "physical-pixels").display?.id, "only");
});

// --- events --------------------------------------------------------------------

test("event lines round-trip", () => {
  const events: InteractionEvent[] = [
    { type: "move", t: 16.66, x: 0.123456789, y: 0.5 },
    { type: "button", t: 20, button: "right", down: true, x: 0.1, y: 0.2 },
    { type: "scroll", t: 21, dx: 0, dy: -3, x: 0.1, y: 0.2 },
    { type: "key", t: 22, combo: "Ctrl+Shift+S" },
    { type: "marker", t: 23, id: "m1", label: "Intro" },
    { type: "window", t: 24, app: "Code", title: null, rect: { x: 0, y: 0, width: 0.5, height: 1 } },
    { type: "pause", t: 25 },
    { type: "resume", t: 25 },
    { type: "surface", t: 26, width: 1280, height: 720 },
  ];
  for (const e of events) {
    const back = decodeEvent(encodeEvent(e));
    if (e.type === "move") assert.deepEqual(back, { ...e, t: 16.7, x: 0.12346 });
    else assert.deepEqual(back, e);
  }
  assert.equal(encodeEvent(events[0]), '["m",16.7,0.12346,0.5]', "compact array form");
});

test("events file tolerates truncation, unknown types, and sorts", () => {
  const text = [
    encodeHeader({ recordingId: "r1", coordinateSpace: "capture" }),
    encodeEvent({ type: "move", t: 50, x: 0.5, y: 0.5 }),
    encodeEvent({ type: "move", t: 10, x: 0.1, y: 0.1 }),
    '["zz",30,"future event type"]',
    '["m",60,0.5', // app closed mid-write
    "",
  ].join("\n");
  const { header, events, skipped } = decodeEvents(text);
  assert.equal(header?.recordingId, "r1");
  assert.deepEqual(
    events.map((e) => e.t),
    [10, 50]
  );
  assert.equal(skipped, 2);
  assert.throws(() => decodeEvents(JSON.stringify({ format: "wipeclip.events", version: 99 })), RecordingFormatError);
});

function collector(surface = { x: -1920, y: 0, width: 1920, height: 1080 }, settings = DEFAULT_INPUT_SETTINGS) {
  const clock = new RecordingClock();
  // Monitor clock started 1000 ms before host time 0.
  const sync = new ClockSync([{ sentHost: 0, monitorUs: 1_000_000, receivedHost: 0 }]);
  return { clock, c: new EventCollector({ clock, sync, surface, settings }) };
}

const us = (hostMs: number) => (hostMs + 1000) * 1000;

test("collector maps time and coordinates, drops paused events, restates pointer on resume", () => {
  const { clock, c } = collector();
  clock.start(100);
  const batch: RawInputEvent[] = [
    { k: "move", t: us(150), x: -960, y: 540 },
    { k: "move", t: us(50), x: -1920, y: 0 }, // before start: dropped
    { k: "button", t: us(200), button: "left", down: true, x: -960, y: 540 },
  ];
  assert.deepEqual(c.ingest(batch), [
    { type: "move", t: 50, x: 0.5, y: 0.5 },
    { type: "button", t: 100, button: "left", down: true, x: 0.5, y: 0.5 },
  ]);
  assert.deepEqual(c.pause(1100), [{ type: "pause", t: 1000 }]);
  // Moved while paused: not recorded, but remembered.
  assert.deepEqual(c.ingest([{ k: "move", t: us(1500), x: 0, y: 1080 }]), []);
  assert.deepEqual(c.resume(2100), [
    { type: "resume", t: 1000 },
    { type: "move", t: 1000, x: 1, y: 1 },
  ]);
  assert.deepEqual(c.ingest([{ k: "scroll", t: us(2200), dx: 0, dy: 2, x: -1920, y: 0 }]), [
    { type: "scroll", t: 1100, dx: 0, dy: 2, x: 0, y: 0 },
  ]);
  assert.equal(c.count, 5);
});

test("collector honours privacy settings", () => {
  const { clock, c } = collector(undefined, { ...DEFAULT_INPUT_SETTINGS, keyboard: "off", activeWindow: true, windowTitles: false });
  clock.start(0);
  const out = c.ingest([
    { k: "key", t: us(10), combo: "Ctrl+C" },
    { k: "window", t: us(20), app: "Mail", title: "Re: salary", bounds: { x: -1920, y: 0, width: 960, height: 1080 } },
  ]);
  assert.deepEqual(out, [{ type: "window", t: 20, app: "Mail", title: null, rect: { x: 0, y: 0, width: 0.5, height: 1 } }]);
});

test("collector keeps desktop coordinates when the surface is unknown", () => {
  const { clock, c } = collector(null as never);
  clock.start(0);
  assert.deepEqual(c.ingest([{ k: "move", t: us(5), x: 812, y: -40 }]), [{ type: "move", t: 5, x: 812, y: -40 }]);
});

// --- manifest ------------------------------------------------------------------

function manifest(over: Partial<RecordingManifest> = {}): RecordingManifest {
  return parseManifest({
    format: RECORDING_FORMAT,
    version: 1,
    id: "rec-1",
    createdAt: "2026-10-11T10:00:00.000Z",
    status: "complete",
    durationMs: 10_000,
    capture: {
      surface: "monitor",
      display: display("a", 0, 0, 1920, 1080),
      desktopUnit: "physical-pixels",
      region: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
      video: { width: 1920, height: 1080, frameRate: 30 },
      requested: { width: null, height: null, frameRate: 30 },
      coordinateSpace: "capture",
    },
    tracks: [
      { kind: "screen", path: "screen.mp4", mimeType: "video/mp4", startOffsetMs: 0, durationMs: 10_000, bytes: 1, hasVideo: true, hasAudio: false },
      { kind: "microphone", path: "microphone.m4a", mimeType: "audio/mp4", startOffsetMs: 40, durationMs: 9_960, bytes: 1, hasVideo: false, hasAudio: true },
      { kind: "webcam", path: "webcam.mp4", mimeType: "video/mp4", startOffsetMs: -20, durationMs: 10_020, bytes: 1, hasVideo: true, hasAudio: false },
    ],
    input: { path: "events.jsonl", settings: DEFAULT_INPUT_SETTINGS, eventCount: 3, droppedEvents: 0 },
    ...over,
  });
}

test("manifest round-trips and fills defaults for older files", () => {
  const m = manifest();
  assert.deepEqual(parseManifest(serializeManifest(m)), m);
  assert.equal(m.input.permissions.keyboard, "unknown");
  assert.deepEqual(m.markers, []);
  const minimal = parseManifest({ format: RECORDING_FORMAT, version: 1, tracks: [] });
  assert.equal(minimal.status, "recording", "unknown status = not finalized");
  assert.equal(minimal.capture.coordinateSpace, "desktop");
});

test("manifest rejects foreign, newer, damaged and path-escaping files", () => {
  assert.throws(() => parseManifest({ format: "other" }), RecordingFormatError);
  assert.throws(() => parseManifest({ format: RECORDING_FORMAT, version: 2 }), /newer version/);
  assert.throws(() => parseManifest("{not json"), /not valid JSON/);
  for (const path of ["../secret.mp4", "C:\\Windows\\x.mp4", "/etc/passwd", "a/../../b.mp4"]) {
    assert.throws(
      () => manifest({ tracks: [{ kind: "screen", path, mimeType: "", startOffsetMs: 0, durationMs: 0, bytes: 0, hasVideo: true, hasAudio: false }] }),
      /invalid media path/,
      path
    );
  }
});

// --- import ----------------------------------------------------------------------

test("recording import keeps tracks separate and in sync", () => {
  const m = manifest();
  let n = 0;
  const ids = () => `id${++n}`;
  const tracks: ImportedTrack[] = [
    { track: m.tracks[0], sourceId: "screen", duration: 10, width: 1920, height: 1080 },
    { track: m.tracks[1], sourceId: "mic", duration: 9.96, width: 0, height: 0 },
    { track: m.tracks[2], sourceId: "cam", duration: 10.02, width: 1280, height: 720 },
  ];
  const { project, skipped } = planRecordingProject(m, tracks, ids);
  assert.deepEqual(skipped, []);
  assert.equal(project.clips.length, 1);
  assert.deepEqual(project.clips[0].crop, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, "region becomes an editable crop");
  assert.equal(project.clips[0].sourceId, "screen");
  assert.equal(project.clips[0].end, 10);
  const mic = project.audio[0];
  assert.equal(mic.sourceId, "mic");
  assert.equal(mic.start, 0.04, "starts 40 ms in");
  assert.equal(mic.offset, 0);
  assert.ok(Math.abs(mic.duration - 9.96) < 1e-9);
  const cam = project.overlays[0];
  assert.equal(cam.kind, "video");
  if (cam.kind === "video") {
    assert.equal(cam.start, 0);
    assert.equal(cam.offset, 0.02, "started 20 ms early: trimmed to line up");
    assert.equal(cam.volume, 0);
    assert.ok(cam.end <= 10);
  }
});

test("recording import fails clearly without a screen track and skips empty tracks", () => {
  const m = manifest();
  assert.throws(() => planRecordingProject(m, [], () => "x"), /no screen video/);
  const { skipped, project } = planRecordingProject(
    m,
    [
      { track: m.tracks[0], sourceId: "s", duration: 5, width: 1920, height: 1080 },
      { track: m.tracks[1], sourceId: "m", duration: 0, width: 0, height: 0 },
    ],
    () => "x"
  );
  assert.equal(project.audio.length, 0);
  assert.deepEqual(skipped, [{ kind: "microphone", reason: "too short to place on the timeline" }]);
});

// --- writer ----------------------------------------------------------------------

test("chunk writer keeps order and stops at the first failure", async () => {
  const written: number[] = [];
  const errors: Error[] = [];
  let calls = 0;
  const w = new ChunkWriter(
    async (bytes) => {
      calls++;
      await new Promise((r) => setTimeout(r, bytes[0] === 1 ? 20 : 0)); // first write slowest
      if (bytes[0] === 3) throw new Error("disk full");
      written.push(bytes[0]);
    },
    (e) => errors.push(e)
  );
  w.push(new Uint8Array([1, 1]));
  w.push(new Uint8Array([2]));
  w.push(new Uint8Array([])); // ignored
  w.push(new Uint8Array([3]));
  w.push(new Uint8Array([4]));
  await w.flush();
  assert.deepEqual(written, [1, 2]);
  assert.equal(w.bytes, 3);
  assert.equal(w.error?.message, "disk full");
  assert.equal(errors.length, 1);
  assert.equal(calls, 3, "nothing written after the failure");
  assert.equal(w.backlog, 0);
  w.push(new Uint8Array([5]));
  await w.flush();
  assert.equal(calls, 3);
});

// --- mime ------------------------------------------------------------------------

test("MP4 preferred, WebM fallback, null when nothing records", async () => {
  const { pickMimeType, fileTypeFor } = await import("../../src/lib/recorder/mime.ts");
  const chromium = (t: string) => t.startsWith("video/mp4") || t.startsWith("video/webm") || t.startsWith("audio/webm") || t === "audio/mp4";
  assert.deepEqual(pickMimeType("screen", chromium), { mimeType: "video/mp4;codecs=avc1.640033", file: "screen.mp4" });
  assert.deepEqual(pickMimeType("microphone", chromium), { mimeType: "audio/mp4", file: "microphone.m4a" });
  const oldWebView = (t: string) => t.includes("webm");
  assert.deepEqual(pickMimeType("webcam", oldWebView), { mimeType: "video/webm;codecs=vp9", file: "webcam.webm" });
  assert.deepEqual(pickMimeType("system-audio", oldWebView), { mimeType: "audio/webm;codecs=opus", file: "system-audio.webm" });
  assert.equal(pickMimeType("screen", () => false), null);
  assert.equal(fileTypeFor("audio/webm;codecs=opus"), "audio/webm");
});

// --- timing from the files themselves (real WebView2 measurement) ------------------

test("alignment uses decoded lengths: start-event lag shifts events, audio is end-aligned", async () => {
  const { alignRecording } = await import("../../src/lib/recorder/importPlan.ts");
  // Numbers from a real 68 s recording in the desktop app on Windows: the
  // clock (anchored to the screen recorder's late start event) measured
  // 68.223 s and the audio tracks reported starting 0.357 s earlier, but the
  // decoded files are 68.60 s (screen) and 68.59 s (audio).
  const m = manifest({ durationMs: 68_223 });
  const tracks: ImportedTrack[] = [
    { track: { ...m.tracks[0], durationMs: 68_223 }, sourceId: "screen", duration: 68.6, width: 1920, height: 1080 },
    { track: { ...m.tracks[1], startOffsetMs: -357, durationMs: 68_223 }, sourceId: "mic", duration: 68.59, width: 0, height: 0 },
  ];
  const { tracks: out, lagMs } = alignRecording(m, tracks);
  assert.equal(lagMs, 377, "events move 0.377 s later");
  assert.equal(out[1].track.startOffsetMs, 10, "microphone starts with the screen, not 0.357 s before it");
  // Nothing to correct: same lengths, tiny lag.
  const clean = alignRecording(manifest({ durationMs: 10_000 }), [
    { track: m.tracks[0], sourceId: "s", duration: 10.01, width: 1, height: 1 },
    { track: m.tracks[1], sourceId: "a", duration: 10.01, width: 0, height: 0 },
  ]);
  assert.equal(clean.lagMs, 0);
  assert.equal(clean.tracks[1].track.startOffsetMs, 0);
  // A track that ended early (unplugged) keeps its recorded offset.
  const early = alignRecording(m, [tracks[0], { ...tracks[1], track: { ...tracks[1].track, endedEarly: true }, duration: 30 }]);
  assert.equal(early.tracks[1].track.startOffsetMs, -357);
});

test("typing events carry only the text cursor, never a key, and don't move the pointer", () => {
  const { clock, c } = collector();
  clock.start(0);
  const out = c.ingest([
    { k: "move", t: us(5), x: -960, y: 540 },
    { k: "typing", t: us(10), caret: { x: -1920, y: 540, width: 2, height: 20 } },
    { k: "typing", t: us(20), caret: null },
  ]);
  const typed = out[1];
  assert.ok(typed.type === "typing" && typed.t === 10 && typed.caret, "caret mapped to capture space");
  for (const [k, v] of [["x", 1 / 1920], ["y", 550 / 1080], ["h", 20 / 1080]] as const) assert.ok(Math.abs(typed.caret[k] - v) < 1e-5, k);
  assert.deepEqual(Object.keys(typed).sort(), ["caret", "t", "type"], "nothing about the key");
  assert.deepEqual(out[2], { type: "typing", t: 20, caret: null });
  // Round trip (5 decimals); no caret stays compact.
  const back = decodeEvent(encodeEvent(out[1]));
  assert.ok(back?.type === "typing" && back.caret && Math.abs(back.caret.y - 550 / 1080) < 1e-5 && Math.abs(back.caret.h - 20 / 1080) < 1e-5);
  assert.deepEqual(decodeEvent(encodeEvent(out[2])), out[2]);
  assert.equal(encodeEvent(out[2]), '["i",20]');
  // Off: nothing stored.
  const off = collector(undefined, { ...DEFAULT_INPUT_SETTINGS, typing: false });
  off.clock.start(0);
  assert.deepEqual(off.c.ingest([{ k: "typing", t: us(10), caret: null }]), []);
});
