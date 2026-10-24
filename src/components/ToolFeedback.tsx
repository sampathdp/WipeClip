"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import FeedbackForm, { type FeedbackKind } from "./FeedbackForm";
import { useI18n } from "@/i18n/client";

const QUICK_PICKS: FeedbackKind[] = ["feedback", "bug", "feature"];

/** Shown under a tool's result: a one-line "how did it turn out?" prompt
 * that opens the same form as /feedback, tagged with the tool and page so
 * the report arrives with its context.
 */
export default function ToolFeedback({ tool, className = "mt-6" }: { tool: string; className?: string }) {
  const [openKind, setOpenKind] = useState<FeedbackKind | null>(null);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const t = useI18n().t.feedback;

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setSignedInEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedInEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <div className={`${className} rounded-2xl border border-border/80 bg-surface-2/40 p-4 sm:p-5`}>
      {openKind ? (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">{t.toolTitle}</p>
            <button
              type="button"
              onClick={() => setOpenKind(null)}
              className="text-xs font-semibold text-muted hover:text-foreground"
            >
              {t.close}
            </button>
          </div>
          <FeedbackForm
            key={openKind}
            signedInEmail={signedInEmail}
            defaultKind={openKind}
            tool={tool}
            pageUrl={() => window.location.href}
            signedInSentHint={t.sentHintTool}
          />
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="text-sm text-muted">{t.toolPrompt}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {QUICK_PICKS.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setOpenKind(kind)}
                className="btn-secondary rounded-full px-4 py-2 text-xs font-semibold"
              >
                {t.quick[kind]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
