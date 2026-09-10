import Link from "next/link";

const tools = [
  {
    href: "/remove-background",
    badge: "Free",
    title: "Background Remover",
    desc: "Upload a photo, get a transparent PNG back. No region to mark, no account needed to preview.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a5 5 0 0 1 5 5c0 2-1 3.5-2.5 5L12 15l-2.5-3C8 10.5 7 9 7 7a5 5 0 0 1 5-5Z" />
        <path d="M5 21c0-3 3-5 7-5s7 2 7 5" />
      </svg>
    ),
  },
  {
    href: "/extract-video-frame",
    badge: "Free",
    title: "Video Frame Grabber",
    desc: "Scrub to any moment, capture it as a full-resolution PNG. 100% in your browser. Nothing is uploaded.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    ),
  },
  {
    href: "/sharpen-image",
    badge: "Free",
    title: "Photo Sharpener",
    desc: "Restore crisp detail to a soft or slightly blurry photo. Pick light, standard, or strong strength.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 2 7l10 5 10-5-10-5Z" />
        <path d="m2 17 10 5 10-5M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    href: "/remove-image-watermark",
    badge: "Pro",
    title: "Image Watermark Cleanup",
    desc: "Mark a logo, badge, or watermark region on an image you own, once. Same reconstruction engine as the video tool.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-5-5L5 21" />
      </svg>
    ),
  },
];

export default function FreeTools() {
  return (
    <section id="tools" className="scroll-mt-28 py-24 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-accent-2/4 blur-[130px] pointer-events-none -z-10 dark:bg-accent-2/10"
      />

      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-cyan-50 border border-cyan-500/30 px-3.5 py-1 text-xs font-semibold text-cyan-600">
            The Full Toolkit
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            More than <span className="text-gradient">video cleanup</span>
          </h2>
          <p className="mt-4 text-muted text-base leading-relaxed">
            Everything else you need for the same footage and photos, three of them free, no
            account required to try.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {tools.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="glass-card-interactive group rounded-[1.75rem] p-7 flex flex-col justify-between"
            >
              <div>
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-accent/30 to-accent-2/30 border border-cyan-400/30 text-cyan-600 shadow-[0_0_20px_rgba(34,211,238,0.2)]">
                    {t.icon}
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                      t.badge === "Free"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                        : "border-accent/30 bg-accent/10 text-accent"
                    }`}
                  >
                    {t.badge}
                  </span>
                </div>
                <h3 className="font-display text-lg font-bold text-foreground tracking-tight">{t.title}</h3>
                <p className="mt-2.5 text-sm text-muted leading-relaxed">{t.desc}</p>
              </div>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-600 transition-transform group-hover:translate-x-1">
                Try it
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
