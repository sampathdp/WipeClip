import Link from "next/link";
import Logo from "./Logo";
import { WATERMARK_PLATFORMS } from "@/lib/watermarkPlatforms";

export default function Footer() {
  return (
    <footer className="py-10">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Logo size={28} textSize="text-sm" />
            <span className="text-xs text-muted">&copy; {new Date().getFullYear()}</span>
          </div>
          <nav className="flex gap-6 text-sm text-muted">
            <Link href="/privacy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
            <Link href="/dmca" className="transition-colors hover:text-foreground">
              Copyright / DMCA
            </Link>
          </nav>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border/60 pt-6 text-xs text-muted">
          <span className="font-semibold text-foreground/80">Remove a watermark from:</span>
          {WATERMARK_PLATFORMS.map((p, i) => (
            <span key={p.slug} className="flex items-center gap-2">
              <Link href={`/${p.slug}`} className="transition-colors hover:text-foreground">
                {p.platform}
              </Link>
              {i < WATERMARK_PLATFORMS.length - 1 && <span className="text-border">&middot;</span>}
            </span>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted">
          For content you own or have permission to edit only. Not affiliated
          with any third-party video platform or AI model provider. Using
          WipeClip.co to infringe copyright or to violate another platform&apos;s
          terms of service is strictly prohibited. Please review our{" "}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </footer>
  );
}
