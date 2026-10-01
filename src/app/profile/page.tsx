import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { FREE_DAILY_CREDITS } from "@/lib/credits";
import { effectivePlan } from "@/lib/plan";
import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Your Profile",
  robots: { index: false },
};

const PLAN_LABEL: Record<string, string> = { free: "Free", lite: "Lite", starter: "Starter", pro: "Pro" };

function formatDate(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default async function ProfilePage() {
  if (!isSupabaseConfigured()) redirect("/");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=/profile");

  // Same lazy daily free-credit reset /api/credits applies, so the balance
  // shown here is never yesterday's (service_role only - see schema.sql).
  await createServiceClient().rpc("ensure_daily_reset", { p_user_id: user.id });

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, plan_expires_at, free_credits, paid_credits, created_at")
    .eq("id", user.id)
    .single();

  const plan = profile ? effectivePlan(profile) : "free";
  const free = profile?.free_credits ?? 0;
  const paid = profile?.paid_credits ?? 0;
  const total = free + paid;
  const expires = plan !== "free" ? formatDate(profile?.plan_expires_at) : null;
  const provider = (user.app_metadata?.provider as string | undefined) ?? "email";
  const email = user.email ?? "";
  const initial = email.charAt(0).toUpperCase() || "?";

  const links = [
    { href: "/editor", title: "Video Editor", desc: "Trim, cut, add transitions and stickers." },
    { href: "/#upload", title: "Remove an object", desc: "Take a distraction out of your own clip." },
    {
      href: "/history",
      title: "Job History",
      desc: plan === "pro" ? "Your usage and billing log." : "Usage and billing log - a Pro feature.",
      badge: plan === "pro" ? undefined : "Pro",
    },
    { href: "/referrals", title: "Refer a Friend", desc: "Share your link and earn credits." },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <main className="flex-1 pt-32 pb-20">
        <div className="mx-auto max-w-4xl px-6">
          {/* Header */}
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-2 font-display text-2xl font-extrabold text-white shadow-[0_0_30px_rgba(124,92,255,0.4)]">
              {initial}
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-foreground">Your profile</h1>
              <p className="mt-1 truncate text-sm text-muted">{email}</p>
            </div>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {/* Credits */}
            <section className="glass-card rounded-[1.75rem] p-6 md:col-span-2" aria-labelledby="credits-h">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="credits-h" className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Credits
                  </h2>
                  <p className="mt-2 font-display text-5xl font-extrabold text-gradient">{total}</p>
                </div>
                <Link href="/pricing" className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold">
                  Buy credits
                </Link>
              </div>
              <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-border bg-surface-2/60 p-4">
                  <dt className="text-xs text-muted">Free credits</dt>
                  <dd className="mt-1 font-mono text-lg font-bold text-foreground">{free}</dd>
                  <dd className="mt-1 text-[11px] text-muted">Renews to {FREE_DAILY_CREDITS} every day</dd>
                </div>
                <div className="rounded-xl border border-border bg-surface-2/60 p-4">
                  <dt className="text-xs text-muted">Purchased credits</dt>
                  <dd className="mt-1 font-mono text-lg font-bold text-foreground">{paid}</dd>
                  <dd className="mt-1 text-[11px] text-muted">Used after free credits</dd>
                </div>
              </dl>
            </section>

            {/* Plan */}
            <section className="glass-card flex flex-col rounded-[1.75rem] p-6" aria-labelledby="plan-h">
              <h2 id="plan-h" className="text-xs font-semibold uppercase tracking-wider text-muted">
                Plan
              </h2>
              <p className="mt-2 font-display text-3xl font-extrabold text-foreground">{PLAN_LABEL[plan] ?? plan}</p>
              <p className="mt-1 text-xs text-muted">
                {plan === "free" ? "Upgrade for more credits and Pro features." : expires ? `Active until ${expires}` : "Active"}
              </p>
              <Link href="/pricing" className="btn-secondary mt-auto rounded-full px-4 py-2 pt-2 text-center text-sm font-semibold">
                {plan === "free" ? "See plans" : "Manage plan"}
              </Link>
            </section>
          </div>

          {/* Quick links */}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="glass-card-interactive group flex items-center justify-between rounded-2xl p-5"
              >
                <div>
                  <p className="flex items-center gap-2 font-semibold text-foreground">
                    {l.title}
                    {l.badge && (
                      <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">{l.badge}</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{l.desc}</p>
                </div>
                <span className="text-cyan-600 transition-transform group-hover:translate-x-1">→</span>
              </Link>
            ))}
          </div>

          {/* Account */}
          <section className="glass-card mt-5 rounded-[1.75rem] p-6" aria-labelledby="account-h">
            <h2 id="account-h" className="text-xs font-semibold uppercase tracking-wider text-muted">
              Account
            </h2>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted">Email</dt>
                <dd className="mt-1 truncate font-medium text-foreground">{email}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Sign-in method</dt>
                <dd className="mt-1 font-medium capitalize text-foreground">{provider}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Member since</dt>
                <dd className="mt-1 font-medium text-foreground">{formatDate(profile?.created_at ?? user.created_at)}</dd>
              </div>
            </dl>
            <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-5">
              {provider === "email" && (
                <Link href="/auth/reset-password" className="btn-secondary rounded-full px-4 py-2 text-sm font-semibold">
                  Change password
                </Link>
              )}
              <form action="/auth/sign-out" method="post">
                <button
                  type="submit"
                  className="rounded-full border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-500/20 dark:text-rose-400"
                >
                  Sign out
                </button>
              </form>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
