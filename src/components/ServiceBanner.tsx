"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const DISMISS_KEY = "wc-editor-teaser-dismissed";

/** Floating, dismissible teaser for the upcoming desktop editor. Sits at the
 * bottom of the viewport so it never collides with the fixed navbar. */
export default function ServiceBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {}
    const t = setTimeout(() => setVisible(true), 600);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  }

  if (!visible) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      <div className="rounded-full bg-gradient-to-r from-accent via-accent-light to-accent-2 p-px shadow-lg shadow-accent/25">
        <div className="flex items-center gap-3 rounded-full bg-background/95 py-1.5 pl-1.5 pr-2 text-sm backdrop-blur">
          <span className="shrink-0 rounded-full bg-gradient-to-r from-accent to-accent-2 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
            Soon
          </span>
          <span className="text-foreground">
            <span className="font-semibold">WipeClip Editor</span>
            <span className="hidden text-muted sm:inline"> · packed with crazy new features</span>
          </span>
          <Link
            href="/download"
            onClick={dismiss}
            className="shrink-0 rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background transition hover:opacity-90"
          >
            Get notified →
          </Link>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 rounded-full p-1 text-muted transition hover:bg-foreground/10 hover:text-foreground"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
