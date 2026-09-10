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
    default: "AI Video Cleanup for Creators | WipeClip.co",
    template: "%s | WipeClip.co",
  },
  description:
    "WipeClip is an AI video cleanup tool for creators. Mark a logo, badge, caption, or timestamp on one frame and it reconstructs the pixels underneath across the whole clip — no cropping, no blur box. For footage you own or have the rights to edit.",
  keywords: [
    "AI video cleanup",
    "AI footage restoration",
    "remove logo from video",
    "remove object from video",
    "AI video inpainting",
    "video overlay remover",
    "restore original footage",
    "video watermark remover",
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
    title: "AI Video Cleanup for Creators | WipeClip.co",
    description:
      "Mark a logo, badge, caption, or timestamp and WipeClip reconstructs the pixels underneath across the whole clip. No crop, no blur box.",
    locale: "en_US",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "WipeClip.co AI video cleanup and object removal",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Video Cleanup for Creators | WipeClip.co",
    description:
      "Mark a logo, badge, caption, or timestamp and WipeClip reconstructs the pixels underneath across the whole clip. No crop, no blur box.",
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

const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"){document.documentElement.setAttribute("data-theme","dark");}else{var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#ffffff");}}catch(e){}})();`;

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
        "AI video cleanup for creators: reconstructs the pixels behind a logo, badge, caption, timestamp or unwanted object across a whole clip, for footage you own or have rights to edit.",
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
