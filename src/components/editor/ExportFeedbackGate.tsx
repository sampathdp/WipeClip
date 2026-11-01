"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import FeedbackForm from "@/components/FeedbackForm";

const GIVEN_KEY = "wc_export_feedback_given";
const SKIP_AFTER_SECONDS = 10;

/** Whether this device has already sent export feedback once. */
export function exportFeedbackGiven(): boolean {
  try {
    return localStorage.getItem(GIVEN_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberGiven() {
  try {
    localStorage.setItem(GIVEN_KEY, "1");
  } catch {}
}

/** The feedback step of an export: shown while it renders and before the
 * result can be saved, until feedback is sent once (then never again on
 * this device). Skip appears after SKIP_AFTER_SECONDS; skipping only
 * covers this export.
 */
export default function ExportFeedbackGate({ tool, onDone }: { tool: string; onDone: () => void }) {
  const [left, setLeft] = useState(SKIP_AFTER_SECONDS);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setSignedInEmail(data.user?.email ?? null))
      .catch(() => {});
  }, []);

  return (
    <div className="mt-4 rounded-2xl border border-accent/40 bg-surface-2/60 p-4 text-left sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Quick feedback before you save</p>
          <p className="mt-0.5 text-xs text-muted">Tell us once what works and what doesn&apos;t. It helps us improve WipeClip.</p>
        </div>
        {left > 0 ? (
          <span className="shrink-0 font-mono text-xs text-muted" aria-live="off">
            Skip in {left}s
          </span>
        ) : (
          <button type="button" onClick={onDone} className="shrink-0 text-xs font-semibold text-muted hover:text-foreground">
            Skip
          </button>
        )}
      </div>
      <FeedbackForm
        signedInEmail={signedInEmail}
        defaultKind="feedback"
        tool={tool}
        pageUrl={() => window.location.href}
        onSent={() => {
          rememberGiven();
          onDone();
        }}
      />
    </div>
  );
}
