import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import ReferralCapture from "@/components/ReferralCapture";
import ServiceBanner from "@/components/ServiceBanner";
import InlineScript from "@/components/InlineScript";
import HtmlLang from "@/components/HtmlLang";
import ColorBloomPopup from "@/components/ColorBloomPopup";
import { SITE_URL, SUPPORT_EMAIL } from "@/lib/seo";
import { AI_CLEANUP_ENABLED } from "@/lib/features";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Video Editor & Screen Recorder for Windows and Mac | WipeClip.co",
    template: "%s | WipeClip.co",
  },
  // Kept under ~160 characters so search results show it whole.
  description:
    "Free video editor and screen recorder for Windows and Mac. Auto captions in 6 languages, voice translation to English, auto zooms and full-quality export.",
  keywords: [
    "video editor for windows",
    "video editor for mac",
    "free video editor",
    "screen recorder",
    "add transitions to video",
    "add text to video",
    "add stickers to video",
    "video filters online",
    ...(AI_CLEANUP_ENABLED ? ["remove object from video"] : ["add captions to video"]),
    "auto captions",
    "sinhala subtitles",
    "tamil subtitles",
    "hindi subtitles",
    "kannada subtitles",
    "telugu subtitles",
    "translate video to english",
    "ai voice translation",
    "wipeclip",
  ],
  authors: [{ name: "WipeClip.co" }],
  creator: "WipeClip.co",
  publisher: "WipeClip.co",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "WipeClip.co",
    title: "Video Editor & Screen Recorder for Windows and Mac | WipeClip.co",
    description:
      AI_CLEANUP_ENABLED
        ? "Record your screen, trim, cut, add transitions, text, stickers and filters on Windows and Mac. Free forever, with AI tools to clean up your footage."
        : "Record, trim, cut and caption on Windows and Mac. Free forever, with captions in 6 languages and voice translation to English in your own voice.",
    locale: "en_US",
    // Same English pages, offered to UK, Irish and EU visitors too.
    alternateLocale: ["en_GB", "en_IE", "en_DE", "en_FR", "en_NL"],
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "WipeClip.co video editor for Windows and Mac",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Video Editor & Screen Recorder for Windows and Mac | WipeClip.co",
    description:
      AI_CLEANUP_ENABLED
        ? "Record your screen, trim, cut, add transitions, text, stickers and filters on Windows and Mac. Free forever, with AI tools to clean up your footage."
        : "Record, trim, cut and caption on Windows and Mac. Free forever, with captions in 6 languages and voice translation to English in your own voice.",
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-icon.png",
    shortcut: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#05060a",
  colorScheme: "light dark",
};

const themeInitScript = `(function(){document.documentElement.classList.add("js-reveal");try{var t=localStorage.getItem("theme");if(t!=="light"){document.documentElement.setAttribute("data-theme","dark");}else{var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#ffffff");}}catch(e){}})();`;

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "WipeClip.co",
      alternateName: "WipeClip",
      legalName: "Codeplay Studios",
      url: siteUrl,
      logo: `${siteUrl}/logo.webp`,
      email: SUPPORT_EMAIL,
      address: { "@type": "PostalAddress", addressCountry: "LK" },
      areaServed: ["Europe", "United Kingdom", "North America", "Asia", "Oceania"],
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: SUPPORT_EMAIL,
        availableLanguage: ["English"],
      },
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: siteUrl,
      name: "WipeClip.co",
      publisher: { "@id": `${siteUrl}/#organization` },
    },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${inter.variable} ${jakarta.variable}`}
      suppressHydrationWarning
    >
      <head>
        <InlineScript html={themeInitScript} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        <HtmlLang />
        <ServiceBanner />
        <ReferralCapture />
        {children}
        <ColorBloomPopup />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
