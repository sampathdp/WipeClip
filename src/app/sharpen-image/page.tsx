import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import PhotoSharpenerDemo from "@/components/PhotoSharpenerDemo";

const title = "Sharpen a Blurry Photo - Free";
const description =
  "Restore crisp detail to a soft or slightly blurry photo in seconds. Free, no account required to preview. Pick light, standard, or strong strength.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/sharpen-image" },
  openGraph: {
    type: "website",
    url: "https://wipeclip.co/sharpen-image",
    siteName: "WipeClip.co",
    title,
    description,
    locale: "en_US",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/opengraph-image"],
  },
};

const faqs = [
  {
    q: "Will this fix a badly blurry or out-of-focus photo?",
    a: "No. This restores local contrast and edge detail on a photo that's already reasonably sharp but looks a little soft (a common side effect of compression or resizing). It can't reconstruct detail that was never captured, so heavy motion blur or an out-of-focus shot won't come back sharp.",
  },
  {
    q: "Does this upscale the image resolution?",
    a: "No. Output is the same pixel dimensions as your upload. This adds clarity/detail contrast at the existing resolution, it doesn't add resolution.",
  },
  {
    q: "What's the difference between Light, Standard, and Strong?",
    a: "How aggressively local contrast is boosted around detected edges. Standard suits most photos; Light avoids over-sharpening delicate detail like skin or sky; Strong is for photos that still look soft after Standard.",
  },
  {
    q: "Is this free?",
    a: "Yes. Every visitor gets free preview passes with no account, and every signed-in account gets 2 free credits a day, which covers typical everyday use of this tool.",
  },
];

export default function Page() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className="flex flex-1 flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <Navbar />
      <main className="flex-1">
        <section className="relative overflow-hidden pt-36 pb-16 md:pt-48">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-48 left-1/3 h-[650px] w-[950px] rounded-full bg-gradient-to-b from-accent/6 via-cyan-500/4 to-transparent blur-[140px] -z-10 dark:from-accent/25 dark:via-cyan-500/15"
          />
          <div className="mx-auto max-w-3xl px-6 text-center">
            <div className="mb-6 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-cyan-500/30 px-3.5 py-1 text-xs font-semibold text-cyan-600">
              Free Tool
            </div>
            <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl text-foreground text-balance">
              Sharpen a <span className="text-gradient">soft or blurry</span> photo
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              Upload a photo, pick a strength, get crisper detail back, no account needed to
              preview.
            </p>
          </div>
        </section>

        <section className="pb-24">
          <div className="px-6">
            <PhotoSharpenerDemo />
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="text-center font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
              Photo sharpening: FAQ
            </h2>
            <div className="mt-10 space-y-4">
              {faqs.map((f) => (
                <details
                  key={f.q}
                  className="glass-card group rounded-2xl p-6 transition-all duration-200 border border-border/80 hover:border-cyan-500/30 open:border-cyan-500/40"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-base text-foreground">
                    <span>{f.q}</span>
                    <span className="ml-4 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 border border-border text-cyan-600 transition-transform duration-300 group-open:rotate-45">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </span>
                  </summary>
                  <p className="mt-4 text-sm text-muted leading-relaxed border-t border-border/50 pt-4">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
