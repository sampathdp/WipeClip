import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import DesktopShell from "./DesktopShell";
import "./desktop.css";

// Same fonts as the website; next/font downloads them at build time and
// bundles them, so the app never fetches fonts at runtime.
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

export const metadata: Metadata = {
  title: "WipeClip",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#05060a",
  colorScheme: "light dark",
};

// Same theme bootstrap as src/app/layout.tsx, so there's no light/dark flash.
const themeInitScript = `(function(){document.documentElement.classList.add("js-reveal");try{var t=localStorage.getItem("theme");if(t!=="light"){document.documentElement.setAttribute("data-theme","dark");}}catch(e){}})();`;

export default function DesktopLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable} ${jakarta.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        <DesktopShell>{children}</DesktopShell>
      </body>
    </html>
  );
}
