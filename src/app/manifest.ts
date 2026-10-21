import type { MetadataRoute } from "next";
import { AI_CLEANUP_ENABLED } from "@/lib/features";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WipeClip.co: Video Editor for Windows and Mac",
    short_name: "WipeClip.co",
    description: AI_CLEANUP_ENABLED
      ? "Video editor and screen recorder for Windows and Mac, with AI object removal for footage you shot yourself."
      : "Video editor and screen recorder for Windows and Mac, with AI auto captions.",
    start_url: "/",
    display: "standalone",
    background_color: "#05060a",
    theme_color: "#05060a",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/icon-512.webp",
        sizes: "512x512",
        type: "image/webp",
      },
    ],
  };
}
