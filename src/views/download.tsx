import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";
import DownloadButtons from "@/components/DownloadButtons";
import { systemsAnswer } from "@/components/Faq";
import { EditorWindowMock, FocusMock, RecorderMock, ReviewMock, TutorialFrameMock } from "@/components/download/Mockups";
import { buildPageMetadata, faqJsonLd, softwareAppJsonLd } from "@/lib/seo";
import { AI_CLEANUP_ENABLED } from "@/lib/features";
import { DESKTOP_DOWNLOADS, DOWNLOAD_PATH } from "@/lib/download";
import { localeHref, type Lang } from "@/lib/i18n";
import { fmt, getDict } from "@/i18n";
import { rich } from "@/i18n/rich";

export function downloadMetadata(lang: Lang): Metadata {
  const t = getDict(lang).downloadPage.meta;
  return buildPageMetadata({
    title: t.title,
    description: t.description,
    path: DOWNLOAD_PATH,
    ogTitle: t.ogTitle,
    ogDescription: t.ogDescription,
    lang,
  });
}

const MOCKS = {
  recorder: <RecorderMock />,
  focus: <FocusMock />,
  review: <ReviewMock />,
  tutorial: <TutorialFrameMock />,
};

const EDITING_ICONS = {
  trim: <path d="M6 3v12a3 3 0 0 0 3 3h12M18 21V9a3 3 0 0 0-3-3H3" />,
  transitions: (
    <>
      <rect x="2" y="6" width="9" height="12" rx="2" />
      <rect x="13" y="6" width="9" height="12" rx="2" />
    </>
  ),
  text: <path d="M4 7V4h16v3M9 20h6M12 4v16" />,
  music: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  filters: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
    </>
  ),
  aspect: (
    <>
      <rect x="3" y="6" width="12" height="9" rx="1.5" />
      <rect x="16" y="4" width="5" height="16" rx="1.5" />
    </>
  ),
  autosave: <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />,
  quality: <path d="M5 12l4 4L19 6" />,
};

// English only while the AI cleanup feature is off; takes the autosave slot.
const CLEANUP_FEATURE = {
  title: "AI object removal",
  desc: "Remove an unwanted object from just one clip.",
  icon: <path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z" />,
};

const FEATURE_LIST = [
  "Screen, window and area recording",
  "Separate system audio, microphone and webcam tracks",
  "Automatic focus zooms from recorded clicks",
  "Click highlights and smooth cursor",
  "Pause, dead time and retake detection",
  "On-device captions with SRT and WebVTT export",
  "Privacy blur and pixelate masks",
  "Keyboard shortcut indicators",
  "Chapters and annotations",
  "Trim, split, transitions, text, stickers, music and filters",
];

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-cyan-500" aria-hidden>
      <path d="M5 12l4 4L19 6" />
    </svg>
  );
}

export default function DownloadView({ lang }: { lang: Lang }) {
  const d = getDict(lang);
  const t = d.downloadPage;
  const href = (path: string) => localeHref(lang, path);

  const spotlights = (Object.keys(MOCKS) as (keyof typeof MOCKS)[]).map((id) => ({ id, ...t.spotlights[id], mock: MOCKS[id] }));
  const editing = (Object.keys(EDITING_ICONS) as (keyof typeof EDITING_ICONS)[]).map((key) =>
    key === "autosave" && AI_CLEANUP_ENABLED ? CLEANUP_FEATURE : { ...t.editing[key], icon: EDITING_ICONS[key] },
  );
  const faqs = t.faqs.map((f) => {
    const a = fmt(f.a, { systems: systemsAnswer(d) });
    // The uploads answer also names AI Cleanup while that feature is on (English only).
    return AI_CLEANUP_ENABLED && lang === "en" ? { q: f.q, a: a.replace("when you export,", "when you export or run AI Cleanup,") } : { q: f.q, a };
  });

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      softwareAppJsonLd({
        description:
          "Desktop screen recorder and video editor: record screen, system audio, microphone and webcam as separate tracks, add automatic focus zooms and click highlights, cut pauses and dead time, add on-device captions, privacy masks and annotations, and export at the original quality.",
        featureList: FEATURE_LIST,
      }),
      { ...faqJsonLd(faqs), inLanguage: lang },
    ],
  };

  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="flex-1 overflow-x-clip">
        {/* Hero */}
        <section className="relative pt-32 pb-20 md:pt-40">
          <div
            aria-hidden
            className="animate-float-slow pointer-events-none absolute -top-40 left-1/2 -z-10 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-b from-accent/15 via-cyan-500/10 to-transparent blur-[130px] dark:from-accent/30 dark:via-cyan-500/15"
          />
          <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-6 lg:grid-cols-[1fr_1.1fr]">
            <Reveal className="text-center lg:text-left">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-surface-2/90 px-3.5 py-1 text-xs font-semibold text-cyan-600">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
                {t.badge}
              </div>
              <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tighter text-foreground text-balance sm:text-6xl xl:text-7xl">
                {t.h1}
                <span className="text-gradient">{t.h1Highlight}</span>
              </h1>
              <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg lg:mx-0">{t.intro}</p>
              <div className="mt-8 flex justify-center lg:justify-start">
                <DownloadButtons compact />
              </div>
              <p className="mt-4 text-xs text-muted">
                {DESKTOP_DOWNLOADS.map((dl) => d.client.downloads[dl.os].requirements).join(" · ")}
              </p>
              {DESKTOP_DOWNLOADS.filter((dl) => dl.url && d.client.downloads[dl.os].note).map((dl) => (
                <p key={dl.os} className="mt-1 text-xs text-muted">
                  {d.client.downloads[dl.os].note}
                </p>
              ))}
            </Reveal>
            <Reveal delay={120} className="relative">
              <div aria-hidden className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-tr from-accent/20 to-cyan-500/20 blur-2xl" />
              <EditorWindowMock />
            </Reveal>
          </div>
        </section>

        {/* Stats */}
        <section className="border-y border-border bg-surface/60">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-10 sm:grid-cols-4">
            {t.stats.map((s) => (
              <div key={s.label} className="text-center">
                <div className="font-display text-3xl font-extrabold text-gradient sm:text-4xl">{s.value}</div>
                <div className="mt-1 text-xs font-medium text-muted sm:text-sm">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Unique features */}
        <section className="mx-auto max-w-7xl px-6 pt-24">
          <Reveal className="mx-auto max-w-2xl text-center">
            <div className="mb-4 inline-flex rounded-full border border-border bg-surface-2/90 px-3.5 py-1 text-xs font-semibold text-muted">
              {t.onlyBadge}
            </div>
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-5xl">
              {t.onlyTitle}
              <span className="text-gradient">{t.onlyTitleHighlight}</span>
            </h2>
            <p className="mt-4 text-base text-muted">{t.onlyIntro}</p>
          </Reveal>

          <div className="mt-20 space-y-28">
            {spotlights.map((s, i) => (
              <div key={s.id} id={s.id} className="grid scroll-mt-28 grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
                <Reveal className={i % 2 ? "lg:order-2" : ""}>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-600">{s.eyebrow}</p>
                  <h3 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                    {s.title}
                    <span className="text-gradient">{s.titleHighlight}</span>
                  </h3>
                  <p className="mt-4 text-base leading-relaxed text-muted">{s.desc}</p>
                  <ul className="mt-6 space-y-3">
                    {s.points.map((p) => (
                      <li key={p} className="flex gap-2.5 text-sm text-foreground">
                        <Check />
                        {p}
                      </li>
                    ))}
                  </ul>
                </Reveal>
                <Reveal delay={120} className={`relative ${i % 2 ? "lg:order-1" : ""}`}>
                  <div aria-hidden className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-accent/10 to-cyan-500/10 blur-xl" />
                  {s.mock}
                </Reveal>
              </div>
            ))}
          </div>
        </section>

        {/* Workflow */}
        <section className="mx-auto max-w-6xl px-6 pt-32">
          <Reveal className="glass-card rounded-[2rem] p-8 sm:p-12">
            <h2 className="text-center font-display text-3xl font-extrabold tracking-tight text-foreground">
              {t.stepsTitle}
              <span className="text-gradient">{t.stepsTitleHighlight}</span>
            </h2>
            <ol className="relative mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              <span aria-hidden className="absolute left-[12%] right-[12%] top-6 hidden h-px bg-gradient-to-r from-accent/50 via-cyan-500/50 to-accent/50 lg:block" />
              {t.steps.map((s, i) => (
                <li key={s.title} className="relative text-center">
                  <span className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-tr from-accent to-cyan-500 font-display text-lg font-extrabold text-white shadow-[0_0_25px_rgba(124,92,255,0.45)]">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 font-display text-lg font-bold text-foreground">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.desc}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        </section>

        {/* Everyday editing */}
        <section className="mx-auto max-w-6xl px-6 pt-28">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              {t.editingTitle}
              <span className="text-gradient">{t.editingTitleHighlight}</span>
            </h2>
            <p className="mt-4 text-base text-muted">{t.editingIntro}</p>
          </Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {editing.map((f, i) => (
              <Reveal key={f.title} delay={(i % 4) * 70} className="glass-card rounded-2xl p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/30 bg-gradient-to-tr from-accent/15 to-accent-2/15 text-cyan-600">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {f.icon}
                  </svg>
                </div>
                <h3 className="mt-4 font-display text-base font-bold text-foreground">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.desc}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Privacy */}
        <section className="mx-auto max-w-6xl px-6 pt-28">
          <Reveal className="grid grid-cols-1 gap-8 rounded-[2rem] border border-border bg-gradient-to-br from-surface-2 to-surface p-8 sm:p-12 lg:grid-cols-[auto_1fr] lg:items-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-accent to-cyan-500 text-white shadow-[0_0_30px_rgba(34,211,238,0.35)]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </div>
            <div>
              <h2 className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">{t.privacyTitle}</h2>
              <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted">{t.privacyBody}</p>
            </div>
          </Reveal>
        </section>

        {/* Download */}
        <section id="get" className="relative scroll-mt-28 pt-28">
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-24 -z-10 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-gradient-to-b from-accent/15 to-cyan-500/10 blur-[120px] dark:from-accent/25"
          />
          <div className="mx-auto max-w-3xl px-6 text-center">
            <Reveal>
              <h2 className="font-display text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
                {t.getTitle}
                <span className="text-gradient">{t.getTitleHighlight}</span>
              </h2>
              <p className="mt-4 text-base text-muted">{t.getIntro}</p>
            </Reveal>
            <div className="mt-10 text-left">
              <DownloadButtons />
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-6 pt-28 pb-24">
          <h2 className="text-center font-display text-3xl font-extrabold tracking-tight text-foreground">{t.faqTitle}</h2>
          <div className="mt-10 space-y-4">
            {faqs.map((f) => (
              <details
                key={f.q}
                className="glass-card group rounded-2xl border border-border/80 p-6 transition-all duration-200 hover:border-cyan-500/30 open:border-cyan-500/40"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between text-base font-semibold text-foreground">
                  <span>{f.q}</span>
                  <span className="ml-4 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-3 text-cyan-600 transition-transform duration-300 group-open:rotate-45">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                </summary>
                <p className="mt-4 border-t border-border/50 pt-4 text-sm leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
          <p className="mt-8 text-center text-xs text-muted">
            {rich(t.legal, {
              terms: (
                <Link href={href("/terms")} className="underline hover:text-foreground">
                  {t.terms}
                </Link>
              ),
              privacy: (
                <Link href={href("/privacy")} className="underline hover:text-foreground">
                  {t.privacy}
                </Link>
              ),
            })}
          </p>
        </section>
      </main>
      <Footer lang={lang} />
    </div>
  );
}
