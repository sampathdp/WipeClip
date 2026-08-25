import type { Metadata } from "next";

export const SITE_URL = "https://www.wipeclip.co";
export const SITE_NAME = "WipeClip.co";

const OG_IMAGE = "/opengraph-image";

/**
 * Builds a consistent title/description/canonical/OpenGraph/Twitter metadata
 * object for a public page. `path` must be root-relative (e.g. "/pricing")
 * and is resolved against the root layout's `metadataBase` (SITE_URL). It
 * must never be a vercel.app, preview, or localhost URL.
 */
export function buildPageMetadata({
  title,
  description,
  path,
  ogTitle,
  ogDescription,
}: {
  title: string;
  description: string;
  path: string;
  ogTitle?: string;
  ogDescription?: string;
}): Metadata {
  const socialTitle = ogTitle ?? title;
  const socialDescription = ogDescription ?? description;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: path,
      siteName: SITE_NAME,
      title: socialTitle,
      description: socialDescription,
      locale: "en_US",
      images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: socialTitle }],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: socialDescription,
      images: [OG_IMAGE],
    },
  };
}
