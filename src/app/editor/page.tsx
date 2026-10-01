import type { Metadata } from "next";
import VideoEditor from "@/components/editor/VideoEditor";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Online Video Editor - Trim, Cut, Transitions & Stickers",
  description:
    "Edit video in your browser: trim, split and cut out sections, reorder clips, add transitions and stickers, and remove overlays with WipeClip's AI Cleanup. Exports keep your original quality.",
  path: "/editor",
});

export default function EditorPage() {
  return <VideoEditor />;
}
