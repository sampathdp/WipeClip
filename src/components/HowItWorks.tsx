const steps = [
  {
    n: "01",
    title: "Upload your video",
    desc: "Drop in any video clip you own or have permission to edit. Supports MP4, MOV, and WebM up to 300MB.",
    tag: "Drag & Drop",
  },
  {
    n: "02",
    title: "Mark the overlay area",
    desc: "Select the badge or logo region once on the preview frame. Our AI tracks and reconstructs all frames.",
    tag: "1-Click Select",
  },
  {
    n: "03",
    title: "Export clean footage",
    desc: "Download your unwatermarked video instantly at crisp original resolution with pristine audio.",
    tag: "Lossless Export",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-28 py-24 relative">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border px-3.5 py-1 text-xs font-semibold text-muted">
            Simple 3-Step Workflow
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            Zero editing skills required
          </h2>
          <p className="mt-4 text-muted text-base leading-relaxed">
            WipeClip.co handles temporal frame alignment and neural reconstruction automatically. Simply upload, mark, and download.
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.n}
              className="glass-card-interactive rounded-[2rem] p-8 flex flex-col justify-between relative group overflow-hidden"
            >
              {/* Subtle top glow bar */}
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-accent via-cyan-400 to-accent-2 opacity-0 group-hover:opacity-100 transition-opacity" />

              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-3xl font-extrabold text-gradient-cyan">
                    {step.n}
                  </span>
                  <span className="rounded-full bg-surface-3/80 border border-border px-3 py-1 text-[11px] font-mono text-muted">
                    {step.tag}
                  </span>
                </div>

                <h3 className="mt-6 text-xl font-bold font-display text-foreground tracking-tight">{step.title}</h3>
                <p className="mt-3 text-sm text-muted leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
