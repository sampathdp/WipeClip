import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CtaBanner from "@/components/CtaBanner";
import Breadcrumbs from "@/components/Breadcrumbs";
import GuideHeader from "@/components/guides/GuideHeader";
import DirectAnswer from "@/components/guides/DirectAnswer";
import ArticleByline from "@/components/guides/ArticleByline";
import RelatedGuides from "@/components/guides/RelatedGuides";
import FullMethodComparisonTable from "@/components/guides/FullMethodComparisonTable";
import { buildPageMetadata, SITE_URL } from "@/lib/seo";

const title = "AI Inpainting vs Blur vs Crop for Video Watermark Removal";
const description =
  "A criteria-by-criteria comparison of cropping, blurring, covering, and AI reconstruction for removing a video watermark, including where AI reconstruction is the wrong tool for the job.";
const path = "/guides/ai-inpainting-vs-blur-vs-crop";
const publishedDate = "2026-08-25";
const updatedDate = "2026-08-25";

export const metadata: Metadata = buildPageMetadata({ title, description, path });

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: title,
  description,
  author: { "@type": "Organization", name: "WipeClip.co", url: SITE_URL },
  publisher: {
    "@type": "Organization",
    name: "WipeClip.co",
    logo: { "@type": "ImageObject", url: `${SITE_URL}/logo.webp` },
  },
  datePublished: publishedDate,
  dateModified: updatedDate,
  mainEntityOfPage: `${SITE_URL}${path}`,
  image: `${SITE_URL}/opengraph-image`,
};

export default function Page() {
  return (
    <div className="flex flex-1 flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <Navbar />
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "AI Inpainting vs Blur vs Crop" },
        ]}
      />
      <main className="flex-1">
        <GuideHeader
          eyebrow="Comparison Guide"
          h1={
            <>
              AI inpainting vs blur vs crop for{" "}
              <span className="text-gradient">video watermark removal</span>
            </>
          }
          intro="Four ways to deal with an unwanted overlay on a video, and what each one actually costs you."
        />

        <section className="py-8">
          <DirectAnswer>
            There&apos;s no single best method. Cropping and blurring are fast and require no
            processing, but permanently damage the frame. AI reconstruction preserves the full frame
            and usually leaves a less visible result, but takes longer to run and can struggle when
            there isn&apos;t enough surrounding detail to rebuild from. Which one is right depends on
            the overlay and the footage. See the comparison below.
          </DirectAnswer>
        </section>

        <section className="py-8">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
              The four methods
            </h2>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-border/70 bg-surface-2/50 p-5">
                <h3 className="font-display text-sm font-bold text-foreground">Cropping</h3>
                <p className="mt-1.5 text-sm text-muted leading-relaxed">
                  Cuts the watermarked area out of the frame entirely, usually by trimming an edge or
                  corner. Simple and instant, but changes the video&apos;s dimensions and permanently
                  removes whatever else was in that area.
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-surface-2/50 p-5">
                <h3 className="font-display text-sm font-bold text-foreground">Blurring</h3>
                <p className="mt-1.5 text-sm text-muted leading-relaxed">
                  Applies a blur filter over a fixed box covering the mark. Fast and keeps the frame
                  intact, but the blurred patch is obviously visible and doesn&apos;t follow a moving
                  overlay.
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-surface-2/50 p-5">
                <h3 className="font-display text-sm font-bold text-foreground">Covering</h3>
                <p className="mt-1.5 text-sm text-muted leading-relaxed">
                  Places a solid shape (a logo, a color block, a sticker) over the mark. Same
                  trade-offs as blurring, and arguably more visually intrusive since it&apos;s fully
                  opaque.
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-surface-2/50 p-5">
                <h3 className="font-display text-sm font-bold text-foreground">AI reconstruction</h3>
                <p className="mt-1.5 text-sm text-muted leading-relaxed">
                  Estimates what should be behind the marked region using the pixels around it and
                  nearby frames, then rebuilds that area instead of hiding it. Keeps the frame intact
                  and can follow a moving mark, but is an estimate, not a guaranteed recovery of the
                  original pixels.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="comparison" className="scroll-mt-28 py-8">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
              How they compare
            </h2>
          </div>
          <div className="mx-auto mt-6 max-w-5xl px-6">
            <FullMethodComparisonTable />
          </div>
        </section>

        <section className="py-8">
          <div className="mx-auto max-w-3xl px-6">
            <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                Which method is actually best?
              </h2>
              <ul className="mt-5 space-y-4 text-sm sm:text-base leading-relaxed text-muted">
                <li>
                  <strong className="text-foreground">Crop</strong> is the right call when the mark
                  sits right at the very edge of the frame and losing that sliver of video doesn&apos;t
                  matter, since it&apos;s instant and needs no special tooling.
                </li>
                <li>
                  <strong className="text-foreground">Blur or cover</strong> make sense when speed
                  matters more than how it looks (a quick internal draft, for example) and a visible
                  patch is acceptable.
                </li>
                <li>
                  <strong className="text-foreground">AI reconstruction</strong> is the better choice
                  when the frame needs to stay intact and the result needs to hold up visually (a
                  client deliverable, a repost, footage you&apos;re reusing elsewhere), provided
                  there&apos;s enough surrounding detail for it to work with.
                </li>
                <li>
                  For a large mark sitting over a mostly featureless or heavily obscured area, even AI
                  reconstruction may not outperform a simple crop. There&apos;s honestly not much for
                  it to reconstruct from.
                </li>
              </ul>
            </div>
          </div>
        </section>

        <RelatedGuides
          links={[
            {
              href: "/guides/how-ai-video-inpainting-works",
              label: "How AI Video Inpainting Works",
              desc: "The mechanics behind the reconstruction method compared above.",
            },
            {
              href: "/guides/does-watermark-removal-reduce-video-quality",
              label: "Does Removing a Watermark Reduce Video Quality?",
              desc: "Why matching the source resolution isn't the same as zero quality loss.",
            },
            {
              href: "/research/video-watermark-removal-test",
              label: "WipeClip Research: Watermark Removal Test",
              desc: "Real before/after tests across these scenarios, published as they're verified.",
            },
            {
              href: "/remove-tiktok-watermark",
              label: "Remove a Moving TikTok Watermark",
              desc: "A worked example of the moving-overlay case from the table above.",
            },
          ]}
        />

        <section className="pb-8">
          <div className="mx-auto max-w-3xl px-6">
            <ArticleByline publishedDate={publishedDate} updatedDate={updatedDate} />
          </div>
        </section>

        <CtaBanner />
      </main>
      <Footer />
    </div>
  );
}
