import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import BackgroundRemoverDemo from "@/components/BackgroundRemoverDemo";
import PhotoSharpenerDemo from "@/components/PhotoSharpenerDemo";
import VideoFrameGrabberDemo from "@/components/VideoFrameGrabberDemo";
import ToolGuide from "@/components/ToolGuide";
import RelatedTools from "@/components/RelatedTools";
import { buildPageMetadata, faqJsonLd, jsonLdString, webApplicationJsonLd } from "@/lib/seo";
import { AI_CLEANUP_ENABLED } from "@/lib/features";
import { localeHref, type Lang } from "@/lib/i18n";
import { getDict } from "@/i18n";

/** The three free browser tools share one page layout; copy comes from
 * the dictionary's toolPages, keyed like TOOLS below. */
const TOOLS = {
  removeBackground: { path: "/remove-background", demo: <BackgroundRemoverDemo />, name: "removeBackground" },
  sharpenImage: { path: "/sharpen-image", demo: <PhotoSharpenerDemo />, name: "sharpen" },
  extractVideoFrame: { path: "/extract-video-frame", demo: <VideoFrameGrabberDemo />, name: "frameGrabber" },
} as const;

export type ToolKey = keyof typeof TOOLS;

// AI cleanup copy, English only while that feature is off.
const CLEANUP_EXTRAS: Partial<Record<ToolKey, { description?: string; faq: { q: string; a: string }; replaceLast?: boolean }>> = {
  removeBackground: {
    description: " Powered by the same engine behind WipeClip.co's AI cleanup tools.",
    faq: {
      q: "How is this different from WipeClip.co's AI cleanup tool?",
      a: "Background removal cuts out the subject automatically, no marking required. The AI object removal tool reconstructs a small marked region (like a stray object) instead of removing the whole background. Both share the same image-processing engine underneath.",
    },
  },
  extractVideoFrame: {
    replaceLast: true,
    faq: {
      q: "Why would I need WipeClip.co's paid tool instead?",
      a: "This tool answers a different question - grabbing a clean still frame. If your own footage has an unwanted object you need removed from the whole clip, that's WipeClip.co's AI object removal tool, free to try.",
    },
  },
};

function content(tool: ToolKey, lang: Lang) {
  const t = getDict(lang).toolPages[tool];
  const extra = AI_CLEANUP_ENABLED ? CLEANUP_EXTRAS[tool] : undefined;
  const description = t.description + (extra?.description ?? "");
  let faqs = t.faqs;
  if (extra) faqs = extra.replaceLast ? [...faqs.slice(0, -1), extra.faq] : [...faqs.slice(0, 2), extra.faq, ...faqs.slice(2)];
  return { t, description, faqs };
}

export function toolMetadata(tool: ToolKey, lang: Lang): Metadata {
  const { t, description } = content(tool, lang);
  return buildPageMetadata({ title: t.title, description, path: TOOLS[tool].path, lang });
}

export default function ToolView({ tool, lang }: { tool: ToolKey; lang: Lang }) {
  const d = getDict(lang);
  const { t, description, faqs } = content(tool, lang);
  const { path, demo, name } = TOOLS[tool];
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { ...faqJsonLd(faqs), inLanguage: lang },
      webApplicationJsonLd({ name: d.client.toolNames[name], path: localeHref(lang, path), description, free: true }),
    ],
  };

  return (
    <div className="flex flex-1 flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }}
      />
      <Navbar />
      <main className="flex-1">
        <section className="relative overflow-hidden pt-36 pb-16 md:pt-48">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-48 left-1/3 h-[650px] w-[950px] rounded-full bg-gradient-to-b from-accent/6 via-cyan-500/4 to-transparent blur-[140px] -z-10 dark:from-accent/25 dark:via-cyan-500/15"
          />
          <div className="mx-auto max-w-3xl px-6 text-center">
            <div className="mb-6 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-cyan-500/30 px-3.5 py-1 text-xs font-semibold text-cyan-600">
              {t.badge}
            </div>
            <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl text-foreground text-balance">
              {t.h1[0]}
              <span className="text-gradient">{t.h1[1]}</span>
              {t.h1[2]}
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">{t.intro}</p>
          </div>
        </section>

        <section className="pb-24">
          <div className="px-6">{demo}</div>
        </section>

        <ToolGuide title={t.guideTitle} steps={t.steps} facts={t.facts} factsTitle={d.toolGuide.factsTitle} />

        <section className="py-16">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="text-center font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
              {t.faqTitle}
            </h2>
            <div className="mt-10 space-y-4">
              {faqs.map((f) => (
                <details
                  key={f.q}
                  className="glass-card group rounded-2xl p-6 transition-all duration-200 border border-border/80 hover:border-cyan-500/30 open:border-cyan-500/40"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-base text-foreground">
                    <span>{f.q}</span>
                    <span className="ml-4 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 border border-border text-cyan-600 transition-transform duration-300 group-open:rotate-45">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </span>
                  </summary>
                  <p className="mt-4 text-sm text-muted leading-relaxed border-t border-border/50 pt-4">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
        <RelatedTools current={path} lang={lang} />
      </main>
      <Footer lang={lang} />
    </div>
  );
}
