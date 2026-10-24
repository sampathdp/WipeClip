import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CopyReferralLink from "@/components/CopyReferralLink";
import SignInClient from "@/app/sign-in/SignInClient";
import PurchaseTracker from "@/app/welcome/PurchaseTracker";
import { FREE_DAILY_CREDITS } from "@/lib/credits";
import { effectivePlan, isProUser } from "@/lib/plan";
import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { AI_CLEANUP_ENABLED } from "@/lib/features";
import { SITE_URL } from "@/lib/seo";
import { localeHref, type Lang } from "@/lib/i18n";
import { fmt, getDict } from "@/i18n";

/** Signed-in and post-checkout pages: never indexed, one per language so
 * a visitor stays in their language through sign-in and checkout. */
export function accountMetadata(page: "signIn" | "profile" | "history" | "referrals" | "welcome", lang: Lang): Metadata {
  const d = getDict(lang);
  if (page === "signIn") {
    return {
      title: d.signInPage.title,
      description: d.signInPage.description,
      alternates: { canonical: localeHref(lang, "/sign-in") },
      robots: { index: false, follow: true },
    };
  }
  const title = { profile: d.profile.title, history: d.history.title, referrals: d.referrals.title, welcome: d.welcomePage.title }[page];
  return { title, robots: page === "welcome" ? { index: false, follow: false } : { index: false } };
}

export function SignInView({ lang }: { lang: Lang }) {
  return (
    <div className="flex flex-1 flex-col min-h-screen">
      <Navbar />
      <SignInClient />
      <Footer lang={lang} />
    </div>
  );
}

function formatDate(iso: string | null | undefined, lang: Lang) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(lang === "en" ? "en-US" : lang, { year: "numeric", month: "short", day: "numeric" });
}

export async function ProfileView({ lang }: { lang: Lang }) {
  const href = (path: string) => localeHref(lang, path);
  if (!isSupabaseConfigured()) redirect(href("/"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`${href("/sign-in")}?next=${href("/profile")}`);

  // Same lazy daily free-credit reset /api/credits applies, so the balance
  // shown here is never yesterday's (service_role only - see schema.sql).
  await createServiceClient().rpc("ensure_daily_reset", { p_user_id: user.id });

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, plan_expires_at, free_credits, paid_credits, created_at")
    .eq("id", user.id)
    .single();

  const t = getDict(lang).profile;
  const plan = profile ? effectivePlan(profile) : "free";
  const free = profile?.free_credits ?? 0;
  const paid = profile?.paid_credits ?? 0;
  const total = free + paid;
  const expires = plan !== "free" ? formatDate(profile?.plan_expires_at, lang) : null;
  const provider = (user.app_metadata?.provider as string | undefined) ?? "email";
  const email = user.email ?? "";
  const initial = email.charAt(0).toUpperCase() || "?";

  const links = [
    { href: href("/download"), title: t.links.download.title, desc: t.links.download.desc },
    // English only while the AI cleanup feature is off.
    ...(AI_CLEANUP_ENABLED
      ? [{ href: "/#upload", title: "Remove an object", desc: "Take a distraction out of your own clip." }]
      : []),
    {
      href: href("/history"),
      title: t.links.history.title,
      desc: plan === "pro" ? t.links.history.descPro : t.links.history.descFree,
      badge: plan === "pro" ? undefined : t.proBadge,
    },
    { href: href("/referrals"), title: t.links.referrals.title, desc: t.links.referrals.desc },
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
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-foreground">{t.h1}</h1>
              <p className="mt-1 truncate text-sm text-muted">{email}</p>
            </div>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {/* Credits */}
            <section className="glass-card rounded-[1.75rem] p-6 md:col-span-2" aria-labelledby="credits-h">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="credits-h" className="text-xs font-semibold uppercase tracking-wider text-muted">
                    {t.credits}
                  </h2>
                  <p className="mt-2 font-display text-5xl font-extrabold text-gradient">{total}</p>
                </div>
                <Link href={href("/pricing")} className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold">
                  {t.buyCredits}
                </Link>
              </div>
              <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-border bg-surface-2/60 p-4">
                  <dt className="text-xs text-muted">{t.freeCredits}</dt>
                  <dd className="mt-1 font-mono text-lg font-bold text-foreground">{free}</dd>
                  <dd className="mt-1 text-[11px] text-muted">{fmt(t.renews, { n: FREE_DAILY_CREDITS })}</dd>
                </div>
                <div className="rounded-xl border border-border bg-surface-2/60 p-4">
                  <dt className="text-xs text-muted">{t.purchased}</dt>
                  <dd className="mt-1 font-mono text-lg font-bold text-foreground">{paid}</dd>
                  <dd className="mt-1 text-[11px] text-muted">{t.usedAfter}</dd>
                </div>
              </dl>
            </section>

            {/* Plan */}
            <section className="glass-card flex flex-col rounded-[1.75rem] p-6" aria-labelledby="plan-h">
              <h2 id="plan-h" className="text-xs font-semibold uppercase tracking-wider text-muted">
                {t.plan}
              </h2>
              <p className="mt-2 font-display text-3xl font-extrabold text-foreground">{t.plans[plan] ?? plan}</p>
              <p className="mt-1 text-xs text-muted">
                {plan === "free" ? t.upgrade : expires ? fmt(t.activeUntil, { date: expires }) : t.active}
              </p>
              <Link href={href("/pricing")} className="btn-secondary mt-auto rounded-full px-4 py-2 pt-2 text-center text-sm font-semibold">
                {plan === "free" ? t.seePlans : t.managePlan}
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
              {t.account}
            </h2>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted">{t.email}</dt>
                <dd className="mt-1 truncate font-medium text-foreground">{email}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t.method}</dt>
                <dd className="mt-1 font-medium capitalize text-foreground">{provider}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t.memberSince}</dt>
                <dd className="mt-1 font-medium text-foreground">{formatDate(profile?.created_at ?? user.created_at, lang)}</dd>
              </div>
            </dl>
            <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-5">
              {provider === "email" && (
                <Link href="/auth/reset-password" className="btn-secondary rounded-full px-4 py-2 text-sm font-semibold">
                  {t.changePassword}
                </Link>
              )}
              <form action="/auth/sign-out" method="post">
                <button
                  type="submit"
                  className="rounded-full border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-500/20 dark:text-rose-400"
                >
                  {t.signOut}
                </button>
              </form>
            </div>
          </section>
        </div>
      </main>
      <Footer lang={lang} />
    </div>
  );
}

type Transaction = {
  id: number;
  kind: "consume" | "refund";
  amount: number;
  resolution: string | null;
  tool: string | null;
  filename: string | null;
  created_at: string;
};

export async function HistoryView({ lang }: { lang: Lang }) {
  const href = (path: string) => localeHref(lang, path);
  if (!isSupabaseConfigured()) redirect(href("/"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`${href("/sign-in")}?next=${href("/history")}`);
  if (!(await isProUser(supabase, user.id))) redirect(href("/pricing"));

  const { data } = await supabase
    .from("credit_transactions")
    .select("id, kind, amount, resolution, tool, filename, created_at")
    .in("kind", ["consume", "refund"])
    .order("created_at", { ascending: false })
    .limit(200);

  const transactions = (data ?? []) as Transaction[];
  const t = getDict(lang).history;

  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <main className="flex-1 pt-32 pb-20">
        <div className="mx-auto max-w-4xl px-6">
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">{t.title}</h1>
          <p className="mt-3 text-sm sm:text-base text-muted">{t.intro}</p>

          <div className="mt-8 glass-card rounded-[1.75rem] border border-border/80 overflow-hidden">
            {transactions.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted">{t.empty}</p>
            ) : (
              <div className="divide-y divide-border/60">
                {transactions.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {tx.filename ?? (tx.tool === "image" ? t.imageJob : t.videoJob)}
                        {tx.kind === "refund" && (
                          <span className="ml-2 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-600 align-middle">
                            {t.refunded}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {new Date(tx.created_at).toLocaleString(lang)}
                        {tx.tool ? ` · ${tx.tool}` : ""}
                        {tx.resolution && tx.resolution !== "image" ? ` · ${tx.resolution}` : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 font-mono text-sm font-bold ${
                        tx.amount < 0 ? "text-muted" : "text-emerald-600"
                      }`}
                    >
                      {tx.amount > 0 ? "+" : ""}
                      {fmt(Math.abs(tx.amount) === 1 ? t.credit : t.credits, { n: tx.amount })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer lang={lang} />
    </div>
  );
}

export async function ReferralsView({ lang }: { lang: Lang }) {
  const href = (path: string) => localeHref(lang, path);
  if (!isSupabaseConfigured()) redirect(href("/"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`${href("/sign-in")}?next=${href("/referrals")}`);

  const supabaseAdmin = createServiceClient();
  const { data: code, error: codeErr } = await supabaseAdmin.rpc("ensure_referral_code", {
    p_user_id: user.id,
  });
  const { data: profile } = await supabase.from("profiles").select("referred_by").eq("id", user.id).single();
  const t = getDict(lang).referrals;

  // ensure_referral_code/claim_referral/the referral_code+referred_by
  // columns only exist once supabase/schema.sql's referral-program
  // additions have actually been run against this project's database -
  // adding them to the file in this repo doesn't apply them anywhere by
  // itself. Surfaced explicitly rather than silently rendering "ref=null".
  if (codeErr || !code) {
    return (
      <div className="flex flex-1 flex-col">
        <Navbar />
        <main className="flex-1 pt-32 pb-20">
          <div className="mx-auto max-w-2xl px-6 text-center">
            <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">{t.notSetUp}</h1>
            <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">{t.notSetUpBody}</p>
          </div>
        </main>
        <Footer lang={lang} />
      </div>
    );
  }

  // The link lands friends on the home page in the referrer's language.
  const link = `${SITE_URL}${lang === "en" ? "/" : href("/")}?ref=${code}`;

  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <main className="flex-1 pt-32 pb-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            {t.h1[0]}
            <span className="text-gradient">{t.h1[1]}</span>
            {t.h1[2]}
            <span className="text-gradient">{t.h1[3]}</span>
          </h1>
          <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">{t.intro}</p>

          <div className="mt-8 glass-card rounded-[1.75rem] border border-cyan-500/20 p-6 sm:p-8">
            <CopyReferralLink link={link} />
          </div>

          {profile?.referred_by && <p className="mt-6 text-xs text-muted">{t.referred}</p>}
        </div>
      </main>
      <Footer lang={lang} />
    </div>
  );
}

/** Where both checkouts (Paddle and Payments.lk) send the buyer after a
 * successful payment (successUrl in /api/checkout). The webhook, not this
 * page, grants the plan, so it can take a few seconds to show up. */
export function WelcomeView({ lang }: { lang: Lang }) {
  const t = getDict(lang).welcomePage;
  return (
    <div className="flex flex-1 flex-col min-h-screen">
      <Navbar />
      <main className="flex flex-1 flex-col items-center justify-center px-6 pt-36 pb-28 text-center relative overflow-hidden">
        <div
          aria-hidden
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 rounded-full bg-accent/6 blur-[120px] pointer-events-none -z-10 dark:bg-accent/20"
        />
        <PurchaseTracker />
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">{t.h1}</h1>
        <p className="mt-4 max-w-md text-sm sm:text-base text-muted">{t.intro}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href={localeHref(lang, "/download")} className="btn-primary rounded-full px-6 py-3 text-sm font-bold">
            {t.download}
          </Link>
          <Link href={localeHref(lang, "/profile")} className="btn-secondary rounded-full px-6 py-3 text-sm font-semibold">
            {t.viewPlan}
          </Link>
        </div>
      </main>
      <Footer lang={lang} />
    </div>
  );
}
