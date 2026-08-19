"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function AuthStatus() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setEmail(user?.email ?? null);
      if (!user) return;
      const res = await fetch("/api/credits");
      if (res.ok) {
        const data = await res.json();
        setCredits(data.total);
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

  return (
    <div className="flex items-center gap-3 text-sm">
      <Link
        href="/pricing"
        className="hidden items-center gap-1.5 rounded-full bg-surface-2/90 border border-cyan-500/30 px-3.5 py-1.5 font-mono text-xs text-cyan-300 transition-all hover:border-cyan-400 hover:shadow-[0_0_12px_rgba(34,211,238,0.3)] sm:inline-flex"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
        {credits ?? "…"} credits
      </Link>
      <span className="hidden text-muted md:inline text-xs font-medium max-w-[140px] truncate">{email}</span>
      <form action="/auth/sign-out" method="post">
        <button
          type="submit"
          className="btn-secondary rounded-full px-3.5 py-1.5 text-xs font-medium"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
