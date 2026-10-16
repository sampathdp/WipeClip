import Link from "next/link";
import { SITE_URL } from "@/lib/seo";
import { AI_CLEANUP_ENABLED } from "@/lib/features";

/** Indexable content for /editor. The editor itself is a client app with
 * almost no text, so this server-rendered section is what search engines
 * (and first-time visitors) read. VideoEditor only shows it before a video
 * is loaded, so it never gets in the way of editing.
 */

const features = [
  {
    title: "Trim the start and end",
    desc: "Drag a clip's edges to cut dead air off the beginning or end. Timestamps show while you drag, and you can type exact times too.",
  },
  {
    title: "Split and cut out sections",
    desc: "Split at the playhead, delete the part you don't want, and the rest joins up automatically, with no black frames, frozen frames or audio gaps.",
  },
  {
    title: "Rearrange clips",
    desc: "Drag clips along the timeline to change their order. The preview and the export both follow the new order.",
  },
  {
    title: "Real transitions",
    desc: "Fade, crossfade, dip to black or white, slide, zoom and blur, from 0.2 to 2 seconds. They're rendered into the exported video, not just shown in the preview.",
  },
  {
    title: "Text, stickers and images",
    desc: "Titles, captions and lower thirds with your own fonts, colors, outline and background, plus stickers and your own images. Drag, resize, rotate, layer and animate them.",
  },
  {
    title: "Music and audio",
    desc: "Add music or voice-over tracks, extract a clip's audio, then trim, move, fade and set the volume of each. Everything is mixed into the export without clipping.",
  },
  {
    title: "Filters, adjustments and effects",
    desc: "Cinematic, vintage, black & white and more, plus brightness, contrast, temperature and other sliders, and timed effects like VHS, glitch, shake and zoom.",
  },
  {
    title: "Any aspect ratio",
    desc: "Turn one video into 16:9, 9:16 for Shorts, TikTok and Reels, 1:1 or 4:5, with fit or fill and a color, gradient, blurred or image background.",
  },
  ...(AI_CLEANUP_ENABLED
    ? [
        {
          title: "AI object removal on any clip",
          desc: "Mark an unwanted object, like a passer-by or a stray cable, on one clip and WipeClip's reconstruction engine rebuilds the pixels behind it, for just that part of the timeline.",
        },
      ]
    : []),
];

const steps = [
  { title: "Upload", desc: "Drop in an MP4, MOV or WebM up to 300MB and 10 minutes long." },
  { title: "Edit", desc: "Trim, split, delete, reorder, add transitions and stickers on the timeline." },
  { title: "Preview", desc: "Play the whole edit back with transitions and stickers, synced to the audio." },
  { title: "Export", desc: "Render a normal MP4 at your original aspect ratio and frame rate, then download it." },
];

const faqs = [
  {
    q: "Is the WipeClip video editor free?",
    a: "You can edit and export a 720p preview without an account. Signing in unlocks full-resolution exports and downloads, which use credits like the rest of WipeClip. Free credits renew daily.",
  },
  {
    q: "Does editing change my original video?",
    a: "No. The editor never modifies your file. It keeps a list of your edits (which parts play, in what order, with which transitions and stickers) and only renders a new video when you export.",
  },
  {
    q: "Will cutting out a section leave a gap or put the audio out of sync?",
    a: "No. Removed sections are left out of the render entirely and the remaining clips are joined frame-accurately, with the audio cut at exactly the same points, so there are no blank frames and no drift.",
  },
  {
    q: "Does exporting reduce quality?",
    a: "WipeClip keeps your original aspect ratio (16:9, 9:16, 1:1 and others) and frame rate, never upscales, and encodes at a visually near-lossless quality setting. You choose the maximum resolution when you export.",
  },
  ...(AI_CLEANUP_ENABLED
    ? [
        {
          q: "Can I remove an object from just part of my video?",
          a: "Yes. Select a clip on the timeline and use AI Cleanup. Only that clip is processed, and the cleaned result replaces it in your project. Undo brings the original back.",
        },
      ]
    : []),
  {
    q: "Is my video uploaded or stored?",
    a: `Editing happens in your browser. Your video is uploaded only to check it, and when you export${AI_CLEANUP_ENABLED ? " or run AI Cleanup" : ""}. It's processed in temporary storage and isn't kept. Your project is saved in your own browser so you can pick up where you left off.`,
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "WipeClip Video Editor",
      url: `${SITE_URL}/editor`,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web",
      browserRequirements: "Requires a modern browser with HTML5 video support",
      description:
        AI_CLEANUP_ENABLED
          ? "Browser-based video editor: trim, split and reorder clips, add text, music, filters, effects, transitions, stickers and images, resize for any platform, and remove unwanted objects from a clip with AI."
          : "Browser-based video editor: trim, split and reorder clips, add text, music, filters, effects, transitions, stickers and images, and resize for any platform.",
      featureList: [
        "Trim video",
        "Split and cut video",
        "Remove sections from the middle of a video",
        "Reorder clips",
        "Transitions: fade, crossfade, dip to black, dip to white, slide, zoom, blur",
        "Text layers with fonts, colors, outline, background and animations",
        "Stickers and image overlays with position, size, rotation, opacity, timing and layer order",
        "Music and audio tracks with volume, fades and audio extraction",
        "Filters, color adjustments and timed effects",
        "Canvas presets for YouTube, Shorts, TikTok, Reels and Instagram",
        ...(AI_CLEANUP_ENABLED ? ["AI removal of unwanted objects on a selected clip"] : []),
        "Export MP4 at the original aspect ratio and frame rate",
      ],
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

export default function EditorLanding() {
  return (
    <div className="pb-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      <section className="mx-auto max-w-5xl px-6 pt-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Everything you need to <span className="text-gradient">edit a clip</span>
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted">
            A lightweight online video editor that runs in your browser. No install, no complicated pro timeline,
            and the export contains every edit you see in the preview.
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
        {AI_CLEANUP_ENABLED && (
          <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted">
            Only need an object gone from the whole video? The{" "}
            <Link href="/#upload" className="underline hover:text-foreground">
              one-step AI object removal tool
            </Link>{" "}
            is quicker. Read{" "}
            <Link href="/guides/how-ai-video-inpainting-works" className="underline hover:text-foreground">
              how the reconstruction works
            </Link>
            .
          </p>
        )}
      </section>

      <section className="mx-auto max-w-3xl px-6 pt-20">
        <h2 className="text-center font-display text-3xl font-extrabold tracking-tight text-foreground">
          Video editor FAQ
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
    </div>
  );
}
