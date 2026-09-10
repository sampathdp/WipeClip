import type { Metadata } from "next";
import Link from "next/link";
import WatermarkLandingTemplate from "@/components/WatermarkLandingTemplate";
import { getWatermarkPlatform } from "@/lib/watermarkPlatforms";
import { buildPageMetadata } from "@/lib/seo";

const content = getWatermarkPlatform("remove-canva-watermark")!;

const title = "Remove a Canva Watermark From Your Own Video Export";
const description =
  "Canva's free-tier badge sits in a fixed spot on the exported file. If a clean re-export is available, use that first. Otherwise WipeClip can reconstruct the marked region.";

export const metadata: Metadata = buildPageMetadata({
  title,
  description,
  path: `/${content.slug}`,
});

const body = (
  <div className="space-y-6">
    <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        A fixed badge, baked into the export
      </h2>
      <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
        Canva&apos;s free-tier video export appends a small logo badge to one corner of the finished
        render. It&apos;s not a layer you can toggle off inside the Canva editor afterward. It&apos;s
        part of the exported file itself, in the same static spot for the whole clip.
      </p>
    </div>

    <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Check for a clean re-export first
      </h2>
      <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
        If you (or whoever exported it) can re-render from a Canva Pro seat, that&apos;s the cleanest
        fix, since the badge simply isn&apos;t added, so there&apos;s nothing to reconstruct. Reconstruction
        is the right tool specifically when only the badge-marked export is available: a client
        delivered it that way, or a Pro seat isn&apos;t an option for a single clip.
      </p>
    </div>

    <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        When reconstruction is (and isn&apos;t) necessary
      </h2>
      <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
        Because the Canva badge is small, static, and sits in a predictable corner, it&apos;s one of
        the more straightforward cases: a consistent region with steady background around it to
        rebuild from. See{" "}
        <Link
          href="/guides/how-ai-video-inpainting-works"
          className="underline hover:text-foreground text-cyan-600"
        >
          how that reconstruction actually works
        </Link>
        . Results still depend on what&apos;s actually behind the badge: a busy, fast-changing part
        of a Canva animation gives less to work with than a plain background does. See{" "}
        <Link href="/#limitations" className="underline hover:text-foreground text-cyan-600">
          limitations
        </Link>{" "}
        for what affects the outcome.
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
          Clean up a Canva watermark on your{" "}
          <span className="text-gradient">own export</span>
        </>
      }
      body={body}
    />
  );
}
