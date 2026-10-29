// Run with: npm run desktop:test:js
// Creator presets (src/lib/editor/creatorPresets.ts): canvas settings,
// activity-aware reframing for vertical and square, the tutorial preset.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCreatorPreset, centerOn, type PresetContext } from "../../src/lib/editor/creatorPresets.ts";
import type { Act } from "../../src/lib/editor/insights.ts";
import { layout, videoBox } from "../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, newClip, type MediaSource, type Overlay, type Project } from "../../src/lib/editor/types.ts";

const src = (id: string, width = 1920, height = 1080) => ({ id, kind: "original", file: null, url: "", duration: 60, width, height, fps: 30, hasAudio: true }) as MediaSource;

function setup(acts: Act[] | null, over: Partial<PresetContext> = {}) {
  const project: Project = { clips: [newClip("c1", "rec", 0, 20), newClip("c2", "rec", 30, 50)], overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS };
  const lay = layout(project, 30);
  const ctx: PresetContext = { lay, sources: { rec: src("rec") }, originalId: "rec", acts, recSourceId: acts ? "rec" : null, cursorCaptured: true, keystrokes: [], ...over };
  return { project, ctx };
}

const at = (t: number, x: number, kind: Act["kind"] = "click"): Act => ({ t, kind, x, y: 0.5 });

test("centerOn keeps the box covering the canvas", () => {
  assert.equal(centerOn(0.5, 3), 0.5);
  // Source x 0.8 to the middle: box moves left, but not past its edge.
  assert.ok(Math.abs(centerOn(0.8, 3) - (0.5 - 0.9)) < 1e-9);
  assert.equal(centerOn(1, 3), 1 - 1.5);
  assert.equal(centerOn(0, 3), 1.5);
  assert.equal(centerOn(0.9, 1), 0.5);
});

test("vertical: each recorded clip is centered on its own activity, and stays adjustable", () => {
  // Clip 1 (timeline 0-20): work on the right; clip 2 (20-40): on the left.
  const acts = [at(2, 0.8), at(5, 0.82, "move"), at(9, 0.78), at(22, 0.2), at(25, 0.22), at(30, 0.18)];
  const { project, ctx } = setup(acts);
  const r = applyCreatorPreset(project, "vertical", ctx);
  assert.equal(r.project.canvas.aspect, "9:16");
  assert.equal(r.project.canvas.fit, "fill");
  const [c1, c2] = r.project.clips;
  assert.ok(c1.transform.x < 0.5 && c2.transform.x > 0.5, `${c1.transform.x} ${c2.transform.x}`);
  // The activity is inside the visible part of each clip.
  const box = videoBox(c1, { width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { fit: "fill" });
  for (const [clip, u] of [[c1, 0.8], [c2, 0.2]] as const) {
    const left = clip.transform.x - box.w / 2;
    const xOnCanvas = left + u * box.w;
    assert.ok(xOnCanvas > 0.05 && xOnCanvas < 0.95, String(xOnCanvas));
  }
  assert.match(r.notes.join(" "), /2 clips are centered on where you clicked/);
  // Only settings changed: the clips' timing and the input project are untouched.
  assert.deepEqual(r.project.clips.map((c) => [c.start, c.end]), [[0, 20], [30, 50]]);
  assert.equal(project.canvas.aspect, "original");
});

test("activity spread wider than a crop keeps the whole picture (fit, blurred background)", () => {
  const acts = [at(1, 0.05), at(3, 0.95), at(5, 0.1), at(7, 0.9), at(9, 0.5)];
  const { project, ctx } = setup(acts);
  const r = applyCreatorPreset(project, "square", ctx);
  assert.equal(r.project.canvas.aspect, "1:1");
  assert.equal(r.project.canvas.fit, "fit");
  assert.equal(r.project.canvas.background.type, "blur");
  assert.ok(r.project.clips.every((c) => c.transform.x === 0.5));
  assert.match(r.notes[0], /spread too wide/);
});

test("plain videos are centered with a note to check; portrait sources aren't moved", () => {
  const { project, ctx } = setup(null);
  const r = applyCreatorPreset(project, "vertical", ctx);
  assert.ok(r.project.clips.every((c) => c.transform.x === 0.5));
  assert.match(r.notes.join(" "), /check the sides/);
  const portrait = setup(null, { sources: { rec: src("rec", 1080, 1920) } });
  const p = applyCreatorPreset(portrait.project, "vertical", portrait.ctx);
  assert.deepEqual(p.notes, []);
});

test("Landscape: 16:9, whole picture, blurred bars for other shapes", () => {
  const { project, ctx } = setup(null, { sources: { rec: src("rec", 1440, 1080) } });
  const r = applyCreatorPreset(project, "landscape", ctx);
  assert.equal(r.project.canvas.aspect, "16:9");
  assert.equal(r.project.canvas.fit, "fit");
  assert.equal(r.project.canvas.background.type, "blur");
  const same = setup(null);
  assert.equal(applyCreatorPreset(same.project, "landscape", same.ctx).project.canvas.background.type, "color");
});

test("tutorial: framed canvas, click highlights, cursor only when the recording lacks one, shortcut indicators", () => {
  const key = { id: "k1", kind: "text", keystroke: true } as unknown as Overlay;
  const old = { id: "k0", kind: "text", keystroke: true } as unknown as Overlay;
  const text = { id: "t", kind: "text" } as unknown as Overlay;
  const { project, ctx } = setup([at(1, 0.5)], { cursorCaptured: false, keystrokes: [key] });
  const r = applyCreatorPreset({ ...project, overlays: [old, text] }, "tutorial", ctx);
  assert.equal(r.project.canvas.aspect, "16:9");
  assert.ok(r.project.canvas.frame && r.project.canvas.frame.padding > 0);
  assert.equal(r.project.pointer?.clicks, true);
  assert.equal(r.project.pointer?.cursor, true);
  assert.deepEqual(r.project.overlays.map((o) => o.id), ["t", "k1"]);
  const captured = setup([at(1, 0.5)], { cursorCaptured: true });
  assert.equal(applyCreatorPreset(project, "tutorial", captured.ctx).project.pointer?.cursor, false);
  // Not a recording: layout only.
  const plain = setup(null);
  const p = applyCreatorPreset(plain.project, "tutorial", plain.ctx);
  assert.equal(p.project.pointer, undefined);
  assert.match(p.notes[0], /need a WipeClip screen recording/);
});
