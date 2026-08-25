const steps = [
  {
    title: "Same source, same pipeline",
    desc: "Every test starts from an unedited source clip and runs through the same WipeClip pipeline end to end, with no manual touch-up after processing.",
  },
  {
    title: "Fixed measurement points",
    desc: "Processing time is wall-clock, from upload start to result download. Resolution and framerate are read from the actual input and output files, not estimated.",
  },
  {
    title: "Published, not summarized",
    desc: "Each test publishes its real before/after clip alongside the numbers, so a result can be checked directly instead of taken on faith.",
  },
];

export default function TestMethodology() {
  return (
    <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Test methodology
      </h2>
      <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
        This is the process every test on this page follows once it&apos;s run and published. No
        tests have been completed and verified yet. See{" "}
        <a href="#limitations" className="underline hover:text-foreground">
          limitations
        </a>{" "}
        below.
      </p>

      <div className="mt-8 grid gap-5 sm:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.title} className="rounded-2xl border border-border/70 bg-surface-2/50 p-5">
            <span className="font-mono text-lg font-extrabold text-gradient-cyan">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-2 font-display text-sm font-bold text-foreground tracking-tight">
              {s.title}
            </h3>
            <p className="mt-1.5 text-sm text-muted leading-relaxed">{s.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
