"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const FREE_TOOLS = [
  { href: "/remove-background", label: "Background Remover" },
  { href: "/extract-video-frame", label: "Video Frame Grabber" },
  { href: "/sharpen-image", label: "Photo Sharpener" },
];

const DISMISS_KEY = "wipeclip_free_tools_banner_dismissed";

function GiftIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
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
      <div className="relative isolate overflow-hidden bg-gradient-to-r from-accent via-indigo-500 to-accent-2 px-4 py-2.5 text-white">
        {/* Compact single-line variant for narrow screens */}
        <Link
          href="/#tools"
          className="flex items-center justify-center gap-1.5 px-8 text-center text-xs font-semibold sm:hidden"
        >
          <GiftIcon />
          <span>3 free tools, no sign-up &mdash; see them</span>
          <span aria-hidden>&rarr;</span>
        </Link>

        {/* Full list, one link per tool, on wider screens */}
        <div className="mx-auto hidden max-w-7xl flex-wrap items-center justify-center gap-x-2.5 gap-y-1 px-8 text-center text-sm font-semibold sm:flex">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <GiftIcon />
            3 free tools, no sign-up required:
          </span>
          {FREE_TOOLS.map((t, i) => (
            <span key={t.href} className="inline-flex items-center gap-2.5">
              <Link href={t.href} className="underline decoration-white/50 underline-offset-2 transition-colors hover:decoration-white">
                {t.label}
              </Link>
              {i < FREE_TOOLS.length - 1 && <span className="opacity-50">&bull;</span>}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss banner"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
