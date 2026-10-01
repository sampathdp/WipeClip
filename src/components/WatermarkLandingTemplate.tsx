import Link from "next/link";
import Navbar from "./Navbar";
import Footer from "./Footer";
import HowItWorks from "./HowItWorks";
import CtaBanner from "./CtaBanner";
import type { WatermarkPlatform } from "@/lib/watermarkPlatforms";

export default function WatermarkLandingTemplate({
  content,
  h1,
  body,
  extra,
}: {
  content: WatermarkPlatform;
  /** Overrides the default "Restore your {platform} footage" H1 text. */
  h1?: React.ReactNode;
  /** Overrides the default behavior/why-remove block with platform-specific
   * editorial content. Still rendered inside the template's narrow
   * max-w-3xl column. */
  body?: React.ReactNode;
  /** Extra full-width section(s) rendered after `body`, before the
   * "How it works" block - for content that needs its own width, like an
   * evidence/comparison component. */
  extra?: React.ReactNode;
}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: content.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className="flex flex-1 flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
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
              {content.heroEyebrow}
            </div>
            <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl text-foreground text-balance">
              {h1 ?? (
                <>
                  Restore your <span className="text-gradient">{content.platform}</span> footage
                </>
              )}
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              {content.heroSubtitle}
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/#upload"
                className="btn-primary rounded-full px-8 py-4 text-sm sm:text-base font-bold inline-flex items-center justify-center gap-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_0_35px_rgba(124,92,255,0.45)] transition-all hover:scale-[1.02]"
              >
<span>Clean up a clip free</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-3xl px-6">
            {body ?? (
              <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
                <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                  How the {content.platform} export badge behaves
                </h2>
                <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
                  {content.behavior}
                </p>
                <h2 className="mt-8 font-display text-2xl font-bold tracking-tight text-foreground">
                  Why creators clean it up
                </h2>
                <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
                  {content.whyRemove}
                </p>
              </div>
            )}
          </div>
        </section>

        {extra}

        <HowItWorks />

        <section className="pb-4">
          <div className="mx-auto max-w-3xl px-6">
            <div className="glass-card flex flex-col gap-4 rounded-[1.75rem] border border-border/80 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
              <div>
                <h2 className="font-display text-lg font-bold tracking-tight text-foreground">
                  Need to trim or re-edit the clip too?
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  The WipeClip video editor cuts, rearranges and adds transitions and stickers to your{" "}
                  {content.platform} footage, with AI cleanup on just the clips that need it.
                </p>
              </div>
              <Link href="/editor" className="btn-secondary shrink-0 rounded-full px-5 py-2.5 text-center text-sm font-semibold">
                Open the editor
              </Link>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="text-center font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
              {content.platform} footage cleanup: FAQ
            </h2>
            <div className="mt-10 space-y-4">
              {content.faqs.map((f) => (
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
            <p className="mt-8 text-center text-xs text-muted">
              WipeClip.co is not affiliated with, endorsed by, or sponsored by {content.platform}. All product
              names, logos, and brands are property of their respective owners.
            </p>
          </div>
        </section>

        <CtaBanner />
      </main>
      <Footer />
    </div>
  );
}
