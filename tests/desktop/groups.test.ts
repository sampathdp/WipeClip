// Run with: npm run desktop:test:js
// Grouped items (src/lib/editor/groups.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { groupColors, groupOf, liveGroups, makeGroup, moveClipWithGroup, ungroup } from "../../src/lib/editor/groups.ts";
import { DEFAULT_CANVAS, newClip, type Overlay, type Project } from "../../src/lib/editor/types.ts";

const text = (id: string): Overlay =>
  ({ id, kind: "text", start: 0, end: 1, x: 0.5, y: 0.5, width: 0.5, rotation: 0, opacity: 1, animIn: "none", animOut: "none", hidden: false, locked: false, text: {} as never }) as Overlay;

function base(): Project {
  return {
    clips: ["A", "B", "C", "D"].map((id, i) => newClip(id, "s", i, i + 1)),
    overlays: [text("t1"), text("t2"), text("t3")],
    audio: [],
    effects: [],
    canvas: DEFAULT_CANVAS,
  };
}

test("grouping, membership, ungrouping", () => {
  const p = base();
  const g = makeGroup(p, ["overlay:t1", "overlay:t2", "overlay:gone"])!;
  assert.deepEqual(g.group.keys, ["overlay:t1", "overlay:t2"]);
  const p2 = { ...p, groups: g.groups };
  assert.equal(groupOf(p2, "overlay:t2")?.id, g.group.id);
  assert.equal(groupOf(p2, "overlay:t3"), null);
  assert.equal(groupColors(p2).size, 2);
  // Regrouping one member takes it out of its old group, which then has too few.
  const g2 = makeGroup(p2, ["overlay:t2", "overlay:t3"])!;
  assert.equal(g2.groups.length, 1);
  assert.equal(makeGroup(p, ["overlay:t1"]), null);
  assert.deepEqual(ungroup(p2, ["overlay:t1"]), { groups: [], count: 1 });
  // A deleted member: the group is gone once fewer than two remain.
  assert.equal(liveGroups({ ...p2, overlays: [text("t1")] }).length, 0);
});

test("grouped clips move as one block", () => {
  const p = { ...base(), groups: [{ id: "g", keys: ["clip:A", "clip:C"] }] };
  // Drag A to the end (index among the other clips: 3 = after D).
  assert.deepEqual(moveClipWithGroup(p, 0, 3).clips.map((c) => c.id), ["B", "D", "A", "C"]);
  // Drag C before B (others: A, B, D; index 1 = B): A comes along, in order.
  assert.deepEqual(moveClipWithGroup(p, 2, 1).clips.map((c) => c.id), ["A", "C", "B", "D"]);
  // Not grouped: a plain move.
  assert.deepEqual(moveClipWithGroup(base(), 3, 0).clips.map((c) => c.id), ["D", "A", "B", "C"]);
});
