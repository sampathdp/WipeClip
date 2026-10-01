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
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            <Link href="/editor" className="transition-colors hover:text-foreground">
              Video Editor
            </Link>
            <Link href="/about" className="transition-colors hover:text-foreground">
              About
            </Link>
            <Link href="/research" className="transition-colors hover:text-foreground">
              Research
            </Link>
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
          <span className="font-semibold text-foreground/80">Free tools:</span>
          <Link href="/remove-background" className="transition-colors hover:text-foreground">
            Background Remover
          </Link>
          <span className="text-border">&middot;</span>
          <Link href="/extract-video-frame" className="transition-colors hover:text-foreground">
            Video Frame Grabber
          </Link>
          <span className="text-border">&middot;</span>
          <Link href="/sharpen-image" className="transition-colors hover:text-foreground">
            Photo Sharpener
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted">
          <span className="font-semibold text-foreground/80">Clean up footage from:</span>
          {WATERMARK_PLATFORMS.map((p) => (
            <span key={p.slug} className="flex items-center gap-2">
              <Link href={`/${p.slug}`} className="transition-colors hover:text-foreground">
                {p.platform}
              </Link>
              <span className="text-border">&middot;</span>
            </span>
          ))}
          <Link href="/remove-image-watermark" className="transition-colors hover:text-foreground">
            Still Images
          </Link>
        </div>
        <p className="mt-4 text-xs text-muted">
          For content you own or have permission to edit only. Not affiliated
          with any third-party video platform or AI model provider. All product
          names, logos, and brands are property of their respective owners and
          are used for identification purposes only. Using WipeClip.co to
          infringe copyright or to violate another platform&apos;s terms of
          service is strictly prohibited. Please review our{" "}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </footer>
  );
}
