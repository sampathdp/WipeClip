import Link from "next/link";
import { WATERMARK_PLATFORMS } from "@/lib/watermarkPlatforms";

export default function RelatedContent() {
  return (
    <section id="related" className="scroll-mt-28 py-24 relative">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border px-3.5 py-1 text-xs font-semibold text-muted">
            Related Guides
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            Removing a watermark from a specific platform
          </h2>
          <p className="mt-4 text-muted text-base leading-relaxed">
            Each platform&apos;s export behaves a little differently — these go into the specifics.
          </p>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-3">
          {WATERMARK_PLATFORMS.map((p) => (
            <Link
              key={p.slug}
              href={`/${p.slug}`}
              className="glass-card-interactive rounded-xl px-5 py-3.5 text-sm font-semibold text-foreground text-center"
            >
              {p.platform}
            </Link>
          ))}
          <Link
            href="/remove-image-watermark"
            className="glass-card-interactive rounded-xl px-5 py-3.5 text-sm font-semibold text-foreground text-center"
          >
            Still image
          </Link>
        </div>
      </div>
    </section>
  );
}
