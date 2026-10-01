import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CtaBanner from "@/components/CtaBanner";
import Breadcrumbs from "@/components/Breadcrumbs";
import ResearchHero from "@/components/research/ResearchHero";
import ResearchDisclaimer from "@/components/research/ResearchDisclaimer";
import TestMethodology from "@/components/research/TestMethodology";
import EvidenceGallery from "@/components/research/EvidenceGallery";
import BenchmarkTable from "@/components/research/BenchmarkTable";
import LimitationsPanel from "@/components/research/LimitationsPanel";
import RelatedGuides from "@/components/guides/RelatedGuides";
import { buildPageMetadata, SITE_URL } from "@/lib/seo";
import { RESEARCH_TESTS, TEST_CATEGORIES } from "@/lib/researchData";

const title = "We Tested AI Video Cleanup on Real Videos";
const description =
  "WipeClip's ongoing test of its own AI video cleanup: static and moving overlays, semi-transparent marks, complex backgrounds, and fast motion. Real before/after data, published once verified.";
const path = "/research/video-cleanup-test";

export const metadata: Metadata = buildPageMetadata({
  title,
  description,
  path,
});

const publishedDate = "2026-08-25";

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
  dateModified: publishedDate,
  mainEntityOfPage: `${SITE_URL}${path}`,
  image: `${SITE_URL}/opengraph-image`,
};

export default function VideoCleanupTestPage() {
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
          { label: "Research", href: "/research" },
          { label: "AI Video Cleanup Test" },
        ]}
      />
      <main className="flex-1">
        <ResearchHero
          eyebrow="WipeClip Research"
          h1={title}
          intro="An ongoing, in-house test of WipeClip's own AI video cleanup across six real-world overlay scenarios, published with real before/after clips as each one is verified."
        />

        <section className="py-8">
          <div className="mx-auto max-w-3xl px-6">
            <ResearchDisclaimer />
          </div>
        </section>

        <section id="intro" className="scroll-mt-28 py-16">
          <div className="mx-auto max-w-3xl px-6">
            <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                Why this page exists
              </h2>
              <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
                Claims about AI video tools are easy to make and hard to check. This page is where
                WipeClip publishes its own results against its own product: six overlay scenarios,
                tested the same way every time, with the actual output clip attached to every number.
                Last published: {new Date(publishedDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.
              </p>
            </div>
          </div>
        </section>

        <section id="quick-results" className="scroll-mt-28 pb-16">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              Quick results
            </h2>
            <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
              No numeric results are published yet. Every test below is pending real, verified data.
              The full breakdown for each scenario is in the sections that follow.
            </p>
          </div>
        </section>

        <section id="methodology" className="scroll-mt-28 pb-16">
          <div className="mx-auto max-w-3xl px-6">
            <TestMethodology />
          </div>
        </section>

        <section className="pb-16">
          <div className="mx-auto max-w-3xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                Test cases
              </h2>
              <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
                Six overlay scenarios cover the situations that actually determine whether
                reconstruction holds up.
              </p>
            </div>
            <div className="mt-10">
              <EvidenceGallery />
            </div>
          </div>
        </section>

        <section id="resolution-comparison" className="scroll-mt-28 py-16">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
              Resolution comparison
            </h2>
            <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
              Input vs. output resolution, framerate, clip length, and processing time for every
              published test.
            </p>
            <div className="mt-6">
              <BenchmarkTable tests={RESEARCH_TESTS} />
            </div>
          </div>
        </section>

        <section id="processing-performance" className="scroll-mt-28 pb-16">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
              Processing performance
            </h2>
            <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
              Processing time is measured wall-clock, from upload start to result download (see{" "}
              <a href="#methodology" className="underline hover:text-foreground">
                methodology
              </a>
              ). No processing times have been measured and published yet. They&apos;ll appear in
              the table above once available.
            </p>
          </div>
        </section>

        <section id="before-after" className="scroll-mt-28 pb-16">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
              Before vs after
            </h2>
            <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
              Every before/after comparison lives with its test case above, organized by scenario:
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {TEST_CATEGORIES.map((c) => (
                <a
                  key={c.key}
                  href={`#${c.key}`}
                  className="rounded-full bg-surface-2/90 border border-border px-3.5 py-1.5 text-xs font-semibold text-muted hover:text-foreground hover:border-cyan-500/40 transition-colors"
                >
                  {c.label}
                </a>
              ))}
            </div>
          </div>
        </section>

        <section id="works-well" className="scroll-mt-28 py-16">
          <div className="mx-auto max-w-3xl px-6">
            <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                Where AI reconstruction works well
              </h2>
              <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
                Based on how the reconstruction approach works (not on test results published here
                yet), it&apos;s best suited to a mark that&apos;s small relative to the frame, in a
                fixed or predictably-tracked position, with steady detail in the surrounding footage
                to rebuild from.
              </p>
            </div>
          </div>
        </section>

        <section id="struggles" className="scroll-mt-28 pb-16">
          <div className="mx-auto max-w-3xl px-6">
            <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                Where it struggles
              </h2>
              <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
                A large mark over a highly detailed or fast-changing background, heavy camera shake,
                and objects repeatedly crossing the marked region all give the model less to work
                with. See WipeClip&apos;s{" "}
                <Link href="/about#limitations" className="underline hover:text-foreground text-cyan-600">
                  general product limitations
                </Link>{" "}
                for the full list. This page will confirm or update that picture once tests are
                published.
              </p>
            </div>
          </div>
        </section>

        <section id="limitations" className="scroll-mt-28 pb-16">
          <div className="mx-auto max-w-3xl px-6">
            <LimitationsPanel />
          </div>
        </section>

        <section id="methodology-notes" className="scroll-mt-28 pb-16">
          <div className="mx-auto max-w-3xl px-6">
            <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                Methodology notes
              </h2>
              <ul className="mt-4 space-y-3 text-sm sm:text-base leading-relaxed text-muted list-disc pl-5">
                <li>Every test records the exact WipeClip build/version used, since results can change as the underlying model changes.</li>
                <li>&ldquo;Visible artifacts&rdquo; is a written description of what&apos;s actually visible in the output, not a numeric score.</li>
                <li>No test on this page is described as a &ldquo;pass&rdquo; or &ldquo;success&rdquo; against a threshold: the before/after clip and notes are the result.</li>
              </ul>
            </div>
          </div>
        </section>

        <RelatedGuides
          links={[
            {
              href: "/guides/ai-inpainting-vs-blur-vs-crop",
              label: "AI Inpainting vs Blur vs Crop",
              desc: "How reconstruction compares to methods that don't touch pixels at all.",
            },
            {
              href: "/guides/does-ai-cleanup-reduce-video-quality",
              label: "Does AI Cleanup Reduce Video Quality?",
              desc: "Where the resolution/framerate numbers from this page fit into the bigger quality picture.",
            },
            {
              href: "/guides/how-ai-video-inpainting-works",
              label: "How AI Video Inpainting Works",
              desc: "The mechanics behind the reconstruction being tested here.",
            },
          ]}
        />

        <CtaBanner />
      </main>
      <Footer />
    </div>
  );
}
