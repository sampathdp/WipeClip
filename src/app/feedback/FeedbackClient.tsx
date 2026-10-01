"use client";

import { useState } from "react";
import Link from "next/link";

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

const KIND_LABEL: Record<FeedbackKind, string> = {
  bug: "Bug",
  feature: "Feature request",
  feedback: "Feedback",
};

const STATUS_STYLE: Record<FeedbackStatus, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-cyan-500/15 border-cyan-500/30 text-cyan-700 dark:text-cyan-300" },
  in_progress: {
    label: "In progress",
    className: "bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300",
  },
  resolved: {
    label: "Resolved",
    className: "bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
  },
  closed: { label: "Closed", className: "bg-slate-500/15 border-slate-500/30 text-muted" },
};

const PLACEHOLDERS: Record<FeedbackKind, string> = {
  bug: "What did you do, what did you expect, and what happened instead? Include the file type, resolution and any error message you saw.",
  feature: "What would you like WipeClip.co to do, and what would you use it for?",
  feedback: "Tell us what's working, what isn't, or anything else.",
};

export default function FeedbackClient({
  signedInEmail,
  initialItems,
}: {
  signedInEmail: string | null;
  initialItems: FeedbackItem[];
}) {
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<FeedbackItem[]>(initialItems);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setError(null);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          subject,
          message,
          email: signedInEmail ? undefined : email,
          website,
          pageUrl: document.referrer || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }
      if (signedInEmail && data?.item) setItems((prev) => [data.item as FeedbackItem, ...prev]);
      setSubject("");
      setMessage("");
      setStatus("sent");
    } catch {
      setError("Network error. Check your connection and try again.");
      setStatus("error");
    }
  };

  return (
    <>
      <div className="mt-8 glass-card rounded-[1.75rem] border border-border/80 p-6 sm:p-8">
        {status === "sent" ? (
          <div className="rounded-2xl border border-cyan-400/40 bg-cyan-50 p-6 text-center text-sm text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300">
            <div className="mb-2 text-2xl">✓</div>
            <p className="font-medium">Thanks, we got it.</p>
            <p className="mt-1 text-xs text-muted">
              {signedInEmail
                ? "You can follow its status under “Your requests” below."
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
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-5">
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
                      name="kind"
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
              <label htmlFor="fb-subject" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted">
                Title
              </label>
              <input
                id="fb-subject"
                required
                maxLength={140}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={kind === "bug" ? "e.g. 4K export stuck at 90%" : "A short summary"}
                className="glass-input w-full rounded-xl px-4 py-3.5 text-sm"
              />
            </div>

            <div>
              <label htmlFor="fb-message" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted">
                Details
              </label>
              <textarea
                id="fb-message"
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
                <label htmlFor="fb-email" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted">
                  Email <span className="normal-case tracking-normal font-normal">(optional, so we can reply)</span>
                </label>
                <input
                  id="fb-email"
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
        )}
      </div>

      <section className="mt-12">
        <h2 className="font-display text-xl font-bold tracking-tight text-foreground">Your requests</h2>
        {!signedInEmail ? (
          <p className="mt-2 text-sm text-muted">
            <Link href="/sign-in" className="font-medium text-cyan-600 hover:text-cyan-700">
              Sign in
            </Link>{" "}
            to see the bugs and requests you&apos;ve sent and follow their status.
          </p>
        ) : items.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing sent yet. Anything you submit will show up here.</p>
        ) : (
          <div className="mt-4 glass-card divide-y divide-border/60 overflow-hidden rounded-[1.75rem] border border-border/80">
            {items.map((item) => {
              const s = STATUS_STYLE[item.status] ?? STATUS_STYLE.open;
              return (
                <details key={item.id} className="group px-5 py-4 sm:px-6">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{item.subject}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {KIND_LABEL[item.kind] ?? item.kind} · {new Date(item.created_at).toLocaleDateString()}
                        {item.admin_reply ? " · reply from the team" : ""}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${s.className}`}>
                      {s.label}
                    </span>
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">{item.message}</p>
                  {item.admin_reply && (
                    <div className="mt-3 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm leading-6">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-600">
                        WipeClip team
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
