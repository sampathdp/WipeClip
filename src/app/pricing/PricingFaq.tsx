import Link from "next/link";
import { PLANS } from "@/lib/credits";
import { faqJsonLd, jsonLdString } from "@/lib/seo";

const pass = (key: keyof typeof PLANS) => `${PLANS[key].priceLabel} (${PLANS[key].credits} credits)`;

// Built from PLANS, so prices here can't drift from the cards above.
const faqs = [
  {
    q: "Is WipeClip free?",
    a: "Yes. The screen recorder and video editor are free to download and use, and every account gets 2 free credits a day. Paid passes are optional.",
  },
  {
    q: "How much do the paid plans cost?",
    a: `For 30 days: Lite ${pass("lite")}, Starter ${pass("starter")}, Pro ${pass("pro")}. For 1 year: Lite ${pass("lite_yearly")}, Starter ${pass("starter_yearly")}, Pro ${pass("pro_yearly")}. These are the US dollar list prices; the cards above and checkout show your price in your local currency, such as euros or pounds, with any local tax included.`,
  },
  {
    q: "Do prices include VAT?",
    a: "Yes. If you're in the UK or the EU, the price you see at checkout already includes VAT for your country, so there's nothing extra to pay. You get a receipt by email after every purchase.",
  },
  {
    q: "Is this a subscription?",
    a: "No. Every plan is a one-time payment for 30 days or 1 year and doesn't renew automatically. When it ends, your account goes back to the free plan and you can buy again whenever you like.",
  },
  {
    q: "What do paid plans add?",
    a: "Premium transitions, filters and effects, exports at higher resolutions up to 4K, and more credits for the AI tools. Recording and basic editing stay free.",
  },
  {
    q: "What happens if I buy again before my plan ends?",
    a: "Buying the same plan again adds its days to the end of your current pass, so you never lose the time you already paid for.",
  },
  {
    q: "Can I get a refund?",
    a: "Yes. You can ask for a full refund of any purchase within 14 days, for any reason. A refunded plan ends straight away and its credits are removed.",
  },
];

export default function PricingFaq() {
  return (
    <section className="relative mx-auto mt-24 max-w-3xl" aria-labelledby="pricing-faq-heading">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString({ "@context": "https://schema.org", ...faqJsonLd(faqs) }) }}
      />
      <h2 id="pricing-faq-heading" className="text-center font-display text-2xl font-extrabold tracking-tight text-foreground">
        Pricing questions
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
        Full details in the{" "}
        <Link href="/refund-policy" className="underline hover:text-foreground">
          refund policy
        </Link>{" "}
        and{" "}
        <Link href="/terms" className="underline hover:text-foreground">
          terms
        </Link>
        .
      </p>
    </section>
  );
}
