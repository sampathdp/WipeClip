import Link from "next/link";
import Logo from "./Logo";
import { AI_CLEANUP_ENABLED } from "@/lib/features";

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
            <Link href="/feedback" className="transition-colors hover:text-foreground">
              Feedback &amp; Bugs
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
            <Link href="/refund-policy" className="transition-colors hover:text-foreground">
              Refund Policy
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
          {AI_CLEANUP_ENABLED && (
            <>
              <span className="text-border">&middot;</span>
              <Link href="/image-cleanup" className="transition-colors hover:text-foreground">
                Image Cleanup
              </Link>
            </>
          )}
        </div>
        <p className="mt-4 text-xs text-muted">
          For content you created or have the rights to edit only. WipeClip.co
          does not remove watermarks, logos, or other ownership or copyright
          marks, and using it to do so, or to infringe anyone&apos;s copyright,
          is prohibited. Not affiliated with any third-party video platform or
          AI model provider. Please review our{" "}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </footer>
  );
}
