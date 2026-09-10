const cards = [
  {
    title: "Static overlay",
    tag: "Fixed position",
    desc: "Stays in the same spot for the whole clip: a corner logo, a fixed timestamp, a persistent bug. WipeClip only has to track one consistent region across every frame.",
  },
  {
    title: "Moving overlay",
    tag: "Motion-tracked",
    desc: "Drifts, resizes, or reappears in different spots: a rotating badge, an animated bug, an overlay that repositions itself. WipeClip's motion-aware tracking follows the marked region frame by frame instead of using one fixed box.",
  },
];

export default function StaticVsMovingWatermarks() {
  return (
    <section id="static-vs-moving" className="scroll-mt-28 py-24 relative">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border px-3.5 py-1 text-xs font-semibold text-muted">
            Static vs Moving Overlays
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            Not every overlay behaves the same way
          </h2>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2">
          {cards.map((c) => (
            <div key={c.title} className="glass-card-interactive rounded-[1.75rem] p-8">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-3/80 border border-border px-3 py-1 text-[11px] font-mono text-muted">
                {c.tag}
              </span>
              <h3 className="mt-4 font-display text-xl font-bold text-foreground tracking-tight">
                {c.title}
              </h3>
              <p className="mt-2.5 text-sm text-muted leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted leading-relaxed">
          Moving overlays are generally harder to remove convincingly than static ones, especially
          when they cross busy or fast-changing parts of the frame.
        </p>
      </div>
    </section>
  );
}
