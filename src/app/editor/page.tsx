import type { Metadata } from "next";
import EditorLanding from "@/components/editor/EditorLanding";
import VideoEditor from "@/components/editor/VideoEditor";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Online Video Editor - Trim, Cut, Transitions & Stickers",
  description:
    "Free online video editor in your browser: trim, split and cut out sections, reorder clips, add transitions and stickers, and remove logos or captions with AI Cleanup. Exports keep your original quality.",
  path: "/editor",
  ogTitle: "WipeClip Online Video Editor",
  ogDescription:
    "Trim, cut, rearrange, add transitions and stickers, and clean up overlays with AI. Right in your browser, at your original quality.",
});

export default function EditorPage() {
  return (
    <VideoEditor>
      <EditorLanding />
    </VideoEditor>
  );
}
