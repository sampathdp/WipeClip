import Reveal from "./Reveal";

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
    desc: "Download your restored video instantly at crisp original resolution with pristine audio.",
    tag: "Lossless Export",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "How to clean up a video with WipeClip.co",
  step: steps.map((s) => ({
    "@type": "HowToStep",
    name: s.title,
    text: s.desc,
  })),
};

const ICONS = [
  <path key="u" d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14" />,
  <path key="m" d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M9 9h6v6H9z" />,
  <path key="d" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
];

export default function HowItWorks({ includeSchema = false }: { includeSchema?: boolean }) {
  return (
    <section id="how-it-works" className="scroll-mt-28 py-24 relative">
      {includeSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
          }}
        />
      )}
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border px-3.5 py-1 text-xs font-semibold text-muted">
            Simple 3-Step Workflow
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            Zero editing skills required
          </h2>
          <p className="mt-4 text-muted text-base leading-relaxed">
            Upload, mark the overlay once, download. WipeClip.co handles the frame-by-frame reconstruction.
          </p>
        </Reveal>

        <ol className="relative mt-16 grid gap-10 md:grid-cols-3 md:gap-6">
          {/* connector line behind the step badges (desktop) */}
          <div aria-hidden className="absolute left-[16.6%] right-[16.6%] top-8 hidden h-px bg-gradient-to-r from-accent/60 via-cyan-400/60 to-accent-2/60 md:block" />
          {steps.map((step, i) => (
            <Reveal as="li" key={step.n} delay={i * 120} className="relative text-center">
              <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-400/40 bg-surface shadow-[0_0_30px_rgba(34,211,238,0.2)]">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-500" aria-hidden>
                  {ICONS[i]}
                </svg>
                <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent font-mono text-[10px] font-bold text-white">
                  {step.n}
                </span>
              </div>
              <h3 className="mt-6 font-display text-xl font-bold tracking-tight text-foreground">{step.title}</h3>
              <p className="mx-auto mt-2.5 max-w-xs text-sm leading-relaxed text-muted">{step.desc}</p>
              <span className="mt-4 inline-block rounded-full border border-border bg-surface-3/80 px-3 py-1 font-mono text-[11px] text-muted">
                {step.tag}
              </span>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
