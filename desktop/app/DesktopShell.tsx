"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { installUpdate, openExternal, showDesktopError, SITE_ORIGIN } from "@/lib/platform";
import { closeWhatsNew, getServerUpdateSnapshot, getUpdateSnapshot, showWhatsNew, startUpdateChecks, subscribeUpdates } from "@/lib/platform/updates";
import Dialog from "@/components/editor/Dialog";
import releaseNotes from "../release-notes.json";

/** App-wide desktop glue around the editor:
 *  - Links: the app bundles only the editor, so any link to another page
 *    of the site (/pricing, /terms, /profile ...) or any external link opens
 *    in the system browser instead of navigating this window away.
 *  - Sign-in return: Google sign-in and email links come back as
 *    wipeclip://auth/callback?code=..., and the code is exchanged here.
 *  - Offline banner, update banner, "What's new" after an update, and
 *    uncaught errors forwarded to the app's log file.
 */
export default function DesktopShell({ children }: { children: React.ReactNode }) {
  // The recording mini player window gets none of this (no sign-in, links or banner).
  if (usePathname()?.startsWith("/mini")) return <>{children}</>;
  return <MainShell>{children}</MainShell>;
}

function MainShell({ children }: { children: React.ReactNode }) {
  const online = useOnline();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return;
      const raw = a.getAttribute("href") ?? "";
      if (raw.startsWith("#") || raw.startsWith("blob:") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      let target: string | null = null;
      if (url.origin === window.location.origin) {
        // "/" is the editor itself (the header logo); stay in-app.
        if (url.pathname === "/" && !url.hash) return;
        target = `${SITE_ORIGIN}${url.pathname}${url.search}${url.hash}`;
      } else if (url.protocol === "https:" || url.protocol === "http:") {
        target = url.href;
      }
      // Capture phase: runs before next/link's own click handler.
      e.preventDefault();
      e.stopPropagation();
      if (target) void openExternal(target).catch((err) => console.error("[desktop] open link failed", err));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const handle = (urls: string[] | null) => {
      for (const raw of urls ?? []) void finishSignIn(raw);
    };
    import("@tauri-apps/plugin-deep-link")
      .then(async ({ getCurrent, onOpenUrl }) => {
        // Cold start from a link (Windows/Linux pass it at launch).
        handle(await getCurrent());
        const stop = await onOpenUrl(handle);
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch((err) => console.error("[desktop] deep links unavailable", err));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const report = (message: string) => {
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("frontend_log", { level: "error", message: message.slice(0, 4000) }))
        .catch(() => {});
    };
    const onError = (e: ErrorEvent) => report(`${e.message} at ${e.filename}:${e.lineno}`);
    const onRejection = (e: PromiseRejectionEvent) =>
      report(`Unhandled rejection: ${e.reason instanceof Error ? (e.reason.stack ?? e.reason.message) : String(e.reason)}`);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <>
      {!online && (
        <div role="status" className="bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold text-black">
          You&apos;re offline. Editing still works, but opening a new video, AI cleanup, sign-in and export need an internet connection.
        </div>
      )}
      {online && <UpdateBanner />}
      <WhatsNew />
      {children}
    </>
  );
}

/** Sign-in links already handled, kept across reloads: the deep-link
 * plugin hands the launch link back on every page load (getCurrent), and a
 * code can only be exchanged once - retrying it reports a missing PKCE
 * verifier. Stored as SHA-256 hashes, newest last. */
const HANDLED_KEY = "wipeclip.handledAuthLinks";
const handledInMemory = new Set<string>();

async function linkId(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function readHandled(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(HANDLED_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** true the first time a link is seen (this session or any earlier load). */
async function firstTime(raw: string): Promise<boolean> {
  const id = await linkId(raw);
  if (handledInMemory.has(id) || readHandled().includes(id)) return false;
  handledInMemory.add(id);
  try {
    localStorage.setItem(HANDLED_KEY, JSON.stringify([...readHandled(), id].slice(-20)));
  } catch {
    // private storage unavailable: the in-memory set still covers this load
  }
  return true;
}

async function finishSignIn(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  if (url.protocol !== "wipeclip:" || url.host !== "auth" || url.pathname !== "/callback") return;
  if (!(await firstTime(raw))) return;
  // Supabase puts errors in the query (PKCE) or the fragment (implicit).
  const params = new URLSearchParams(url.search || url.hash.replace(/^#/, ""));
  const failure = params.get("error_description") ?? params.get("error");
  if (failure) {
    await showDesktopError("Sign-in failed", failure);
    return;
  }
  const code = params.get("code");
  if (!code) return;
  const supabase = createClient();
  // Already signed in: an old link (e.g. one from before this fix) has
  // nothing left to do.
  if ((await supabase.auth.getSession()).data.session) return;
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    await showDesktopError(
      "Sign-in failed",
      `${error.message}\n\nStart the sign-in again from this app (links opened from a different app or device can't finish here).`
    );
  }
}

/** Versions the user chose "Later" for; not offered again until a newer one
 * (or until they ask with "Check for updates"). */
const SKIPPED_UPDATE_KEY = "wipeclip.skippedUpdate";

/** Offers a new version from the release feed (src-tauri/src/updater.rs,
 * polled by src/lib/platform/updates.ts). Nothing installs without a click;
 * the project autosaves, so the restart loses nothing. */
function UpdateBanner() {
  const { update: found, manual } = useSyncExternalStore(subscribeUpdates, getUpdateSnapshot, getServerUpdateSnapshot);
  const [skipped, setSkipped] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SKIPPED_UPDATE_KEY);
    } catch {
      return null; // storage unavailable (or prerender): just offer it
    }
  });
  const [progress, setProgress] = useState<number | "installing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => startUpdateChecks(), []);

  const update = found && (manual || skipped !== found.version) ? found : null;
  if (!update) return null;

  const install = () => {
    setError(null);
    setProgress(0);
    installUpdate((p) => setProgress(p.event === "installing" ? "installing" : p.total ? Math.round((p.downloaded / p.total) * 100) : 0)).catch((err) => {
      setProgress(null);
      setError(String(err));
    });
  };
  const later = () => {
    try {
      localStorage.setItem(SKIPPED_UPDATE_KEY, update.version);
    } catch {
      // storage unavailable: hidden for this session only
    }
    setSkipped(update.version);
  };
  const notes = feedNotes(update.notes);

  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-accent px-4 py-1.5 text-center text-xs font-semibold text-white">
      {progress === null ? (
        <>
          <span>WipeClip {update.version} is available. The app restarts to update; your project is saved.</span>
          <button type="button" onClick={install} className="rounded-full bg-white px-3 py-0.5 text-black hover:bg-white/90">
            Update now
          </button>
          <button type="button" onClick={later} className="underline hover:no-underline">
            Later
          </button>
          {notes.length > 0 && (
            <button type="button" onClick={() => setShowNotes((v) => !v)} aria-expanded={showNotes} className="underline hover:no-underline">
              {showNotes ? "Hide what's new" : "What's new"}
            </button>
          )}
          {showNotes && (
            <ul className="w-full list-inside list-disc py-1 text-left font-medium sm:mx-auto sm:max-w-xl">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {error &&<span className="w-full font-medium">Update failed: {error}</span>}
        </>
      ) : (
        <span>{progress === "installing" ? "Installing, WipeClip will restart…" : `Downloading WipeClip ${update.version}… ${progress}%`}</span>
      )}
    </div>
  );
}

/** The update feed's notes ("- one\n- two", desktop/scripts/update-manifest.mjs)
 * as a list. Feeds from before 0.1.8 carried a link to the release page
 * instead; that shows nothing. */
function feedNotes(notes: string | null): string[] {
  if (!notes || /^https?:\/\//.test(notes.trim())) return [];
  return notes
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

/** The version this install last ran (or was installed at); a different one
 * at launch means the app updated itself. */
const SEEN_VERSION_KEY = "wipeclip.seenVersion";
/** Set by the update checks (src/lib/platform/updates.ts) to the version
 * offered. Installs from before SEEN_VERSION_KEY existed have only this, so a
 * match means this launch follows that update. */
const NOTIFIED_UPDATE_KEY = "wipeclip.notifiedUpdate";
/** How many releases the footer's "What's new" shows. */
const RECENT_RELEASES = 5;

type Release = (typeof releaseNotes.releases)[number];

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Releases after `since` (all if null) up to `current`, newest first. */
function releasesBetween(since: string | null, current: string): Release[] {
  return releaseNotes.releases.filter(
    (r) => compareVersions(r.version, current) <= 0 && (since === null || compareVersions(r.version, since) > 0)
  );
}

/** "What's new" once after the app updates itself, with the notes of every
 * version since the one last run (desktop/release-notes.json, bundled with
 * the app, so it works offline). A fresh install shows nothing. The editor
 * footer (AppVersion) reopens it with the latest releases. */
function WhatsNew() {
  const { version, whatsNew } = useSyncExternalStore(subscribeUpdates, getUpdateSnapshot, getServerUpdateSnapshot);

  useEffect(() => startUpdateChecks(), []);

  useEffect(() => {
    if (!version) return;
    let seen: string | null;
    let notified: string | null;
    try {
      seen = localStorage.getItem(SEEN_VERSION_KEY);
      notified = localStorage.getItem(NOTIFIED_UPDATE_KEY);
      localStorage.setItem(SEEN_VERSION_KEY, version);
    } catch {
      return; // storage unavailable: can't tell an update from a fresh install
    }
    if (seen === version) return;
    const from = seen ?? (notified === version ? (releasesBetween(null, version)[1]?.version ?? null) : null);
    if (from === null || compareVersions(version, from) <= 0 || !releasesBetween(from, version).length) return;
    showWhatsNew(from);
  }, [version]);

  if (!whatsNew || !version) return null;
  const { since } = whatsNew;
  const releases = since ? releasesBetween(since, version) : releasesBetween(null, version).slice(0, RECENT_RELEASES);

  return (
    <Dialog title={since ? `What's new in WipeClip ${version}` : "What's new in WipeClip"} onClose={closeWhatsNew}>
      {releases.length === 0 ? (
        <p className="text-sm text-muted">No notes for this version yet.</p>
      ) : (
        <div className="space-y-4">
          {releases.map((r) => (
            <section key={r.version}>
              <h3 className="text-sm font-semibold text-foreground">
                Version {r.version}
                <span className="ml-2 font-normal text-muted">{formatDate(r.date)}</span>
              </h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-muted">
                {r.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <div className="mt-5 flex justify-end">
        <button type="button" onClick={closeWhatsNew} className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent/90">
          Got it
        </button>
      </div>
    </Dialog>
  );
}

function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
