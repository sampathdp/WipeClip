"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { PLANS, type PlanKey } from "@/lib/credits";

const paygCards: { key: PlanKey; tagline: string; isPopular?: boolean; features: string[] }[] = [
  {
    key: "starter",
    tagline: "Monthly credits banked, never lost daily",
    isPopular: false,
    features: [
      "60 credits / month",
      "Up to 1080p Full HD",
      "Priority processing queue",
      "Cancel anytime",
    ],
  },
  {
    key: "pro",
    tagline: "For creators & power workflows",
    isPopular: true,
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
];

export default function PricingClient() {
  const [loading, setLoading] = useState<PlanKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  useEffect(() => {
    if (checkoutUrl) window.location.href = checkoutUrl;
  }, [checkoutUrl]);

  const buy = async (plan: PlanKey) => {
    setLoading(plan);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not start checkout.");
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
          className="animate-blob absolute top-20 left-1/4 h-[500px] w-[500px] rounded-full bg-accent/15 blur-[140px] pointer-events-none -z-10"
        />
        <div
          aria-hidden
          className="animate-blob absolute top-40 right-1/4 h-[500px] w-[500px] rounded-full bg-accent-2/15 blur-[140px] [animation-delay:4s] pointer-events-none -z-10"
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

        <div className="mx-auto mt-16 grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {/* Free Tier Card */}
          <div className="glass-card rounded-[2rem] p-7 flex flex-col justify-between border border-border/80 relative">
            <div>
              <div className="inline-block rounded-full bg-surface-3 border border-border px-3 py-1 text-xs font-semibold text-muted">
                Free Tier
              </div>
              <div className="mt-4">
                <span className="font-mono text-3xl font-extrabold text-foreground">$0</span>
                <span className="text-xs text-muted"> / forever</span>
              </div>
              <p className="mt-2 text-xs font-mono text-cyan-300">2 credits / day (auto-renew)</p>
              <p className="mt-3 text-xs text-muted">Perfect to test watermark removal on short clips.</p>

              <div className="mt-6 border-t border-border/60 pt-6">
                <ul className="space-y-3 text-xs text-muted">
                  <li className="flex items-center gap-2">
                    <span className="text-cyan-400 font-bold">✓</span> 720p HD resolution
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-cyan-400 font-bold">✓</span> No watermark on output
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-cyan-400 font-bold">✓</span> No credit card required
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
                    <span className="inline-block rounded-full bg-surface-3 border border-border px-3 py-1 text-xs font-semibold text-foreground">
                      {plan.label}
                    </span>
                    <span className="text-[11px] font-mono text-cyan-400 font-bold">
                      {plan.credits} credits
                    </span>
                  </div>

                  <div className="mt-4">
                    <span className="font-mono text-3xl font-extrabold text-foreground">{plan.priceLabel}</span>
                    {card.key !== "payg" && <span className="text-xs text-muted"> / month</span>}
                  </div>

                  <p className="mt-3 text-xs text-muted leading-relaxed">{card.tagline}</p>

                  <div className="mt-6 border-t border-border/60 pt-6">
                    <ul className="space-y-3 text-xs text-muted">
                      {card.features.map((f) => (
                        <li key={f} className="flex items-center gap-2">
                          <span className="text-cyan-400 font-bold">✓</span>
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

        {error && <p className="mt-8 text-center text-sm font-medium text-rose-400">{error}</p>}
      </main>
      <Footer />
    </div>
  );
}
