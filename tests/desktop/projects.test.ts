// Run with: npm run desktop:test:js
// The project library (src/lib/editor/projectStore.ts) on an in-memory
// IndexedDB: the v1 -> v2 upgrade, save/list/load, rename, delete and the
// clean-up of files no project uses.
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import {
  deleteProject,
  isProjectProblem,
  listProjects,
  loadProject,
  nameFromFile,
  newProjectInfo,
  renameProject,
  saveProject,
  saveSource,
  tidyProjects,
} from "../../src/lib/editor/projectStore.ts";
import { DEFAULT_CANVAS, newClip, type MediaSource, type Project } from "../../src/lib/editor/types.ts";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

function source(id: string, name = "clip.mp4"): MediaSource {
  const file = new File([new Uint8Array(1000)], name, { type: "video/mp4" });
  return { id, kind: "original", file, url: "blob:test", duration: 10, width: 1280, height: 720, fps: 30, hasAudio: true };
}

function projectFor(src: MediaSource): Project {
  return { clips: [newClip(`clip-${src.id}`, src.id, 0, 4)], overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS };
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const sourceKeys = async () => {
  const db = await req(indexedDB.open("wipeclip-editor"));
  const keys = await req(db.transaction("sources").objectStore("sources").getAllKeys());
  db.close();
  return keys.map(String).sort();
};

test("names come from the file name", () => {
  assert.equal(nameFromFile("My clip.final.mp4"), "My clip.final");
  assert.equal(nameFromFile(".mp4"), "Untitled project");
});

test("save, list newest first, load, rename", async () => {
  const a = source("src-a", "first.mp4");
  const b = source("src-b", "second.mov");
  const ia = newProjectInfo("first");
  const ib = newProjectInfo("second");
  assert.ok(await saveSource(a));
  assert.ok(await saveSource(b));
  await saveProject(ia, projectFor(a), [a], "data:image/jpeg;base64,AA==");
  await new Promise((r) => setTimeout(r, 5));
  await saveProject(ib, projectFor(b), [b], null);

  const list = await listProjects();
  assert.deepEqual(
    list.map((p) => p.name),
    ["second", "first"]
  );
  assert.equal(list[1].thumb, "data:image/jpeg;base64,AA==");
  assert.equal(list[1].bytes, 1000);
  assert.equal(list[1].clips, 1);
  assert.equal(list[1].duration, 4);

  const loaded = await loadProject(ia.id);
  assert.ok(!isProjectProblem(loaded));
  assert.equal(loaded.info.name, "first");
  assert.equal(loaded.sources[0].file.name, "first.mp4");
  assert.equal(loaded.sources[0].file.size, 1000);
  assert.equal(loaded.project.clips.length, 1);

  await renameProject(ia.id, "renamed");
  assert.ok((await listProjects()).some((p) => p.id === ia.id && p.name === "renamed"));
});

test("delete removes the project and only its own files", async () => {
  const a = source("src-a");
  const b = source("src-b");
  const ia = newProjectInfo("a");
  const ib = newProjectInfo("b");
  await saveSource(a);
  await saveSource(b);
  await saveProject(ia, projectFor(a), [a], null);
  await saveProject(ib, projectFor(b), [b], null);
  await deleteProject(ia.id);
  assert.deepEqual(
    (await listProjects()).map((p) => p.id),
    [ib.id]
  );
  assert.deepEqual(await sourceKeys(), ["src-b"]);
  assert.ok(isProjectProblem(await loadProject(ia.id)));
});

test("tidy drops files no project refers to", async () => {
  const kept = source("src-kept");
  const orphan = source("src-orphan");
  await saveSource(kept);
  await saveSource(orphan); // saved, then the app closed before the project's first save
  await saveProject(newProjectInfo("kept"), projectFor(kept), [kept], null);
  await tidyProjects();
  assert.deepEqual(await sourceKeys(), ["src-kept"]);
});

test("a missing source file is reported, not opened", async () => {
  const a = source("src-a", "gone.mp4");
  const info = newProjectInfo("broken");
  await saveProject(info, projectFor(a), [a], null); // its file was never stored
  const loaded = await loadProject(info.id);
  assert.ok(isProjectProblem(loaded));
  assert.match(loaded.problem, /gone\.mp4/);
});

test("the v1 single project moves into the library", async () => {
  // A version 1 database as the previous release left it.
  const open = indexedDB.open("wipeclip-editor", 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore("project");
    open.result.createObjectStore("sources");
  };
  const v1 = await req(open);
  const savedAt = Date.now() - 60_000; // recent: the website drops projects after 7 days
  const a = source("src-old", "holiday.mp4");
  const { file, ...rest } = a;
  const meta = { ...rest, url: undefined };
  const tx = v1.transaction(["project", "sources"], "readwrite");
  tx.objectStore("sources").put(file, a.id);
  tx.objectStore("project").put({ project: projectFor(a), sources: [{ ...meta, name: file.name, type: file.type }], savedAt }, "current");
  tx.objectStore("project").put({ blob: new Blob(["x"]), savedAt: Date.now() }, "export");
  await new Promise((r) => (tx.oncomplete = r));
  v1.close();

  const list = await listProjects();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "holiday");
  assert.equal(list[0].savedAt, savedAt);
  assert.equal(list[0].bytes, null); // v1 didn't store sizes
  const loaded = await loadProject(list[0].id);
  assert.ok(!isProjectProblem(loaded));
  assert.equal(loaded.sources[0].file.name, "holiday.mp4");

  // The old slot is gone; the last export stays where it was.
  const db = await req(indexedDB.open("wipeclip-editor"));
  const legacy = db.transaction("project").objectStore("project");
  assert.equal(await req(legacy.get("current")), undefined);
  assert.ok(await req(legacy.get("export")));
  db.close();
});
