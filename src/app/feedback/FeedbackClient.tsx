"use client";

import { useState } from "react";
import Link from "next/link";
import FeedbackForm, { type FeedbackItem, type FeedbackStatus } from "@/components/FeedbackForm";
import { useI18n, useLocaleHref } from "@/i18n/client";

export type { FeedbackItem };

const STATUS_STYLE: Record<FeedbackStatus, string> = {
  open: "bg-cyan-500/15 border-cyan-500/30 text-cyan-700 dark:text-cyan-300",
  in_progress: "bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300",
  resolved: "bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
  closed: "bg-slate-500/15 border-slate-500/30 text-muted",
};

export default function FeedbackClient({
  signedInEmail,
  initialItems,
}: {
  signedInEmail: string | null;
  initialItems: FeedbackItem[];
}) {
  const [items, setItems] = useState<FeedbackItem[]>(initialItems);
  const { lang, t: messages } = useI18n();
  const t = messages.feedback;
  const href = useLocaleHref();

  return (
    <>
      <div className="mt-8 glass-card rounded-[1.75rem] border border-border/80 p-6 sm:p-8">
        <FeedbackForm
          signedInEmail={signedInEmail}
          onSent={(item) => item && setItems((prev) => [item, ...prev])}
        />
      </div>

      <section className="mt-12">
        <h2 className="font-display text-xl font-bold tracking-tight text-foreground">{t.yourRequests}</h2>
        {!signedInEmail ? (
          <p className="mt-2 text-sm text-muted">
            <Link href={href("/sign-in")} className="font-medium text-cyan-600 hover:text-cyan-700">
              {t.signIn}
            </Link>{" "}
            {t.signInToSee}
          </p>
        ) : items.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t.nothingYet}</p>
        ) : (
          <div className="mt-4 glass-card divide-y divide-border/60 overflow-hidden rounded-[1.75rem] border border-border/80">
            {items.map((item) => {
              const status = item.status in STATUS_STYLE ? item.status : "open";
              return (
                <details key={item.id} className="group px-5 py-4 sm:px-6">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{item.subject}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {t.kindLabels[item.kind] ?? item.kind} · {new Date(item.created_at).toLocaleDateString(lang)}
                        {item.admin_reply ? t.replied : ""}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status]}`}>
                      {t.statuses[status]}
                    </span>
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">{item.message}</p>
                  {item.admin_reply && (
                    <div className="mt-3 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm leading-6">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-600">
                        {t.team}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-foreground">{item.admin_reply}</p>
                    </div>
                  )}
                </details>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
