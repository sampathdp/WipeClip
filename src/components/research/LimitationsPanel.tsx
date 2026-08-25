const limitations = [
  {
    title: "No verified tests published yet",
    desc: "This is the current, biggest limitation. Every section above shows a placeholder until real before/after data replaces it.",
  },
  {
    title: "Single test environment",
    desc: "Once published, each test will reflect one hardware/software configuration and one operator, not a statistically representative sample across devices.",
  },
  {
    title: "Not independently audited",
    desc: "Tests are conducted and published by WipeClip.co, not verified by an outside party.",
  },
  {
    title: "Small sample size",
    desc: "A handful of clips per category isn't comprehensive coverage of every watermark type, platform, or resolution combination.",
  },
];

export default function LimitationsPanel() {
  return (
    <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Limitations of this research
      </h2>
      <div className="mt-6 space-y-4">
        {limitations.map((l) => (
          <div key={l.title} className="rounded-2xl border border-border/70 bg-surface-2/50 p-5">
            <h3 className="font-display text-sm font-bold text-foreground tracking-tight">
              {l.title}
            </h3>
            <p className="mt-1.5 text-sm text-muted leading-relaxed">{l.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
