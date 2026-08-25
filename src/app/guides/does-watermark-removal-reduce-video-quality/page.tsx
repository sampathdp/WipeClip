import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CtaBanner from "@/components/CtaBanner";
import Breadcrumbs from "@/components/Breadcrumbs";
import GuideHeader from "@/components/guides/GuideHeader";
import DirectAnswer from "@/components/guides/DirectAnswer";
import ArticleByline from "@/components/guides/ArticleByline";
import RelatedGuides from "@/components/guides/RelatedGuides";
import QualityFactorsTable from "@/components/guides/QualityFactorsTable";
import ResearchDisclaimer from "@/components/research/ResearchDisclaimer";
import BenchmarkTable from "@/components/research/BenchmarkTable";
import { buildPageMetadata, SITE_URL } from "@/lib/seo";
import { RESEARCH_TESTS } from "@/lib/researchData";

const title = "Does Removing a Watermark Reduce Video Quality?";
const description =
  "Resolution isn't the same as visual quality. A clear look at how resolution, bitrate, codec, re-encoding, and reconstructed pixels actually affect a video after watermark removal.";
const path = "/guides/does-watermark-removal-reduce-video-quality";
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
          { label: "Guides" },
          { label: "Does Watermark Removal Reduce Quality?" },
        ]}
      />
      <main className="flex-1">
        <GuideHeader
          eyebrow="Quality Explainer"
          h1={
            <>
              Does removing a watermark{" "}
              <span className="text-gradient">reduce video quality</span>?
            </>
          }
          intro="Not automatically — but 'the resolution matches' and 'nothing was lost' aren't the same claim."
        />

        <section className="py-8">
          <DirectAnswer>
            Matching the source resolution and framerate means the frame size and motion smoothness
            are preserved — it does not mean zero quality loss overall. Bitrate, codec choice, and
            re-encoding all affect visible quality independent of resolution, and the reconstructed
            watermark region is an estimate, not a copy of the original pixels. Both are worth
            understanding separately.
          </DirectAnswer>
        </section>

        <section className="py-8">
          <div className="mx-auto max-w-3xl px-6">
            <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                Resolution is not the same thing as quality
              </h2>
              <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
                A 1920×1080 video encoded at a low bitrate can look noticeably worse than a 1280×720
                video encoded well — blocky in fast motion, soft in detail, banded in gradients.
                Resolution describes how many pixels exist. It says nothing about how much
                information each of those pixels actually carries, which is what bitrate, codec, and
                compression settings control.
              </p>
            </div>
          </div>
        </section>

        <section className="py-8">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
              What actually affects quality
            </h2>
          </div>
          <div className="mx-auto mt-6 max-w-5xl px-6">
            <QualityFactorsTable />
          </div>
        </section>

        <section className="py-8">
          <div className="mx-auto max-w-3xl px-6">
            <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                Why &ldquo;output matches input resolution&rdquo; isn&apos;t the whole story
              </h2>
              <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
                Preserving 1920×1080 (or whatever the source resolution is) means the frame wasn&apos;t
                cropped or downscaled — that&apos;s a real, checkable claim. It doesn&apos;t cover two
                separate things: the bitrate and codec settings used when the result is re-encoded for
                export, and the fact that the marked region itself is reconstructed rather than
                untouched. Both can introduce visible differences that resolution alone won&apos;t show
                you.
              </p>
            </div>
          </div>
        </section>

        <section id="real-measurements" className="scroll-mt-28 py-8">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
              Real quality measurements
            </h2>
            <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
              Rather than asserting numbers here, this section pulls directly from WipeClip&apos;s
              published research data — it will show real input/output resolution, framerate, and
              processing time for each test once available.
            </p>
            <div className="mt-6 space-y-6">
              <ResearchDisclaimer compact />
              <BenchmarkTable tests={RESEARCH_TESTS} />
            </div>
          </div>
        </section>

        <RelatedGuides
          links={[
            {
              href: "/guides/how-ai-video-inpainting-works",
              label: "How AI Video Inpainting Works",
              desc: "Why the reconstructed region is an estimate rather than a copy of the original.",
            },
            {
              href: "/guides/ai-inpainting-vs-blur-vs-crop",
              label: "AI Inpainting vs Blur vs Crop",
              desc: "How reconstruction compares to methods that avoid touching pixels at all.",
            },
            {
              href: "/research/video-watermark-removal-test",
              label: "WipeClip Research: Watermark Removal Test",
              desc: "Where the measurements referenced above will be published.",
            },
            {
              href: "/privacy",
              label: "Privacy Policy",
              desc: "What happens to a video file during processing.",
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
