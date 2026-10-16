import Link from "next/link";
import { AI_CLEANUP_ENABLED } from "@/lib/features";

export default function CtaBanner() {
  return (
    <section className="py-20 relative">
      <div className="relative mx-auto max-w-5xl px-6">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-accent/20 via-surface-2 to-accent-2/15 p-8 sm:p-16 text-center border border-cyan-500/30 shadow-[0_20px_50px_rgba(15,23,42,0.10)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
          {/* Ambient Glows */}
          <div
            aria-hidden
            className="absolute -top-24 -left-24 h-64 w-64 rounded-full bg-accent/30 blur-3xl pointer-events-none"
          />
          <div
            aria-hidden
            className="absolute -bottom-24 -right-24 h-64 w-64 rounded-full bg-accent-2/30 blur-3xl pointer-events-none"
          />

          <div className="relative z-10">
            <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl text-foreground">
              {AI_CLEANUP_ENABLED ? (
                <>
                  Clean shots, <span className="text-gradient">distraction-free</span>
                </>
              ) : (
                <>
                  Your next video, <span className="text-gradient">edited in minutes</span>
                </>
              )}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base sm:text-lg text-muted">
              {AI_CLEANUP_ENABLED
                ? "No registration needed to preview. Upload a clip you shot and see the crystal-clear result in under 15 seconds."
                : "No registration needed to start. Drop in a clip, trim, add captions and export for any platform."}
            </p>
            <div className="mt-8">
              <Link
                href={AI_CLEANUP_ENABLED ? "/#upload" : "/editor"}
                className="btn-primary inline-flex items-center gap-2 rounded-full px-8 py-4 text-base font-bold shadow-[0_0_30px_rgba(124,92,255,0.5)]"
              >
                <span>{AI_CLEANUP_ENABLED ? "Remove an Object Free" : "Start Editing Free"}</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
            <p className="mt-5 text-xs text-muted">
              Just need a clean cutout instead?{" "}
              <Link href="/remove-background" className="font-semibold text-cyan-600 underline hover:text-cyan-700">
                Try the free background remover
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
