import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import PricingClient from "@/app/pricing/PricingClient";
import { buildPageMetadata, faqJsonLd, jsonLdString } from "@/lib/seo";
import { PLANS } from "@/lib/credits";
import { localeHref, type Lang } from "@/lib/i18n";
import { fmt, getDict } from "@/i18n";
import { rich } from "@/i18n/rich";

export function pricingMetadata(lang: Lang): Metadata {
  const t = getDict(lang).pricingPage;
  const price = PLANS.lite.priceLabel;
  return buildPageMetadata({
    title: fmt(t.title, { price }),
    description: fmt(t.description, { price }),
    path: "/pricing",
    ogTitle: t.ogTitle,
    ogDescription: t.ogDescription,
    lang,
  });
}

/** The pricing FAQ, server-rendered after the plans so it stays out of the
 * client bundle and in the page's HTML for crawlers. Built from PLANS, so
 * prices here can't drift from the cards above. */
function PricingFaq({ lang }: { lang: Lang }) {
  const t = getDict(lang).pricingPage;
  const pass = (key: keyof typeof PLANS) => fmt(t.passPrice, { price: PLANS[key].priceLabel, n: PLANS[key].credits });
  const faqs = t.faqs.map((f) => ({
    q: f.q,
    a: fmt(f.a, {
      lite: pass("lite"),
      starter: pass("starter"),
      pro: pass("pro"),
      liteYearly: pass("lite_yearly"),
      starterYearly: pass("starter_yearly"),
      proYearly: pass("pro_yearly"),
    }),
  }));
  const link = (path: string, label: string) => (
    <Link href={localeHref(lang, path)} className="underline hover:text-foreground">
      {label}
    </Link>
  );

  return (
    <section className="relative mx-auto mt-24 max-w-3xl" aria-labelledby="pricing-faq-heading">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString({ "@context": "https://schema.org", ...faqJsonLd(faqs), inLanguage: lang }) }}
      />
      <h2 id="pricing-faq-heading" className="text-center font-display text-2xl font-extrabold tracking-tight text-foreground">
        {t.faqTitle}
      </h2>
      <div className="mt-8 space-y-3">
        {faqs.map((f) => (
          <details key={f.q} className="glass-card group rounded-2xl border border-border/80 p-5 open:border-cyan-500/40">
            <summary className="cursor-pointer list-none font-semibold text-foreground">{f.q}</summary>
            <p className="mt-3 border-t border-border/50 pt-3 text-sm leading-relaxed text-muted">{f.a}</p>
          </details>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-muted">
        {rich(t.more, { refund: link("/refund-policy", t.refund), terms: link("/terms", t.terms) })}
      </p>
    </section>
  );
}

export default function PricingView({ lang }: { lang: Lang }) {
  return (
    <div className="flex flex-1 flex-col min-h-screen">
      <Navbar />
      <PricingClient>
        <PricingFaq lang={lang} />
      </PricingClient>
      <Footer lang={lang} />
    </div>
  );
}
