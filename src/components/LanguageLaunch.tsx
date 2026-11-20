import Link from "next/link";
import Reveal from "./Reveal";
import { localeHref, type Lang } from "@/lib/i18n";
import { getDict } from "@/i18n";

// "Hello" in the five voice translation languages, shown as they're written
// whatever the page's language.
const HELLO = [
  { word: "Hello", lang: "en" },
  { word: "Bonjour", lang: "fr" },
  { word: "Hallo", lang: "de" },
  { word: "Hola", lang: "es" },
  { word: "Ciao", lang: "it" },
];

// Bar heights of the speaker's waveform (percent), drawn once.
const WAVE = [38, 62, 84, 55, 92, 70, 44, 78, 96, 60, 35, 72, 88, 52, 66, 41, 80, 58, 90, 47];

/** Homepage launch section for voice translation and captions in European
 * languages (desktop 1.1): a greeting cycling through the five languages, a
 * voice turning into each of them, and what changed in numbers. CSS-animated
 * only (globals.css "Language launch"), so it renders on the server and holds
 * still under prefers-reduced-motion. */
export default function LanguageLaunch({ lang = "en" }: { lang?: Lang }) {
  const t = getDict(lang).languageLaunch;
  return (
    <section id="languages" aria-labelledby="languages-title" className="relative scroll-mt-28 overflow-hidden py-24 sm:py-32">
      <div
        aria-hidden
        className="animate-blob pointer-events-none absolute -left-32 top-10 -z-10 h-[520px] w-[520px] rounded-full bg-fuchsia-500/10 blur-[140px] dark:bg-fuchsia-500/25"
      />
      <div
        aria-hidden
        className="animate-blob pointer-events-none absolute -right-24 bottom-0 -z-10 h-[480px] w-[480px] rounded-full bg-cyan-500/10 blur-[130px] [animation-delay:-5s] dark:bg-cyan-500/25"
      />

      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto max-w-4xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-surface-2/90 py-1 pl-1.5 pr-4 text-xs font-semibold text-foreground shadow-[0_0_40px_rgba(124,92,255,0.3)]">
            <span className="relative flex h-5 items-center rounded-full bg-gradient-to-r from-accent to-fuchsia-500 px-2 text-[10px] font-black uppercase tracking-wider text-white">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent/50 motion-reduce:hidden" />
              <span className="relative">{t.badge}</span>
            </span>
            {t.kicker}
          </div>

          {/* The greeting: five words stacked in one place, each shown in turn. */}
          <p aria-hidden className="ll-hello relative mx-auto h-[1.1em] font-display text-7xl font-black leading-none tracking-tighter sm:text-9xl">
            {HELLO.map((h, i) => (
              <span key={h.lang} lang={h.lang} className="ll-word text-gradient absolute inset-0" style={{ animationDelay: `${i * 2}s` }}>
                {h.word}
              </span>
            ))}
          </p>

          <h2 id="languages-title" className="mt-8 font-display text-4xl font-extrabold tracking-tight text-foreground sm:text-6xl">
            {t.title}
            <span className="text-gradient">{t.titleHighlight}</span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">{t.intro}</p>
        </Reveal>

        {/* One voice in, five languages out. */}
        <Reveal className="mt-16" delay={100}>
          <div className="border-glow relative mx-auto grid max-w-5xl items-center gap-8 overflow-hidden rounded-[2.5rem] p-6 sm:p-10 md:grid-cols-[1fr_auto_1fr]">
            <div className="glass-card rounded-3xl p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-accent to-fuchsia-500 text-lg text-white shadow-lg">
                  🎙
                </span>
                <div>
                  <p className="text-sm font-bold text-foreground">{t.yourVoice}</p>
                  <p className="text-xs text-muted">{t.yourVoiceDetail}</p>
                </div>
              </div>
              <div aria-hidden className="mt-6 flex h-20 items-center gap-[3px]">
                {WAVE.map((h, i) => (
                  <span
                    key={i}
                    className="ll-bar flex-1 rounded-full bg-gradient-to-t from-accent to-cyan-400"
                    style={{ height: `${h}%`, animationDelay: `${(i % 7) * -0.17}s` }}
                  />
                ))}
              </div>
            </div>

            <div aria-hidden className="relative mx-auto flex h-16 w-16 items-center justify-center md:h-40 md:w-24">
              <span className="ll-beam absolute inset-x-0 top-1/2 hidden h-[3px] -translate-y-1/2 rounded-full bg-gradient-to-r from-accent via-fuchsia-500 to-cyan-400 md:block" />
              <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-2xl text-background shadow-[0_0_50px_rgba(124,92,255,0.6)]">
                ⇄
              </span>
            </div>

            <ul className="grid gap-2.5">
              {t.languages.map((name, i) => (
                <li
                  key={name}
                  className="ll-chip glass-card flex items-center justify-between rounded-2xl px-5 py-3 text-sm font-bold text-foreground"
                  style={{ animationDelay: `${i * 2}s` }}
                >
                  <span>{name}</span>
                  <span lang={HELLO[i].lang} className="text-xs font-semibold text-muted">
                    “{HELLO[i].word}”
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <ul className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {t.stats.map((s, i) => (
            <Reveal key={s.label} as="li" delay={Math.min(i, 3) * 100} className="glass-card relative overflow-hidden rounded-[2rem] p-7">
              <p className="text-gradient font-display text-5xl font-black tracking-tight">{s.value}</p>
              <p className="mt-3 text-sm font-semibold leading-snug text-foreground">{s.label}</p>
            </Reveal>
          ))}
        </ul>

        <Reveal className="mx-auto mt-12 max-w-3xl text-center" delay={100}>
          <p className="text-sm leading-relaxed text-muted">{t.fastVoice}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href={localeHref(lang, "/download")}
              className="btn-primary inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-bold shadow-[0_0_35px_rgba(124,92,255,0.45)] transition-transform hover:scale-[1.03]"
            >
              {t.download}
            </Link>
            <Link href="/whats-new" className="btn-secondary inline-flex rounded-full px-6 py-3.5 text-sm font-semibold">
              {t.changelog} →
            </Link>
          </div>
          <p className="mt-6 text-xs text-muted">{t.footnote}</p>
        </Reveal>
      </div>
    </section>
  );
}
