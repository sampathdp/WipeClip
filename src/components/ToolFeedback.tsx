"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import FeedbackForm, { type FeedbackKind } from "./FeedbackForm";

const QUICK_PICKS: { kind: FeedbackKind; label: string }[] = [
  { kind: "feedback", label: "Share feedback" },
  { kind: "bug", label: "Report a problem" },
  { kind: "feature", label: "Suggest a feature" },
];

/** Shown under a tool's result: a one-line "how did it turn out?" prompt
 * that opens the same form as /feedback, tagged with the tool and page so
 * the report arrives with its context.
 */
export default function ToolFeedback({ tool, className = "mt-6" }: { tool: string; className?: string }) {
  const [openKind, setOpenKind] = useState<FeedbackKind | null>(null);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);

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
            <p className="text-sm font-semibold text-foreground">Tell us about this result</p>
            <button
              type="button"
              onClick={() => setOpenKind(null)}
              className="text-xs font-semibold text-muted hover:text-foreground"
            >
              Close
            </button>
          </div>
          <FeedbackForm
            key={openKind}
            signedInEmail={signedInEmail}
            defaultKind={openKind}
            tool={tool}
            pageUrl={() => window.location.href}
            signedInSentHint="You can follow its status on the Feedback page."
          />
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="text-sm text-muted">How did this turn out? Your feedback helps us improve it.</p>
          <div className="flex flex-wrap justify-center gap-2">
            {QUICK_PICKS.map((p) => (
              <button
                key={p.kind}
                type="button"
                onClick={() => setOpenKind(p.kind)}
                className="btn-secondary rounded-full px-4 py-2 text-xs font-semibold"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
