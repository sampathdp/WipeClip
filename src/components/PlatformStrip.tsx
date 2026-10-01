import Link from "next/link";
import { WATERMARK_PLATFORMS } from "@/lib/watermarkPlatforms";
import Reveal from "./Reveal";

/** Compact homepage version of RelatedContent: one row of platform links. */
export default function PlatformStrip() {
  return (
    <section id="related" className="scroll-mt-28 py-16">
      <Reveal className="mx-auto max-w-5xl px-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Works with footage from</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          {WATERMARK_PLATFORMS.map((p) => (
            <Link
              key={p.slug}
              href={`/${p.slug}`}
              className="rounded-full border border-border bg-surface-2/60 px-4 py-2 text-sm font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-cyan-500/50 hover:text-cyan-600"
            >
              {p.platform}
            </Link>
          ))}
          <Link
            href="/remove-image-watermark"
            className="rounded-full border border-border bg-surface-2/60 px-4 py-2 text-sm font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-cyan-500/50 hover:text-cyan-600"
          >
            Still images
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
