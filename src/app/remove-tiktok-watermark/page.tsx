import type { Metadata } from "next";
import Link from "next/link";
import WatermarkLandingTemplate from "@/components/WatermarkLandingTemplate";
import EvidenceSection from "@/components/EvidenceSection";
import { getWatermarkPlatform } from "@/lib/watermarkPlatforms";
import { buildPageMetadata } from "@/lib/seo";

const content = getWatermarkPlatform("remove-tiktok-watermark")!;

const title = "Remove a Moving TikTok Watermark From Your Own Video";
const description =
  "TikTok's logo and @username drift to a new spot as the clip plays, so a static blur or crop misses it by the next frame. On a clip you own, WipeClip tracks the mark and reconstructs what's underneath, frame by frame.";

export const metadata: Metadata = buildPageMetadata({
  title,
  description,
  path: `/${content.slug}`,
});

const body = (
  <div className="space-y-6">
    <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        The mark moves: that&apos;s what makes it different
      </h2>
      <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
        TikTok&apos;s export burns in a spinning &ldquo;tiktok&rdquo; mark and the uploader&apos;s
        @username, and both drift to a different spot as the clip plays rather than sitting still in
        one corner. Anything built around a watermark that stays put struggles here.
      </p>
    </div>

    <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Why a static crop or blur box falls short
      </h2>
      <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
        <strong className="text-foreground">Cropping</strong> only works if the mark stays inside
        one fixed region for the whole clip. Since the badge drifts, a crop tight enough to remove it
        early on misses it later, or has to cut a much bigger, permanent chunk out of every frame to
        stay ahead of it, changing the video&apos;s dimensions in the process.
      </p>
      <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
        <strong className="text-foreground">A static blur box</strong> has the same problem: sized
        and positioned for frame one, it&apos;s misaligned by frame thirty. The badge ends up
        partially visible at the edge of the blur, or the box has to be enlarged well past the mark
        itself to stay safe, hiding more of the actual video than necessary.
      </p>
      <p className="mt-4 text-sm">
        <Link href="/#comparison" className="underline hover:text-foreground text-cyan-600">
          See how crop, blur, cover, and reconstruction compare
        </Link>
      </p>
    </div>

    <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Masking and tracking, frame by frame
      </h2>
      <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
        You still only mark the badge once, on a single preview frame. From there, WipeClip tracks
        that region&apos;s motion across the clip and reconstructs it frame by frame, instead of
        applying one fixed mask to the whole video.{" "}
        <Link href="/#static-vs-moving" className="underline hover:text-foreground text-cyan-600">
          More on static vs. moving overlays
        </Link>
        .
      </p>
    </div>

    <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Fast-motion clips are the hardest case
      </h2>
      <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
        Quick pans, shaky handheld shots, and rapid-cut trend edits give the tracker less stable
        footage to reference between frames. Results depend on how much clean detail is actually
        visible around the mark at each moment. See{" "}
        <Link href="/#limitations" className="underline hover:text-foreground text-cyan-600">
          limitations
        </Link>{" "}
        for the full picture.
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
          Clean up a <span className="text-gradient">moving</span> TikTok watermark
        </>
      }
      body={body}
      extra={<EvidenceSection />}
    />
  );
}
