import Link from "next/link";

const limitations = [
  {
    title: "Watermark size",
    desc: "A small badge is easier to rebuild convincingly than a large logo covering a big share of the frame.",
  },
  {
    title: "Background complexity",
    desc: "Reconstruction works from the detail already visible around the marked region. A very flat, low-detail background gives it less to work with than a richly textured one.",
  },
  {
    title: "Camera movement",
    desc: "Heavy shake, fast pans, or rapid zooms give the motion-aware tracking less stable footage to reference from frame to frame.",
  },
  {
    title: "Objects crossing the region",
    desc: "If something else passes through the marked area during the clip, that moment has less usable surrounding detail to reconstruct from.",
  },
  {
    title: "Amount of visual information available",
    desc: "If the marked area stays mostly obscured, out of frame, or unchanging for the whole clip, there may not be enough surrounding detail to rebuild it convincingly.",
  },
];

export default function LimitationsSection() {
  return (
    <section id="limitations" className="scroll-mt-28 py-24 relative">
      <div className="mx-auto max-w-4xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border px-3.5 py-1 text-xs font-semibold text-muted">
            Limitations
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            What affects the result
          </h2>
          <p className="mt-4 text-muted text-base leading-relaxed">
            Results depend on how much the reconstruction has to work with. A few factors matter
            most:
          </p>
        </div>

        <div className="mt-12 space-y-3">
          {limitations.map((l) => (
            <div
              key={l.title}
              className="glass-card rounded-2xl p-6 flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:gap-5"
            >
              <h3 className="shrink-0 font-display text-sm font-bold text-foreground tracking-tight sm:w-64">
                {l.title}
              </h3>
              <p className="text-sm text-muted leading-relaxed">{l.desc}</p>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted leading-relaxed">
          Curious whether any of this shows up as reduced video quality? See{" "}
          <Link
            href="/guides/does-watermark-removal-reduce-video-quality"
            className="underline hover:text-foreground"
          >
            does watermark removal reduce video quality
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
