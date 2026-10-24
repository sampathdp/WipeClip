import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AI_CLEANUP_ENABLED } from "@/lib/features";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CtaBanner from "@/components/CtaBanner";
import Breadcrumbs from "@/components/Breadcrumbs";
import GuideHeader from "@/components/guides/GuideHeader";
import DirectAnswer from "@/components/guides/DirectAnswer";
import ArticleByline from "@/components/guides/ArticleByline";
import RelatedGuides from "@/components/guides/RelatedGuides";
import QualityFactorsTable from "@/components/guides/QualityFactorsTable";
import { buildPageMetadata, SITE_URL } from "@/lib/seo";
import { getGuide } from "@/lib/site-pages";

const path = "/guides/does-ai-cleanup-reduce-video-quality";
const { title, description, published: publishedDate, updated: updatedDate } = getGuide(path);

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
  if (!AI_CLEANUP_ENABLED) notFound();

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
          { label: "Guides", href: "/guides" },
          { label: "Does AI Cleanup Reduce Quality?" },
        ]}
      />
      <main className="flex-1">
        <GuideHeader
          eyebrow="Quality Explainer"
          h1={
            <>
              Does removing an object{" "}
              <span className="text-gradient">reduce video quality</span>?
            </>
          }
          intro="Not automatically, but 'the resolution matches' and 'nothing was lost' aren't the same claim."
        />

        <section className="py-8">
          <DirectAnswer>
            Matching the source resolution and framerate means the frame size and motion smoothness
            are preserved. It does not mean zero quality loss overall. Bitrate, codec choice, and
            re-encoding all affect visible quality independent of resolution, and the reconstructed
            marked region is an estimate, not a copy of the original pixels. Both are worth
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
                video encoded well: blocky in fast motion, soft in detail, banded in gradients.
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
                cropped or downscaled. That&apos;s a real, checkable claim. It doesn&apos;t cover two
                separate things: the bitrate and codec settings used when the result is re-encoded for
                export, and the fact that the marked region itself is reconstructed rather than
                untouched. Both can introduce visible differences that resolution alone won&apos;t show
                you.
              </p>
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
