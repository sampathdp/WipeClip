"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type View = "password" | "magic";
type PasswordAction = "signin" | "signup";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.95v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.05l3.02-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/** In-page sign-in, deliberately NOT a redirect to /sign-in - this opens
 * over whatever the caller is already showing (see UploadDemo.tsx's
 * "sign in to download" gate). A processed-but-not-yet-downloaded result
 * is persisted to IndexedDB before this opens (see resultCache.ts) and
 * restored once signed in, specifically so it survives whichever path the
 * visitor picks here - including Google's full-page OAuth redirect, which
 * would otherwise lose anything only held in memory.
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
  const [googleLoading, setGoogleLoading] = useState(false);

  if (!open) return null;

  const signInWithGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (err) {
      setError(err.message);
      setGoogleLoading(false);
    }
    // On success the browser navigates away to Google's consent screen -
    // the pending result is already saved to IndexedDB by this point
    // (UploadDemo.tsx saves it right after processing, before this modal
    // is even reachable), so no further state update is needed here.
  };

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
          <>
            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={googleLoading}
              className="mt-6 flex w-full items-center justify-center gap-3 rounded-full border border-border-light bg-white py-3 text-sm font-semibold text-slate-800 transition-all hover:shadow-[0_0_20px_rgba(255,255,255,0.15)] disabled:opacity-50"
            >
              <GoogleIcon />
              {googleLoading ? "Redirecting…" : "Continue with Google"}
            </button>

            <div className="my-4 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>

            <form
              onSubmit={view === "magic" ? sendMagicLink : submitPassword}
              className="flex flex-col gap-3 text-left"
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
          </>
        )}
      </div>
    </div>
  );
}
