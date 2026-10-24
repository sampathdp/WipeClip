import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import BackgroundRemoverDemo from "@/components/BackgroundRemoverDemo";
import PhotoSharpenerDemo from "@/components/PhotoSharpenerDemo";
import VideoFrameGrabberDemo from "@/components/VideoFrameGrabberDemo";
import DownloadButtons from "@/components/DownloadButtons";
import InlineScript from "@/components/InlineScript";
import ToolGuide from "@/components/ToolGuide";
import { faqJsonLd, jsonLdString, softwareAppJsonLd } from "@/lib/seo";
import { LOCALE_INFO, LOCALES, localizedPath, TRANSLATED_PATHS, type Locale } from "@/lib/i18n";
import { PAGES, UI, type LocalizedDemo, type LocalizedPage as Content } from "@/lib/i18n-content";

const DEMOS: Record<LocalizedDemo, React.ReactNode> = {
  download: (
    <div className="mx-auto max-w-xl">
      <DownloadButtons />
    </div>
  ),
  background: <BackgroundRemoverDemo />,
  sharpen: <PhotoSharpenerDemo />,
  frame: <VideoFrameGrabberDemo />,
};

/** A translated free-tool or download page. Same layout as the English
 * pages; the copy comes from i18n-content. */
export default function LocalizedPage({ locale, page }: { locale: Locale; page: Content }) {
  const ui = UI[locale];
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { ...faqJsonLd(page.faqs), inLanguage: locale },
      ...(page.demo === "download" ? [softwareAppJsonLd({ inLanguage: locale })] : []),
    ],
  };
  const slugs = TRANSLATED_PATHS[page.enPath];
  const versions = [
    { href: page.enPath, name: "English" },
    ...LOCALES.filter((l) => l !== locale).map((l) => ({
      href: localizedPath(l, slugs[l]),
      name: LOCALE_INFO[l].name,
    })),
  ];
  // Other tools in this language, for crawlers and visitors alike.
  const siblings = Object.entries(PAGES[locale]).filter(([, p]) => p.enPath !== page.enPath);

  return (
    <div className="flex flex-1 flex-col">
      {/* The root layout renders <html lang="en">; correct it on a full load. */}
      <InlineScript html={`document.documentElement.lang=${JSON.stringify(locale)};`} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      <Navbar />
      <main className="flex-1" lang={locale}>
        <section className="relative overflow-hidden pt-36 pb-16 md:pt-48">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-48 left-1/3 h-[650px] w-[950px] rounded-full bg-gradient-to-b from-accent/6 via-cyan-500/4 to-transparent blur-[140px] -z-10 dark:from-accent/25 dark:via-cyan-500/15"
          />
          <div className="mx-auto max-w-3xl px-6 text-center">
            <div className="mb-6 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-cyan-500/30 px-3.5 py-1 text-xs font-semibold text-cyan-600">
              {page.badge}
            </div>
            <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl text-foreground text-balance">
              {page.h1[0]}
              <span className="text-gradient">{page.h1[1]}</span>
              {page.h1[2]}
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">{page.intro}</p>
          </div>
        </section>

        <section className="pb-24">
          <div className="px-6">{DEMOS[page.demo]}</div>
        </section>

        <ToolGuide title={page.guideTitle} steps={page.steps} facts={page.facts} factsTitle={ui.factsTitle} />

        <section className="py-16">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="text-center font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
              {page.faqTitle}
            </h2>
            <div className="mt-10 space-y-4">
              {page.faqs.map((f) => (
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

        <nav className="pb-16">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-6 text-sm text-muted">
            <p className="flex flex-wrap justify-center gap-x-4 gap-y-2">
              <span className="font-semibold text-foreground">{ui.freeTools}:</span>
              {siblings.map(([slug, p]) => (
                <Link key={slug} href={localizedPath(locale, slug)} className="underline hover:text-foreground">
                  {p.h1.join("").trim()}
                </Link>
              ))}
            </p>
            <p className="flex flex-wrap justify-center gap-x-4">
              <span>{ui.otherLanguages}:</span>
              {versions.map((v) => (
                <Link key={v.href} href={v.href} className="underline hover:text-foreground">
                  {v.name}
                </Link>
              ))}
            </p>
          </div>
        </nav>
      </main>
      <Footer />
    </div>
  );
}
