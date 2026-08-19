export default function CtaBanner() {
  return (
    <section className="py-20 relative">
      <div className="relative mx-auto max-w-5xl px-6">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-accent/20 via-surface-2 to-accent-2/15 p-8 sm:p-16 text-center border border-cyan-500/30 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
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
              Restore your footage, <span className="text-gradient">watermark-free</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base sm:text-lg text-muted">
              No registration needed to preview. Upload your clip and see the crystal-clear result in under 15 seconds.
            </p>
            <div className="mt-8">
              <a
                href="#upload"
                className="btn-primary inline-flex items-center gap-2 rounded-full px-8 py-4 text-base font-bold shadow-[0_0_30px_rgba(124,92,255,0.5)]"
              >
                <span>Remove Watermark Free</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
