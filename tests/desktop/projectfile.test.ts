// Run with: npm run desktop:test:js
// Project files (.wipeclip): the stored-ZIP container (src/lib/editor/zip.ts)
// and the project format on top of it (src/lib/editor/projectFile.ts).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createProjectFile,
  projectFileName,
  ProjectFileError,
  readProjectFile,
  referencedSources,
} from "../../src/lib/editor/projectFile.ts";
import { DEFAULT_CANVAS, newClip, type MediaSource, type Project } from "../../src/lib/editor/types.ts";
import { buildZip, crc32, readZip } from "../../src/lib/editor/zip.ts";

function source(id: string, name: string, bytes: Uint8Array, type = "video/mp4", extra: Partial<MediaSource> = {}): MediaSource {
  const file = new File([bytes], name, { type });
  return { id, kind: "original", file, url: "blob:x", duration: 10, width: 1280, height: 720, fps: 30, hasAudio: true, ...extra };
}

const project = (ids: string[]): Project => ({
  clips: [newClip("c1", ids[0], 0, 4)],
  overlays: ids[1] ? [{ id: "o1", kind: "image", sourceId: ids[1], start: 0, end: 2, x: 0, y: 0, width: 0.2, rotation: 0, opacity: 1, animIn: "none", animOut: "none", hidden: false, locked: false } as Project["overlays"][number]] : [],
  audio: [],
  effects: [],
  canvas: DEFAULT_CANVAS,
  zooms: [],
  masks: ids[0] ? [{ id: "m1", start: 0, end: 1, mode: "blur", strength: 50, color: "#000", x: 0, y: 0, w: 0.1, h: 0.1, space: "video", sourceId: ids[0], follow: "none", enabled: true }] : [],
});

test("crc32 matches the standard check value", async () => {
  assert.equal(await crc32(new Blob(["123456789"])), 0xcbf43926);
  assert.equal(await crc32(new Blob([])), 0);
});

test("zip round trip, readable by a standard unzip tool", async () => {
  const data = new Uint8Array(70_000).map((_, i) => (i * 7) % 251);
  const zip = await buildZip([
    { name: "project.json", data: new Blob(['{"a":1}']) },
    { name: "media/src_1/Ünïcode clip.mp4", data: new Blob([data]) },
  ]);
  const entries = await readZip(zip);
  assert.deepEqual([...entries.keys()], ["project.json", "media/src_1/Ünïcode clip.mp4"]);
  assert.equal(await entries.get("project.json")!.text(), '{"a":1}');
  assert.deepEqual(new Uint8Array(await entries.get("media/src_1/Ünïcode clip.mp4")!.arrayBuffer()), data);

  // Python's zipfile checks the headers and every CRC.
  const dir = mkdtempSync(join(tmpdir(), "wipeclip-zip-"));
  try {
    const path = join(dir, "t.zip");
    writeFileSync(path, new Uint8Array(await zip.arrayBuffer()));
    const out = execFileSync(process.platform === "win32" ? "py" : "python3", [
      "-c",
      "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print('|'.join(i.filename for i in z.infolist()))",
      path,
    ], { env: { ...process.env, PYTHONIOENCODING: "utf-8" } }).toString("utf8").trim();
    assert.equal(out, "project.json|media/src_1/Ünïcode clip.mp4");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("project file round trip keeps the edit, files and recording details, with fresh ids", async () => {
  const video = source("src_a", "clip.mp4", new Uint8Array([1, 2, 3, 4]), "video/mp4", {
    recording: { trackKind: "screen", folder: "C:/rec", manifest: { version: 1 } as never, events: [] },
  });
  const image = source("src_b", "logo.png", new Uint8Array([9, 9]), "image/png", { kind: "image", duration: 0 });
  const unused = source("src_c", "old.mp4", new Uint8Array(1000));
  const p = project(["src_a", "src_b"]);
  const file = await createProjectFile({ name: "My trip", createdAt: 1 }, p, [video, image, unused]);

  const opened = await readProjectFile(file);
  assert.equal(opened.name, "My trip");
  assert.equal(opened.sources.length, 2, "sources the project doesn't use are left out");
  const byName = Object.fromEntries(opened.sources.map((s) => [s.file.name, s]));
  assert.deepEqual(new Uint8Array(await byName["clip.mp4"].file.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
  assert.equal(byName["logo.png"].file.type, "image/png");
  assert.equal(byName["clip.mp4"].recording?.folder, "C:/rec");
  // Fresh ids, and every reference follows them.
  assert.ok(!opened.sources.some((s) => s.id === "src_a" || s.id === "src_b"));
  assert.equal(opened.project.clips[0].sourceId, byName["clip.mp4"].id);
  assert.equal((opened.project.overlays[0] as { sourceId: string }).sourceId, byName["logo.png"].id);
  assert.equal(opened.project.masks![0].sourceId, byName["clip.mp4"].id);
  assert.deepEqual([...referencedSources(opened.project)].sort(), opened.sources.map((s) => s.id).sort());
});

async function fileWith(manifest: unknown, extra: { name: string; data: Blob }[] = []) {
  return buildZip([{ name: "project.json", data: new Blob([JSON.stringify(manifest)]) }, ...extra]);
}

const good = () => ({
  format: "wipeclip-project",
  version: 1,
  name: "x",
  createdAt: 1,
  savedAt: 1,
  project: project(["s1"]),
  sources: [{ id: "s1", kind: "original", name: "a.mp4", type: "video/mp4", duration: 1, width: 2, height: 2, fps: 30, hasAudio: false, path: "media/s1/a.mp4" }],
});
const media = { name: "media/s1/a.mp4", data: new Blob([new Uint8Array(4)]) };

test("rejects what isn't a valid project file, with a reason", async () => {
  const cases: [string, Blob, RegExp][] = [
    ["not a zip", new Blob(["hello"]), /Not a project file/],
    ["other zip", await buildZip([{ name: "x.txt", data: new Blob(["x"]) }]), /missing project details/],
    ["wrong format", await fileWith({ ...good(), format: "other" }, [media]), /isn't a WipeClip project/],
    ["newer version", await fileWith({ ...good(), version: 99 }, [media]), /newer version/],
    ["missing media", await fileWith(good()), /missing "a\.mp4"/],
    ["bad type", await fileWith({ ...good(), sources: [{ ...good().sources[0], type: "text/html" }] }, [media]), /damaged/],
    ["bad id", await fileWith({ ...good(), sources: [{ ...good().sources[0], id: "../x" }] }, [media]), /damaged/],
    ["dangling clip", await fileWith({ ...good(), project: project(["nope"]) }, [media]), /missing/],
    ["no clips", await fileWith({ ...good(), project: { ...project(["s1"]), clips: [] } }, [media]), /damaged/],
  ];
  for (const [label, blob, msg] of cases) {
    await assert.rejects(readProjectFile(blob), (e: unknown) => e instanceof ProjectFileError && msg.test(e.message), label);
  }
  // And the valid one opens.
  assert.equal((await readProjectFile(await fileWith(good(), [media]))).sources.length, 1);
});

test("file names are safe on every OS", () => {
  assert.equal(projectFileName('My: "trip"/2026'), "My_ _trip_2026.wipeclip");
  assert.equal(projectFileName("..."), "project.wipeclip");
});
