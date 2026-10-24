import type { Metadata } from "next";
import { PLANS } from "./credits";
import { languageAlternates, LOCALE_INFO, type Locale } from "./i18n";

export const SITE_URL = "https://www.wipeclip.co";
export const SITE_NAME = "WipeClip.co";
export const SUPPORT_EMAIL = "support@wipeclip.co";

/** The desktop app's schema.org node. One @id everywhere it appears (home,
 * download), so search engines and AI answer engines read one product. */
export function softwareAppJsonLd(extra: Record<string, unknown> = {}) {
  const paid = Object.values(PLANS).map((p) => p.usdCents / 100);
  return {
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#app`,
    name: "WipeClip",
    url: `${SITE_URL}/download`,
    downloadUrl: `${SITE_URL}/download`,
    applicationCategory: "MultimediaApplication",
    applicationSubCategory: "Video editor and screen recorder",
    operatingSystem: "Windows 10, Windows 11, macOS 11+",
    isAccessibleForFree: true,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      lowPrice: "0",
      highPrice: Math.max(...paid).toFixed(2),
      offerCount: paid.length + 1,
      url: `${SITE_URL}/pricing`,
    },
    publisher: { "@id": `${SITE_URL}/#organization` },
    ...extra,
  };
}

/** A browser tool page's schema.org node. `free` adds a $0 offer, true of
 * the free daily result on the photo and frame tools. */
export function webApplicationJsonLd({
  name,
  path,
  description,
  free,
}: {
  name: string;
  path: string;
  description: string;
  free: boolean;
}) {
  return {
    "@type": "WebApplication",
    "@id": `${SITE_URL}${path}#app`,
    name,
    url: `${SITE_URL}${path}`,
    description,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any (web browser)",
    isAccessibleForFree: free,
    ...(free ? { offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } } : {}),
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

/** FAQPage JSON-LD from the same question list the page shows. */
export function faqJsonLd(faqs: { q: string; a: string }[]) {
  return {
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/** Serialises JSON-LD for a <script> tag, escaping "<" so content can't
 * close the tag early. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

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
  locale,
}: {
  title: string;
  description: string;
  path: string;
  ogTitle?: string;
  ogDescription?: string;
  /** Set on translated pages; English when omitted. */
  locale?: Locale;
}): Metadata {
  const socialTitle = ogTitle ?? title;
  const socialDescription = ogDescription ?? description;

  return {
    title,
    description,
    alternates: { canonical: path, languages: languageAlternates(path) },
    openGraph: {
      type: "website",
      url: path,
      siteName: SITE_NAME,
      title: socialTitle,
      description: socialDescription,
      locale: locale ? LOCALE_INFO[locale].ogLocale : "en_US",
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
