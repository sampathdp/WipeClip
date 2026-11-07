// Run with: npm run desktop:test:js
// Webcam background removal (src/lib/editor/matte.ts): the preview's math
// must match the export's (backend/app/pipeline/editor.py matte_curve,
// matte_soft_sigma, matte_blur_sigma, matte_bg_rect - the same numbers are
// checked in backend/tests/test_matte.py), plus the project-side pieces.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_MATTE,
  bgRect,
  bgVideoTime,
  blurSigma,
  edgeCurve,
  ensureMatte,
  fullMatte,
  matteInput,
  matteJobKey,
  matteUnsupported,
  memoryKey,
  setMatteEngine,
  softSigma,
} from "../../src/lib/editor/matte.ts";
import { referencedSources, remapSources } from "../../src/lib/editor/projectFile.ts";
import { DEFAULT_CANVAS, migrateProject, type MediaSource, type Overlay, type Project } from "../../src/lib/editor/types.ts";

test("edge curve: same values as the export's", () => {
  assert.equal(edgeCurve(0.5, 0), 0.5);
  assert.equal(edgeCurve(0.2, 0), 0); // faint halo dropped
  assert.equal(edgeCurve(0.8, 0), 1);
  assert.ok(edgeCurve(0.3, 100) > 0.5); // grown
  assert.ok(edgeCurve(0.7, -100) < 0.5); // shrunk
  // The export's lut: clip(((v/255 - c) * 2 + 0.5) * 255) with c = 0.5 - edge/100 * 0.4.
  for (const edge of [-100, -30, 0, 45, 100])
    for (const v of [0, 40, 128, 200, 255]) {
      const c = 0.5 - (edge / 100) * 0.4;
      const lut = Math.min(255, Math.max(0, ((v / 255 - c) * 2 + 0.5) * 255));
      assert.ok(Math.abs(edgeCurve(v / 255, edge) * 255 - lut) < 1e-9, `edge ${edge} v ${v}`);
    }
});

test("sizes are relative to the height, so preview and export agree", () => {
  assert.ok(Math.abs(softSigma(100, 180) - 3.96) < 1e-9);
  assert.ok(Math.abs(softSigma(0, 720) - 1.44) < 1e-9);
  assert.equal(softSigma(50, 360) * 2, softSigma(50, 720));
  assert.equal(blurSigma(100, 720), 36);
  assert.equal(blurSigma(0, 720), 0);
});

test("background placement: fill covers, fit shows all, zoom and position", () => {
  const fill = { fit: "fill" as const, scale: 1, x: 0.5, y: 0.5 };
  assert.deepEqual(bgRect(160, 90, 100, 100, fill), { left: 0, top: -35, width: 160, height: 160 });
  assert.deepEqual(bgRect(160, 90, 100, 100, { ...fill, fit: "fit" }), { left: 35, top: 0, width: 90, height: 90 });
  assert.deepEqual(bgRect(160, 90, 100, 100, { ...fill, y: 0 }), { left: 0, top: -0, width: 160, height: 160 });
  const zoomed = bgRect(160, 90, 160, 90, { ...fill, scale: 2 });
  assert.deepEqual(zoomed, { left: -80, top: -45, width: 320, height: 180 });
});

test("background video loops or holds its last frame", () => {
  assert.equal(bgVideoTime(2.5, 1, true), 0.5);
  assert.ok(Math.abs(bgVideoTime(2.5, 1, false) - 0.96) < 1e-9);
  assert.equal(bgVideoTime(0.3, 1, false), 0.3);
  assert.equal(bgVideoTime(-1, 1, true), 0);
  assert.equal(bgVideoTime(5, 0, true), 0);
});

test("older or partial settings get defaults", () => {
  assert.deepEqual(fullMatte({ mode: "blur" }), { ...DEFAULT_MATTE, mode: "blur" });
});

const diskSrc = { id: "d", duration: 5, disk: { path: "C:/rec/webcam.webm", name: "webcam.webm", size: 1, type: "video/webm" } } as MediaSource;
const memSrc = { id: "m", duration: 5, file: new File([new Uint8Array(4)], "cam.mp4", { lastModified: 1700000000000 }) } as MediaSource;

test("disk and in-memory videos, in the desktop app", () => {
  assert.equal(matteUnsupported(diskSrc, true), null);
  assert.equal(matteUnsupported(memSrc, true), null);
  assert.match(matteUnsupported(diskSrc, false)!, /desktop app/);
  assert.match(matteUnsupported(undefined, true)!, /missing/);
  assert.match(matteUnsupported({ id: "x" } as MediaSource, true)!, /missing/);
});

test("in-memory videos get a stable key; jobs are per video and detail", () => {
  const key = memoryKey(memSrc.file!);
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.equal(memoryKey({ name: "cam.mp4", size: 4, lastModified: 1700000000000 }), key, "same file in another session");
  assert.notEqual(memoryKey({ name: "cam.mp4", size: 5, lastModified: 1700000000000 }), key);
  assert.deepEqual(matteInput(diskSrc), { path: "C:/rec/webcam.webm" });
  assert.deepEqual(matteInput(memSrc), { key, file: memSrc.file });
  assert.equal(matteJobKey(diskSrc, "fine"), "C:/rec/webcam.webm|fine");
  assert.equal(matteJobKey(diskSrc, undefined), "C:/rec/webcam.webm|fine", "older settings: fine");
  assert.equal(matteJobKey(memSrc, "fast"), `mem:${key}|fast`);
  assert.equal(matteJobKey(undefined, "fine"), null);
});

test("one engine job per video and detail, retried after a failure", async () => {
  const calls: string[] = [];
  let fail = true;
  setMatteEngine({
    render: async (input, duration, detail) => {
      calls.push(`${"path" in input ? input.path : input.key}|${duration}|${detail}`);
      if (fail) throw new Error("engine down");
      return { path: `${"path" in input ? input.path : input.key}.${detail}.mp4` };
    },
    url: async (p) => `asset://${p}`,
  });
  await assert.rejects(ensureMatte(diskSrc, "fine"), /engine down/);
  fail = false;
  const [a, b] = await Promise.all([ensureMatte(diskSrc, "fine"), ensureMatte(diskSrc, "fine")]);
  assert.equal(a.path, "C:/rec/webcam.webm.fine.mp4");
  assert.equal(a, b);
  assert.equal(calls.length, 2);
  await ensureMatte(diskSrc, "fine"); // cached
  assert.equal(calls.length, 2);
  const fast = await ensureMatte(diskSrc, "fast");
  assert.equal(fast.path, "C:/rec/webcam.webm.fast.mp4");
  assert.deepEqual(calls.at(-1), "C:/rec/webcam.webm|5|fast", "the editor's duration goes along");
  const mem = await ensureMatte(memSrc, "fine");
  assert.equal(mem.path, `${memoryKey(memSrc.file!)}.fine.mp4`);
});

test("a webcam's background source belongs to the project", () => {
  const cam: Overlay = {
    id: "o1",
    kind: "video",
    sourceId: "cam",
    offset: 0,
    volume: 0,
    start: 0,
    end: 5,
    x: 0.5,
    y: 0.5,
    width: 0.3,
    rotation: 0,
    opacity: 1,
    animIn: "none",
    animOut: "none",
    hidden: false,
    locked: false,
    matte: { ...DEFAULT_MATTE, mode: "image", bgSourceId: "bg" },
  };
  const project: Project = { clips: [], overlays: [cam], audio: [], effects: [], canvas: DEFAULT_CANVAS };
  assert.ok(referencedSources(project).has("bg"));
  const moved = remapSources(project, new Map([["cam", "cam2"], ["bg", "bg2"]]));
  const o = moved.overlays[0] as Overlay & { kind: "video" };
  assert.equal(o.sourceId, "cam2");
  assert.equal(o.matte?.bgSourceId, "bg2");
  // Saved and opened again as-is; projects without it are unchanged.
  assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(project))).overlays[0], cam);
  const old = { ...cam } as Partial<typeof cam>;
  delete old.matte;
  assert.equal((migrateProject({ ...project, overlays: [old] }).overlays[0] as typeof cam).matte, undefined);
});
