import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import ReferralCapture from "@/components/ReferralCapture";
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

const siteUrl = "https://wipeclip.co";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "WipeClip.co — Video Watermark & Object Remover",
    template: "%s | WipeClip.co",
  },
  description:
    "WipeClip.co removes watermarks, logos, timestamps and unwanted objects from video you own or have rights to edit. Fast, private, no quality loss.",
  keywords: [
    "remove watermark from video",
    "video watermark remover",
    "remove logo from video",
    "video object remover",
    "video inpainting tool",
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
    title: "WipeClip.co — Video Watermark & Object Remover",
    description:
      "Remove watermarks, logos, timestamps and unwanted objects from video you own or have rights to edit. Fast, private, no quality loss.",
    locale: "en_US",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "WipeClip.co — video watermark & object remover",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "WipeClip.co — Video Watermark & Object Remover",
    description:
      "Remove watermarks, logos, timestamps and unwanted objects from video you own or have rights to edit.",
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
  themeColor: "#ffffff",
  colorScheme: "light dark",
};

const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"){document.documentElement.setAttribute("data-theme","dark");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#05060a");}}catch(e){}})();`;

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
        "Removes watermarks, logos, timestamps and unwanted objects from video you own or have rights to edit.",
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
