/** Desktop update checks, shared by the update banner (DesktopShell) and the
 * "Check for updates" link in the editor footer. The release feed is polled
 * in the background and on window focus, so a new release shows up within
 * minutes; if WipeClip isn't focused when one is found, an OS notification
 * points the user back to the app.
 */
import { checkForUpdate, getDesktopCapabilities, IS_DESKTOP, notifyIfAway, type AppUpdate } from "./index";

export type UpdateStatus = "idle" | "checking" | "upToDate" | "available" | "error";

export interface UpdateSnapshot {
  /** This app's version; null on the website and until it's read. */
  version: string | null;
  status: UpdateStatus;
  update: AppUpdate | null;
  /** The last check was started from the footer link (not the background poll). */
  manual: boolean;
  error: string | null;
}

const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 15 * 60 * 1000;
/** Focusing the window rechecks, at most this often. */
const FOCUS_RECHECK_MS = 5 * 60 * 1000;
/** Versions already announced with an OS notification. */
const NOTIFIED_KEY = "wipeclip.notifiedUpdate";

let snapshot: UpdateSnapshot = { version: null, status: "idle", update: null, manual: false, error: null };
const listeners = new Set<() => void>();
let lastCheck = 0;
let inFlight: Promise<void> | null = null;
let started = false;

function set(patch: Partial<UpdateSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const l of listeners) l();
}

export function subscribeUpdates(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUpdateSnapshot(): UpdateSnapshot {
  return snapshot;
}

const SERVER_SNAPSHOT = snapshot;
export function getServerUpdateSnapshot(): UpdateSnapshot {
  return SERVER_SNAPSHOT;
}

function announce(update: AppUpdate) {
  try {
    if (localStorage.getItem(NOTIFIED_KEY) === update.version) return;
    localStorage.setItem(NOTIFIED_KEY, update.version);
  } catch {
    // storage unavailable: may notify again next launch
  }
  void notifyIfAway(`WipeClip ${update.version} is available`, "Open WipeClip to update. Your project is saved.");
}

/** Checks the release feed now. `manual` checks report "up to date" and
 * errors in the footer; background checks stay quiet. */
export function checkUpdatesNow(manual = false): Promise<void> {
  if (!IS_DESKTOP) return Promise.resolve();
  if (inFlight) {
    if (manual) set({ manual: true });
    return inFlight;
  }
  lastCheck = Date.now();
  set({ status: "checking", manual, error: null });
  inFlight = checkForUpdate()
    .then((found) => {
      if (found) {
        set({ status: "available", update: found });
        announce(found);
      } else {
        set({ status: "upToDate", update: null });
      }
    })
    .catch((err) => {
      console.warn("[desktop] update check failed", err);
      // Keep an update already found; a failed recheck doesn't hide it.
      set({ status: snapshot.update ? "available" : "error", error: String(err) });
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Starts the background checks once per page load. */
export function startUpdateChecks(): void {
  if (!IS_DESKTOP || started) return;
  started = true;
  getDesktopCapabilities()
    .then((c) => set({ version: c.version }))
    .catch(() => {});
  setTimeout(() => void checkUpdatesNow(), FIRST_CHECK_MS);
  setInterval(() => void checkUpdatesNow(), CHECK_EVERY_MS);
  const recheck = () => {
    if (navigator.onLine && Date.now() - lastCheck > FOCUS_RECHECK_MS) void checkUpdatesNow();
  };
  window.addEventListener("focus", recheck);
  window.addEventListener("online", recheck);
}
