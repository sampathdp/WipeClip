/** Saves editor projects in the visitor's own browser (IndexedDB) so a
 * refresh or closed tab doesn't lose their edits - same "never on our
 * servers" approach as src/lib/resultCache.ts. A library of projects, each
 * reopened from the start screen's Recent projects. Source videos (original
 * + AI-cleaned segments, recordings) are written once each, when added, to
 * their own store under their globally unique id; the small project record
 * is what gets re-saved as the user edits. Best-effort throughout: private
 * browsing or a full quota just means no recovery, never a broken editor.
 */
import { IS_DESKTOP } from "../platform/env.ts";
import { newId } from "./timeline.ts";
import { migrateProject, type MediaSource, type Project } from "./types.ts";

const DB_NAME = "wipeclip-editor";
const DB_VERSION = 2;
/** v1's single project lived here under "current"; still holds the last
 * export. Moved into PROJECTS_STORE by the v2 upgrade. */
const LEGACY_STORE = "project";
const LEGACY_KEY = "current";
const PROJECTS_STORE = "projects";
const SOURCE_STORE = "sources";
/** Website only: browser storage is a convenience there. The desktop app
 * keeps a project until the user deletes it. */
const MAX_AGE_MS = IS_DESKTOP ? Infinity : 7 * 24 * 60 * 60 * 1000;
/** Version of the stored project. Records without one are version 1
 * (everything saved before versioning); migrateProject fills any newer
 * fields. A record from a newer app is reported, never guessed at. */
export const PROJECT_FORMAT = 1;

type SourceMeta = Omit<MediaSource, "url" | "file"> & { name: string; type: string; size?: number };

/** What the editor knows about the open project besides its content. */
export interface ProjectInfo {
  id: string;
  name: string;
  createdAt: number;
}

interface StoredProject {
  project: Project;
  sources: SourceMeta[];
  savedAt: number;
  formatVersion?: number;
  // Added in DB version 2; v1 records get them in the upgrade.
  id: string;
  name: string;
  createdAt: number;
  /** Small JPEG data URL of the first clip, for the project list. */
  thumb?: string | null;
}

export interface ProjectSummary extends ProjectInfo {
  savedAt: number;
  clips: number;
  /** Seconds of source video in the project's clips (before speed changes). */
  duration: number;
  thumb: string | null;
  /** Disk space its stored files take, when known. */
  bytes: number | null;
  /** Set when the project can't be opened, with the reason to show. */
  problem?: string;
}

/** A project name from a file name: "My clip.final.mp4" -> "My clip.final". */
export function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim() || "Untitled project";
}

export function newProjectInfo(name: string): ProjectInfo {
  return { id: newId("prj"), name, createdAt: Date.now() };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        db.createObjectStore(LEGACY_STORE);
        db.createObjectStore(SOURCE_STORE);
      }
      if (e.oldVersion < 2) {
        const projects = db.createObjectStore(PROJECTS_STORE);
        // The one v1 project becomes the first library entry. Its sources
        // already sit under their own ids, so they stay where they are.
        const legacy = req.transaction!.objectStore(LEGACY_STORE);
        const get = legacy.get(LEGACY_KEY);
        get.onsuccess = () => {
          const old = get.result as Omit<StoredProject, "id" | "name" | "createdAt"> | undefined;
          if (old?.project) {
            const original = old.sources?.find((s) => s.kind === "original") ?? old.sources?.[0];
            const id = newId("prj");
            const record: StoredProject = { ...old, id, name: original ? nameFromFile(original.name) : "Untitled project", createdAt: old.savedAt ?? Date.now() };
            projects.put(record, id);
          }
          legacy.delete(LEGACY_KEY);
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // Another tab still has the v1 database open; it has to close first.
    req.onblocked = () => reject(new Error("blocked"));
  });
}

function run<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest | void
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = op(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

function toMeta(s: MediaSource): SourceMeta {
  const { id, kind, duration, width, height, fps, hasAudio, file } = s;
  return { id, kind, duration, width, height, fps, hasAudio, name: file.name, type: file.type, size: file.size };
}

/** A recorded source's capture details and interaction events, stored once
 * beside its file (they can be a few MB - too much to re-save with every
 * edit, which is what the project record gets). */
const recordingKey = (id: string) => `${id}#recording`;

/** Stores a source for recovery. false when it couldn't be stored (full
 * disk/quota, private browsing): the caller tells the user, because the
 * project then can't be reopened after closing. */
export async function saveSource(source: MediaSource): Promise<boolean> {
  try {
    await withDb(async (db) => {
      await run(db, SOURCE_STORE, "readwrite", (s) => s.put(source.file, source.id));
      if (source.recording) await run(db, SOURCE_STORE, "readwrite", (s) => s.put(source.recording, recordingKey(source.id)));
    });
    return true;
  } catch {
    return false;
  }
}

export async function saveProject(info: ProjectInfo, project: Project, sources: MediaSource[], thumb: string | null): Promise<void> {
  try {
    const record: StoredProject = {
      ...info,
      project,
      sources: sources.map(toMeta),
      savedAt: Date.now(),
      formatVersion: PROJECT_FORMAT,
      thumb,
    };
    await withDb((db) => run(db, PROJECTS_STORE, "readwrite", (s) => s.put(record, info.id)));
  } catch {
    // best-effort
  }
}

function summarize(r: StoredProject): ProjectSummary {
  const sizes = r.sources?.map((s) => s.size) ?? [];
  const summary: ProjectSummary = {
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    savedAt: r.savedAt,
    clips: r.project?.clips?.length ?? 0,
    duration: (r.project?.clips ?? []).reduce((t, c) => t + Math.max(0, c.end - c.start), 0),
    thumb: r.thumb ?? null,
    bytes: sizes.length && sizes.every((n) => typeof n === "number") ? sizes.reduce((a, b) => a + (b as number), 0) : null,
  };
  if ((r.formatVersion ?? 1) > PROJECT_FORMAT) summary.problem = "Saved by a newer version of WipeClip. Update the app to open it.";
  return summary;
}

const usable = (r: StoredProject) => !!r.project?.clips?.length && !!r.sources?.length && Date.now() - r.savedAt <= MAX_AGE_MS;

/** Every saved project, most recently saved first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  try {
    const records = (await withDb((db) => run<StoredProject[]>(db, PROJECTS_STORE, "readonly", (s) => s.getAll()))) ?? [];
    return records
      .filter(usable)
      .map(summarize)
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch (e) {
    console.error("[project] couldn't list saved projects", e);
    return [];
  }
}

export interface RestoredProject {
  info: ProjectInfo;
  project: Project;
  sources: MediaSource[];
  savedAt: number;
}

/** A saved project that exists but can't be opened, with the reason to
 * show - never silently treated as "nothing saved". */
export interface ProjectProblem {
  problem: string;
}

export const isProjectProblem = (r: RestoredProject | ProjectProblem | null): r is ProjectProblem => !!r && "problem" in r;

export async function loadProject(id: string): Promise<RestoredProject | ProjectProblem> {
  try {
    return await withDb(async (db) => {
      const record = await run<StoredProject>(db, PROJECTS_STORE, "readonly", (s) => s.get(id));
      if (!record || !usable(record)) return { problem: "This project isn't saved on this device any more." };
      if ((record.formatVersion ?? 1) > PROJECT_FORMAT) {
        return { problem: "This project was saved by a newer version of WipeClip. Update the app to open it." };
      }
      const sources: MediaSource[] = [];
      for (const meta of record.sources) {
        const blob = await run<Blob>(db, SOURCE_STORE, "readonly", (s) => s.get(meta.id));
        if (!blob) {
          sources.forEach((s) => URL.revokeObjectURL(s.url));
          return { problem: `"${record.name}" can't be reopened: its video "${meta.name}" wasn't saved on this device (storage may have been full).` };
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- size is only for the project list
        const { name, type, size, ...rest } = meta;
        const file = new File([blob], name, { type });
        const recording = await run<MediaSource["recording"]>(db, SOURCE_STORE, "readonly", (s) => s.get(recordingKey(meta.id)));
        sources.push({ ...rest, file, url: URL.createObjectURL(file), ...(recording ? { recording } : {}) });
      }
      return {
        info: { id: record.id, name: record.name, createdAt: record.createdAt },
        project: migrateProject(record.project),
        sources,
        savedAt: record.savedAt,
      };
    });
  } catch (e) {
    console.error("[project] couldn't read a saved project", e);
    return { problem: "This project couldn't be read, so it can't be reopened. Your original video files are not affected." };
  }
}

export async function renameProject(id: string, name: string): Promise<void> {
  try {
    await withDb(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(PROJECTS_STORE, "readwrite");
          const store = tx.objectStore(PROJECTS_STORE);
          const get = store.get(id);
          get.onsuccess = () => {
            if (get.result) store.put({ ...get.result, name }, id);
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        })
    );
  } catch {
    // best-effort
  }
}

/** Deletes a project and the stored files only it used. */
export async function deleteProject(id: string): Promise<void> {
  try {
    await withDb(async (db) => {
      await run(db, PROJECTS_STORE, "readwrite", (s) => s.delete(id));
      await removeUnusedSources(db);
    });
  } catch {
    // best-effort
  }
}

/** Housekeeping when the editor starts, before anything is open: drops
 * expired projects (website) and stored files no project refers to - a
 * source saved just before a crash, before its project's first save. */
export async function tidyProjects(): Promise<void> {
  try {
    await withDb(async (db) => {
      const records = (await run<StoredProject[]>(db, PROJECTS_STORE, "readonly", (s) => s.getAll())) ?? [];
      for (const r of records) {
        if (!usable(r) && (r.formatVersion ?? 1) <= PROJECT_FORMAT) await run(db, PROJECTS_STORE, "readwrite", (s) => s.delete(r.id));
      }
      await removeUnusedSources(db);
    });
  } catch {
    // best-effort
  }
}

async function removeUnusedSources(db: IDBDatabase): Promise<void> {
  const records = (await run<StoredProject[]>(db, PROJECTS_STORE, "readonly", (s) => s.getAll())) ?? [];
  const used = new Set<string>();
  for (const r of records) for (const s of r.sources ?? []) used.add(s.id).add(recordingKey(s.id));
  const keys = (await run<IDBValidKey[]>(db, SOURCE_STORE, "readonly", (s) => s.getAllKeys())) ?? [];
  const unused = keys.filter((k) => !used.has(String(k)));
  if (unused.length) await run(db, SOURCE_STORE, "readwrite", (s) => unused.forEach((k) => s.delete(k)));
}

const EXPORT_KEY = "export";

/** Last anonymous export, kept so signing in to download it (which may
 * navigate away) doesn't mean rendering - and paying for - it again.
 */
export async function saveLastExport(blob: Blob): Promise<void> {
  try {
    await withDb((db) => run(db, LEGACY_STORE, "readwrite", (s) => s.put({ blob, savedAt: Date.now() }, EXPORT_KEY)));
  } catch {
    // best-effort
  }
}

export async function loadLastExport(): Promise<Blob | null> {
  try {
    const record = await withDb((db) =>
      run<{ blob: Blob; savedAt: number }>(db, LEGACY_STORE, "readonly", (s) => s.get(EXPORT_KEY))
    );
    if (!record || Date.now() - record.savedAt > 2 * 60 * 60 * 1000) return null;
    return record.blob;
  } catch {
    return null;
  }
}

export async function clearLastExport(): Promise<void> {
  try {
    await withDb((db) => run(db, LEGACY_STORE, "readwrite", (s) => s.delete(EXPORT_KEY)));
  } catch {
    // best-effort
  }
}
