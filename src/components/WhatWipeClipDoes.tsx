import Link from "next/link";

const points = [
  {
    title: "Mark the unwanted overlay",
    desc: "Draw a box around the badge, logo, or timestamp on one preview frame. You don't trace it frame by frame yourself.",
  },
  {
    title: "WipeClip reconstructs that region",
    desc: "It rebuilds the marked area using the pixels and motion visible around it in nearby frames, instead of covering it with a solid patch.",
  },
  {
    title: "The rest of the frame stays untouched",
    desc: "Only the marked region is rebuilt. There's no need to crop, resize, or blur the whole video to hide one overlay.",
  },
];

export default function WhatWipeClipDoes() {
  return (
    <section id="what-it-does" className="scroll-mt-28 py-24 relative">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border px-3.5 py-1 text-xs font-semibold text-muted">
            What WipeClip Does
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            Reconstruction, not a cover-up
          </h2>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          {points.map((p, i) => (
            <div key={p.title} className="glass-card rounded-[1.75rem] p-7">
              <span className="font-mono text-2xl font-extrabold text-gradient-cyan">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-4 font-display text-lg font-bold text-foreground tracking-tight">
                {p.title}
              </h3>
              <p className="mt-2.5 text-sm text-muted leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted leading-relaxed">
          Reconstruction is an estimate built from the footage around the marked region — not a
          guaranteed pixel-perfect recovery of whatever was originally behind the overlay. See{" "}
          <a href="#limitations" className="underline hover:text-foreground">
            limitations
          </a>{" "}
          below for when results are stronger or weaker, or read{" "}
          <Link href="/guides/how-ai-video-inpainting-works" className="underline hover:text-foreground">
            how the reconstruction actually works
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
