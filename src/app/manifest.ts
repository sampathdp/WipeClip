import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WipeClip.co: Online Video Editor for Creators",
    short_name: "WipeClip.co",
    description:
      "Online video editor for creators, with AI object removal for footage you shot yourself.",
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
