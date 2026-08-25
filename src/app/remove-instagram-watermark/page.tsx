import type { Metadata } from "next";
import Link from "next/link";
import WatermarkLandingTemplate from "@/components/WatermarkLandingTemplate";
import { getWatermarkPlatform } from "@/lib/watermarkPlatforms";
import { buildPageMetadata } from "@/lib/seo";

const content = getWatermarkPlatform("remove-instagram-watermark")!;

const title = "Remove Your Watermark From an Instagram Video";
const description =
  "Downloaded your own Reel or Story and want the Instagram badge and @handle gone? WipeClip reconstructs the marked region while keeping the original frame size and quality.";

export const metadata: Metadata = buildPageMetadata({
  title,
  description,
  path: `/${content.slug}`,
});

const body = (
  <div className="space-y-6">
    <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Your @handle and the Instagram badge are burned into the download
      </h2>
      <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
        When a Reel or Story is saved from Instagram, the app&apos;s own download pipeline burns the
        Instagram logo and the poster&apos;s @handle directly into the video file. It&apos;s not an
        overlay you can switch off, it&apos;s part of every frame of the file you&apos;re left with.
      </p>
    </div>

    <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-cyan-500/30">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Only for content you own or have permission to edit
      </h2>
      <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
        This tool is built for your own Reels and Stories, or footage a client or collaborator has
        explicitly authorized you to repurpose, not for stripping another creator&apos;s attribution
        off content that isn&apos;t yours. If you&apos;re working with something you didn&apos;t post
        yourself, confirm you have permission first. See our{" "}
        <Link href="/terms" className="underline hover:text-foreground text-cyan-600">
          Terms of Service
        </Link>
        .
      </p>
    </div>

    <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Get the original clean source first, if you can
      </h2>
      <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
        If you still have the video file from before it went through Instagram&apos;s save/download
        pipeline, use that instead. It&apos;s identical to the source, not a reconstruction (see{" "}
        <Link
          href="/guides/does-watermark-removal-reduce-video-quality"
          className="underline hover:text-foreground text-cyan-600"
        >
          why that distinction matters
        </Link>
        ). WipeClip is for when only the downloaded, badge-marked copy remains.
      </p>
    </div>

    <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Frame dimensions stay exactly as they were
      </h2>
      <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
        Only the marked region is rebuilt. WipeClip doesn&apos;t crop or resize the video to hide the
        badge, so the original aspect ratio and resolution carry through unchanged.{" "}
        <Link href="/#comparison" className="underline hover:text-foreground text-cyan-600">
          Compare that to what cropping does
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
          Remove your watermark from an{" "}
          <span className="text-gradient">Instagram video</span>
        </>
      }
      body={body}
    />
  );
}
