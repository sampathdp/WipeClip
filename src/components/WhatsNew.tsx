import Link from "next/link";
import Reveal from "./Reveal";
import { localeHref, type Lang } from "@/lib/i18n";
import { LATEST_RELEASE } from "@/lib/releases";
import { getDict } from "@/i18n";

// The same sentence in each language the voice translation speaks, cycled
// in the demo card. Native script on purpose: it isn't translated.
const VOICE_LINES = [
  { code: "si", lang: "සිංහල", line: "ආයුබෝවන්! අද අපි වීඩියෝවක් හදමු." },
  { code: "ta", lang: "தமிழ்", line: "வணக்கம்! இன்று ஒரு வீடியோ உருவாக்குவோம்." },
  { code: "hi", lang: "हिन्दी", line: "नमस्ते! आज हम एक वीडियो बनाते हैं।" },
  { code: "kn", lang: "ಕನ್ನಡ", line: "ನಮಸ್ಕಾರ! ಇಂದು ಒಂದು ವೀಡಿಯೊ ಮಾಡೋಣ." },
  { code: "te", lang: "తెలుగు", line: "నమస్కారం! ఈ రోజు ఒక వీడియో చేద్దాం." },
];

const CAPTION_LANGS = ["English", "සිංහල", "தமிழ்", "हिन्दी", "ಕನ್ನಡ", "తెలుగు"];

// Bar heights for the two waveforms, in percent.
const WAVE = [35, 60, 85, 50, 95, 40, 70, 55, 90, 30, 65, 80, 45, 75, 38, 88, 52, 68, 42, 78, 58, 92, 36, 62];

function Waveform({ tone, offset = 0 }: { tone: string; offset?: number }) {
  return (
    <div aria-hidden className="flex h-12 items-center justify-between">
      {WAVE.map((h, i) => (
        <span
          key={i}
          className={`wn-wave w-1 rounded-full sm:w-1.5 ${tone}`}
          style={{ height: `${h}%`, animationDelay: `${((i * 97 + offset) % 1200) - 1200}ms` }}
        />
      ))}
    </div>
  );
}

/** Homepage spotlight on the newest desktop features, linking to the full
 * changelog at /whats-new. Everything is CSS-animated, so it renders fully
 * on the server and stays still under prefers-reduced-motion. */
export default function WhatsNew({ lang = "en" }: { lang?: Lang }) {
  const t = getDict(lang).whatsNew;
  const strip = [...t.strip, `v${LATEST_RELEASE.version}`];
  return (
    <section id="new" aria-labelledby="new-title" className="relative scroll-mt-28 overflow-hidden py-24">
      <div
        aria-hidden
        className="animate-blob pointer-events-none absolute -top-24 left-[10%] -z-10 h-[420px] w-[420px] rounded-full bg-accent/10 blur-[120px] dark:bg-accent/30"
      />
      <div
        aria-hidden
        className="animate-blob pointer-events-none absolute bottom-0 right-[5%] -z-10 h-[460px] w-[460px] rounded-full bg-cyan-500/10 blur-[130px] [animation-delay:-7s] dark:bg-cyan-500/25"
      />

      {/* Tilted ticker */}
      <div className="-mx-4 -rotate-2 overflow-hidden bg-gradient-to-r from-accent via-fuchsia-500 to-cyan-500 py-2.5 shadow-[0_10px_40px_rgba(124,92,255,0.35)]">
        <div className="animate-marquee flex w-max items-center gap-6 font-display text-sm font-black uppercase tracking-[0.2em] text-white">
          {[...strip, ...strip, ...strip, ...strip].map((item, i) => (
            <span key={i} className="flex items-center gap-6">
              {item}
              <span aria-hidden>✦</span>
            </span>
          ))}
        </div>
      </div>

      <div className="relative mx-auto mt-16 max-w-7xl px-6">
        <span
          aria-hidden
          className="wn-outline pointer-events-none absolute -top-10 left-1/2 -z-10 -translate-x-1/2 select-none font-display text-[9rem] font-black leading-none tracking-tighter sm:text-[14rem]"
        >
          NEW
        </span>

        <Reveal className="mx-auto max-w-3xl text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-surface-2/90 py-1 pl-1.5 pr-4 text-xs font-semibold text-foreground shadow-[0_0_30px_rgba(244,63,94,0.25)]">
            <span className="relative flex h-5 items-center rounded-full bg-rose-500 px-2 text-[10px] font-black uppercase tracking-wider text-white">
              <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/60 motion-reduce:hidden" />
              <span className="relative">{t.badge}</span>
            </span>
            v{LATEST_RELEASE.version} · <time dateTime={LATEST_RELEASE.date}>{LATEST_RELEASE.date}</time>
          </div>
          <h2 id="new-title" className="font-display text-4xl font-extrabold tracking-tight text-foreground sm:text-6xl">
            {t.title}
            <span className="text-gradient">{t.titleHighlight}</span>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">{t.intro}</p>
        </Reveal>

        <div className="mt-14 grid gap-5 lg:grid-cols-3 lg:grid-rows-2">
          {/* Voice translation, the headline feature */}
          <Reveal className="border-glow relative overflow-hidden rounded-[2rem] p-7 sm:p-9 lg:col-span-2 lg:row-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-gradient-to-r from-accent to-fuchsia-500 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                {t.voice.eyebrow}
              </span>
            </div>
            <h3 className="mt-5 font-display text-3xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-5xl">
              {t.voice.title[0]}
              <span className="block text-gradient">{t.voice.title[1]}</span>
            </h3>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-muted">{t.voice.desc}</p>

            <div className="mt-8 rounded-[1.5rem] border border-border bg-surface-2/70 p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
                <span>{t.voice.from}</span>
                <span className="relative inline-grid h-6 min-w-24 overflow-hidden rounded-full bg-cyan-500/15 px-3 text-cyan-700 dark:text-cyan-300">
                  {VOICE_LINES.map((v) => (
                    <span key={v.lang} lang={v.code} className="wn-cycle col-start-1 row-start-1 flex items-center justify-center normal-case tracking-normal">
                      {v.lang}
                    </span>
                  ))}
                </span>
              </div>
              <div className="mt-3">
                <Waveform tone="bg-cyan-500/70" />
              </div>
              <div className="relative mt-3 grid min-h-[3.5rem] text-lg font-semibold text-foreground sm:text-xl">
                {VOICE_LINES.map((v) => (
                  <p key={v.lang} lang={v.code} className="wn-cycle col-start-1 row-start-1">
                    {v.line}
                  </p>
                ))}
              </div>

              <div aria-hidden className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-gradient-to-r from-transparent via-accent/60 to-accent" />
                <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-accent to-cyan-500 text-white shadow-[0_0_25px_rgba(124,92,255,0.6)]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                </span>
                <span className="h-px flex-1 bg-gradient-to-l from-transparent via-accent/60 to-accent" />
              </div>

              <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
                <span>{t.voice.to}</span>
                <span className="rounded-full bg-accent/15 px-3 py-1 text-accent">EN</span>
              </div>
              <div className="mt-3">
                <Waveform tone="bg-accent/80" offset={400} />
              </div>
              <p className="mt-3 text-lg font-semibold text-foreground sm:text-xl">Hello! Let&apos;s make a video today.</p>
            </div>
          </Reveal>

          {/* Captions in more languages */}
          <Reveal delay={100} className="glass-card relative overflow-hidden rounded-[2rem] p-7">
            <div className="text-[11px] font-bold uppercase tracking-wider text-cyan-600">{t.captions.eyebrow}</div>
            <h3 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-foreground">{t.captions.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{t.captions.desc}</p>
            <ul className="mt-5 flex flex-wrap gap-2" aria-label={t.captions.title}>
              {CAPTION_LANGS.map((l, i) => (
                <li
                  key={l}
                  className="animate-float-slow rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-sm font-semibold text-foreground shadow-sm"
                  style={{ animationDelay: `${i * -1.1}s` }}
                >
                  {l}
                </li>
              ))}
            </ul>
          </Reveal>

          {/* Faster, on-device captions */}
          <Reveal delay={200} className="glass-card relative overflow-hidden rounded-[2rem] p-7">
            <div className="text-[11px] font-bold uppercase tracking-wider text-fuchsia-600 dark:text-fuchsia-400">{t.speed.eyebrow}</div>
            <h3 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-foreground">{t.speed.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{t.speed.desc}</p>
            <div aria-hidden className="mt-5 h-2.5 overflow-hidden rounded-full bg-surface-2 ring-1 ring-border">
              <div className="wn-fill h-full rounded-full bg-gradient-to-r from-fuchsia-500 via-accent to-cyan-400" />
            </div>
          </Reveal>
        </div>

        {/* Simpler editor */}
        <Reveal delay={150} className="glass-card mt-5 grid items-center gap-6 rounded-[2rem] p-7 sm:grid-cols-[1fr_1.2fr] sm:p-9">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-accent">{t.editor.eyebrow}</div>
            <h3 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">{t.editor.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">{t.editor.desc}</p>
          </div>
          <div aria-hidden className="flex gap-3 rounded-[1.25rem] border border-border bg-surface-2/70 p-3">
            <div className="w-[42%] rounded-xl border border-border bg-surface p-2.5">
              <div className="flex gap-1">
                {t.editor.tabs.map((tab, i) => (
                  <span
                    key={tab}
                    className="wn-tab flex-1 truncate rounded-md px-1.5 py-1 text-center text-[9px] font-semibold sm:text-[10px]"
                    style={{ animationDelay: `${i ? i * 2 - 6 : 0}s` }}
                  >
                    {tab}
                  </span>
                ))}
              </div>
              <div className="mt-3 space-y-2">
                {[80, 55, 70].map((w) => (
                  <div key={w} className="h-1.5 rounded-full bg-border" style={{ width: `${w}%` }} />
                ))}
              </div>
            </div>
            <div className="flex-1 rounded-xl bg-gradient-to-br from-slate-800 via-slate-900 to-black ring-1 ring-border" />
          </div>
        </Reveal>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
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
      </div>
    </section>
  );
}
