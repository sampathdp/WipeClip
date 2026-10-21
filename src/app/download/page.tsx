import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";
import DownloadButtons from "@/components/DownloadButtons";
import { buildPageMetadata, SITE_URL } from "@/lib/seo";
import { AI_CLEANUP_ENABLED } from "@/lib/features";
import { DESKTOP_DOWNLOADS, DOWNLOAD_PATH } from "@/lib/download";

export const metadata: Metadata = buildPageMetadata({
  title: "Download WipeClip - Video Editor and Screen Recorder for Windows & Mac",
  description:
    "Download the free WipeClip desktop app for Windows and macOS: record your screen, trim, cut and rearrange clips, add transitions, text, stickers, music and auto captions, then export at your original quality.",
  path: DOWNLOAD_PATH,
  ogTitle: "WipeClip for Windows & Mac",
  ogDescription:
    "A fast desktop video editor with a built-in screen recorder, auto zooms and captions. Free to download.",
});

const features = [
  {
    title: "Record your screen",
    desc: "Capture the whole screen, a window or an area, with system audio, microphone and webcam. Recordings open straight in the editor.",
  },
  {
    title: "Automatic focus zooms",
    desc: "Zooms follow your clicks and typing, with click highlights and a smooth drawn cursor, so tutorials are easy to follow.",
  },
  {
    title: "Trim, split and rearrange",
    desc: "Cut dead air, delete the parts you don't want and drag clips into a new order. The rest joins up with no gaps or audio drift.",
  },
  {
    title: "Transitions, text and stickers",
    desc: "Fades, slides, zooms and blurs, plus titles, lower thirds, stickers and your own images. Drag, resize, rotate and animate them.",
  },
  {
    title: "Captions and chapters",
    desc: "Generate captions from speech on your own computer, edit them, and export subtitles. Add chapters, annotations and privacy masks.",
  },
  {
    title: "Music, filters and any aspect ratio",
    desc: "Add music and voice-over, apply filters and effects, and turn one video into landscape, vertical, square or portrait.",
  },
  ...(AI_CLEANUP_ENABLED
    ? [
        {
          title: "AI object removal on any clip",
          desc: "Mark an unwanted object on one clip and WipeClip rebuilds the pixels behind it, for just that part of the timeline.",
        },
      ]
    : []),
];

const steps = [
  { title: "Download", desc: "Get the installer for Windows or macOS. It's free and installs in under a minute." },
  { title: "Record or import", desc: "Record your screen or drop in an MP4, MOV or WebM you already have." },
  { title: "Edit", desc: "Trim, cut, add transitions, text, captions and music on the timeline." },
  { title: "Export", desc: "Save an MP4 at your original aspect ratio and frame rate, straight to your disk." },
];

const faqs = [
  {
    q: "Is the WipeClip app free?",
    a: "Yes. The app is free to download and edit with. Signing in unlocks full-resolution exports, which use credits like the rest of WipeClip. Free credits renew daily, and paid passes add premium effects and 4K.",
  },
  {
    q: "Which systems are supported?",
    a: DESKTOP_DOWNLOADS.map((d) => `${d.label}: ${d.requirements}.`).join(" "),
  },
  {
    q: "Is there still an online editor?",
    a: "No. The video editor now lives in the desktop app, alongside the screen recorder, focus zooms and local captions. The free photo tools on this site still run in your browser.",
  },
  {
    q: "Does editing change my original video?",
    a: "No. The editor keeps a list of your edits and only renders a new video when you export. Your original file is never modified.",
  },
  {
    q: "Is my video uploaded or stored?",
    a: `Recording and editing happen on your computer. Your video is uploaded only when you export${AI_CLEANUP_ENABLED ? " or run AI Cleanup" : ""}, is processed in temporary storage and isn't kept.`,
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "WipeClip",
      url: `${SITE_URL}${DOWNLOAD_PATH}`,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Windows 10, Windows 11, macOS 11+",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      description:
        "Desktop video editor and screen recorder: record your screen, trim, split and reorder clips, add text, music, captions, filters, transitions and stickers, and export at the original quality.",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
};

export default function DownloadPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="flex-1 pb-20">
        <section className="relative overflow-hidden pt-36 pb-12 md:pt-44">
          <div
            aria-hidden
            className="animate-float-slow pointer-events-none absolute -top-40 left-1/4 -z-10 h-[520px] w-[820px] rounded-full bg-gradient-to-b from-accent/10 via-cyan-500/5 to-transparent blur-[130px] dark:from-accent/25 dark:via-cyan-500/15"
          />
          <div className="mx-auto max-w-4xl px-6 text-center">
            <Reveal>
              <div className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-surface-2/90 px-3.5 py-1 text-xs font-semibold text-cyan-600">
                Free for Windows &amp; Mac
              </div>
              <h1 className="font-display text-4xl font-extrabold tracking-tight text-foreground text-balance sm:text-6xl">
                Record, edit and export <span className="text-gradient">on your desktop</span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
                WipeClip is a fast video editor with a built-in screen recorder. Capture your screen, cut it down, add
                zooms, captions, transitions and music, and export at your original quality.
              </p>
            </Reveal>
            <div className="mx-auto mt-10 max-w-2xl text-left">
              <DownloadButtons />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pt-12">
          <h2 className="text-center font-display text-3xl font-extrabold tracking-tight text-foreground">
            Everything you need to make a video
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="glass-card rounded-[1.5rem] p-6">
                <h3 className="font-display text-lg font-bold tracking-tight text-foreground">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pt-20">
          <h2 className="text-center font-display text-3xl font-extrabold tracking-tight text-foreground">
            How it works
          </h2>
          <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <li key={s.title} className="glass-card rounded-[1.5rem] p-6">
                <span className="font-mono text-2xl font-extrabold text-gradient-cyan">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-3 font-display text-lg font-bold text-foreground">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.desc}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-3xl px-6 pt-20">
          <h2 className="text-center font-display text-3xl font-extrabold tracking-tight text-foreground">
            Desktop app FAQ
          </h2>
          <div className="mt-10 space-y-4">
            {faqs.map((f) => (
              <details
                key={f.q}
                className="glass-card group rounded-2xl border border-border/80 p-6 transition-all duration-200 hover:border-cyan-500/30 open:border-cyan-500/40"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between text-base font-semibold text-foreground">
                  <span>{f.q}</span>
                  <span className="ml-4 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-3 text-cyan-600 transition-transform duration-300 group-open:rotate-45">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                </summary>
                <p className="mt-4 border-t border-border/50 pt-4 text-sm leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
          <p className="mt-8 text-center text-xs text-muted">
            For videos you own or have permission to edit. See our{" "}
            <Link href="/terms" className="underline hover:text-foreground">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline hover:text-foreground">
              Privacy Policy
            </Link>
            .
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
