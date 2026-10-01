"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function AuthStatus() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [credits, setCredits] = useState<number | null>(null);
  const [plan, setPlan] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const REF_STORAGE_KEY = "wipeclip_ref";

    // Claims a stored referral code (see ReferralCapture.tsx) the first
    // moment a session actually exists - this listener fires for every
    // auth path (password signup, magic link, OAuth, email-confirm
    // redirect), so this is the one place that covers all of them.
    // claim_referral is idempotent per-referee, so calling this more than
    // once for the same user is harmless; the stored code is cleared
    // either way so a stale/invalid code doesn't retry forever.
    const claimReferralIfAny = async () => {
      const code = localStorage.getItem(REF_STORAGE_KEY);
      if (!code) return;
      localStorage.removeItem(REF_STORAGE_KEY);
      try {
        await fetch("/api/referrals/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
      } catch {
        // Best-effort - a lost referral credit isn't worth surfacing an error for.
      }
    };

    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setEmail(user?.email ?? null);
      if (!user) return;
      await claimReferralIfAny();
      const res = await fetch("/api/credits");
      if (res.ok) {
        const data = await res.json();
        setCredits(data.total);
        setPlan(data.plan ?? null);
      }
    };
    load();

    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    window.addEventListener("credits:refresh", load);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("credits:refresh", load);
    };
  }, []);

  if (email === undefined) {
    return <div className="h-9 w-20 animate-pulse rounded-full bg-surface-2/80 border border-border" />;
  }

  if (!email) {
    return (
      <Link
        href="/sign-in"
        className="btn-primary rounded-full px-4 py-2 text-sm font-semibold inline-flex items-center gap-1.5"
      >
        Sign in
      </Link>
    );
  }

  return <AccountMenu email={email} credits={credits} plan={plan} />;
}

const PLAN_LABEL: Record<string, string> = { free: "Free plan", starter: "Starter", pro: "Pro" };

/** Signed-in navbar: a credits pill plus an avatar that opens the account
 * menu - everything that used to sit inline in the bar lives in here now.
 */
function AccountMenu({ email, credits, plan }: { email: string; credits: number | null; plan: string | null }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = email.trim().charAt(0).toUpperCase() || "?";
  const item =
    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none";

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <Link
        href="/pricing"
        title="Your credits - click to buy more"
        className="hidden items-center gap-1.5 rounded-full bg-surface-2/90 border border-cyan-500/30 px-3 py-1.5 font-mono text-xs text-cyan-600 transition-all hover:border-cyan-400 hover:shadow-[0_0_12px_rgba(34,211,238,0.3)] sm:inline-flex"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
        {credits ?? "…"}
        <span className="sr-only"> credits</span>
      </Link>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 font-display text-sm font-bold text-white shadow-[0_0_15px_rgba(124,92,255,0.35)] ring-2 ring-transparent transition hover:ring-cyan-400/50 focus-visible:outline-none focus-visible:ring-cyan-400"
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-[60] w-64 rounded-2xl border border-border bg-background/95 p-2 shadow-2xl backdrop-blur-xl"
        >
          <div className="border-b border-border px-3 pb-3 pt-2">
            <p className="truncate text-sm font-semibold text-foreground">{email}</p>
            <p className="mt-0.5 text-xs text-muted">
              {plan ? (PLAN_LABEL[plan] ?? plan) : "…"} · {credits ?? "…"} credits
            </p>
          </div>
          <div className="py-1" onClick={() => setOpen(false)}>
            <Link role="menuitem" href="/profile" className={item}>
              Profile
            </Link>
            <Link role="menuitem" href="/history" className={item}>
              Job History
              {plan !== "pro" && (
                <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">PRO</span>
              )}
            </Link>
            <Link role="menuitem" href="/referrals" className={item}>
              Refer a Friend
            </Link>
            <Link role="menuitem" href="/pricing" className={item}>
              Buy credits
            </Link>
          </div>
          <form action="/auth/sign-out" method="post" className="border-t border-border pt-1">
            <button role="menuitem" type="submit" className={item + " text-rose-600 dark:text-rose-400"}>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
