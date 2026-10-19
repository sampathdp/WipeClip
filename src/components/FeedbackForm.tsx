"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/platform";

export type FeedbackKind = "bug" | "feature" | "feedback";
export type FeedbackStatus = "open" | "in_progress" | "resolved" | "closed";

export type FeedbackItem = {
  id: number;
  kind: FeedbackKind;
  subject: string;
  message: string;
  status: FeedbackStatus;
  admin_reply: string | null;
  created_at: string;
};

const KIND_OPTIONS: { value: FeedbackKind; label: string; hint: string }[] = [
  { value: "bug", label: "Report a bug", hint: "Something failed, errored, or gave a bad result" },
  { value: "feature", label: "Request a feature", hint: "A tool, option, or format you'd like to see" },
  { value: "feedback", label: "General feedback", hint: "Anything else on your mind" },
];

const PLACEHOLDERS: Record<FeedbackKind, string> = {
  bug: "What did you do, what did you expect, and what happened instead? Include the file type, resolution and any error message you saw.",
  feature: "What would you like WipeClip.co to do, and what would you use it for?",
  feedback: "Tell us what's working, what isn't, or anything else.",
};

/** The bug report / feature request / feedback form. Used on the /feedback
 * page and, via ToolFeedback, under every tool's result.
 */
export default function FeedbackForm({
  signedInEmail,
  defaultKind = "bug",
  tool,
  pageUrl,
  signedInSentHint = "You can follow its status under “Your requests” below.",
  onSent,
}: {
  signedInEmail: string | null;
  defaultKind?: FeedbackKind;
  /** Which tool produced the output being commented on (e.g. "background_remover"). */
  tool?: string;
  /** Page the feedback is about. Defaults to the page that linked here. */
  pageUrl?: () => string | null;
  signedInSentHint?: string;
  onSent?: (item: FeedbackItem | null) => void;
}) {
  const [kind, setKind] = useState<FeedbackKind>(defaultKind);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const idPrefix = tool ? `fb-${tool}` : "fb";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setError(null);

    try {
      const res = await apiFetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          subject,
          message,
          email: signedInEmail ? undefined : email,
          website,
          tool,
          pageUrl: pageUrl ? pageUrl() : document.referrer || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }
      onSent?.(signedInEmail && data?.item ? (data.item as FeedbackItem) : null);
      setSubject("");
      setMessage("");
      setStatus("sent");
    } catch {
      setError("Network error. Check your connection and try again.");
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <div className="rounded-2xl border border-cyan-400/40 bg-cyan-50 p-6 text-center text-sm text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300">
        <div className="mb-2 text-2xl">✓</div>
        <p className="font-medium">Thanks, we got it.</p>
        <p className="mt-1 text-xs text-muted">
          {signedInEmail
            ? signedInSentHint
            : email
              ? `We'll reply to ${email} if we need more details.`
              : "Sign in next time if you'd like to track its status."}
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="btn-secondary mt-5 rounded-full px-5 py-2 text-xs font-semibold"
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="relative flex flex-col gap-5 text-left">
      <fieldset>
        <legend className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted">
          What&apos;s this about?
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {KIND_OPTIONS.map((o) => (
            <label
              key={o.value}
              className={`cursor-pointer rounded-xl border p-3 text-left transition-all ${
                kind === o.value
                  ? "border-cyan-500/60 bg-cyan-500/10 shadow-[0_0_15px_rgba(34,211,238,0.15)]"
                  : "border-border hover:border-cyan-500/40"
              }`}
            >
              <input
                type="radio"
                name={`${idPrefix}-kind`}
                value={o.value}
                checked={kind === o.value}
                onChange={() => setKind(o.value)}
                className="sr-only"
              />
              <span className="block text-sm font-semibold text-foreground">{o.label}</span>
              <span className="mt-0.5 block text-xs text-muted">{o.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${idPrefix}-subject`} className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted">
          Title
        </label>
        <input
          id={`${idPrefix}-subject`}
          required
          maxLength={140}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={kind === "bug" ? "e.g. 4K export stuck at 90%" : "A short summary"}
          className="glass-input w-full rounded-xl px-4 py-3.5 text-sm"
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-message`} className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted">
          Details
        </label>
        <textarea
          id={`${idPrefix}-message`}
          required
          minLength={10}
          maxLength={5000}
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={PLACEHOLDERS[kind]}
          className="glass-input w-full resize-y rounded-xl px-4 py-3.5 text-sm"
        />
      </div>

      {signedInEmail ? (
        <p className="text-xs text-muted">
          Sending as <strong className="text-foreground">{signedInEmail}</strong>.
        </p>
      ) : (
        <div>
          <label htmlFor={`${idPrefix}-email`} className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted">
            Email <span className="normal-case tracking-normal font-normal">(optional, so we can reply)</span>
          </label>
          <input
            id={`${idPrefix}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            className="glass-input w-full rounded-xl px-4 py-3.5 text-sm"
          />
        </div>
      )}

      {/* Honeypot - hidden from people, filled in by naive bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />

      <button
        type="submit"
        disabled={status === "sending"}
        className="btn-primary w-full rounded-full py-3.5 text-sm font-bold disabled:opacity-50 sm:w-auto sm:self-start sm:px-10"
      >
        {status === "sending" ? "Sending…" : "Send"}
      </button>

      {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
    </form>
  );
}
