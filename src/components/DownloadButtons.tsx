"use client";

import { useSyncExternalStore } from "react";
import { DESKTOP_DOWNLOADS } from "@/lib/download";
import { currentPath, trackEvent } from "@/lib/analytics";

type Os = (typeof DESKTOP_DOWNLOADS)[number]["os"];

const noSubscribe = () => () => {};

function detectOs(): Os | null {
  try {
    const ua = navigator.userAgent;
    if (/Windows/i.test(ua)) return "windows";
    if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) return "mac";
  } catch {
    // Best-effort only; both buttons stay equal.
  }
  return null;
}

const ICONS: Record<Os, React.ReactNode> = {
  windows: (
    <path d="M3 5.5 10.5 4.5v7H3zM12 4.3 21 3v8.5h-9zM3 13h7.5v7L3 19zM12 13h9v8l-9-1.3z" fill="currentColor" stroke="none" />
  ),
  mac: (
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
};

/** Windows and macOS download buttons. The one matching the visitor's OS is
 * shown first and highlighted; an installer with no URL yet shows
 * "Coming soon". `compact` is the single-row variant for promo sections.
 */
export default function DownloadButtons({ compact = false }: { compact?: boolean }) {
  // The server render (and first client render) knows no OS; the client
  // then reads it from the user agent, which never changes.
  const os = useSyncExternalStore(noSubscribe, detectOs, () => null);

  const items = [...DESKTOP_DOWNLOADS].sort((a, b) => Number(b.os === os) - Number(a.os === os));

  return (
    <div className={compact ? "flex flex-wrap gap-3" : "grid gap-4 sm:grid-cols-2"}>
      {items.map((d) => {
        const primary = os ? d.os === os : d.os === "windows";
        const icon = (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {ICONS[d.os]}
          </svg>
        );
        const button = d.url ? (
          <a
            href={d.url}
            onClick={() => trackEvent("desktop_download_clicked", { os: d.os, source_page: currentPath() })}
            className={`${primary ? "btn-primary" : "btn-secondary"} inline-flex items-center justify-center gap-2.5 rounded-full px-6 py-3 text-sm font-bold`}
          >
            {icon}
            Download for {d.label}
          </a>
        ) : (
          <span
            aria-disabled
            className="btn-secondary inline-flex cursor-not-allowed items-center justify-center gap-2.5 rounded-full px-6 py-3 text-sm font-semibold opacity-60"
          >
            {icon}
            {d.label}: coming soon
          </span>
        );

        if (compact) return <div key={d.os}>{button}</div>;
        return (
          <div key={d.os} className={`glass-card flex flex-col rounded-[1.5rem] p-6 ${primary ? "ring-1 ring-cyan-500/40" : ""}`}>
            <h3 className="font-display text-lg font-bold text-foreground">WipeClip for {d.label}</h3>
            <p className="mt-1 text-sm text-muted">{d.file}</p>
            <p className="mt-1 text-xs text-muted">{d.requirements}</p>
            <div className="mt-5 flex">{button}</div>
          </div>
        );
      })}
    </div>
  );
}
