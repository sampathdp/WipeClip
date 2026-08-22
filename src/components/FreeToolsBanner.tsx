"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const FREE_TOOLS = [
  {
    href: "/remove-background",
    label: "Background Remover",
    icon: (
      <>
        <path d="M12 2a5 5 0 0 1 5 5c0 2-1 3.5-2.5 5L12 15l-2.5-3C8 10.5 7 9 7 7a5 5 0 0 1 5-5Z" />
        <path d="M5 21c0-3 3-5 7-5s7 2 7 5" />
      </>
    ),
  },
  {
    href: "/extract-video-frame",
    label: "Video Frame Grabber",
    icon: (
      <>
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
  },
  {
    href: "/sharpen-image",
    label: "Photo Sharpener",
    icon: (
      <>
        <path d="M12 2 2 7l10 5 10-5-10-5Z" />
        <path d="m2 17 10 5 10-5M2 12l10 5 10-5" />
      </>
    ),
  },
];

const DISMISS_KEY = "wipeclip_free_tools_banner_dismissed";

function GiftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M20 12v9H4v-9M2 7h20v5H2V7ZM12 22V7M12 7a2.5 2.5 0 0 1 0-5C13.5 2 15 3.5 15 5.5S13.5 7 12 7ZM12 7a2.5 2.5 0 0 0 0-5C10.5 2 9 3.5 9 5.5S10.5 7 12 7Z" />
    </svg>
  );
}

export default function FreeToolsBanner() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") setDismissed(true);
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="pt-16">
      <div className="relative isolate overflow-hidden border-b border-cyan-500/20 bg-gradient-to-r from-accent/10 via-surface-2/90 to-accent-2/10 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-2 px-10 py-2.5 sm:gap-2.5">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-bold text-foreground sm:text-sm">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-tr from-accent to-accent-2 text-white shadow-[0_0_10px_rgba(34,211,238,0.4)]">
              <GiftIcon />
            </span>
            <span className="hidden sm:inline">3 free tools, no sign-up:</span>
            <span className="sm:hidden">Free tools:</span>
          </span>

          {FREE_TOOLS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-3/70 px-3 py-1 text-[11px] font-semibold text-muted transition-all hover:-translate-y-px hover:border-cyan-400/50 hover:text-cyan-700 hover:shadow-[0_0_12px_rgba(34,211,238,0.25)] dark:hover:text-cyan-300 sm:text-xs"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-cyan-600 dark:text-cyan-400">
                {t.icon}
              </svg>
              {t.label}
            </Link>
          ))}
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss banner"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-foreground"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
