import Link from "next/link";
import Reveal from "./Reveal";
import { localeHref, type Lang } from "@/lib/i18n";
import { LATEST_RELEASE, spotlightNotes, type SpotlightNote } from "@/lib/releases";
import { getDict } from "@/i18n";

const MARK: Record<SpotlightNote["kind"], string> = { new: "✦", fixed: "✓", other: "•" };

/** Homepage spotlight on the newest desktop release, linking to the full
 * changelog at /whats-new. The cards come from desktop/release-notes.json,
 * so each release updates this section by itself. Everything is
 * CSS-animated, so it renders fully on the server and stays still under
 * prefers-reduced-motion. */
export default function WhatsNew({ lang = "en" }: { lang?: Lang }) {
  const t = getDict(lang).whatsNew;
  const strip = [...t.strip, `v${LATEST_RELEASE.version}`];
  const notes = spotlightNotes();
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

        <ul lang="en" className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((n, i) => (
            <Reveal
              key={`${n.version}-${i}`}
              as="li"
              delay={Math.min(i, 3) * 100}
              className={`${i === 0 ? "border-glow sm:col-span-2 p-7 sm:p-9" : "glass-card p-7"} relative overflow-hidden rounded-[2rem]`}
            >
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider">
                <span aria-hidden className={n.kind === "fixed" ? "text-cyan-600" : "text-accent"}>
                  {MARK[n.kind]}
                </span>
                {n.version !== LATEST_RELEASE.version && <span className="text-muted">v{n.version}</span>}
              </div>
              {n.headline && (
                <h3
                  className={`mt-3 font-display font-extrabold tracking-tight text-foreground ${i === 0 ? "text-3xl sm:text-4xl" : "text-xl"}`}
                >
                  {n.headline}
                </h3>
              )}
              <p className={`mt-2 leading-relaxed ${n.headline ? "text-muted" : "text-foreground"} ${i === 0 ? "text-base sm:text-lg" : "text-sm"}`}>
                {n.text}
              </p>
            </Reveal>
          ))}
        </ul>
        {t.notesInEnglish && <p className="mt-4 text-center text-xs text-muted">{t.notesInEnglish}</p>}

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
