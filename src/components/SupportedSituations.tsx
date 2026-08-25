const situations = [
  { title: "Static corner overlay", desc: "A badge or bug that sits in the same corner for the whole clip." },
  { title: "Logo", desc: "A brand mark burned into the footage, in one spot or repeated across the frame." },
  { title: "Text overlay", desc: "A caption, username, or wordmark baked directly into the video." },
  { title: "Moving mark", desc: "An overlay that drifts, resizes, or changes position as the clip plays." },
  {
    title: "Timestamp on owned footage",
    desc: "A date/time burn-in on footage you own or have rights to edit, security or dashcam video, for example.",
  },
];

export default function SupportedSituations() {
  return (
    <section id="situations" className="scroll-mt-28 py-24 relative">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border px-3.5 py-1 text-xs font-semibold text-muted">
            Supported Situations
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            What you can mark and remove
          </h2>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {situations.map((s) => (
            <div key={s.title} className="glass-card rounded-2xl p-6">
              <h3 className="font-display text-base font-bold text-foreground tracking-tight">
                {s.title}
              </h3>
              <p className="mt-2 text-sm text-muted leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
