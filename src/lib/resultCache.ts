/** Client-side (IndexedDB) holding pen for one anonymous processing result,
 * so it survives whatever sign-in path the visitor actually takes -
 * SignInModal's password flow resolves in-page and never needed this, but
 * magic link, Google OAuth, and the Navbar's own "Sign in" link all do a
 * real page navigation, which throws away React state and invalidates any
 * blob: URL created via URL.createObjectURL. IndexedDB is disk-backed and
 * survives that; a plain in-memory variable wouldn't.
 *
 * Deliberately NOT server-side storage: this project doesn't have object
 * storage (out of scope), and "zero files stored" is a product promise -
 * this stays entirely in the visitor's own browser, one record at a time.
 */

const DB_NAME = "wipeclip-pending-result";
const STORE_NAME = "result";
const RECORD_KEY = "current";
const MAX_AGE_MS = 2 * 60 * 60 * 1000; // don't resurrect something from days-old browser state

export interface PendingResult {
  filename: string;
  originalBlob: Blob;
  resultBlob: Blob;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Best-effort: never throws. A failure here (private browsing, quota,
 * browser without IndexedDB) just means the visitor won't get an automatic
 * restore after signing in - not a reason to break the preview itself.
 */
export async function savePendingResult(entry: Omit<PendingResult, "savedAt">): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ ...entry, savedAt: Date.now() }, RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // best-effort, see docstring
  }
}

export async function loadPendingResult(): Promise<PendingResult | null> {
  try {
    const db = await openDb();
    const record = await new Promise<PendingResult | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!record) return null;
    if (Date.now() - record.savedAt > MAX_AGE_MS) {
      await clearPendingResult();
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

export async function clearPendingResult(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // best-effort, see docstring
  }
}
