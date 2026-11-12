// Run with: npm run desktop:test:js
// Several timeline items picked at once (src/lib/editor/multiSelect.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { followClips } from "../../src/lib/editor/follow.ts";
import { allKeys, copyKeys, deleteKeys, existingKeys, keySelection, pasteCopy, selKey, shiftKeys } from "../../src/lib/editor/multiSelect.ts";
import { layout } from "../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, newClip, type Overlay, type Project } from "../../src/lib/editor/types.ts";

const text = (id: string, start: number, end: number, locked = false): Overlay =>
  ({ id, kind: "text", start, end, x: 0.5, y: 0.5, width: 0.5, rotation: 0, opacity: 1, animIn: "none", animOut: "none", hidden: false, locked, text: {} as never }) as Overlay;

function base(): Project {
  return {
    clips: [newClip("A", "s", 0, 4), newClip("B", "s", 10, 16)],
    overlays: [text("t1", 1, 2), text("t2", 5, 6), text("pin", 2, 3, true)],
    audio: [{ id: "a1", sourceId: "m", label: "m", start: 3, offset: 0, duration: 2, volume: 1, fadeIn: 0, fadeOut: 0, muted: false }],
    effects: [{ id: "e1", type: "blur", start: 0.5, end: 1.5, intensity: 50 }],
    masks: [],
    canvas: DEFAULT_CANVAS,
  };
}
const follow = (a: Project, b: Project) => followClips(a, b, layout(a, 30), layout(b, 30));

test("keys round-trip", () => {
  assert.equal(selKey({ kind: "overlay", id: "t1" }), "overlay:t1");
  assert.deepEqual(keySelection("audio:a:b"), { kind: "audio", id: "a:b" });
  assert.equal(selKey({ kind: "transition", clipId: "A" }), null);
  assert.equal(allKeys(base()).length, 7);
  assert.deepEqual(existingKeys(base(), ["overlay:t1", "overlay:gone"]), ["overlay:t1"]);
});

test("moving together keeps spacing, skips locked layers and stops at 0", () => {
  const p = base();
  const out = shiftKeys(p, ["overlay:t1", "audio:a1", "overlay:pin"], 1);
  assert.equal(out.overlays[0].start, 2);
  assert.equal(out.audio[0].start, 4);
  assert.equal(out.overlays[2].start, 2); // locked
  const back = shiftKeys(p, ["overlay:t1", "effect:e1"], -5);
  assert.equal(back.effects[0].start, 0); // held at 0
  assert.equal(back.overlays[0].start, 0.5); // same shift
  const capped = shiftKeys(p, ["overlay:t2"], 10, 10);
  assert.equal(capped.overlays[1].end, 10);
});

test("deleting together: clips with their layers, locked layers stay, one clip kept", () => {
  const p = base();
  const r = deleteKeys(p, ["clip:A", "overlay:pin", "effect:e1"], follow);
  assert.deepEqual(r.project.clips.map((c) => c.id), ["B"]);
  // t1 was on A: gone with it; t2 (on B) moved up 4 s.
  assert.deepEqual(r.project.overlays.map((o) => o.id).sort(), ["pin", "t2"]);
  assert.equal(r.project.overlays.find((o) => o.id === "t2")?.start, 1);
  assert.equal(r.lockedKept, 1);
  assert.equal(r.project.effects.length, 0);
  const all = deleteKeys(p, ["clip:A", "clip:B"]);
  assert.equal(all.project.clips.length, 1);
  assert.equal(all.clipKept, true);
});

test("copy and paste keep spacing at the playhead", () => {
  const p = base();
  const copy = copyKeys(p, ["overlay:t1", "audio:a1"])!;
  const { project, keys } = pasteCopy(p, copy, 8);
  assert.equal(keys.length, 2);
  const t = project.overlays[project.overlays.length - 1];
  const a = project.audio[project.audio.length - 1];
  assert.equal(t.start, 8);
  assert.equal(a.start, 10);
  assert.notEqual(t.id, "t1");
  assert.equal(copyKeys(p, ["clip:A"]), null);
});
