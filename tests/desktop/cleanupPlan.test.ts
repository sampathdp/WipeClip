// Run with: npm run desktop:test:js
// Clean up audio's plan (src/lib/editor/cleanupPlan.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CLEANUP_GROUPS, CLEANUP_OPTIONS, DEFAULT_CLEANUP, autoCleanupOptions, cleanupSummary, voiceTracks } from "../../src/lib/editor/cleanupPlan.ts";
import type { AudioClip, MediaSource } from "../../src/lib/editor/types.ts";

const src = (id: string, over: Partial<MediaSource> = {}): MediaSource => ({ id, kind: "audio", url: "", duration: 10, width: 0, height: 0, fps: 0, hasAudio: true, ...over }) as MediaSource;
const track = (id: string, sourceId: string, over: Partial<AudioClip> = {}): AudioClip => ({
  id,
  sourceId,
  label: id,
  start: 0,
  offset: 0,
  duration: 5,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  muted: false,
  ...over,
});

test("every option is in a group, ids are unique, defaults are real options", () => {
  const ids = CLEANUP_OPTIONS.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const o of CLEANUP_OPTIONS) assert.ok(CLEANUP_GROUPS.some((g) => g.id === o.group), o.id);
  for (const d of DEFAULT_CLEANUP) assert.ok(ids.includes(d), d);
  assert.ok(!DEFAULT_CLEANUP.includes("stutters"), "a repeat can be deliberate: off by default");
  assert.ok(!DEFAULT_CLEANUP.includes("background"), "slow, and a download: off by default");
  assert.ok(!DEFAULT_CLEANUP.includes("echo"), "colors a dry recording a little: off by default");
  assert.deepEqual(
    CLEANUP_OPTIONS.filter((o) => o.engine).map((o) => o.id),
    ["noise", "clipping", "mouth", "wind", "echo", "background"]
  );
});

test("voice tracks: microphones, video sound and voice tracks; not music, computer sound or muted", () => {
  const sources: Record<string, MediaSource> = {
    mic: src("mic", { recording: { trackKind: "microphone" } as never }),
    sys: src("sys", { recording: { trackKind: "system-audio" } as never }),
    vid: src("vid", { kind: "original" }),
    song: src("song"),
    vo: src("vo"),
  };
  const audio = [
    track("mic1", "mic"),
    track("mic2", "mic", { start: 6 }),
    track("system", "sys"),
    track("fromVideo", "vid"),
    track("music", "song", { beats: { bpm: 120, times: [] } }),
    track("ducked", "song", { duck: { amount: 0.7, regions: [] } }),
    track("markedMusic", "vo", { captions: "music" }),
    track("voiceover", "vo"),
    track("muted", "mic", { muted: true }),
    track("missing", "nope"),
  ];
  assert.deepEqual(
    voiceTracks(audio, sources).map((a) => a.id),
    ["mic1", "mic2", "fromVideo", "voiceover"]
  );
});

test("the editing step gets exactly the chosen edits", () => {
  assert.deepEqual(autoCleanupOptions(new Set(["breaths", "hesitations", "noise"])), {
    silences: false,
    hesitations: true,
    fillers: false,
    stutters: false,
    breaths: true,
  });
});

test("the summary says what was done and what's left to review", () => {
  const s = cleanupSummary({
    cleaned: ["noise removed", "mouth sounds removed"],
    studio: true,
    lufs: -16,
    edit: { removed: 7.25, silences: 3, hesitations: 4, fillers: 1, stutters: 0, breaths: 12, toReview: 2, notes: [] },
  });
  assert.equal(
    s,
    "Cleaned up: noise removed, mouth sounds removed; studio sound; 12 breaths turned down; cut 3 long silences, 4 hesitations, 1 filler word (7.3 s); the mix set to -16 LUFS. 2 less certain cuts are waiting in Review. Undo takes it back one step at a time."
  );
  assert.match(cleanupSummary({ cleaned: [], studio: false, lufs: null, edit: null }), /^Nothing needed changing\./);
});
