import type { Metadata } from "next";
import Link from "next/link";
import WatermarkLandingTemplate from "@/components/WatermarkLandingTemplate";
import { getWatermarkPlatform } from "@/lib/watermarkPlatforms";
import { buildPageMetadata } from "@/lib/seo";

const content = getWatermarkPlatform("remove-capcut-watermark")!;

const title = "Remove the CapCut Watermark, or Avoid It Entirely";
const description =
  "Still have the CapCut project or the original clean clip? Re-exporting is often the better fix. If only the finished export is left, WipeClip can reconstruct the marked region.";

export const metadata: Metadata = buildPageMetadata({
  title,
  description,
  path: `/${content.slug}`,
});

const decisionSteps = [
  {
    title: "Still have the CapCut project?",
    desc: "Re-export it. A CapCut Pro export (or any export path that doesn't add the badge) gives you the actual render again, not an estimate of one.",
  },
  {
    title: "Still have the original clip you imported?",
    desc: "Use that file directly instead of the watermarked export. It's identical to the source, since nothing was ever removed from it.",
  },
  {
    title: "Only the finished, watermarked export left?",
    desc: "This is where reconstruction earns its keep. Mark the badge and WipeClip rebuilds that region from the footage around it.",
  },
];

const body = (
  <div className="space-y-6">
    <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Before reconstructing anything, check for a cleaner source
      </h2>
      <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
        Reconstruction is a fallback for when nothing cleaner is available, not the first move. Work
        through these in order:
      </p>

      <div className="mt-8 space-y-4">
        {decisionSteps.map((step, i) => (
          <div
            key={step.title}
            className="rounded-2xl border border-border/70 bg-surface-2/50 p-5 flex gap-4"
          >
            <span className="shrink-0 font-mono text-xl font-extrabold text-gradient-cyan">
              {i + 1}
            </span>
            <div>
              <h3 className="font-display text-base font-bold text-foreground tracking-tight">
                {step.title}
              </h3>
              <p className="mt-1.5 text-sm text-muted leading-relaxed">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>

    <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Why re-exporting beats reconstruction, when it&apos;s available
      </h2>
      <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
        A clean re-export or the original source file is exactly what was there: nothing is being
        guessed. Reconstruction infers what&apos;s probably behind the mark from the surrounding
        frames, which works well in a lot of cases, but it&apos;s still an estimate, not a copy of
        pixels that were actually captured. If a real clean source exists, it beats reconstruction
        every time. See{" "}
        <Link
          href="/guides/does-watermark-removal-reduce-video-quality"
          className="underline hover:text-foreground text-cyan-600"
        >
          why an estimate isn&apos;t the same as zero quality loss
        </Link>
        , and{" "}
        <Link href="/#comparison" className="underline hover:text-foreground text-cyan-600">
          how it compares to crop, blur, and cover
        </Link>
        .
      </p>
    </div>
  </div>
);

export default function Page() {
  return (
    <WatermarkLandingTemplate
      content={content}
      h1={
        <>
          Remove the CapCut watermark, <span className="text-gradient">or avoid it entirely</span>
        </>
      }
      body={body}
    />
  );
}
