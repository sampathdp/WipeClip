"use client";

import { useDownloadCount } from "@/lib/downloadCount";
import { useI18n } from "@/i18n/client";
import { rich } from "@/i18n/rich";

const Arrow = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  </svg>
);

/** The desktop app's download count as social proof: a glowing pill next
 * to a download button (`pill`), or a large stat (`stat`). Renders nothing
 * until the count is known. */
export default function DownloadCountBadge({ variant = "pill" }: { variant?: "pill" | "stat" }) {
  const count = useDownloadCount();
  const { lang, t } = useI18n();
  if (!count) return null;
  const n = count.toLocaleString(lang);

  if (variant === "stat") {
    return (
      <div className="inline-flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-black">
          <Arrow size={18} />
        </span>
        <span className="text-sm font-medium text-muted">
          {rich(t.downloads.downloadCount, {
            count: <span className="font-display text-2xl font-extrabold tabular-nums text-foreground">{n}</span>,
          })}
        </span>
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 py-1.5 pl-1.5 pr-4 text-sm text-muted shadow-[0_0_25px_rgba(16,185,129,0.25)]">
      <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-black">
        <span aria-hidden className="absolute inset-0 rounded-full bg-emerald-500/60 motion-safe:animate-ping [animation-iteration-count:3]" />
        <span className="relative">
          <Arrow size={14} />
        </span>
      </span>
      {rich(t.downloads.downloadCount, { count: <strong className="font-extrabold tabular-nums text-foreground">{n}</strong> })}
    </span>
  );
}
