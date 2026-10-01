"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { formatLkr, FREE_DAILY_CREDITS, PLANS, type PlanKey } from "@/lib/credits";
import { TIER_LIMITS, TIERS as TIER_ORDER, toTier, type Tier } from "@/lib/entitlements";
import { createClient } from "@/lib/supabase/client";
import { landingPagePath, trackEvent } from "@/lib/analytics";

type Billing = "month" | "year";

/** GET /api/checkout - which checkout this visitor gets (decided server
 * side by country) and, for Paddle, what Paddle.js needs. */
type CheckoutConfig = {
  gateway: "payments_lk" | "paddle" | null;
  paddle: { clientToken: string; environment: "sandbox" | "production"; customerId: string | null } | null;
};

type PaddleJs = {
  Environment: { set(env: "sandbox"): void };
  Initialize(options: { token: string; pwCustomer?: { id: string } }): void;
  Checkout: {
    open(options: {
      transactionId: string;
      customer?: { email: string };
      settings?: { displayMode?: "overlay"; successUrl?: string };
    }): void;
  };
};

declare global {
  interface Window {
    Paddle?: PaddleJs;
  }
}

let paddleLoad: Promise<PaddleJs> | null = null;

/** Loads and initializes Paddle.js once per page. Sandbox is set only for a
 * sandbox token; live is Paddle.js's default. pwCustomer is the signed-in
 * user's Paddle customer ID (ctm_...), for Paddle Retain - never our own
 * user id or email. */
function loadPaddle(config: NonNullable<CheckoutConfig["paddle"]>): Promise<PaddleJs> {
  paddleLoad ??= new Promise<PaddleJs>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.async = true;
    script.onload = () => {
      const paddle = window.Paddle;
      if (!paddle) return reject(new Error("Paddle.js did not load."));
      if (config.environment === "sandbox") paddle.Environment.set("sandbox");
      paddle.Initialize({
        token: config.clientToken,
        ...(config.customerId ? { pwCustomer: { id: config.customerId } } : {}),
      });
      resolve(paddle);
    };
    script.onerror = () => {
      paddleLoad = null;
      reject(new Error("Could not load the checkout. Check your connection or ad blocker and try again."));
    };
    document.head.appendChild(script);
  });
  return paddleLoad;
}

const res = (r: string) => (r === "4k" ? "4K" : r);

/** Card copy per tier. Limits come from TIER_LIMITS so the page can't
 * drift from what /api/export actually enforces. */
const TIERS: { tier: Tier; tagline: string; popular?: boolean; features: string[] }[] = [
  {
    tier: "free",
    tagline: "Everything you need to start editing.",
    features: [
      "Full video editor: trim, split, text, stickers, audio",
      "Basic transitions, filters and effects",
      `Exports up to ${res(TIER_LIMITS.free.maxResolution)}`,
      "Small \"Made with WipeClip\" mark on exports",
      `${TIER_LIMITS.free.dailyExports} exports a day`,
      `${FREE_DAILY_CREDITS} AI credits a day`,
    ],
  },
  {
    tier: "lite",
    tagline: "Premium editing at a small price.",
    features: [
      "Everything in Free",
      "All premium transitions, filters and effects",
      `Exports up to ${res(TIER_LIMITS.lite.maxResolution)}`,
      "No WipeClip mark on exports",
      `${TIER_LIMITS.lite.dailyExports} exports a day`,
      "AI credits for cleanup, background removal and sharpening",
    ],
  },
  {
    tier: "starter",
    tagline: "For creators publishing every week.",
    popular: true,
    features: [
      "Everything in Lite",
      `Exports up to ${res(TIER_LIMITS.starter.maxResolution)} Full HD`,
      `${TIER_LIMITS.starter.dailyExports} exports a day`,
      "4x more AI credits than Lite",
    ],
  },
  {
    tier: "pro",
    tagline: "For professionals and agencies.",
    features: [
      "Everything in Starter",
      `Exports up to ${res(TIER_LIMITS.pro.maxResolution)} Ultra HD`,
      `${TIER_LIMITS.pro.dailyExports} exports a day`,
      "3x more AI credits than Starter",
      "Image cleanup tool",
      "Highest-quality AI cleanup (motion-tracked)",
      "Usage and billing history",
    ],
  },
];

const SUBSCRIPTION_KEYS: Record<Exclude<Tier, "free">, Record<Billing, PlanKey>> = {
  lite: { month: "lite", year: "lite_yearly" },
  starter: { month: "starter", year: "starter_yearly" },
  pro: { month: "pro", year: "pro_yearly" },
};

const CREDIT_PACKS: PlanKey[] = ["creator", "payg"];

const COMPARISON: { label: string; values: Record<Tier, string | boolean> }[] = [
  { label: "Trim, split, reorder, speed", values: { free: true, lite: true, starter: true, pro: true } },
  { label: "Text, stickers, images, audio tracks", values: { free: true, lite: true, starter: true, pro: true } },
  { label: "Canvas sizes for YouTube, Shorts, Reels", values: { free: true, lite: true, starter: true, pro: true } },
  { label: "Fade, Crossfade, Dip to Black transitions", values: { free: true, lite: true, starter: true, pro: true } },
  { label: "Slide, Zoom, Blur, Dip to White transitions", values: { free: false, lite: true, starter: true, pro: true } },
  { label: "Filters", values: { free: "4 basic", lite: "All 10", starter: "All 10", pro: "All 10" } },
  { label: "Effects", values: { free: "3 basic", lite: "All 11", starter: "All 11", pro: "All 11" } },
  {
    label: "Max export resolution",
    values: {
      free: res(TIER_LIMITS.free.maxResolution),
      lite: res(TIER_LIMITS.lite.maxResolution),
      starter: res(TIER_LIMITS.starter.maxResolution),
      pro: res(TIER_LIMITS.pro.maxResolution),
    },
  },
  { label: "WipeClip mark on exports", values: { free: "Yes", lite: "No", starter: "No", pro: "No" } },
  {
    label: "Exports per day",
    values: {
      free: String(TIER_LIMITS.free.dailyExports),
      lite: String(TIER_LIMITS.lite.dailyExports),
      starter: String(TIER_LIMITS.starter.dailyExports),
      pro: String(TIER_LIMITS.pro.dailyExports),
    },
  },
  {
    label: "AI credits",
    values: {
      free: `${FREE_DAILY_CREDITS} / day`,
      lite: `${PLANS.lite.credits} / month`,
      starter: `${PLANS.starter.credits} / month`,
      pro: `${PLANS.pro.credits} / month`,
    },
  },
];

export default function PricingClient() {
  const [billing, setBilling] = useState<Billing>("month");
  const [loading, setLoading] = useState<PlanKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [currentTier, setCurrentTier] = useState<Tier | null>(null);
  const [checkoutConfig, setCheckoutConfig] = useState<CheckoutConfig | null>(null);
  const showLkr = checkoutConfig?.gateway !== "paddle";

  useEffect(() => {
    if (checkoutUrl) window.location.href = checkoutUrl;
  }, [checkoutUrl]);

  // Also drives the `logged_in` property on pricing_viewed/checkout_started
  // below - a local session read, same pattern as the tool demo components.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      const signedIn = Boolean(data.user);
      setIsSignedIn(signedIn);
      trackEvent("pricing_viewed", { logged_in: signedIn, source: landingPagePath() });
      // After the session read, so Paddle Retain gets the signed-in
      // customer. Paddle.js loads up front so the overlay opens instantly.
      fetch("/api/checkout")
        .then((r) => (r.ok ? r.json() : null))
        .then((c: CheckoutConfig | null) => {
          if (!c) return;
          setCheckoutConfig(c);
          if (c.paddle) loadPaddle(c.paddle).catch(() => {});
        })
        .catch(() => {});
      if (signedIn) {
        fetch("/api/credits")
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d && setCurrentTier(toTier(d.plan)))
          .catch(() => {});
      }
    });
  }, []);

  // Payments.lk (and Paddle's successUrl) bounces back here with ?success=1&plan=<key> after a
  // completed hosted checkout (see successUrl in /api/checkout). The
  // webhook is still the source of truth for actually granting credits -
  // this only marks the funnel's purchase step and never touches billing
  // state. The query string is stripped right after so a refresh/bookmark
  // of this URL can't re-fire it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "1") {
      trackEvent("purchase_completed", { plan: params.get("plan") ?? undefined });
      window.history.replaceState(null, "", window.location.pathname);
    } else if (params.get("canceled") === "1") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const buy = async (plan: PlanKey) => {
    trackEvent("checkout_started", { plan, logged_in: isSignedIn });
    setLoading(plan);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      // Parsed from text so an HTML error page (proxy or platform error, not
      // this app's JSON) surfaces as a status code instead of a JSON parse error.
      const text = await res.text();
      let data: {
        url?: string;
        paddle?: { transactionId: string; email: string | null; successUrl: string };
        error?: string;
      } | null = null;
      try {
        data = JSON.parse(text);
      } catch {}
      if (res.ok && data?.paddle && checkoutConfig?.paddle) {
        const paddle = await loadPaddle(checkoutConfig.paddle);
        paddle.Checkout.open({
          transactionId: data.paddle.transactionId,
          ...(data.paddle.email ? { customer: { email: data.paddle.email } } : {}),
          settings: { displayMode: "overlay", successUrl: data.paddle.successUrl },
        });
        setLoading(null);
        return;
      }
      if (!res.ok || !data?.url) throw new Error(data?.error ?? `Could not start checkout (HTTP ${res.status}).`);
      setCheckoutUrl(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout.");
      setLoading(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col min-h-screen">
      <Navbar />
      <main className="flex-1 px-6 pt-36 pb-28 relative overflow-hidden">
        {/* Background glow meshes */}
        <div
          aria-hidden
          className="animate-blob absolute top-20 left-1/4 h-[500px] w-[500px] rounded-full bg-accent/5 blur-[140px] pointer-events-none -z-10 dark:bg-accent/15"
        />
        <div
          aria-hidden
          className="animate-blob absolute top-40 right-1/4 h-[500px] w-[500px] rounded-full bg-accent-2/5 blur-[140px] [animation-delay:4s] pointer-events-none -z-10 dark:bg-accent-2/15"
        />

        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border px-3.5 py-1 text-xs font-semibold text-muted">
            Simple plans for the video editor
          </div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl text-foreground">
            Edit free. <span className="text-gradient">Upgrade when you grow.</span>
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted max-w-xl mx-auto">
            The editor is free forever. Paid plans start at $1.99 a month and unlock premium transitions,
            filters and effects, exports without the WipeClip mark, higher resolutions and more AI credits.
          </p>

          <div className="mt-8 inline-flex rounded-full border border-border bg-surface-2/80 p-1 text-sm font-semibold" role="radiogroup" aria-label="Billing period">
            {(["month", "year"] as const).map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={billing === b}
                onClick={() => setBilling(b)}
                className={`rounded-full px-5 py-2 transition ${billing === b ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
              >
                {b === "month" ? "Monthly" : "Yearly"}
                {b === "year" && <span className="ml-1.5 text-[11px] font-bold text-emerald-500">Save ~25%</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="mx-auto mt-14 grid max-w-7xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((card) => {
            const key = card.tier === "free" ? null : SUBSCRIPTION_KEYS[card.tier][billing];
            const plan = key ? PLANS[key] : null;
            const isCurrent = currentTier === card.tier;
            return (
              <div
                key={card.tier}
                className={`glass-card rounded-[2rem] p-7 flex flex-col justify-between relative transition-all border ${
                  card.popular
                    ? "border-cyan-400 shadow-[0_0_35px_rgba(34,211,238,0.25)] bg-surface-2/90"
                    : "border-border/80 hover:border-cyan-500/40"
                }`}
              >
                {card.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-accent to-accent-2 px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg">
                    Most Popular
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <h2 className="inline-block rounded-full bg-surface-3 border border-border px-3 py-1 text-xs font-semibold text-foreground">
                      {plan ? plan.label : "Free"}
                    </h2>
                    {isCurrent && <span className="text-[11px] font-bold text-emerald-500">Current plan</span>}
                  </div>

                  <div className="mt-4">
                    <span className="font-mono text-3xl font-extrabold text-foreground">{plan ? plan.priceLabel : "$0"}</span>
                    <span className="text-xs text-muted"> / {plan ? plan.period : "forever"}</span>
                    {plan && (
                      <p className="mt-1 text-[11px] text-muted">
                        {showLkr ? `Charged as ${formatLkr(plan.amountCents)} · ` : ""}
                        {plan.credits} AI credits included
                      </p>
                    )}
                  </div>

                  <p className="mt-3 text-xs text-muted leading-relaxed">{card.tagline}</p>

                  <div className="mt-6 border-t border-border/60 pt-6">
                    <ul className="space-y-3 text-xs text-muted">
                      {card.features.map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <span className="text-cyan-600 font-bold">✓</span>
                          <span className="text-foreground/90">{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="mt-8">
                  {key && plan ? (
                    <button
                      onClick={() => buy(key)}
                      disabled={loading !== null}
                      className={`w-full rounded-full py-3 text-xs font-bold transition-all ${card.popular ? "btn-primary" : "btn-secondary"} disabled:opacity-50`}
                    >
                      {loading === key ? "Opening checkout…" : isCurrent ? `Renew ${plan.label}` : `Get ${plan.label}`}
                    </button>
                  ) : (
                    <Link href="/editor" className="btn-secondary block w-full rounded-full py-3 text-center text-xs font-semibold">
                      Start editing free
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-muted">
          Plans are prepaid for the period shown and don&apos;t renew automatically. Renewing early adds the time to
          your current plan. AI credits are used by the AI tools (object cleanup, background removal, sharpening);
          editing and exporting never use credits. Full refund within 14 days, see our{" "}
          <Link href="/refund-policy" className="underline hover:text-foreground">
            refund policy
          </Link>
          .
        </p>

        {error && <p className="mt-6 text-center text-sm font-medium text-rose-600">{error}</p>}

        <section className="mx-auto mt-20 max-w-4xl" aria-labelledby="compare-heading">
          <h2 id="compare-heading" className="text-center font-display text-2xl font-extrabold tracking-tight text-foreground">
            Compare plans
          </h2>
          <div className="mt-8 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-surface-2/60 text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Feature</th>
                  <th className="px-4 py-3 font-semibold">Free</th>
                  <th className="px-4 py-3 font-semibold">Lite</th>
                  <th className="px-4 py-3 font-semibold">Starter</th>
                  <th className="px-4 py-3 font-semibold">Pro</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr key={row.label} className={i % 2 ? "bg-surface-2/30" : ""}>
                    <td className="px-4 py-2.5 text-foreground/90">{row.label}</td>
                    {TIER_ORDER.map((t) => {
                      const v = row.values[t];
                      return (
                        <td key={t} className="px-4 py-2.5 text-muted">
                          {v === true ? (
                            <span className="font-bold text-cyan-600" aria-label="Included">✓</span>
                          ) : v === false ? (
                            <span aria-label="Not included">-</span>
                          ) : (
                            v
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mx-auto mt-20 max-w-3xl" aria-labelledby="packs-heading">
          <h2 id="packs-heading" className="text-center font-display text-2xl font-extrabold tracking-tight text-foreground">
            Need more AI credits?
          </h2>
          <p className="mt-2 text-center text-sm text-muted">One-time packs on any plan. Credits never expire.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {CREDIT_PACKS.map((key) => {
              const pack = PLANS[key];
              return (
                <div key={key} className="glass-card flex items-center justify-between gap-4 rounded-2xl border border-border/80 p-5">
                  <div>
                    <p className="text-sm font-bold text-foreground">{pack.label}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {pack.credits} AI credits · {pack.priceLabel}
                      {showLkr && ` (${formatLkr(pack.amountCents)})`}
                    </p>
                  </div>
                  <button
                    onClick={() => buy(key)}
                    disabled={loading !== null}
                    className="btn-secondary shrink-0 rounded-full px-4 py-2 text-xs font-bold disabled:opacity-50"
                  >
                    {loading === key ? "Opening…" : "Buy"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
