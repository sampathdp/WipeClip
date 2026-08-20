import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ImageEditorDemo from "@/components/ImageEditorDemo";

export const metadata: Metadata = {
  title: "Remove Image Watermark — Pro Tool | WipeClip.co",
  description:
    "Mark a watermark or logo region on any image once, and WipeClip.co reconstructs the pixels beneath it. A Pro-plan tool, same motion-free inpainting as the video tool.",
  alternates: { canonical: "/remove-image-watermark" },
};

export default function Page() {
  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <main className="flex-1">
        <section className="relative overflow-hidden pt-36 pb-16 md:pt-48">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-48 left-1/3 h-[650px] w-[950px] rounded-full bg-gradient-to-b from-accent/25 via-cyan-500/15 to-transparent blur-[140px] -z-10"
          />
          <div className="mx-auto max-w-3xl px-6 text-center">
            <div className="mb-6 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-cyan-500/30 px-3.5 py-1 text-xs font-semibold text-cyan-300">
              Pro Tool
            </div>
            <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl text-foreground text-balance">
              Remove a <span className="text-gradient">watermark from an image</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              Mark the badge or logo once and WipeClip.co reconstructs the pixels beneath it —
              same reconstruction engine as the video tool, applied to a single frame.
            </p>
          </div>
        </section>

        <section className="pb-24">
          <div className="px-6">
            <ImageEditorDemo />
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
