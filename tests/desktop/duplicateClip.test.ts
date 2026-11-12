// Run with: npm run desktop:test:js
import assert from "node:assert/strict";
import { test } from "node:test";
import { duplicateClip, layout } from "../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, newClip, type Project } from "../../src/lib/editor/types.ts";

function project(): Project {
  const a = { ...newClip("a", "screen", 0, 4), transition: { type: "fade" as const, duration: 0.5 } };
  const b = newClip("b", "screen", 4, 10);
  return { clips: [a, b], overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS };
}

test("copy lands right after the original", () => {
  const out = duplicateClip(project(), "a");
  assert.ok(out);
  const ids = out.project.clips.map((c) => c.id);
  assert.deepEqual([ids[0], ids[2]], ["a", "b"]);
  assert.equal(ids[1], out.clipId);
  assert.notEqual(out.clipId, "a");
  const [orig, copy] = out.project.clips;
  assert.equal(copy.start, orig.start);
  assert.equal(copy.end, orig.end);
});

test("copy takes over the outgoing transition", () => {
  const out = duplicateClip(project(), "a")!;
  const [orig, copy] = out.project.clips;
  assert.equal(orig.transition, null);
  assert.deepEqual(copy.transition, { type: "fade", duration: 0.5 });
});

test("timeline grows by the clip's length", () => {
  const p = project();
  const before = layout(p, 30).total;
  const after = layout(duplicateClip(p, "b")!.project, 30).total;
  assert.ok(Math.abs(after - before - 6) < 1e-6);
});

test("unknown clip is a no-op", () => {
  assert.equal(duplicateClip(project(), "nope"), null);
});
