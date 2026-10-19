/** Saves the current editor project in the visitor's own browser
 * (IndexedDB) so a refresh or closed tab doesn't lose their edits - same
 * "never on our servers" approach as src/lib/resultCache.ts. One project at
 * a time. Source videos (original + AI-cleaned segments) are written once
 * each, when added, to their own store; the small project JSON is what gets
 * re-saved as the user edits. Best-effort throughout: private browsing or a
 * full quota just means no recovery, never a broken editor.
 */
import { IS_DESKTOP } from "@/lib/platform/env";
import { migrateProject, type MediaSource, type Project } from "./types";

const DB_NAME = "wipeclip-editor";
const PROJECT_STORE = "project";
const SOURCE_STORE = "sources";
const KEY = "current";
/** Website only: browser storage is a convenience there. The desktop app
 * keeps a saved project until the user discards or replaces it. */
const MAX_AGE_MS = IS_DESKTOP ? Infinity : 7 * 24 * 60 * 60 * 1000;
/** Version of the stored record. Records without one are version 1
 * (everything saved before versioning); migrateProject fills any newer
 * fields. A record from a newer app is reported, never guessed at. */
export const PROJECT_FORMAT = 1;

type SourceMeta = Omit<MediaSource, "url" | "file"> & { name: string; type: string };

interface StoredProject {
  project: Project;
  sources: SourceMeta[];
  savedAt: number;
  formatVersion?: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(PROJECT_STORE);
      req.result.createObjectStore(SOURCE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
  return { id, kind, duration, width, height, fps, hasAudio, name: file.name, type: file.type };
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

export async function saveProject(project: Project, sources: MediaSource[]): Promise<void> {
  try {
    const record: StoredProject = { project, sources: sources.map(toMeta), savedAt: Date.now(), formatVersion: PROJECT_FORMAT };
    await withDb((db) => run(db, PROJECT_STORE, "readwrite", (s) => s.put(record, KEY)));
  } catch {
    // best-effort
  }
}

export interface RestoredProject {
  project: Project;
  sources: MediaSource[];
  savedAt: number;
}

/** A saved project that exists but can't be offered, with the reason to
 * show - never silently treated as "nothing saved". */
export interface ProjectProblem {
  problem: string;
}

export const isProjectProblem = (r: RestoredProject | ProjectProblem | null): r is ProjectProblem => !!r && "problem" in r;

export async function loadProject(): Promise<RestoredProject | ProjectProblem | null> {
  try {
    return await withDb(async (db) => {
      const record = await run<StoredProject>(db, PROJECT_STORE, "readonly", (s) => s.get(KEY));
      if (!record) return null;
      if ((record.formatVersion ?? 1) > PROJECT_FORMAT) {
        return { problem: "Your last project was saved by a newer version of WipeClip. Update the app to open it." };
      }
      if (!record.project?.clips?.length || !record.sources?.length) return null;
      if (Date.now() - record.savedAt > MAX_AGE_MS) return null;
      const sources: MediaSource[] = [];
      for (const meta of record.sources) {
        const blob = await run<Blob>(db, SOURCE_STORE, "readonly", (s) => s.get(meta.id));
        if (!blob) {
          return { problem: `Your last project can't be reopened: its video "${meta.name}" wasn't saved on this device (storage may have been full). Open the video again to start over.` };
        }
        const { name, type, ...rest } = meta;
        const file = new File([blob], name, { type });
        const recording = await run<MediaSource["recording"]>(db, SOURCE_STORE, "readonly", (s) => s.get(recordingKey(meta.id)));
        sources.push({ ...rest, file, url: URL.createObjectURL(file), ...(recording ? { recording } : {}) });
      }
      return { project: migrateProject(record.project), sources, savedAt: record.savedAt };
    });
  } catch (e) {
    console.error("[project] couldn't read the saved project", e);
    return { problem: "Your last project couldn't be read, so it can't be reopened. Your original video files are not affected." };
  }
}

export async function clearProject(): Promise<void> {
  try {
    await withDb(async (db) => {
      await run(db, PROJECT_STORE, "readwrite", (s) => s.clear());
      await run(db, SOURCE_STORE, "readwrite", (s) => s.clear());
    });
  } catch {
    // best-effort
  }
}

const EXPORT_KEY = "export";

/** Last anonymous export, kept so signing in to download it (which may
 * navigate away) doesn't mean rendering - and paying for - it again.
 */
export async function saveLastExport(blob: Blob): Promise<void> {
  try {
    await withDb((db) => run(db, PROJECT_STORE, "readwrite", (s) => s.put({ blob, savedAt: Date.now() }, EXPORT_KEY)));
  } catch {
    // best-effort
  }
}

export async function loadLastExport(): Promise<Blob | null> {
  try {
    const record = await withDb((db) =>
      run<{ blob: Blob; savedAt: number }>(db, PROJECT_STORE, "readonly", (s) => s.get(EXPORT_KEY))
    );
    if (!record || Date.now() - record.savedAt > 2 * 60 * 60 * 1000) return null;
    return record.blob;
  } catch {
    return null;
  }
}

export async function clearLastExport(): Promise<void> {
  try {
    await withDb((db) => run(db, PROJECT_STORE, "readwrite", (s) => s.delete(EXPORT_KEY)));
  } catch {
    // best-effort
  }
}
