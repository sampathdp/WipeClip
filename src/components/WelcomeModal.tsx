"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AI_CLEANUP_ENABLED } from "@/lib/features";

const STORAGE_KEY = "wipeclip_welcome_seen";
const OPEN_DELAY_MS = 1200;

const highlights = [
  {
    title: "Free editor, clean exports",
    desc: "Trim, split, transitions, text, stickers and music. Free exports carry no WipeClip mark.",
    icon: <path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M9 12l2 2 4-4" />,
  },
  ...(AI_CLEANUP_ENABLED
    ? [
        {
          title: "AI object removal",
          desc: "Mark a passer-by or stray cable and the area is rebuilt from the motion around it. No blur box.",
          icon: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />,
        },
      ]
    : []),
  {
    title: "Auto captions and picture-in-picture",
    desc: "Generate captions from speech and layer clips on top of each other, all in the browser.",
    icon: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M7 15h4M13 15h4" />
      </>
    ),
  },
  {
    title: "Free photo tools",
    desc: "Background remover, photo sharpener and frame grabber, built in.",
    icon: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-5-5L5 21" />
      </>
    ),
  },
  {
    title: "Your files are not kept",
    desc: "Uploads are processed in temporary storage and deleted once your result is ready.",
    icon: <path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z" />,
  },
];

/** First-visit popup on the homepage summarising what sets WipeClip apart.
 * Shown once per browser: dismissing it (any way) records that in
 * localStorage. If storage is unavailable the popup is skipped rather than
 * shown on every visit.
 */
export default function WelcomeModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {}
    if (seen) return;
    const timer = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-modal-heading"
        className="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-[2rem] p-7 sm:p-8 border border-cyan-500/25 shadow-[0_20px_50px_rgba(15,23,42,0.10)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.8)] relative"
      >
        <button
          onClick={close}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-muted hover:text-foreground hover:bg-surface-2/80"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border px-3.5 py-1 text-xs font-semibold text-muted">
          Welcome to WipeClip
        </div>
        <h2 id="welcome-modal-heading" className="font-display text-2xl font-extrabold tracking-tight text-foreground pr-6">
          Edit on your desktop,{" "}
          <span className="text-gradient">{AI_CLEANUP_ENABLED ? "clean up with AI" : "caption with AI"}</span>
        </h2>
        <p className="mt-1.5 text-sm text-muted">Here&apos;s what you get, free.</p>

        <ul className="mt-6 space-y-4">
          {highlights.map((h) => (
            <li key={h.title} className="flex gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/30 bg-gradient-to-tr from-accent/20 to-accent-2/20 text-cyan-500">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {h.icon}
                </svg>
              </div>
              <div>
                <h3 className="font-display text-sm font-bold text-foreground">{h.title}</h3>
                <p className="mt-0.5 text-xs sm:text-sm leading-relaxed text-muted">{h.desc}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={close}
            className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-surface-2/80"
          >
            Look around
          </button>
          <Link
            href="/download"
            onClick={close}
            className="rounded-full bg-gradient-to-r from-accent to-cyan-500 px-5 py-2.5 text-center text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(124,92,255,0.7)] hover:opacity-95"
          >
            Download the app
          </Link>
        </div>
      </div>
    </div>
  );
}
