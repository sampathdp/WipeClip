import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Breadcrumbs from "@/components/Breadcrumbs";
import ResearchDisclaimer from "@/components/research/ResearchDisclaimer";
import { buildPageMetadata } from "@/lib/seo";

const title = "Research";
const description =
  "WipeClip's published tests on AI video watermark removal: real before/after clips and measured results, published once verified.";

export const metadata: Metadata = buildPageMetadata({
  title,
  description,
  path: "/research",
});

const articles = [
  {
    href: "/research/video-watermark-removal-test",
    title: "We Tested AI Watermark Removal on Real Videos",
    description:
      "Static and moving watermarks, semi-transparent overlays, complex backgrounds, and fast motion. Methodology and results as they're verified.",
    status: "In progress: awaiting verified test data",
  },
];

export default function ResearchIndexPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Research" }]} />
      <main className="flex-1">
        <section className="pt-12 pb-16">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <div className="mb-6 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-cyan-500/30 px-3.5 py-1 text-xs font-semibold text-cyan-600">
              WipeClip Research
            </div>
            <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl text-foreground text-balance">
              Evidence, not marketing claims
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              This is where WipeClip publishes real, checkable tests of its own watermark removal:
              actual before/after clips and measured numbers, not projected or estimated ones.
            </p>
          </div>
        </section>

        <section className="pb-16">
          <div className="mx-auto max-w-3xl px-6">
            <ResearchDisclaimer />
          </div>
        </section>

        <section className="pb-24">
          <div className="mx-auto max-w-3xl px-6 space-y-4">
            {articles.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="glass-card-interactive block rounded-[1.75rem] p-7"
              >
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-3/80 border border-border px-3 py-1 text-[11px] font-mono text-muted">
                  {a.status}
                </span>
                <h2 className="mt-4 font-display text-xl font-bold text-foreground tracking-tight">
                  {a.title}
                </h2>
                <p className="mt-2 text-sm text-muted leading-relaxed">{a.description}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
