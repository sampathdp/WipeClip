export default function GuideHeader({
  eyebrow,
  h1,
  intro,
}: {
  eyebrow: string;
  h1: React.ReactNode;
  intro: string;
}) {
  return (
    <section className="relative overflow-hidden pt-8 pb-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 left-1/3 h-[650px] w-[950px] rounded-full bg-gradient-to-b from-accent/6 via-cyan-500/4 to-transparent blur-[140px] -z-10 dark:from-accent/25 dark:via-cyan-500/15"
      />
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-6 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-cyan-500/30 px-3.5 py-1 text-xs font-semibold text-cyan-600">
          {eyebrow}
        </div>
        <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl text-foreground text-balance">
          {h1}
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">{intro}</p>
      </div>
    </section>
  );
}
