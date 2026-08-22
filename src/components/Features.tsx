const features = [
  {
    title: "Near-Lossless Quality",
    desc: "Outputs preserve full source resolution and framerate, encoded at visually lossless master bitrate.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
  {
    title: "Universal Mark Detection",
    desc: "Mark any badge, dynamic overlay or timestamp. WipeClip.co works across all corners, shapes and brand logos.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="22" y1="12" x2="18" y2="12" />
        <line x1="6" y1="12" x2="2" y2="12" />
        <line x1="12" y1="6" x2="12" y2="2" />
        <line x1="12" y1="22" x2="12" y2="18" />
      </svg>
    ),
  },
  {
    title: "Motion-Aware Inpainting",
    desc: "Reconstructs pixel vectors across temporal adjacent frames rather than blurring with static patches.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
        <line x1="7" y1="2" x2="7" y2="22" />
        <line x1="17" y1="2" x2="17" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <line x1="2" y1="7" x2="7" y2="7" />
        <line x1="2" y1="17" x2="7" y2="17" />
        <line x1="17" y1="17" x2="22" y2="17" />
        <line x1="17" y1="7" x2="22" y2="7" />
      </svg>
    ),
  },
  {
    title: "Fast GPU Neural Pipeline",
    desc: "Clips under a minute process in ~15 seconds end-to-end on our accelerated cluster.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    title: "100% Private by Design",
    desc: "Temporary memory-based processing. Files are automatically wiped immediately after download.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
];

export default function Features() {
  return (
    <section id="features" className="scroll-mt-28 py-24 relative overflow-hidden">
      {/* Background glow accent */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-accent/4 blur-[130px] pointer-events-none -z-10 dark:bg-accent/10" />

      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-cyan-50 border border-cyan-500/30 px-3.5 py-1 text-xs font-semibold text-cyan-600">
            Next-Gen Technology
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            Built to <span className="text-gradient">inpaint</span>, not blur or crop
          </h2>
          <p className="mt-4 text-muted text-base leading-relaxed">
            Legacy tools smudge or cut your video frame. WipeClip.co uses deep motion inpainting to recreate authentic background detail.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="glass-card-interactive rounded-[1.75rem] p-7 flex flex-col justify-between"
            >
              <div>
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-accent/30 to-accent-2/30 border border-cyan-400/30 text-cyan-600 shadow-[0_0_20px_rgba(34,211,238,0.2)]">
                  {f.icon}
                </div>
                <h3 className="font-display text-lg font-bold text-foreground tracking-tight">{f.title}</h3>
                <p className="mt-2.5 text-sm text-muted leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
