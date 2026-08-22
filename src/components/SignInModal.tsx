"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type View = "password" | "magic";
type PasswordAction = "signin" | "signup";

/** In-page sign-in, deliberately NOT a redirect to /sign-in - this opens
 * over whatever the caller is already showing (see UploadDemo.tsx's
 * "sign in to download" gate) so a processed-but-not-yet-downloaded result
 * already sitting in the caller's component state (a blob: URL - nothing
 * is stored server-side) survives the sign-in. Only the password flow is
 * offered as primary for that reason: supabase.auth.signInWithPassword/
 * signUp resolve in-page with no navigation. Magic link is offered too
 * (cross-tab session sync picks it up), but Google OAuth is deliberately
 * left out here - it's a full-page redirect, which would lose the caller's
 * in-memory state. Use the full /sign-in page for that.
 */
export default function SignInModal({
  open,
  onClose,
  onSignedIn,
}: {
  open: boolean;
  onClose: () => void;
  onSignedIn?: () => void;
}) {
  const [view, setView] = useState<View>("password");
  const [passwordAction, setPasswordAction] = useState<PasswordAction>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const supabase = createClient();

    if (passwordAction === "signup") {
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (err) {
        setError(err.message);
        setStatus("error");
        return;
      }
      if (data.session) {
        setStatus("idle");
        onSignedIn?.();
        onClose();
        return;
      }
      // Email confirmation required - can't skip that just because this is
      // a modal, so this one case does ask the visitor to leave the page.
      setStatus("sent");
      return;
    }

    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
      setStatus("error");
      return;
    }
    setStatus("idle");
    onSignedIn?.();
    onClose();
  };

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (err) {
      setError(err.message);
      setStatus("error");
      return;
    }
    setStatus("sent");
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-card w-full max-w-sm rounded-[2rem] p-7 sm:p-8 border border-cyan-500/25 shadow-[0_20px_50px_rgba(0,0,0,0.8)] relative"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-muted hover:text-foreground hover:bg-surface-2/80"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <h2 className="font-display text-xl font-bold tracking-tight text-foreground pr-6">
          Sign in to download
        </h2>
        <p className="mt-1.5 text-xs sm:text-sm text-muted">
          Your clean video stays right here - sign in and it&apos;s ready to download immediately.
        </p>

        {status === "sent" ? (
          <div className="mt-6 rounded-2xl bg-cyan-950/40 border border-cyan-400/40 p-5 text-sm text-cyan-200">
            <p className="font-medium">Check your email</p>
            <p className="mt-1 text-xs text-muted">
              We sent a link to <strong className="text-cyan-300">{email}</strong>. Opening it
              signs you in here too.
            </p>
          </div>
        ) : (
          <form
            onSubmit={view === "magic" ? sendMagicLink : submitPassword}
            className="mt-6 flex flex-col gap-3 text-left"
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="glass-input w-full rounded-xl px-4 py-3 text-sm"
            />
            {view === "password" && (
              <input
                type="password"
                required
                minLength={6}
                autoComplete={passwordAction === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="glass-input w-full rounded-xl px-4 py-3 text-sm"
              />
            )}

            <button
              type="submit"
              disabled={status === "sending"}
              className="btn-primary mt-1 w-full rounded-full py-3 text-sm font-bold disabled:opacity-50"
            >
              {status === "sending"
                ? "Please wait…"
                : view === "magic"
                  ? "Send sign-in link"
                  : passwordAction === "signup"
                    ? "Create account"
                    : "Sign in"}
            </button>

            {error && <p className="text-center text-xs font-medium text-rose-400">{error}</p>}

            <div className="mt-1 flex flex-col items-center gap-1.5 text-xs text-muted">
              {view === "password" ? (
                <>
                  <button
                    type="button"
                    onClick={() => setPasswordAction((a) => (a === "signin" ? "signup" : "signin"))}
                    className="hover:text-foreground"
                  >
                    {passwordAction === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
                  </button>
                  <button type="button" onClick={() => setView("magic")} className="hover:text-foreground">
                    Prefer a magic link instead?
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setView("password")} className="hover:text-foreground">
                  Use email and password instead
                </button>
              )}
              <Link href="/sign-in" className="hover:text-foreground">
                Or open the full sign-in page
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
