import Link from "next/link";
import Reveal from "./Reveal";

const tiles = [
  {
    title: "Reconstruction, not a blur box",
    desc: "The marked area is rebuilt from the pixels and motion around it, so there's no smudge, crop or solid patch.",
    span: "lg:col-span-2",
    icon: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />,
    accent: true,
  },
  {
    title: "Original quality",
    desc: "Resolution, frame rate and audio stay as they were. Nothing is upscaled.",
    span: "",
    icon: <path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M9 12l2 2 4-4" />,
  },
  {
    title: "Zero files stored",
    desc: "Videos are processed in temporary storage and deleted as soon as your result is ready.",
    span: "",
    icon: <path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z" />,
  },
  {
    title: "Static or moving objects",
    desc: "A passer-by, a stray cable, a boom mic or a lens smudge, whether it stays put or moves across the clip.",
    span: "lg:col-span-2",
    icon: <path d="M5 12h14M12 5l7 7-7 7" />,
  },
  {
    title: "Edit it all on your desktop",
    desc: "Trim, cut, reorder, add transitions and stickers, then AI-clean just the clips that need it.",
    span: "lg:col-span-2",
    icon: (
      <>
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
      </>
    ),
    href: "/download",
  },
];

/** Homepage summary of what makes WipeClip different. The long-form detail
 * (comparisons, limitations, evidence) lives on /about.
 */
export default function WhyWipeClip() {
  return (
    <section id="why" className="scroll-mt-28 py-24 relative">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border px-3.5 py-1 text-xs font-semibold text-muted">
            Why WipeClip
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            Clean footage, <span className="text-gradient">nothing lost</span>
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((t, i) => {
            const body = (
              <>
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-xl border ${
                    t.accent ? "border-white/30 bg-white/15 text-white" : "border-cyan-400/30 bg-gradient-to-tr from-accent/20 to-accent-2/20 text-cyan-500"
                  }`}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {t.icon}
                  </svg>
                </div>
                <h3 className={`mt-5 font-display text-lg font-bold tracking-tight ${t.accent ? "text-white" : "text-foreground"}`}>{t.title}</h3>
                <p className={`mt-2 text-sm leading-relaxed ${t.accent ? "text-white/80" : "text-muted"}`}>{t.desc}</p>
                {t.href && <span className="mt-4 inline-block text-sm font-semibold text-cyan-600">Open the editor →</span>}
              </>
            );
            const cls = `group relative h-full overflow-hidden rounded-[1.75rem] p-7 transition-transform duration-300 hover:-translate-y-1 ${
              t.accent
                ? "bg-gradient-to-br from-accent via-indigo-500 to-cyan-500 shadow-[0_20px_50px_-15px_rgba(124,92,255,0.6)]"
                : "glass-card"
            }`;
            return (
              <Reveal key={t.title} delay={i * 80} className={t.span}>
                {t.href ? (
                  <Link href={t.href} className={`${cls} block border-glow`}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </Reveal>
            );
          })}
        </div>

        <Reveal className="mt-10 text-center">
          <Link href="/about" className="inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-600 hover:underline">
            How it works, compared with blur and crop, and its limits →
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
