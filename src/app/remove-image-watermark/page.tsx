import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ImageEditorDemo from "@/components/ImageEditorDemo";

const title = "Remove Image Watermark - Pro Tool";
const description =
  "Mark a watermark or logo region on any image once, and WipeClip.co reconstructs the pixels beneath it. A Pro-plan tool, same motion-free inpainting as the video tool.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/remove-image-watermark" },
  openGraph: {
    type: "website",
    url: "https://wipeclip.co/remove-image-watermark",
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
    q: "Why is this a Pro-only feature when the video tool has a free tier?",
    a: "The video tool's free preview covers casual, occasional use. Image watermark/object removal shares the same reconstruction engine but is bundled into the Pro plan ($24/mo) alongside 4K video, unattended auto-enhance, and batch upload.",
  },
  {
    q: "How is this different from WipeClip.co's free background remover or sharpener?",
    a: "Those tools run automatically with no region to mark - background removal cuts out the whole subject, and sharpening enhances the whole image. This tool reconstructs a specific region you mark yourself, the same way as the video watermark remover, just applied to one still image instead of every frame of a clip.",
  },
  {
    q: "Can I remove a watermark from a still image the same way as from a video?",
    a: "Yes - this uses the same motion-free inpainting reconstruction as the video tool's per-frame engine, just run once against a single frame instead of the whole clip.",
  },
  {
    q: "What image formats are supported?",
    a: "PNG, JPG, and WebP up to 25MB. Output is always a PNG so the reconstructed region keeps full quality with no re-compression artifacts.",
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
              Pro Tool
            </div>
            <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl text-foreground text-balance">
              Remove a <span className="text-gradient">watermark from an image</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              Mark the badge or logo once and WipeClip.co reconstructs the pixels beneath it,
              same reconstruction engine as the video tool, applied to a single frame.
            </p>
          </div>
        </section>

        <section className="pb-24">
          <div className="px-6">
            <ImageEditorDemo />
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="text-center font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
              Image watermark removal: FAQ
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
