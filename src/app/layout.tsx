import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import ReferralCapture from "@/components/ReferralCapture";
import { SITE_URL } from "@/lib/seo";
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
    default: "Online Video Editor for Creators | WipeClip.co",
    template: "%s | WipeClip.co",
  },
  description:
    "WipeClip is an online video editor for creators. Trim, cut, add transitions, text, stickers, filters and music in your browser, then export for YouTube, Shorts and Reels. Built-in AI tools remove unwanted objects, timestamps and captions from footage you own.",
  keywords: [
    "online video editor",
    "free video editor",
    "trim video online",
    "cut video online",
    "add transitions to video",
    "add text to video",
    "add stickers to video",
    "video filters online",
    "remove object from video",
    "AI video cleanup",
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
    title: "Online Video Editor for Creators | WipeClip.co",
    description:
      "Trim, cut, add transitions, text, stickers and filters in your browser. Free forever, with AI tools to clean up your footage.",
    locale: "en_US",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "WipeClip.co online video editor",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Online Video Editor for Creators | WipeClip.co",
    description:
      "Trim, cut, add transitions, text, stickers and filters in your browser. Free forever, with AI tools to clean up your footage.",
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
      url: siteUrl,
      logo: `${siteUrl}/logo.webp`,
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: siteUrl,
      name: "WipeClip.co",
      publisher: { "@id": `${siteUrl}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      name: "WipeClip.co",
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web",
      url: siteUrl,
      description:
        "AI video cleanup for creators: reconstructs the pixels behind a logo, badge, caption, timestamp or unwanted object across a whole clip, for footage you own or have rights to edit, plus a browser-based video editor for trimming, cutting, transitions and stickers.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
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
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        <ReferralCapture />
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
