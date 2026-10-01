import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import BackgroundRemoverDemo from "@/components/BackgroundRemoverDemo";
import { buildPageMetadata } from "@/lib/seo";

const title = "Remove Background From Image - Free";
const description =
  "Upload a photo and get a transparent-background PNG back in seconds. Free, no account required to preview. Powered by the same engine behind WipeClip.co's AI cleanup tools.";

export const metadata: Metadata = buildPageMetadata({
  title,
  description,
  path: "/remove-background",
});

const faqs = [
  {
    q: "Is this actually free?",
    a: "Yes. Every visitor gets free preview passes with no account, and every signed-in account gets 2 free credits a day at no cost, which covers typical everyday use of this tool.",
  },
  {
    q: "What file types come out?",
    a: "A PNG with a transparent alpha channel, so you can drop the subject straight onto a new background, a product page, or a slide.",
  },
  {
    q: "How is this different from WipeClip.co's AI cleanup tool?",
    a: "Background removal cuts out the subject automatically, no marking required. The AI object removal tool reconstructs a small marked region (like a stray object) instead of removing the whole background. Both share the same image-processing engine underneath.",
  },
  {
    q: "Will edges look rough on hair or fine detail?",
    a: "The pipeline runs edge decontamination and alpha smoothing after the initial cut specifically to clean up halos and rough edges around fine detail, not just a flat cutout mask.",
  },
];

export default function Page() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className="flex flex-1 flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
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
              Free Tool
            </div>
            <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl text-foreground text-balance">
              Remove the <span className="text-gradient">background</span> from any photo
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              Upload a photo, get a transparent PNG back. No region to mark, no account needed to
              preview. Just drop the subject onto whatever background you need next.
            </p>
          </div>
        </section>

        <section className="pb-24">
          <div className="px-6">
            <BackgroundRemoverDemo />
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="text-center font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
              Background removal: FAQ
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
      </main>
      <Footer />
    </div>
  );
}
