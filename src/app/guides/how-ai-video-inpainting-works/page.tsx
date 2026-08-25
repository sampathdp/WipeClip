import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CtaBanner from "@/components/CtaBanner";
import Breadcrumbs from "@/components/Breadcrumbs";
import GuideHeader from "@/components/guides/GuideHeader";
import DirectAnswer from "@/components/guides/DirectAnswer";
import ArticleByline from "@/components/guides/ArticleByline";
import RelatedGuides from "@/components/guides/RelatedGuides";
import { buildPageMetadata, SITE_URL } from "@/lib/seo";

const title = "How AI Video Inpainting Works";
const description =
  "A plain-language explanation of how video inpainting fills in a marked region using nearby pixels and nearby frames, and where the approach runs into trouble.";
const path = "/guides/how-ai-video-inpainting-works";
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

const steps = [
  {
    n: "01",
    title: "Marking the region",
    desc: "You draw a box around the badge, logo, or timestamp on a single preview frame. That's the only manual step: everything past this point is automatic.",
  },
  {
    n: "02",
    title: "Filling it in from nearby pixels",
    desc: "Within that same frame, the system looks at the pixels surrounding the marked box (their color, texture, and pattern) and uses them to build a plausible fill for the marked area. This is spatial reconstruction: working outward from what's directly around the gap.",
  },
  {
    n: "03",
    title: "Checking nearby frames",
    desc: "Video has an advantage a single photo doesn't: nearby frames. Because the camera or the subject usually moves at least slightly between frames, a spot hidden by the mark in one frame is often visible, unmarked, a few frames earlier or later. The system tracks that motion and borrows real pixel information from those frames when it can, instead of only guessing from the current frame's surroundings.",
  },
  {
    n: "04",
    title: "Keeping it consistent frame to frame",
    desc: "The same tracking that finds usable pixels in nearby frames also keeps the reconstructed area moving in step with the rest of the footage, so the result doesn't flicker or drift out of alignment as the clip plays.",
  },
];

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
          { label: "How AI Video Inpainting Works" },
        ]}
      />
      <main className="flex-1">
        <GuideHeader
          eyebrow="How It Works"
          h1={
            <>
              How <span className="text-gradient">AI video inpainting</span> works
            </>
          }
          intro="No jargon required: here's what actually happens between marking a watermark and getting a clean clip back."
        />

        <section className="py-8">
          <DirectAnswer>
            Video inpainting fills in a marked region by estimating what should be there, using the
            pixels around it in the same frame, and, uniquely to video, the same spot as it appears in
            nearby frames where it isn&apos;t covered. It&apos;s reconstruction from available
            evidence, not a lookup of the original footage.
          </DirectAnswer>
        </section>

        <section className="py-12">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
              The process, step by step
            </h2>
            <div className="mt-8 space-y-4">
              {steps.map((s) => (
                <div key={s.n} className="rounded-2xl border border-border/70 bg-surface-2/50 p-6 flex gap-4">
                  <span className="shrink-0 font-mono text-xl font-extrabold text-gradient-cyan">
                    {s.n}
                  </span>
                  <div>
                    <h3 className="font-display text-base font-bold text-foreground tracking-tight">
                      {s.title}
                    </h3>
                    <p className="mt-1.5 text-sm text-muted leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="occlusion" className="scroll-mt-28 py-8">
          <div className="mx-auto max-w-3xl px-6">
            <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                When there&apos;s nothing nearby to borrow from
              </h2>
              <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
                Sometimes no nearby frame has a clean view of what&apos;s behind the mark: the camera
                never reveals that spot, or something else blocks it the whole time. This is called{" "}
                <strong className="text-foreground">occlusion</strong>, and it&apos;s the scenario
                with the least real information to work with. The system falls back to estimating from
                the current frame&apos;s surroundings alone, which is a weaker starting point than
                having real footage of the spot to draw on.
              </p>
            </div>
          </div>
        </section>

        <section id="complex-backgrounds" className="scroll-mt-28 py-8">
          <div className="mx-auto max-w-3xl px-6">
            <div className="glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80">
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                Complex backgrounds cut both ways
              </h2>
              <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
                A detailed, textured background can actually help the spatial step: there&apos;s more
                surrounding pattern to sample from than a flat, empty one. What hurts is a background
                that changes quickly or unpredictably between frames: fast motion or heavy camera shake
                makes it harder to line frames up and find a reliable match, regardless of how detailed
                each individual frame is.
              </p>
            </div>
          </div>
        </section>

        <section id="limitations" className="scroll-mt-28 py-8">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
              Common limitations
            </h2>
            <ul className="mt-5 space-y-3 text-sm sm:text-base leading-relaxed text-muted list-disc pl-5">
              <li>A large marked area gives the spatial step less nearby detail to build a convincing fill from.</li>
              <li>Heavy camera shake or fast motion makes it harder to line frames up for the temporal step.</li>
              <li>Something else repeatedly crossing the marked region creates occlusion, described above.</li>
              <li>An area with very little visual information behind it (plain, unchanging, or mostly out of frame) leaves little for either step to work with.</li>
            </ul>
            <p className="mt-5 text-sm text-muted leading-relaxed">
              See WipeClip&apos;s own{" "}
              <Link href="/#limitations" className="underline hover:text-foreground text-cyan-600">
                product limitations
              </Link>{" "}
              for how this applies in practice, and{" "}
              <Link href="/research/video-watermark-removal-test" className="underline hover:text-foreground text-cyan-600">
                WipeClip Research
              </Link>{" "}
              for real test results as they&apos;re published.
            </p>
          </div>
        </section>

        <section className="py-8">
          <div className="mx-auto max-w-3xl px-6">
            <p className="text-xs text-muted leading-relaxed">
              This explains the general approach behind reconstruction-based watermark removal. It
              describes the concepts involved, not the internals of any specific implementation.
            </p>
          </div>
        </section>

        <RelatedGuides
          links={[
            {
              href: "/guides/ai-inpainting-vs-blur-vs-crop",
              label: "AI Inpainting vs Blur vs Crop",
              desc: "How this approach compares to methods that don't reconstruct pixels at all.",
            },
            {
              href: "/guides/does-watermark-removal-reduce-video-quality",
              label: "Does Removing a Watermark Reduce Video Quality?",
              desc: "Why the reconstructed region is an estimate, and what else affects quality.",
            },
            {
              href: "/research/video-watermark-removal-test",
              label: "WipeClip Research: Watermark Removal Test",
              desc: "Real before/after tests across static, moving, and difficult overlay cases.",
            },
            {
              href: "/remove-tiktok-watermark",
              label: "Remove a Moving TikTok Watermark",
              desc: "A worked example of temporal tracking against a moving overlay.",
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
