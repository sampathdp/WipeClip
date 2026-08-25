import Link from "next/link";

export default function ResearchHero({
  eyebrow,
  h1,
  intro,
}: {
  eyebrow: string;
  h1: React.ReactNode;
  intro: string;
}) {
  return (
    <section className="relative overflow-hidden pt-36 pb-16 md:pt-48">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 left-1/3 h-[650px] w-[950px] rounded-full bg-gradient-to-b from-accent/6 via-cyan-500/4 to-transparent blur-[140px] -z-10 dark:from-accent/25 dark:via-cyan-500/15"
      />
      <div className="mx-auto max-w-3xl px-6 text-center">
        <div className="mb-6 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-cyan-500/30 px-3.5 py-1 text-xs font-semibold text-cyan-600">
          {eyebrow}
        </div>
        <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl text-foreground text-balance">
          {h1}
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
          {intro}
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/#upload"
            className="btn-primary rounded-full px-8 py-4 text-sm sm:text-base font-bold inline-flex items-center justify-center gap-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_0_35px_rgba(124,92,255,0.45)] transition-all hover:scale-[1.02]"
          >
            <span>Try WipeClip free</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
