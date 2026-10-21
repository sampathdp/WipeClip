import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";
import WhatWipeClipDoes from "@/components/WhatWipeClipDoes";
import LimitationsSection from "@/components/LimitationsSection";
import PrivacyProcessing from "@/components/PrivacyProcessing";
import CtaBanner from "@/components/CtaBanner";
import { buildPageMetadata } from "@/lib/seo";
import { AI_CLEANUP_ENABLED } from "@/lib/features";

export const metadata: Metadata = buildPageMetadata(
  AI_CLEANUP_ENABLED
    ? {
        title: "About WipeClip - How AI Video Cleanup Works",
        description:
          "What WipeClip is: a desktop video editor for creators on Windows and Mac, with AI object removal for footage you shot yourself. How the reconstruction works, its limitations, and how your files are handled.",
        path: "/about",
      }
    : {
        title: "About WipeClip - Video Editor for Windows and Mac",
        description:
          "What WipeClip is: a desktop video editor and screen recorder for Windows and Mac, with auto captions and free photo tools, and how your files are handled.",
        path: "/about",
      }
);

const SECTIONS = AI_CLEANUP_ENABLED
  ? [
      { id: "what-it-does", label: "What it does" },
      { id: "limitations", label: "Limitations" },
      { id: "privacy", label: "Privacy" },
    ]
  : [{ id: "privacy", label: "Privacy" }];

const EDITOR_PRINCIPLES = [
  {
    title: "Edit on your desktop",
    desc: "A free app for Windows and Mac. Record, trim, cut, caption and export, and your projects stay on your computer.",
  },
  {
    title: "Your own content",
    desc: "Built for creators editing video and photos they made themselves or have the rights to edit.",
  },
  {
    title: "Nothing kept",
    desc: "Files uploaded for export or the photo tools are processed in temporary storage and deleted when the job finishes.",
  },
  {
    title: "Original quality",
    desc: "Exports keep your aspect ratio and frame rate, and nothing is upscaled.",
  },
];

const CLEANUP_PRINCIPLES = [
  {
    title: "Reconstruct, don't cover up",
    desc: "A blur box or crop hides a distraction. WipeClip rebuilds the pixels behind it from the surrounding frames.",
  },
  {
    title: "Your own footage only",
    desc: "Built for creators editing video they shot themselves. You confirm you own or have the rights to edit your footage before every job.",
  },
  {
    title: "Nothing kept",
    desc: "Files are processed in temporary storage and deleted when the job finishes. Editor projects stay on your computer.",
  },
  {
    title: "Honest about limits",
    desc: "Reconstruction is an estimate. We say plainly what works well and what doesn't.",
  },
];

const PRINCIPLES = AI_CLEANUP_ENABLED ? CLEANUP_PRINCIPLES : EDITOR_PRINCIPLES;

const STATS = [
  { value: "0", label: "files stored" },
  { value: "300MB", label: "per upload" },
  { value: "Full", label: "source resolution kept" },
  { value: "Win + Mac", label: "desktop app" },
];

export default function AboutPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden pt-36 pb-16 md:pt-44">
          <div
            aria-hidden
            className="animate-float-slow pointer-events-none absolute -top-40 left-1/4 -z-10 h-[520px] w-[820px] rounded-full bg-gradient-to-b from-accent/10 via-cyan-500/5 to-transparent blur-[130px] dark:from-accent/25 dark:via-cyan-500/15"
          />
          <div className="mx-auto max-w-5xl px-6 text-center">
            <Reveal>
              <div className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-surface-2/90 px-3.5 py-1 text-xs font-semibold text-cyan-600">
                About WipeClip
              </div>
              <h1 className="font-display text-4xl font-extrabold tracking-tight text-foreground text-balance sm:text-6xl">
                {AI_CLEANUP_ENABLED ? (
                  <>
                    Clean footage for creators, <span className="text-gradient">without the cover-up</span>
                  </>
                ) : (
                  <>
                    A video editor for creators, <span className="text-gradient">on Windows and Mac</span>
                  </>
                )}
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
                WipeClip is a desktop video editor for creators: trim, cut, add transitions, text, music and stickers,
                and export for any platform.{" "}
                {AI_CLEANUP_ENABLED
                  ? "Its AI object removal takes out distractions you didn't want in your own shots, like a passer-by, a stray cable or a lens smudge, by reconstructing what was behind them."
                  : "It also generates captions from speech and comes with free photo tools: a background remover, a photo sharpener and a video frame grabber."}
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                {AI_CLEANUP_ENABLED && (
                  <Link href="/#upload" className="btn-primary rounded-full px-6 py-3 text-sm font-semibold">
                    Remove an object free
                  </Link>
                )}
                <Link
                  href="/download"
                  className={`${AI_CLEANUP_ENABLED ? "btn-secondary" : "btn-primary"} rounded-full px-6 py-3 text-sm font-semibold`}
                >
                  Download the app
                </Link>
              </div>
            </Reveal>

            <div className="mt-14 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {STATS.map((s, i) => (
                <Reveal key={s.label} delay={i * 90} className="glass-card rounded-2xl px-4 py-5">
                  <div className="font-display text-3xl font-extrabold text-gradient">{s.value}</div>
                  <div className="mt-1 text-xs font-medium text-muted">{s.label}</div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Principles */}
        <section className="py-16">
          <div className="mx-auto max-w-6xl px-6">
            <Reveal className="text-center">
              <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">What we believe</h2>
            </Reveal>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {PRINCIPLES.map((p, i) => (
                <Reveal key={p.title} delay={i * 90} className="glass-card relative overflow-hidden rounded-[1.75rem] p-7">
                  <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent via-cyan-400 to-accent-2" />
                  <span className="font-mono text-sm font-bold text-cyan-600">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="mt-3 font-display text-lg font-bold tracking-tight text-foreground">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{p.desc}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Sticky in-page navigation */}
        <nav
          aria-label="On this page"
          className="sticky top-[68px] z-40 border-y border-border/70 bg-background/80 backdrop-blur-xl"
        >
          <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-6 py-3">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="shrink-0 rounded-full border border-border bg-surface-2/70 px-3.5 py-1.5 text-xs font-semibold text-muted transition hover:border-cyan-500/50 hover:text-foreground"
              >
                {s.label}
              </a>
            ))}
          </div>
        </nav>

        {/* Long-form sections, alternating bands */}
        {AI_CLEANUP_ENABLED && (
          <>
            <Reveal>
              <WhatWipeClipDoes />
            </Reveal>
            <div className="bg-surface-2/40">
              <Reveal>
                <LimitationsSection />
              </Reveal>
            </div>
          </>
        )}
        <Reveal>
          <PrivacyProcessing />
        </Reveal>

        <CtaBanner />
      </main>
      <Footer />
    </div>
  );
}
