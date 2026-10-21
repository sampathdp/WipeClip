import Reveal from "./Reveal";
import DownloadButtons from "./DownloadButtons";
import { AI_CLEANUP_ENABLED } from "@/lib/features";

const highlights = [
  "Record screen, audio and webcam",
  "Automatic zooms on clicks",
  "Trim, split and reorder clips",
  "Transitions, text and stickers",
  "Auto captions from speech",
  AI_CLEANUP_ENABLED ? "AI Cleanup on just one clip" : "Export at original quality",
];

// Illustrative timeline: three clips, two transitions, one sticker bar.
const CLIPS = [
  { w: "28%", from: "from-accent/70", to: "to-accent/40" },
  { w: "40%", from: "from-cyan-500/70", to: "to-cyan-500/40" },
  { w: "26%", from: "from-fuchsia-500/60", to: "to-fuchsia-500/30" },
];

/** Homepage section promoting the Windows and macOS app (/download). */
export default function DesktopPromo() {
  return (
    <section id="download" className="scroll-mt-28 py-24 relative">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="glass-card grid gap-10 rounded-[2rem] p-8 sm:p-12 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-50 px-3.5 py-1 text-xs font-semibold text-cyan-600 dark:bg-cyan-500/10">
              Free for Windows &amp; Mac
            </div>
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              Record it, then <span className="text-gradient">finish the edit</span>
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted">
              The WipeClip desktop app puts a screen recorder and a lightweight video editor in one place. Capture your
              screen, cut it down, add zooms, captions, transitions and stickers, and export at your original aspect
              ratio and frame rate.
            </p>
            <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
              {highlights.map((h) => (
                <li key={h} className="flex items-start gap-2 text-sm text-foreground">
                  <span className="mt-0.5 font-bold text-cyan-600">✓</span>
                  {h}
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <DownloadButtons compact />
            </div>
          </div>

          <div aria-hidden className="rounded-[1.5rem] border border-border bg-surface-2/70 p-5">
            <div className="aspect-video rounded-xl bg-gradient-to-br from-slate-800 via-slate-900 to-black ring-1 ring-border">
              <div className="flex h-full items-start justify-end p-4">
                <span className="rotate-6 rounded-lg border-2 border-white bg-rose-500 px-3 py-1 font-display text-sm font-black text-white shadow-lg">
                  SUBSCRIBE
                </span>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 font-mono text-[10px] text-muted">
              <span className="h-3 w-3 rounded-full bg-accent" />
              0:12.4 / 0:48.0
            </div>
            <div className="relative mt-3 flex h-12 gap-1">
              {CLIPS.map((c, i) => (
                <div key={i} className={`h-full rounded-md bg-gradient-to-b ${c.from} ${c.to} ring-1 ring-white/10`} style={{ width: c.w }} />
              ))}
              {["28%", "68.5%"].map((left) => (
                <span
                  key={left}
                  className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-sm border-2 border-white bg-accent"
                  style={{ left }}
                />
              ))}
              <span className="absolute -top-2 bottom-[-44px] w-0.5 bg-rose-500" style={{ left: "38%" }} />
            </div>
            <div className="mt-2 h-6">
              <div className="ml-[45%] h-full w-[22%] rounded-md border border-accent/50 bg-accent/25" />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
