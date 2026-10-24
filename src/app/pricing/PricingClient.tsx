"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { formatCleanupLimit, formatLkr, FREE_DAILY_CREDITS, MAX_CLEANUP_SECONDS, PLANS, type PlanKey } from "@/lib/credits";
import { TIER_LIMITS, TIERS as TIER_ORDER, toTier, type Tier } from "@/lib/entitlements";
import { createClient } from "@/lib/supabase/client";
import { landingPagePath, trackEvent } from "@/lib/analytics";
import { AI_CLEANUP_ENABLED } from "@/lib/features";

type Billing = "month" | "year";

/** GET /api/checkout - which checkout this visitor gets (decided server
 * side by country) and, for Paddle, what Paddle.js needs. */
type CheckoutConfig = {
  gateway: "payments_lk" | "paddle" | null;
  paddle: {
    clientToken: string;
    environment: "sandbox" | "production";
    customerId: string | null;
    /** ISO country from the edge's geo header; null lets Paddle detect it from the IP. */
    country: string | null;
    priceIds: Partial<Record<PlanKey, string>>;
  } | null;
  /** The promotion behind the code sent as ?promo= (src/lib/promo.ts), if it is valid for this visitor. */
  promo: { percent: number; plans: PlanKey[]; endsAt: string } | null;
  /** Why the code sent as ?promo= can't be used (invalid, expired, already used). */
  promoError: string | null;
};

const PROMO_STORAGE_KEY = "wc_promo";

/** A code typed into the pricing page, or from the newsletter link
 * (?promo=CODE). Kept in localStorage so it survives the sign-in round
 * trip; the server decides whether it applies (once per account). */
function rememberPromoCode(code: string | null) {
  try {
    if (code) localStorage.setItem(PROMO_STORAGE_KEY, code);
    else localStorage.removeItem(PROMO_STORAGE_KEY);
  } catch {}
}

function readPromoCode(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get("promo")?.trim().slice(0, 40);
  try {
    if (fromUrl) localStorage.setItem(PROMO_STORAGE_KEY, fromUrl);
    return fromUrl || localStorage.getItem(PROMO_STORAGE_KEY);
  } catch {
    return fromUrl || null;
  }
}

let paddleLoad: Promise<Paddle> | null = null;

/** Loads and initializes Paddle.js once per page, in the environment the
 * server names (never defaulted here). pwCustomer is the signed-in user's
 * Paddle customer ID (ctm_...), for Paddle Retain - never our own user id
 * or email. */
function loadPaddle(config: NonNullable<CheckoutConfig["paddle"]>): Promise<Paddle> {
  paddleLoad ??= initializePaddle({
    environment: config.environment,
    token: config.clientToken,
    ...(config.customerId ? { pwCustomer: { id: config.customerId } } : {}),
  }).then(
    (paddle) => {
      if (!paddle) throw new Error("Paddle.js did not load.");
      return paddle;
    },
    () => {
      throw new Error("Could not load the checkout. Check your connection or ad blocker and try again.");
    }
  );
  paddleLoad.catch(() => (paddleLoad = null));
  return paddleLoad;
}

/** Each plan's price as Paddle shows it in the visitor's country (local
 * currency and tax), keyed by plan. Paddle's own formatted strings, shown
 * as is - no price math or reformatting here. `taxed` is true when those
 * totals include sales tax or VAT (EU, UK and other VAT countries). */
async function localizedPrices(
  config: NonNullable<CheckoutConfig["paddle"]>,
): Promise<{ totals: Partial<Record<PlanKey, string>>; taxed: boolean }> {
  const byPrice = Object.entries(config.priceIds) as [PlanKey, string][];
  if (byPrice.length === 0) return { totals: {}, taxed: false };
  const paddle = await loadPaddle(config);
  const preview = await paddle.PricePreview({
    items: byPrice.map(([, priceId]) => ({ priceId, quantity: 1 })),
    ...(config.country ? { address: { countryCode: config.country } } : {}),
  });
  const totals: Partial<Record<PlanKey, string>> = {};
  let taxed = false;
  for (const item of preview.data.details.lineItems) {
    const plan = byPrice.find(([, id]) => id === item.price.id)?.[0];
    if (plan) totals[plan] = item.formattedTotals.total;
    if (Number(item.totals.tax) > 0) taxed = true;
  }
  return { totals, taxed };
}

/** While online checkout is being set up, buyers message us on WhatsApp
 * and get a payment link by hand. On when NEXT_PUBLIC_MANUAL_PAYMENTS=1,
 * or automatically when no gateway is configured. */
const MANUAL_PAYMENTS_FLAG = process.env.NEXT_PUBLIC_MANUAL_PAYMENTS === "1";
const SUPPORT_PHONE_DISPLAY = "075 445 3334";
const SUPPORT_WHATSAPP = "94754453334";

function whatsappLink(text: string) {
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`;
}

const res = (r: string) => (r === "4k" ? "4K" : r);

/** The video cleanup length line for a card, when that tool is on. */
const cleanupLimit = (tier: Tier) =>
  AI_CLEANUP_ENABLED ? [`AI video cleanup up to ${formatCleanupLimit(MAX_CLEANUP_SECONDS[tier])} per clip`] : [];

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
      `${FREE_DAILY_CREDITS} AI credits a day`,
      ...cleanupLimit("free"),
    ],
  },
  {
    tier: "lite",
    tagline: "Premium editing at a small price.",
    features: [
      "Everything in Free",
      "All premium transitions, filters and effects",
      "Green screen, blend modes, speed curves, LUTs and curves",
      "Karaoke captions, auto-ducking, voice effects and stabilization",
      "GIF, audio-only, high-quality and 60 fps exports",
      `Exports up to ${res(TIER_LIMITS.lite.maxResolution)}`,
      `${PLANS.lite.credits} bonus AI credits, plus ${FREE_DAILY_CREDITS} free every day`,
      ...cleanupLimit("lite"),
    ],
  },
  {
    tier: "starter",
    tagline: "For creators publishing every week.",
    popular: true,
    features: [
      "Everything in Lite",
      `Exports up to ${res(TIER_LIMITS.starter.maxResolution)} Full HD`,
      `${PLANS.starter.credits} bonus AI credits, plus ${FREE_DAILY_CREDITS} free every day`,
      ...cleanupLimit("starter"),
    ],
  },
  {
    tier: "pro",
    tagline: "For professionals and agencies.",
    features: [
      "Everything in Starter",
      `Exports up to ${res(TIER_LIMITS.pro.maxResolution)} Ultra HD`,
      `${PLANS.pro.credits} bonus AI credits, plus ${FREE_DAILY_CREDITS} free every day`,
      ...cleanupLimit("pro"),
      ...(AI_CLEANUP_ENABLED ? ["Image cleanup tool", "Highest-quality AI cleanup (motion-tracked)"] : []),
      "Usage and billing history",
    ],
  },
];

const SUBSCRIPTION_KEYS: Record<Exclude<Tier, "free">, Record<Billing, PlanKey>> = {
  lite: { month: "lite", year: "lite_yearly" },
  starter: { month: "starter", year: "starter_yearly" },
  pro: { month: "pro", year: "pro_yearly" },
};

const COMPARISON: { label: string; values: Record<Tier, string | boolean> }[] = [
  { label: "Trim, split, reorder, speed", values: { free: true, lite: true, starter: true, pro: true } },
  { label: "Text, stickers, images, audio tracks", values: { free: true, lite: true, starter: true, pro: true } },
  { label: "Landscape, vertical and square canvas sizes", values: { free: true, lite: true, starter: true, pro: true } },
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
      lite: `${FREE_DAILY_CREDITS} / day + ${PLANS.lite.credits} / 30 days`,
      starter: `${FREE_DAILY_CREDITS} / day + ${PLANS.starter.credits} / 30 days`,
      pro: `${FREE_DAILY_CREDITS} / day + ${PLANS.pro.credits} / 30 days`,
    },
  },
  ...(AI_CLEANUP_ENABLED
    ? [
        {
          label: "AI video cleanup length per clip",
          values: {
            free: formatCleanupLimit(MAX_CLEANUP_SECONDS.free),
            lite: formatCleanupLimit(MAX_CLEANUP_SECONDS.lite),
            starter: formatCleanupLimit(MAX_CLEANUP_SECONDS.starter),
            pro: formatCleanupLimit(MAX_CLEANUP_SECONDS.pro),
          },
        },
      ]
    : []),
];

/** `children`: server-rendered content after the plans (the pricing FAQ),
 * kept out of this client bundle and in the page's HTML for crawlers. */
export default function PricingClient({ children }: { children?: React.ReactNode }) {
  const [billing, setBilling] = useState<Billing>("month");
  const [loading, setLoading] = useState<PlanKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [currentTier, setCurrentTier] = useState<Tier | null>(null);
  const [checkoutConfig, setCheckoutConfig] = useState<CheckoutConfig | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [localPrices, setLocalPrices] = useState<Partial<Record<PlanKey, string>>>({});
  const [pricesTaxed, setPricesTaxed] = useState(false);
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState("");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);
  const promo = promoCode ? checkoutConfig?.promo ?? null : null;
  const showLkr = checkoutConfig?.gateway !== "paddle";
  const manualPayments = MANUAL_PAYMENTS_FLAG || checkoutConfig?.gateway === null;

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
      setUserEmail(data.user?.email ?? null);
      trackEvent("pricing_viewed", { logged_in: signedIn, source: landingPagePath() });
      // After the session read, so Paddle Retain gets the signed-in
      // customer. Paddle.js loads up front so the overlay opens instantly.
      const code = readPromoCode();
      fetch(code ? `/api/checkout?promo=${encodeURIComponent(code)}` : "/api/checkout")
        .then((r) => (r.ok ? r.json() : null))
        .then((c: CheckoutConfig | null) => {
          if (!c) return;
          setCheckoutConfig(c);
          setPromoCode(c.promo ? code : null);
          setPromoError(c.promoError);
          if (!c.promo) rememberPromoCode(null);
          // Until the preview answers (or if it fails), cards show the USD list price.
          if (c.paddle)
            localizedPrices(c.paddle)
              .then(({ totals, taxed }) => {
                setLocalPrices(totals);
                setPricesTaxed(taxed);
              })
              .catch(() => {});
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

  // A canceled Payments.lk checkout bounces back here with ?canceled=1
  // (successful ones land on /welcome). Stripped so a bookmark stays clean.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("canceled") === "1") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  // Re-reads the checkout config with the code, which answers with the
  // offer if the code is live and unused by this account, or why not.
  const applyPromo = async (code: string) => {
    const trimmed = code.trim().slice(0, 40);
    if (!trimmed) return;
    setPromoChecking(true);
    setPromoError(null);
    try {
      const res = await fetch(`/api/checkout?promo=${encodeURIComponent(trimmed)}`);
      const c: CheckoutConfig | null = res.ok ? await res.json() : null;
      if (!c) throw new Error();
      setCheckoutConfig(c);
      setPromoCode(c.promo ? trimmed : null);
      setPromoError(c.promoError);
      rememberPromoCode(c.promo ? trimmed : null);
      if (c.promo) setPromoInput("");
    } catch {
      setPromoError("Couldn't check the code. Try again.");
    } finally {
      setPromoChecking(false);
    }
  };

  const removePromo = () => {
    setPromoCode(null);
    setPromoError(null);
    rememberPromoCode(null);
  };

  const buy = async (plan: PlanKey) => {
    trackEvent("checkout_started", { plan, logged_in: isSignedIn, ...(manualPayments ? { gateway: "manual" } : {}) });
    if (manualPayments) {
      const p = PLANS[plan];
      const text =
        (p.period
          ? `Hi WipeClip, I'd like to buy the ${p.label} plan (${p.priceLabel} for ${p.period === "year" ? "1 year" : "30 days"}).`
          : `Hi WipeClip, I'd like to buy the ${p.label} (${p.priceLabel}, ${p.credits} AI credits).`) +
        (userEmail ? ` My account email: ${userEmail}` : "");
      window.open(whatsappLink(text), "_blank", "noopener,noreferrer");
      return;
    }
    setLoading(plan);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, ...(promoCode ? { promo: promoCode } : {}) }),
      });
      // Parsed from text so an HTML error page (proxy or platform error, not
      // this app's JSON) surfaces as a status code instead of a JSON parse error.
      const text = await res.text();
      let data: {
        url?: string;
        paddle?: { transactionId: string; email: string | null; successUrl: string };
        error?: string;
        promoBlocked?: boolean;
      } | null = null;
      try {
        data = JSON.parse(text);
      } catch {}
      if (data?.promoBlocked) {
        // Already used on this account: drop the code and say why; buying again charges the list price.
        removePromo();
        setPromoError(data.error ?? "This code can't be used.");
        setLoading(null);
        return;
      }
      if (res.ok && data?.paddle && checkoutConfig?.paddle) {
        const paddle = await loadPaddle(checkoutConfig.paddle);
        paddle.Checkout.open({
          transactionId: data.paddle.transactionId,
          ...(data.paddle.email ? { customer: { email: data.paddle.email } } : {}),
          // No discount box in Paddle's checkout: codes are entered on this
          // page, where the server allows each account one use.
          settings: {
            displayMode: "overlay",
            variant: "one-page",
            successUrl: data.paddle.successUrl,
            showAddDiscounts: false,
          },
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
            The editor is free forever. Paid passes start at {PLANS.lite.priceLabel} for 30 days, with no subscription, and unlock premium transitions,
            filters and effects, higher resolutions and more AI credits.
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
                {b === "month" ? "30 days" : "1 year"}
                {b === "year" && <span className="ml-1.5 text-[11px] font-bold text-emerald-500">Save 25%+</span>}
              </button>
            ))}
          </div>
        </div>

        {!manualPayments && checkoutConfig && (
          promo ? (
            <div
              role="status"
              className="mx-auto mt-10 max-w-2xl rounded-2xl border border-emerald-500/50 bg-emerald-500/10 px-5 py-4 text-center text-sm text-foreground"
            >
              <p className="font-semibold">
                Code {promoCode} applied: {promo.percent}% off{" "}
                {promo.plans.map((p) => PLANS[p].label).filter((l, i, a) => a.indexOf(l) === i).join(" and ")}
              </p>
              <p className="mt-1 text-muted">
                Applied at checkout, once per account, until{" "}
                {new Date(promo.endsAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.{" "}
                <button type="button" onClick={removePromo} className="underline hover:text-foreground">
                  Remove code
                </button>
              </p>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                applyPromo(promoInput);
              }}
              className="mx-auto mt-8 flex max-w-sm flex-col items-center gap-2"
            >
              <div className="flex w-full gap-2">
                <input
                  value={promoInput}
                  onChange={(e) => setPromoInput(e.target.value)}
                  placeholder="Have a code?"
                  aria-label="Discount code"
                  autoComplete="off"
                  className="flex-1 rounded-full border border-border bg-surface-2/80 px-4 py-2 text-sm uppercase text-foreground placeholder:normal-case"
                />
                <button
                  type="submit"
                  disabled={promoChecking || !promoInput.trim()}
                  className="btn-secondary rounded-full px-5 py-2 text-xs font-bold disabled:opacity-50"
                >
                  {promoChecking ? "Checking…" : "Apply"}
                </button>
              </div>
              {promoError && <p role="alert" className="text-xs text-red-500">{promoError}</p>}
            </form>
          )
        )}

        {manualPayments && (
          <div
            role="status"
            className="mx-auto mt-10 max-w-2xl rounded-2xl border border-amber-400/60 bg-amber-400/10 px-5 py-4 text-center text-sm text-foreground"
          >
            <p className="font-semibold">Online payments are under construction 🚧</p>
            <p className="mt-1 text-muted">
              You can still upgrade. Message us on WhatsApp at{" "}
              <a
                href={whatsappLink("Hi WipeClip, I'd like a payment link for a plan.")}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-foreground underline"
              >
                {SUPPORT_PHONE_DISPLAY}
              </a>{" "}
              and we&apos;ll send you a secure payment link. Include the email you signed up with so we can
              activate your plan.
            </p>
          </div>
        )}

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
                    <span className="font-mono text-3xl font-extrabold text-foreground">
                      {key && plan ? (localPrices[key] ?? plan.priceLabel) : "$0"}
                    </span>
                    <span className="text-xs text-muted"> {plan ? (plan.period === "year" ? "for 1 year" : "for 30 days") : "/ forever"}</span>
                    {key && promo?.plans.includes(key) && (
                      <p className="mt-1 text-[11px] font-bold text-emerald-500">{promo.percent}% off at checkout</p>
                    )}
                    {plan && (
                      <p className="mt-1 text-[11px] text-muted">
                        {showLkr ? `Charged as ${formatLkr(plan.amountCents)} · ` : ""}
                        {pricesTaxed ? "Incl. VAT / tax · " : ""}
                        One-time payment, no auto-renewal · {plan.credits} AI credits included
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
                      {loading === key
                        ? "Opening checkout…"
                        : manualPayments
                          ? `Get ${plan.label} via WhatsApp`
                          : isCurrent
                            ? `Renew ${plan.label}`
                            : `Get ${plan.label}`}
                    </button>
                  ) : (
                    <Link href="/download" className="btn-secondary block w-full rounded-full py-3 text-center text-xs font-semibold">
                      Download free
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="glass-card mx-auto mt-6 flex max-w-7xl flex-col items-center justify-between gap-4 rounded-[2rem] border border-border/80 p-6 sm:flex-row">
          <div className="text-center sm:text-left">
            <h2 className="text-sm font-bold text-foreground">Only need the AI tools?</h2>
            <p className="mt-1 text-xs text-muted">
              {PLANS.payg.label}: {PLANS.payg.credits} AI credits for{" "}
              <span className="font-mono font-bold text-foreground">{localPrices.payg ?? PLANS.payg.priceLabel}</span>, one-time.
              {showLkr ? ` Charged as ${formatLkr(PLANS.payg.amountCents)}.` : ""} Works on any plan, including Free, and
              doesn&apos;t change your plan.
            </p>
          </div>
          <button
            onClick={() => buy("payg")}
            disabled={loading !== null}
            className="btn-secondary shrink-0 rounded-full px-6 py-3 text-xs font-bold disabled:opacity-50"
          >
            {loading === "payg" ? "Opening checkout…" : manualPayments ? "Get credits via WhatsApp" : "Buy credits"}
          </button>
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-muted">
          Plans are prepaid for the period shown and don&apos;t renew automatically. Renewing early adds the time to
          your current plan. AI credits are used by the AI tools ({AI_CLEANUP_ENABLED ? "object cleanup, " : ""}background removal, sharpening);
          editing and exporting never use credits.
          {AI_CLEANUP_ENABLED
            ? " Video cleanup costs 1 credit per started minute at 720p, 2 at 1080p and 4 at 4K; images cost 1 credit each."
            : ""}{" "}
          Full refund within 14 days, see our{" "}
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
        {children}
      </main>
      <Footer />
    </div>
  );
}
