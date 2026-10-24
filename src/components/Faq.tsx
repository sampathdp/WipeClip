import Link from "next/link";
import Reveal from "./Reveal";
import { AI_CLEANUP_ENABLED } from "@/lib/features";
import { PLANS } from "@/lib/credits";
import { DESKTOP_DOWNLOADS } from "@/lib/download";
import { faqJsonLd, softwareAppJsonLd } from "@/lib/seo";
import { localeHref, type Lang } from "@/lib/i18n";
import { fmt, getDict } from "@/i18n";
import type { Dict } from "@/i18n/types";
import { rich } from "@/i18n/rich";

// Passes only: credit packs (and the retired one) have no plan or days.
const lowestPass = Object.values(PLANS)
  .filter((p) => p.tier)
  .reduce((a, b) => (b.usdCents < a.usdCents ? b : a));

/** "Windows: Windows 10 (21H2 or later) or Windows 11. macOS: …" in the
 * dictionary's language. */
export function systemsAnswer(d: Dict): string {
  return DESKTOP_DOWNLOADS.map((dl) => {
    const os = d.client.downloads[dl.os];
    return `${os.label}: ${os.requirements}.`;
  }).join(" ");
}

function editorFaqs(d: Dict) {
  return d.homeFaq.items.map((f) => ({
    q: f.q,
    a: fmt(f.a, { price: lowestPass.priceLabel, days: lowestPass.days ?? "", systems: systemsAnswer(d) }),
  }));
}

// English only: shown while the AI cleanup feature is on.
const cleanupFaqs = [
  {
    q: "Can I also trim, cut, or edit my video?",
    a: "Yes. The WipeClip desktop app for Windows and Mac lets you trim, split and remove sections, reorder clips, add transitions and stickers, and run AI object removal on a single clip, then export at your original aspect ratio and frame rate.",
  },
  {
    q: "Can I use this on any video I find online?",
    a: "No. WipeClip.co is for footage you shot yourself or have the rights to edit, such as your own recordings, personal B-roll, or client footage you're contracted to edit. You confirm this before every job.",
  },
  {
    q: "Does this actually reconstruct the area, or just blur it?",
    a: "WipeClip.co blends the marked region in from surrounding pixels and temporal motion vectors rather than covering it with a static blur box or destructive crop.",
  },
  {
    q: "What can I remove?",
    a: "Unwanted physical objects in your own shots, like a passer-by, a stray cable, a boom mic or a lens smudge. You mark the region yourself on the preview frame. Only use it on content you created or have the rights to edit.",
  },
  {
    q: "Will the output lose resolution or quality?",
    a: "No. Original source resolution and framerate are strictly preserved, and output videos are exported at visually lossless bitrates.",
  },
  {
    q: "What is the maximum file size?",
    a: "Clips up to 300MB are supported on the free plan. Higher limits and API integrations are available for batch processing.",
  },
  {
    q: "Do you store or use my video files?",
    a: "Never. Files are processed in temporary volatile memory and immediately deleted the instant your download completes.",
  },
  {
    q: "Will you process explicit or adult content?",
    a: "No. Every upload is automatically screened before processing, and clips flagged as explicit or abusive are immediately rejected.",
  },
];

export default function Faq({ lang = "en" }: { lang?: Lang }) {
  const d = getDict(lang);
  const t = d.homeFaq;
  const faqs = AI_CLEANUP_ENABLED ? cleanupFaqs : editorFaqs(d);
  // Shown only on the homepage, so it also carries the app's own node.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [softwareAppJsonLd(lang === "en" ? {} : { inLanguage: lang }), { ...faqJsonLd(faqs), inLanguage: lang }],
  };
  const link = (path: string, label: string) => (
    <Link href={localeHref(lang, path)} className="underline hover:text-cyan-600">
      {label}
    </Link>
  );

  return (
    <section id="faq" className="scroll-mt-28 py-24 relative">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border px-3.5 py-1 text-xs font-semibold text-muted">
            {t.badge}
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            {t.title}
          </h2>
        </div>

        <Reveal className="mt-12 space-y-4">
          {faqs.map((f) => (
            <details
              key={f.q}
              className="glass-card group rounded-2xl p-6 transition-all duration-200 border border-border/80 hover:border-cyan-500/30 open:border-cyan-500/40 open:shadow-[0_0_20px_rgba(34,211,238,0.15)]"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-base text-foreground">
                <span>{f.q}</span>
                <span className="ml-4 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 border border-border text-cyan-600 transition-transform duration-300 group-open:rotate-45 group-hover:scale-110">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </summary>
              <p className="mt-4 text-sm text-muted leading-relaxed border-t border-border/50 pt-4">{f.a}</p>
            </details>
          ))}
        </Reveal>

        <p className="mt-8 text-center text-xs text-muted">
          {rich(t.more, {
            terms: link("/terms", t.terms),
            privacy: link("/privacy", t.privacy),
            dmca: link("/dmca", t.dmca),
          })}
        </p>
      </div>
    </section>
  );
}
