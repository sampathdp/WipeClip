import Link from "next/link";
import VideoCompareSlider from "./VideoCompareSlider";

export type EvidenceExample = {
  id: string;
  label: string;
  beforeSrc: string;
  afterSrc: string;
  resolution: string;
  fps: number;
  processingTimeSeconds: number;
};

/**
 * Renders real before/after processing examples once they exist. Pass
 * `examples` (resolution/fps/processing time included per clip) as they
 * become available — until then this shows a neutral placeholder rather
 * than fabricated numbers, per the no-fake-benchmarks rule this section is
 * bound by.
 */
export default function EvidenceSection({ examples }: { examples?: EvidenceExample[] }) {
  return (
    <section id="evidence" className="scroll-mt-28 py-24 relative">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border px-3.5 py-1 text-xs font-semibold text-muted">
            Evidence
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            Real before/after examples
          </h2>
        </div>

        {examples && examples.length > 0 ? (
          <div className="mt-14 grid gap-8">
            {examples.map((ex) => (
              <div key={ex.id} className="glass-card rounded-[1.75rem] p-6 sm:p-8">
                <VideoCompareSlider beforeSrc={ex.beforeSrc} afterSrc={ex.afterSrc} />
                <div className="mt-5 flex flex-wrap items-center gap-3 text-xs font-mono text-muted">
                  <span className="rounded-full bg-surface-3/80 border border-border px-3 py-1">
                    {ex.label}
                  </span>
                  <span className="rounded-full bg-surface-3/80 border border-border px-3 py-1">
                    {ex.resolution}
                  </span>
                  <span className="rounded-full bg-surface-3/80 border border-border px-3 py-1">
                    {ex.fps} fps
                  </span>
                  <span className="rounded-full bg-surface-3/80 border border-border px-3 py-1">
                    {ex.processingTimeSeconds}s processing
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-14 glass-card mx-auto max-w-2xl rounded-[1.75rem] p-8 sm:p-10 text-center">
            <p className="text-sm sm:text-base text-muted leading-relaxed">
              Real before/after clips — with resolution, framerate, and processing time for each —
              will be published here as they become available.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/#upload"
                className="btn-secondary inline-flex rounded-full px-6 py-3 text-sm font-semibold"
              >
                Try it on your own clip instead
              </Link>
              <Link
                href="/research/video-watermark-removal-test"
                className="text-sm font-semibold text-cyan-600 underline hover:text-cyan-700"
              >
                See the research methodology
              </Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
