"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { openExternal, showDesktopError, SITE_ORIGIN } from "@/lib/platform";

/** App-wide desktop glue around the editor:
 *  - Links: the app bundles only the editor, so any link to another page
 *    of the site (/pricing, /terms, /profile ...) or any external link opens
 *    in the system browser instead of navigating this window away.
 *  - Sign-in return: Google sign-in and email links come back as
 *    wipeclip://auth/callback?code=..., and the code is exchanged here.
 *  - Offline banner, and uncaught errors forwarded to the app's log file.
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
