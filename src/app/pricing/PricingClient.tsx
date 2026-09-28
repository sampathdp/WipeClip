"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { formatLkr, PLANS, type PlanKey } from "@/lib/credits";
import { createClient } from "@/lib/supabase/client";
import { landingPagePath, trackEvent } from "@/lib/analytics";

const paygCards: { key: PlanKey; tagline: string; isPopular?: boolean; features: string[] }[] = [
  {
    key: "starter",
    tagline: "Monthly credits banked, never lost daily",
    isPopular: false,
    features: [
      "60 credits / month",
      "Up to 1080p Full HD",
      "Priority processing queue",
      "No auto-renewal - top up when you need",
    ],
  },
  {
    key: "pro",
    tagline: "For power workflows & 4K exports",
    isPopular: false,
    features: [
      "200 credits / month",
      "4K Ultra HD unlocked",
      "Ultra-priority GPU lane",
    ],
  },
  {
    key: "payg",
    tagline: "One-time purchase, credits never expire",
    isPopular: false,
    features: [
      "30 credits balance",
      "Non-expiring credits",
      "Up to 1080p exports",
      "Ideal for occasional tasks",
    ],
  },
  {
    key: "creator",
    tagline: "One-time purchase, built for a single upload session",
    isPopular: true,
    features: [
      "15 credits balance",
      "Non-expiring credits",
      "Up to 1080p exports",
      "Ideal for Reels, TikToks & Shorts",
    ],
  },
];

const SUBSCRIPTION_PLANS: PlanKey[] = ["starter", "pro"];

export default function PricingClient() {
  const [loading, setLoading] = useState<PlanKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);

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
    });
  }, []);

  // Payments.lk bounces back here with ?success=1&plan=<key> after a
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
      let data: { url?: string; error?: string } | null = null;
      try {
        data = JSON.parse(text);
      } catch {}
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
            Transparent, Flexible Pricing
          </div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl text-foreground">
            Choose your <span className="text-gradient">power plan</span>
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted max-w-xl mx-auto">
            Every free account gets 2 free credits daily at 720p. Upgrade for high-resolution 4K exports and instant monthly banking.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-7xl gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {/* Free Tier Card */}
          <div className="glass-card rounded-[2rem] p-7 flex flex-col justify-between border border-border/80 relative">
            <div>
              <h2 className="inline-block rounded-full bg-surface-3 border border-border px-3 py-1 text-xs font-semibold text-muted">
                Free Tier
              </h2>
              <div className="mt-4">
                <span className="font-mono text-3xl font-extrabold text-foreground">$0</span>
                <span className="text-xs text-muted"> / forever</span>
              </div>
              <p className="mt-2 text-xs font-mono text-cyan-600">2 credits / day (auto-renew)</p>
              <p className="mt-3 text-xs text-muted">Perfect to test video cleanup on short clips.</p>

              <div className="mt-6 border-t border-border/60 pt-6">
                <ul className="space-y-3 text-xs text-muted">
                  <li className="flex items-center gap-2">
                    <span className="text-cyan-600 font-bold">✓</span> 720p HD resolution
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-cyan-600 font-bold">✓</span> No watermark on output
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-cyan-600 font-bold">✓</span> No credit card required
                  </li>
                </ul>
              </div>
            </div>

            <div className="mt-8">
              <Link
                href="/#upload"
                className="btn-secondary block w-full rounded-full py-3 text-center text-xs font-semibold"
              >
                Use Free
              </Link>
            </div>
          </div>

          {/* Paid Tiers */}
          {paygCards.map((card) => {
            const plan = PLANS[card.key];
            const isPopular = card.isPopular;

            return (
              <div
                key={card.key}
                className={`glass-card rounded-[2rem] p-7 flex flex-col justify-between relative transition-all ${
                  isPopular
                    ? "border-cyan-400 shadow-[0_0_35px_rgba(34,211,238,0.25)] scale-[1.03] bg-surface-2/90"
                    : "border-border/80 hover:border-cyan-500/40"
                }`}
              >
                {isPopular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-accent to-accent-2 px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg">
                    Most Popular
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <h2 className="inline-block rounded-full bg-surface-3 border border-border px-3 py-1 text-xs font-semibold text-foreground">
                      {plan.label}
                    </h2>
                    <span className="text-[11px] font-mono text-cyan-600 font-bold">
                      {plan.credits} credits
                    </span>
                  </div>

                  <div className="mt-4">
                    <span className="font-mono text-3xl font-extrabold text-foreground">{plan.priceLabel}</span>
                    {SUBSCRIPTION_PLANS.includes(card.key) && <span className="text-xs text-muted"> / 30 days</span>}
                    <p className="mt-1 text-[11px] text-muted">Charged as {formatLkr(plan.amountCents)}</p>
                  </div>

                  <p className="mt-3 text-xs text-muted leading-relaxed">{card.tagline}</p>

                  <div className="mt-6 border-t border-border/60 pt-6">
                    <ul className="space-y-3 text-xs text-muted">
                      {card.features.map((f) => (
                        <li key={f} className="flex items-center gap-2">
                          <span className="text-cyan-600 font-bold">✓</span>
                          <span className="text-foreground/90">{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="mt-8">
                  <button
                    onClick={() => buy(card.key)}
                    disabled={loading !== null}
                    className={`w-full rounded-full py-3 text-xs font-bold transition-all ${
                      isPopular
                        ? "btn-primary"
                        : "btn-secondary"
                    } disabled:opacity-50`}
                  >
                    {loading === card.key ? "Redirecting to Checkout…" : `Get ${plan.label}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {error && <p className="mt-8 text-center text-sm font-medium text-rose-600">{error}</p>}
      </main>
      <Footer />
    </div>
  );
}
