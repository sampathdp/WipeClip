"use client";

import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Logo from "@/components/Logo";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("saving");
    setError(null);
    const supabase = createClient();
    // /auth/callback already exchanged the recovery code for a session
    // before redirecting here, so this updates the already-authenticated
    // user's password.
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setError(err.message);
      setStatus("error");
      return;
    }
    setStatus("done");
  };

  return (
    <div className="flex flex-1 flex-col min-h-screen">
      <Navbar />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 pt-36 pb-28 relative overflow-hidden">
        <div
          aria-hidden
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-80 w-80 rounded-full bg-accent/20 blur-[100px] pointer-events-none -z-10"
        />

        <div className="glass-card rounded-[2.5rem] p-8 sm:p-10 border border-cyan-500/25 shadow-[0_20px_50px_rgba(0,0,0,0.8)] text-center">
          <div className="flex justify-center mb-6">
            <Logo size={48} showText={false} />
          </div>

          <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            Set a new <span className="text-gradient">password</span>
          </h1>

          {status === "done" ? (
            <div className="mt-8 rounded-2xl bg-cyan-950/40 border border-cyan-400/40 p-6 text-sm text-cyan-200 shadow-[0_0_25px_rgba(34,211,238,0.2)]">
              <div className="mb-2 text-2xl">✓</div>
              <p className="font-medium">Password updated</p>
              <a href="/" className="mt-3 inline-block text-xs font-semibold text-cyan-300 hover:text-cyan-200">
                Continue to WipeClip.co →
              </a>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-8 flex flex-col gap-4 text-left">
              <div>
                <label htmlFor="password" className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  New Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="glass-input w-full rounded-xl px-4 py-3.5 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={status === "saving"}
                className="btn-primary mt-2 w-full rounded-full py-3.5 text-sm font-bold disabled:opacity-50"
              >
                {status === "saving" ? "Saving…" : "Update Password"}
              </button>

              {error && <p className="text-center text-xs font-medium text-rose-400 mt-1">{error}</p>}
            </form>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
