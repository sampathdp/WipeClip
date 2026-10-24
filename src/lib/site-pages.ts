import { AI_CLEANUP_ENABLED } from "./features";

/** Where a tool runs, shown as its badge so nobody expects a browser tool
 * to be a desktop feature or the other way round. */
export type ToolAvailability = "free" | "pro" | "desktop";

export type ToolEntry = {
  href: string;
  title: string;
  /** One sentence for cards and related-tool links. */
  desc: string;
  category: "video" | "image";
  availability: ToolAvailability;
  /** Guides that explain this tool's technique, by href. */
  guides?: string[];
};

export type GuideEntry = {
  href: string;
  title: string;
  description: string;
  published: string;
  updated: string;
  /** Tools the guide is about, by href. */
  tools: string[];
};

/** Every public tool page. The /tools directory, homepage cards and
 * related-tool links all read from here, so a tool only exists once. */
const ALL_TOOLS: ToolEntry[] = [
  {
    href: "/download",
    title: "Desktop Video Editor & Screen Recorder",
    desc: AI_CLEANUP_ENABLED
      ? "Record your screen, trim, split and reorder clips, add transitions, text and captions, and AI-clean any clip. Free for Windows and Mac."
      : "Record your screen, trim, split and reorder clips, add transitions, text and auto captions. Free for Windows and Mac.",
    category: "video",
    availability: "desktop",
    guides: ["/guides/how-ai-video-inpainting-works"],
  },
  {
    href: "/extract-video-frame",
    title: "Video Frame Grabber",
    desc: "Scrub to any moment and save it as a PNG, up to full resolution. Runs in your browser; nothing is uploaded.",
    category: "video",
    availability: "free",
  },
  {
    href: "/remove-background",
    title: "Background Remover",
    desc: "Upload a photo and get a transparent PNG back. No region to mark, no account needed to preview.",
    category: "image",
    availability: "free",
  },
  {
    href: "/sharpen-image",
    title: "Photo Sharpener",
    desc: "Restore crisp detail to a soft or slightly blurry photo with light, standard or strong strength.",
    category: "image",
    availability: "free",
  },
  {
    href: "/image-cleanup",
    title: "AI Image Cleanup",
    desc: "Mark an unwanted object on a photo you took and the area is rebuilt from its surroundings.",
    category: "image",
    availability: "pro",
    guides: ["/guides/how-ai-video-inpainting-works", "/guides/does-ai-cleanup-reduce-video-quality"],
  },
];

export const TOOLS: ToolEntry[] = AI_CLEANUP_ENABLED
  ? ALL_TOOLS
  : ALL_TOOLS.filter((t) => t.href !== "/image-cleanup").map((t) => ({ ...t, guides: undefined }));

/** Long-form guides. Both explain the AI cleanup feature, so they 404
 * (and drop out of every listing) while it is switched off. */
const ALL_GUIDES: GuideEntry[] = [
  {
    href: "/guides/how-ai-video-inpainting-works",
    title: "How AI Video Inpainting Works",
    description:
      "A plain-language explanation of how video inpainting fills in a marked region using nearby pixels and nearby frames, and where the approach runs into trouble.",
    published: "2026-08-25",
    updated: "2026-10-01",
    tools: ["/image-cleanup", "/download"],
  },
  {
    href: "/guides/does-ai-cleanup-reduce-video-quality",
    title: "Does AI Cleanup Reduce Video Quality?",
    description:
      "Resolution isn't the same as visual quality. A clear look at how resolution, bitrate, codec, re-encoding, and reconstructed pixels actually affect a video after removing an unwanted object.",
    published: "2026-08-25",
    updated: "2026-10-01",
    tools: ["/image-cleanup", "/download"],
  },
];

export const GUIDES: GuideEntry[] = AI_CLEANUP_ENABLED ? ALL_GUIDES : [];

export function getGuide(href: string): GuideEntry {
  const guide = ALL_GUIDES.find((g) => g.href === href);
  if (!guide) throw new Error(`Unknown guide ${href}`);
  return guide;
}

export const AVAILABILITY_LABEL: Record<ToolAvailability, string> = {
  free: "Free in browser",
  pro: "Pro, in browser",
  desktop: "Windows & Mac app",
};
