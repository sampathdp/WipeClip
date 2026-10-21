import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import VideoFrameGrabberDemo from "@/components/VideoFrameGrabberDemo";
import ToolGuide from "@/components/ToolGuide";
import { buildPageMetadata, faqJsonLd, jsonLdString } from "@/lib/seo";
import { AI_CLEANUP_ENABLED } from "@/lib/features";

const title = "Extract a Frame From Video - Free Screenshot Tool";
const description =
  "Grab any frame from a video as a PNG screenshot or thumbnail. Runs entirely in your browser: no upload, no account, no limit on how many frames you capture.";

export const metadata: Metadata = buildPageMetadata({
  title,
  description,
  path: "/extract-video-frame",
});

const faqs = [
  {
    q: "Does this upload my video anywhere?",
    a: "No. The video is decoded and drawn to a canvas entirely inside your browser tab using standard HTML5 video/canvas APIs. It's never sent to WipeClip.co's servers, so there's no upload wait. Videos up to 500MB in a format your browser can play (usually MP4 or WebM) work.",
  },
  {
    q: "Is there a limit on how many frames I can grab?",
    a: "No. Capture as many frames from the same video as you want, each one's a fresh canvas export, at no cost to you or to us.",
  },
  {
    q: "What resolution is the exported frame?",
    a: "The video's native resolution. The canvas is sized to the video's actual width and height before export, so you get a full-resolution PNG, not a scaled-down thumbnail.",
  },
  AI_CLEANUP_ENABLED
    ? {
        q: "Why would I need WipeClip.co's paid tool instead?",
        a: "This tool answers a different question - grabbing a clean still frame. If your own footage has an unwanted object you need removed from the whole clip, that's WipeClip.co's AI object removal tool, free to try.",
      }
    : {
        q: "What if I need to edit the whole clip?",
        a: "This tool grabs a single still frame. To trim, cut, caption or rearrange the whole clip, use WipeClip.co's free video editor for Windows and Mac.",
      },
];

export default function Page() {
  const jsonLd = { "@context": "https://schema.org", ...faqJsonLd(faqs) };

  return (
    <div className="flex flex-1 flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }}
      />
      <Navbar />
      <main className="flex-1">
        <section className="relative overflow-hidden pt-36 pb-16 md:pt-48">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-48 left-1/3 h-[650px] w-[950px] rounded-full bg-gradient-to-b from-accent/6 via-cyan-500/4 to-transparent blur-[140px] -z-10 dark:from-accent/25 dark:via-cyan-500/15"
          />
          <div className="mx-auto max-w-3xl px-6 text-center">
            <div className="mb-6 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-cyan-500/30 px-3.5 py-1 text-xs font-semibold text-cyan-600">
              Free Tool &bull; No Upload
            </div>
            <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl text-foreground text-balance">
              Extract a <span className="text-gradient">frame</span> from any video
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              Scrub to the moment you want and capture it as a full-resolution PNG. Runs entirely
              in your browser. Your video is never uploaded.
            </p>
          </div>
        </section>

        <section className="pb-24">
          <div className="px-6">
            <VideoFrameGrabberDemo />
          </div>
        </section>

        <ToolGuide
          title="How to save a frame from a video"
          steps={[
            "Open a video your browser can play (MP4 or WebM, up to 500MB). It stays on your device.",
            "Scrub to the moment you want, or pick one of the suggested cover frames WipeClip finds by scanning the video.",
            "Capture the frame. Grab as many as you like.",
            "Download each frame as a full-resolution PNG, ready for a thumbnail, slide or post.",
          ]}
          facts={[
            { label: "Output", value: "PNG at the video's own resolution" },
            { label: "Max video size", value: "500MB" },
            { label: "Upload", value: "None, runs in your browser" },
            { label: "Account", value: "Not needed" },
            { label: "Price", value: "Free, no frame limit" },
          ]}
        />

        <section className="py-16">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="text-center font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
              Frame extraction: FAQ
            </h2>
            <div className="mt-10 space-y-4">
              {faqs.map((f) => (
                <details
                  key={f.q}
                  className="glass-card group rounded-2xl p-6 transition-all duration-200 border border-border/80 hover:border-cyan-500/30 open:border-cyan-500/40"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-base text-foreground">
                    <span>{f.q}</span>
                    <span className="ml-4 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 border border-border text-cyan-600 transition-transform duration-300 group-open:rotate-45">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </span>
                  </summary>
                  <p className="mt-4 text-sm text-muted leading-relaxed border-t border-border/50 pt-4">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
