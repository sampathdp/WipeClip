"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { apiFetch, IS_DESKTOP } from "@/lib/platform";
import SignInModal from "@/components/SignInModal";
import { useI18n, useLocaleHref } from "@/i18n/client";
import { fmt } from "@/i18n/format";

export default function AuthStatus() {
  const { t } = useI18n();
  const href = useLocaleHref();
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
        await apiFetch("/api/referrals/claim", {
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
      const res = await apiFetch("/api/credits");
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
    // The desktop app has no /sign-in page of its own - signing in on the
    // website wouldn't sign the app in - so it opens the in-app modal.
    if (IS_DESKTOP) return <DesktopSignIn />;
    return (
      <Link
        href={href("/sign-in")}
        className="btn-primary rounded-full px-4 py-2 text-sm font-semibold inline-flex items-center gap-1.5"
      >
        {t.auth.signIn}
      </Link>
    );
  }

  return <AccountMenu email={email} credits={credits} plan={plan} />;
}

function DesktopSignIn() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary rounded-full px-4 py-2 text-sm font-semibold inline-flex items-center gap-1.5"
      >
        {t.auth.signIn}
      </button>
      <SignInModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Signed-in navbar: a credits pill plus an avatar that opens the account
 * menu - everything that used to sit inline in the bar lives in here now.
 */
function AccountMenu({ email, credits, plan }: { email: string; credits: number | null; plan: string | null }) {
  const { t } = useI18n();
  const href = useLocaleHref();
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
        href={href("/pricing")}
        title={t.auth.creditsTitle}
        className="hidden items-center gap-1.5 rounded-full bg-surface-2/90 border border-cyan-500/30 px-3 py-1.5 font-mono text-xs text-cyan-600 transition-all hover:border-cyan-400 hover:shadow-[0_0_12px_rgba(34,211,238,0.3)] sm:inline-flex"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
        {credits ?? "…"}
        <span className="sr-only"> {t.auth.creditsSr}</span>
      </Link>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.auth.accountMenu}
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
              {fmt(t.auth.creditsLine, { plan: plan ? (t.auth.plans[plan] ?? plan) : "…", n: credits ?? "…" })}
            </p>
          </div>
          <div className="py-1" onClick={() => setOpen(false)}>
            <Link role="menuitem" href={href("/profile")} className={item}>
              {t.auth.profile}
            </Link>
            <Link role="menuitem" href={href("/history")} className={item}>
              {t.auth.jobHistory}
              {plan !== "pro" && (
                <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">PRO</span>
              )}
            </Link>
            <Link role="menuitem" href={href("/referrals")} className={item}>
              {t.auth.referFriend}
            </Link>
            <Link role="menuitem" href={href("/pricing")} className={item}>
              {t.auth.buyCredits}
            </Link>
          </div>
          {IS_DESKTOP ? (
            // No server session to clear in the desktop app: signing out
            // locally drops the tokens from the OS credential store.
            <div className="border-t border-border pt-1">
              <button
                role="menuitem"
                type="button"
                onClick={() => void createClient().auth.signOut()}
                className={item + " text-rose-600 dark:text-rose-400"}
              >
                {t.auth.signOut}
              </button>
            </div>
          ) : (
            <form action="/auth/sign-out" method="post" className="border-t border-border pt-1">
              <button role="menuitem" type="submit" className={item + " text-rose-600 dark:text-rose-400"}>
                {t.auth.signOut}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
