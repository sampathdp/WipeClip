// Run with: npm run desktop:test:js
// Layers following the main video row (src/lib/editor/follow.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { followClips, onlyClipsChanged } from "../../src/lib/editor/follow.ts";
import { deleteClip, insertFreezeAt, layout, moveClip, splitAt, updateClip } from "../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, newClip, type AudioClip, type Overlay, type Project } from "../../src/lib/editor/types.ts";

const FPS = 30;

const text = (id: string, start: number, end: number, extra: Partial<Overlay> = {}): Overlay =>
  ({
    id,
    kind: "text",
    start,
    end,
    x: 0.5,
    y: 0.5,
    width: 0.5,
    rotation: 0,
    opacity: 1,
    animIn: "none",
    animOut: "none",
    hidden: false,
    locked: false,
    text: {} as never,
    ...extra,
  }) as Overlay;

const audio = (id: string, start: number, duration: number, offset = 0): AudioClip => ({
  id,
  sourceId: "mic",
  label: id,
  start,
  offset,
  duration,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  muted: false,
});

/** Clips A (source 0-4) and B (source 10-16): A plays 0-4, B 4-10. */
function base(): Project {
  return {
    clips: [newClip("A", "s", 0, 4), newClip("B", "s", 10, 16)],
    overlays: [text("onA", 1, 2), text("onB", 5, 6), text("tailA", 3.5, 3.9)],
    audio: [audio("music", 0, 10), audio("voiceB", 6, 2, 30)],
    effects: [{ id: "fx", type: "blur", start: 4.5, end: 5.5, intensity: 50 }],
    masks: [],
    suggestions: [],
    chapters: [{ id: "c1", t: 5, title: "B", auto: false }],
    transcript: { language: "en", total: 10, words: [{ start: 1, end: 1.5, text: "a" }, { start: 5, end: 5.5, text: "b" }] },
    canvas: DEFAULT_CANVAS,
  };
}

function follow(p: Project, next: Project): Project {
  return followClips(p, next, layout(p, FPS), layout(next, FPS));
}

const ov = (p: Project, id: string) => p.overlays.find((o) => o.id === id);
const au = (p: Project, id: string) => p.audio.find((a) => a.id === id);
const close = (a: number | undefined, b: number, msg?: string) => assert.ok(a !== undefined && Math.abs(a - b) < 0.02, `${msg ?? ""} ${a} != ${b}`);

test("trimming a clip's end pulls later layers back and drops ones on the removed part", () => {
  const p = base();
  const out = follow(p, updateClip(p, "A", { end: 3 }));
  close(ov(out, "onA")?.start, 1);
  close(ov(out, "onB")?.start, 4, "onB start");
  close(ov(out, "onB")?.end, 5);
  assert.equal(ov(out, "tailA"), undefined);
  close(au(out, "voiceB")?.start, 5);
  assert.equal(au(out, "voiceB")?.offset, 30);
  // Music spans both clips: same start, same length.
  close(au(out, "music")?.start, 0);
  close(au(out, "music")?.duration, 10);
  close(out.effects[0].start, 3.5);
  close(out.chapters?.[0].t, 4);
  close(out.transcript?.words[1].start, 4);
  close(out.transcript?.total, 9);
});

test("trimming a clip's start keeps layers on the same footage", () => {
  const p = base();
  const out = follow(p, updateClip(p, "A", { start: 1.5 }));
  // onA was 1-2 s into A: 1.5 is trimmed away, so it keeps 1.5-2 at the new start.
  close(ov(out, "onA")?.start, 0);
  close(ov(out, "onA")?.end, 0.5);
  close(ov(out, "onB")?.start, 3.5);
  // The music spans the trim: it starts at the same place, 1.5 s later in its file.
  close(au(out, "music")?.start, 0);
  close(au(out, "music")?.offset, 1.5);
  close(au(out, "music")?.duration, 8.5);
});

test("moving a clip carries its layers; spanning ones stay", () => {
  const p = base();
  const out = follow(p, moveClip(p, 1, 0)); // B first: B 0-6, A 6-10
  close(ov(out, "onB")?.start, 1);
  close(ov(out, "onA")?.start, 7);
  close(au(out, "voiceB")?.start, 2);
  close(au(out, "music")?.start, 0);
  close(au(out, "music")?.duration, 10);
  close(out.transcript?.words.find((w) => w.text === "b")?.start, 1);
});

test("deleting a clip removes its layers and pulls the rest back", () => {
  const p = base();
  const out = follow(p, deleteClip(p, "A")!);
  assert.equal(ov(out, "onA"), undefined);
  assert.equal(ov(out, "tailA"), undefined);
  close(ov(out, "onB")?.start, 1);
  close(au(out, "voiceB")?.start, 2);
  // Music started in the deleted clip: it starts where B now starts, 4 s into its file.
  close(au(out, "music")?.start, 0);
  close(au(out, "music")?.offset, 4);
  close(au(out, "music")?.duration, 6);
  assert.equal(out.transcript?.words.length, 1);
});

test("splitting changes nothing", () => {
  const p = base();
  const next = splitAt(p, layout(p, FPS), 2)!;
  const out = follow(p, next);
  assert.equal(out.overlays, p.overlays);
  assert.equal(out.audio, p.audio);
  assert.equal(out.effects, p.effects);
});

test("layers on the later part of a split clip follow it when it's moved", () => {
  const p = base();
  const split = { ...splitAt(p, layout(p, FPS), 7)!, overlays: [...p.overlays, text("onB2", 8, 9)] };
  // Clips: A 0-4, B(10-13) 4-7, B'(13-16) 7-10. Move B' to the front: B' 0-3, A 3-7, B 7-10.
  const out = follow(split, moveClip(split, 2, 0));
  close(ov(out, "onB2")?.start, 1);
  close(ov(out, "onB")?.start, 8);
  // voiceB (6-8) crosses the split: it spans two clips, so it stays.
  close(au(out, "voiceB")?.start, 6);
});

test("a speed change stretches attached layers with the footage", () => {
  const p = base();
  const out = follow(p, updateClip(p, "B", { speed: 2 })); // B now 4-7
  close(ov(out, "onB")?.start, 4.5);
  close(ov(out, "onB")?.end, 5);
  // Voice keeps playing at its own pace: same length.
  close(au(out, "voiceB")?.start, 5);
  close(au(out, "voiceB")?.duration, 2);
});

test("a freeze frame pushes later layers back", () => {
  const p = base();
  const out = follow(p, insertFreezeAt(p, layout(p, FPS), 5)!.project);
  close(ov(out, "onA")?.start, 1);
  // onB starts on the frozen moment: it stays on its footage, after the still.
  close(ov(out, "onB")?.start, 8);
  close(ov(out, "onB")?.end, 9);
  // The voice part after the freeze moves with its picture.
  close(au(out, "voiceB")?.start, 9);
});

test("locked layers stay where they are", () => {
  const p = { ...base(), overlays: [text("pinned", 5, 6, { locked: true })] };
  const out = follow(p, deleteClip(p, "A")!);
  close(ov(out, "pinned")?.start, 5);
});

test("caption word timings are placed again", () => {
  const p = { ...base(), overlays: [text("cap", 1, 3, { caption: true, words: [{ start: 0, end: 0.5 }, { start: 1, end: 1.5 }] })] };
  const out = follow(p, updateClip(p, "A", { start: 1.5 }));
  const cap = ov(out, "cap")!;
  close(cap.start, 0);
  close(cap.end, 1.5);
  // The first word (1-1.5) was trimmed away with the footage; the second is 0.5 s in.
  assert.equal(cap.words, undefined);
  const p2 = { ...base(), overlays: [text("cap", 5, 7, { caption: true, words: [{ start: 0, end: 0.5 }, { start: 1, end: 1.5 }] })] };
  const out2 = follow(p2, moveClip(p2, 1, 0));
  assert.deepEqual(ov(out2, "cap")!.words, [
    { start: 0, end: 0.5 },
    { start: 1, end: 1.5 },
  ]);
});

test("a look change moves nothing", () => {
  const p = base();
  const next = updateClip(p, "A", { volume: 0.5 });
  const out = follow(p, next);
  assert.equal(out.overlays, p.overlays);
  assert.equal(out.audio, p.audio);
  assert.equal(out.chapters, p.chapters);
});

test("onlyClipsChanged", () => {
  const p = base();
  assert.equal(onlyClipsChanged(p, updateClip(p, "A", { end: 3 })), true);
  assert.equal(onlyClipsChanged(p, { ...updateClip(p, "A", { end: 3 }), overlays: [] }), false);
  assert.equal(onlyClipsChanged(p, { ...p, overlays: [] }), false);
});

test("reversed clips: trimming keeps layers on the same footage", () => {
  const p = { ...base(), clips: [{ ...newClip("A", "s", 0, 4), reverse: true }, newClip("B", "s", 10, 16)] };
  // A plays source 4 -> 0; onA (1-2 s in) shows source 3 -> 2. Trimming
  // A's source start to 1 removes its last second of playback.
  const out = follow(p, updateClip(p, "A", { start: 1 }));
  close(ov(out, "onA")?.start, 1);
  close(ov(out, "onB")?.start, 4);
  // Trimming its source end to 3 removes its first second instead.
  const out2 = follow(p, updateClip(p, "A", { end: 3 }));
  close(ov(out2, "onA")?.start, 0);
  close(ov(out2, "onA")?.end, 1);
});

test("layers follow clips joined by a transition", () => {
  const p = { ...base(), clips: [{ ...newClip("A", "s", 0, 4), transition: { type: "fade" as const, duration: 1 } }, newClip("B", "s", 10, 16)] };
  // B starts at 3 (1 s overlap); onB at 5-6 is 2 s into B.
  const p2 = { ...p, overlays: [text("onB", 5, 6)] };
  const out = follow(p2, updateClip(p2, "B", { start: 11 }));
  // One second of B's start trimmed: onB moves 1 s earlier.
  close(ov(out, "onB")?.start, 4);
});

test("through the undo history: one drag, layers come back, undo restores", async () => {
  const { historyReducer } = await import("../../src/lib/editor/history.ts");
  const p = base();
  const fol = (a: Project, b: Project) => follow(a, b);
  let h = { past: [] as Project[], present: p, future: [] as Project[], gestureBase: null as Project | null };
  const trim = (end: number) => (h = historyReducer(h, { type: "apply", fn: (x) => updateClip(x, "A", { end }), record: true, follow: fol }));
  h = historyReducer(h, { type: "begin" });
  trim(3); // shorter: tailA goes, onB moves back
  assert.equal(ov(h.present, "tailA"), undefined);
  close(ov(h.present, "onB")?.start, 4);
  trim(4); // back to full length in the same drag
  h = historyReducer(h, { type: "end" });
  close(ov(h.present, "tailA")?.start, 3.5);
  close(ov(h.present, "onB")?.start, 5);
  assert.equal(h.past.length, 1);
  // Unlinked: nothing follows.
  h = historyReducer(h, { type: "apply", fn: (x) => ({ ...x, linkLayers: false }), record: true, follow: fol });
  trim(2);
  close(ov(h.present, "onB")?.start, 5);
  h = historyReducer(h, { type: "undo" });
  h = historyReducer(h, { type: "undo" });
  close(ov(h.present, "onB")?.start, 5);
  assert.equal(h.present.clips[0].end, 4);
});
