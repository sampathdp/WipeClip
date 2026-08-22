"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Logo from "@/components/Logo";
import { createClient } from "@/lib/supabase/client";

type View = "password" | "magic" | "forgot";
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

export default function SignInClient() {
  const router = useRouter();
  const [view, setView] = useState<View>("password");
  const [passwordAction, setPasswordAction] = useState<PasswordAction>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

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
    // no further state update needed here.
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
        router.push("/");
        return;
      }
      // Email confirmation is required before a session exists.
      setStatus("sent");
      return;
    }

    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
      setStatus("error");
      return;
    }
    router.push("/");
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

  const sendResetLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
    });
    if (err) {
      setError(err.message);
      setStatus("error");
      return;
    }
    setStatus("sent");
  };

  const switchView = (next: View) => {
    setView(next);
    setStatus("idle");
    setError(null);
    setPassword("");
  };

  const sentCopy =
    view === "forgot"
      ? "We sent a password reset link to"
      : view === "magic"
        ? "We sent a sign-in link to"
        : "Confirm your account via the link we sent to";

  return (
    <div className="flex flex-1 flex-col min-h-screen">
      <Navbar />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 pt-36 pb-28 relative overflow-hidden">
        {/* Background glow mesh */}
        <div
          aria-hidden
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-80 w-80 rounded-full bg-accent/6 blur-[100px] pointer-events-none -z-10 dark:bg-accent/20"
        />

        <div className="glass-card rounded-[2.5rem] p-8 sm:p-10 border border-cyan-500/25 shadow-[0_20px_50px_rgba(15,23,42,0.10)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.8)] text-center">
          <div className="flex justify-center mb-6">
            <Logo size={48} showText={false} />
          </div>

          <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            {view === "password" && passwordAction === "signup" ? (
              <>
                Create your <span className="text-gradient">WipeClip.co</span> account
              </>
            ) : (
              <>
                Sign in to <span className="text-gradient">WipeClip.co</span>
              </>
            )}
          </h1>

          {status === "sent" ? (
            <div className="mt-8 rounded-2xl bg-cyan-50 border border-cyan-400/40 p-6 text-sm text-cyan-700 shadow-[0_0_25px_rgba(34,211,238,0.2)]">
              <div className="mb-2 text-2xl">✓</div>
              <p className="font-medium">Check your email</p>
              <p className="mt-1 text-xs text-muted">
                {sentCopy} <strong className="text-cyan-600">{email}</strong>.
              </p>
            </div>
          ) : (
            <>
              <p className="mt-2.5 text-xs sm:text-sm text-muted">
                {view === "magic"
                  ? "Passwordless magic link. We will send an instant login link to your inbox."
                  : view === "forgot"
                    ? "Enter your email and we'll send you a link to reset your password."
                    : "Use your email and password, or continue with Google."}
              </p>

              {view !== "forgot" && (
                <>
                  <button
                    type="button"
                    onClick={signInWithGoogle}
                    disabled={googleLoading}
                    className="mt-7 flex w-full items-center justify-center gap-3 rounded-full border border-border-light bg-white py-3.5 text-sm font-semibold text-slate-800 transition-all hover:shadow-[0_0_20px_rgba(15,23,42,0.12)] dark:hover:shadow-[0_0_20px_rgba(255,255,255,0.15)] disabled:opacity-50"
                  >
                    <GoogleIcon />
                    {googleLoading ? "Redirecting…" : "Continue with Google"}
                  </button>

                  <div className="my-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    <span className="h-px flex-1 bg-border" />
                    or
                    <span className="h-px flex-1 bg-border" />
                  </div>
                </>
              )}

              <form
                onSubmit={view === "magic" ? sendMagicLink : view === "forgot" ? sendResetLink : submitPassword}
                className="flex flex-col gap-4 text-left"
              >
                <div>
                  <label htmlFor="email" className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                    Email Address
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="glass-input w-full rounded-xl px-4 py-3.5 text-sm"
                  />
                </div>

                {view === "password" && (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label htmlFor="password" className="block text-xs font-semibold text-muted uppercase tracking-wider">
                        Password
                      </label>
                      {passwordAction === "signin" && (
                        <button
                          type="button"
                          onClick={() => switchView("forgot")}
                          className="text-xs font-medium text-cyan-600 hover:text-cyan-700"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <input
                      id="password"
                      type="password"
                      required
                      minLength={6}
                      autoComplete={passwordAction === "signup" ? "new-password" : "current-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="glass-input w-full rounded-xl px-4 py-3.5 text-sm"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={status === "sending"}
                  className="btn-primary mt-2 w-full rounded-full py-3.5 text-sm font-bold disabled:opacity-50"
                >
                  {status === "sending"
                    ? "Please wait…"
                    : view === "magic"
                      ? "Send Sign-in Link"
                      : view === "forgot"
                        ? "Send Reset Link"
                        : passwordAction === "signup"
                          ? "Create Account"
                          : "Sign In"}
                </button>

                {error && <p className="text-center text-xs font-medium text-rose-600 mt-1">{error}</p>}
              </form>

              <div className="mt-6 flex flex-col gap-2 text-xs text-muted">
                {view === "forgot" ? (
                  <button onClick={() => switchView("password")} className="hover:text-foreground">
                    Back to sign in
                  </button>
                ) : view === "password" ? (
                  <>
                    <button
                      onClick={() => {
                        setPasswordAction((a) => (a === "signin" ? "signup" : "signin"));
                        setError(null);
                      }}
                      className="hover:text-foreground"
                    >
                      {passwordAction === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
                    </button>
                    <button onClick={() => switchView("magic")} className="hover:text-foreground">
                      Prefer a magic link instead?
                    </button>
                  </>
                ) : (
                  <button onClick={() => switchView("password")} className="hover:text-foreground">
                    Use email and password instead
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
