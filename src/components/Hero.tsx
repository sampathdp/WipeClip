import BeforeAfterDemo from "./BeforeAfterDemo";

const MARQUEE_ITEMS = [
  "MP4",
  "MOV",
  "WEBM",
  "4K LOSSLESS",
  "NO CROP",
  "NO BLUR BOX",
  "MOTION-AWARE INPAINTING",
  "~15s AVG RENDER",
];

export default function Hero() {
  return (
    <section className="relative overflow-hidden pt-36 pb-16 md:pt-48">
      {/* Dynamic Ambient Glow Mesh */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 left-1/3 h-[650px] w-[950px] rounded-full bg-gradient-to-b from-accent/25 via-cyan-500/15 to-transparent blur-[140px] -z-10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-32 -left-32 h-[420px] w-[420px] rounded-full bg-accent/25 blur-[130px] -z-10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-72 -right-32 h-[480px] w-[480px] rounded-full bg-accent-2/25 blur-[140px] -z-10"
      />

      {/* Cyber Grid Accent Overlay */}
      <div className="pointer-events-none absolute inset-0 bg-grid-pattern opacity-40 -z-10 [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black_80%)]" />

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid gap-16 lg:grid-cols-12 lg:items-center lg:gap-8">
          {/* Left: Hero Text — asymmetric 5/12 */}
          <div className="mx-auto max-w-xl text-center lg:col-span-5 lg:mx-0 lg:max-w-none lg:text-left">
            {/* Sticker-style AI Pill */}
            <div className="mb-7 inline-flex -rotate-1 items-center gap-2 rounded-full border border-cyan-500/30 bg-surface-2/90 py-1.5 pl-2.5 pr-4 text-xs font-semibold text-cyan-200 shadow-[0_0_25px_rgba(34,211,238,0.25)] backdrop-blur-xl">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="shrink-0 text-cyan-300">
                <path
                  d="M12 2l1.8 5.6L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.4L12 2z"
                  fill="currentColor"
                />
              </svg>
              <span className="tracking-wide">AI Motion-Aware Inpainting</span>
            </div>

            {/* Core Headline — stacked, oversized, mixed weight */}
            <h1 className="font-display text-6xl tracking-tighter leading-[0.92] text-foreground sm:text-7xl lg:text-6xl xl:text-7xl">
              <span className="block font-semibold text-foreground/90">Erase the</span>
              <span className="block italic font-extrabold text-gradient drop-shadow-[0_0_35px_rgba(124,92,255,0.35)]">
                watermark.
              </span>
              <span className="block font-extrabold">Keep the footage.</span>
            </h1>

            {/* Subtitle */}
            <p className="mx-auto mt-7 max-w-md text-base leading-relaxed text-muted sm:text-lg lg:mx-0 lg:border-l-2 lg:border-accent/40 lg:pl-5">
              Mark any badge, timestamp or logo once WipeClip.io reconstructs
              the pixels beneath every frame from surrounding motion. No blur
              box, no crop, zero quality loss.
            </p>

            {/* Action CTAs */}
            <div className="mt-9 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
              <a
                href="#upload"
                className="btn-primary rounded-full px-8 py-4 text-sm sm:text-base font-bold inline-flex items-center justify-center gap-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_0_35px_rgba(124,92,255,0.45)] transition-all hover:scale-[1.02]"
              >
                <span>Remove watermark free</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </a>
            </div>

            {/* Trust Highlights */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              {["No account required", "Up to 300MB free", "100% private"].map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-surface-2/60 px-3 py-1 text-[11px] font-medium text-muted"
                >
                  <span className="text-cyan-400 font-bold">✓</span> {label}
                </span>
              ))}
            </div>
          </div>

          {/* Right: Video Showcase Stage — asymmetric 7/12 */}
          <div className="relative lg:col-span-7">
            {/* Halo glow */}
            <div className="absolute -inset-6 rounded-[3rem] bg-gradient-to-r from-accent/30 via-cyan-400/20 to-accent/30 opacity-70 blur-3xl -z-20 animate-pulse-glow" />
            {/* Stacked ghost cards for layered depth */}
            <div className="absolute inset-0 -z-10 translate-x-3 translate-y-3 rotate-[-2deg] rounded-[2.5rem] bg-gradient-to-br from-accent/25 to-cyan-400/20 blur-sm" />
            <div className="absolute inset-0 -z-10 -translate-x-2 translate-y-5 rotate-[2deg] rounded-[2.5rem] border border-cyan-500/10 bg-surface-2/40" />

            <BeforeAfterDemo />

            {/* Floating stat chips, overlapping the video edges */}
            <div className="glass-card absolute -bottom-6 -left-4 hidden -rotate-3 rounded-2xl border border-cyan-500/20 px-5 py-3 shadow-2xl sm:block">
              <div className="font-display text-xl font-extrabold text-foreground">0</div>
              <div className="text-[10px] font-medium text-muted">files stored</div>
            </div>
            <div className="glass-card absolute -bottom-6 left-1/2 hidden -translate-x-1/2 rotate-1 rounded-2xl border border-cyan-500/20 px-5 py-3 shadow-2xl md:block">
              <div className="font-display text-xl font-extrabold text-gradient-cyan">~15s</div>
              <div className="text-[10px] font-medium text-muted">avg render</div>
            </div>
            <div className="glass-card absolute -bottom-6 right-4 hidden rotate-2 rounded-2xl border border-cyan-500/20 px-5 py-3 shadow-2xl sm:block">
              <div className="font-display text-xl font-extrabold text-gradient">1080p+</div>
              <div className="text-[10px] font-medium text-muted">lossless</div>
            </div>
          </div>
        </div>
      </div>

      {/* Scrolling marquee strip — full bleed, edge to edge */}
      <div className="mt-20 overflow-hidden border-y border-border/60 bg-surface-2/40 py-3">
        <div className="animate-marquee flex w-max items-center gap-8 font-mono text-[11px] font-medium tracking-widest text-muted">
          {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, i) => (
            <span key={i} className="flex items-center gap-8">
              {item}
              <span className="text-cyan-400">•</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
