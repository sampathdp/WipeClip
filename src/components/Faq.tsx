import Link from "next/link";

const faqs = [
  {
    q: "Can I use this on any video I find online?",
    a: "No. WipeClip.co is for content you own or have explicit permission to edit, such as your own AI-generated video drafts, personal B-roll, or footage with client authorization. You confirm this before every job.",
  },
  {
    q: "Does this actually reconstruct the area, or just blur it?",
    a: "WipeClip.co blends the marked region in from surrounding pixels and temporal motion vectors rather than covering it with a static blur box or destructive crop.",
  },
  {
    q: "Which overlays are supported?",
    a: "Any badge, logo, caption, timestamp, or unwanted static object. Because you mark its position on the preview frame, it is not restricted to specific predefined shapes or brands.",
  },
  {
    q: "Will the output lose resolution or quality?",
    a: "No. Original source resolution and framerate are strictly preserved, and output videos are exported at visually lossless bitrates.",
  },
  {
    q: "What is the maximum file size?",
    a: "Clips up to 300MB are supported on the free plan. Higher limits and API integrations are available for batch processing.",
  },
  {
    q: "Do you store or use my video files?",
    a: "Never. Files are processed in temporary volatile memory and immediately deleted the instant your download completes.",
  },
  {
    q: "Will you process explicit or adult content?",
    a: "No. Every upload is automatically screened before processing, and clips flagged as explicit or abusive are immediately rejected.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default function Faq() {
  return (
    <section id="faq" className="scroll-mt-28 py-24 relative">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border px-3.5 py-1 text-xs font-semibold text-muted">
            Frequently Asked Questions
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            Got questions? We&apos;ve got answers.
          </h2>
        </div>

        <div className="mt-12 space-y-4">
          {faqs.map((f) => (
            <details
              key={f.q}
              className="glass-card group rounded-2xl p-6 transition-all duration-200 border border-border/80 hover:border-cyan-500/30 open:border-cyan-500/40 open:shadow-[0_0_20px_rgba(34,211,238,0.15)]"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-base text-foreground">
                <span>{f.q}</span>
                <span className="ml-4 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 border border-border text-cyan-600 transition-transform duration-300 group-open:rotate-45 group-hover:scale-110">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </summary>
              <p className="mt-4 text-sm text-muted leading-relaxed border-t border-border/50 pt-4">{f.a}</p>
            </details>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-muted">
          Full details available in our{" "}
          <Link href="/terms" className="underline hover:text-cyan-600">
            Terms of Service
          </Link>
          ,{" "}
          <Link href="/privacy" className="underline hover:text-cyan-600">
            Privacy Policy
          </Link>
          , and{" "}
          <Link href="/dmca" className="underline hover:text-cyan-600">
            Copyright Policy
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
