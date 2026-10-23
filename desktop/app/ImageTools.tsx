"use client";

import { useState } from "react";
import BackgroundRemoverDemo from "@/components/BackgroundRemoverDemo";
import PhotoSharpenerDemo from "@/components/PhotoSharpenerDemo";
import VideoFrameGrabberDemo from "@/components/VideoFrameGrabberDemo";

const TOOLS = [
  { id: "bg", label: "Remove background", Tool: BackgroundRemoverDemo },
  { id: "sharpen", label: "Sharpen photo", Tool: PhotoSharpenerDemo },
  { id: "frame", label: "Grab a video frame", Tool: VideoFrameGrabberDemo },
] as const;

/** The website's image tools inside the desktop app, over the editor
 * (which stays mounted, so an open project isn't lost). Same free daily
 * preview and credit rules as the website (src/lib/imageTool.ts); results
 * are saved through the Save dialog. */
export default function ImageTools({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<(typeof TOOLS)[number]["id"]>("bg");
  const { Tool } = TOOLS.find((t) => t.id === tab)!;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="Image tools">
      <header className="flex items-center gap-2 border-b border-border bg-surface/80 px-3 py-2 backdrop-blur sm:px-4">
        <h1 className="text-sm font-bold text-foreground">Image tools</h1>
        <nav className="ml-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Tool">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                tab === t.id ? "bg-accent-2/15 text-foreground ring-1 ring-accent-2/50" : "text-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <button type="button" onClick={onClose} className="btn-secondary ml-auto rounded-full px-4 py-1.5 text-xs font-semibold">
          Back to editor
        </button>
      </header>
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-4xl" key={tab}>
          <Tool />
        </div>
      </main>
    </div>
  );
}
