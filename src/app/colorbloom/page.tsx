import type { Metadata } from "next";
import Image from "next/image";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Breadcrumbs from "@/components/Breadcrumbs";
import { buildPageMetadata, jsonLdString, SITE_URL } from "@/lib/seo";
import {
  COLORBLOOM_FEATURES,
  COLORBLOOM_IMAGES,
  COLORBLOOM_PATH,
  COLORBLOOM_SCREENS,
  COLORBLOOM_STORE_URL,
} from "@/lib/colorbloom";

const title = "ColorBloom: Mindful Coloring App for Android";
const description =
  "ColorBloom by Codeplay Studios, the makers of WipeClip, is a free mindful coloring app for Android. Color mandalas, draw symmetry art and save HD wallpapers.";

export const metadata: Metadata = buildPageMetadata({ title, description, path: COLORBLOOM_PATH });

function StoreButton({ className = "" }: { className?: string }) {
  return (
    <a
      href={COLORBLOOM_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-3 rounded-full bg-gradient-to-r from-pink-500 to-violet-500 px-6 py-3.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(236,72,153,0.7)] transition hover:opacity-95 ${className}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
      </svg>
      Get it free for Android
    </a>
  );
}

/** Landing page for ColorBloom, the studio's coloring app. English only. */
export default function ColorBloomPage() {
  const pageUrl = `${SITE_URL}${COLORBLOOM_PATH}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MobileApplication",
    name: "ColorBloom",
    operatingSystem: "Android",
    applicationCategory: "LifestyleApplication",
    url: pageUrl,
    downloadUrl: COLORBLOOM_STORE_URL,
    installUrl: COLORBLOOM_STORE_URL,
    image: `${SITE_URL}${COLORBLOOM_IMAGES.icon}`,
    screenshot: COLORBLOOM_SCREENS.map((s) => `${SITE_URL}${s.src}`),
    description:
      "A mindful coloring and art app with curated mandalas, a symmetry drawing studio, timelapse replays and HD wallpaper export.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    author: { "@id": `${SITE_URL}/#organization` },
  };

  return (
    <div className="flex flex-1 flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      <Navbar />
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "ColorBloom" }]} />
      <main className="flex-1">
        <section className="relative overflow-hidden pt-8 pb-12">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-48 left-1/4 -z-10 h-[650px] w-[950px] rounded-full bg-gradient-to-b from-pink-500/10 via-violet-500/5 to-transparent blur-[140px] dark:from-pink-500/25 dark:via-violet-500/15"
          />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
            <div>
              <div className="mb-6 flex items-center gap-3">
                <Image src={COLORBLOOM_IMAGES.icon} alt="ColorBloom app icon" width={64} height={64} className="rounded-2xl shadow-lg" priority />
                <span className="rounded-full border border-pink-400/40 bg-pink-500/10 px-3.5 py-1 text-xs font-semibold text-pink-600 dark:text-pink-300">
                  New from Codeplay Studios
                </span>
              </div>
              <h1 className="font-display text-4xl font-extrabold tracking-tight text-foreground text-balance sm:text-6xl">
                Color
                <span className="bg-gradient-to-r from-pink-500 via-fuchsia-500 to-violet-500 bg-clip-text text-transparent">Bloom</span>
                <span className="mt-3 block text-2xl font-semibold text-muted sm:text-3xl">Mindful coloring and art</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
                Slow down and let color do the rest. ColorBloom brings mandalas, a live symmetry studio and a daily
                design to your Android phone. Free, offline and ad free, from the team that makes WipeClip.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <StoreButton />
                <a href="#screens" className="btn-secondary inline-flex rounded-full px-6 py-3.5 text-sm font-semibold">
                  See the app
                </a>
              </div>
            </div>
            <div className="relative mx-auto flex max-w-md justify-center gap-4">
              <Image
                src={COLORBLOOM_SCREENS[0].src}
                alt="ColorBloom home screen with curated designs"
                width={540}
                height={968}
                priority
                className="w-1/2 rounded-[1.75rem] border border-border shadow-2xl"
              />
              <Image
                src={COLORBLOOM_SCREENS[2].src}
                alt="ColorBloom Symmetry Studio"
                width={540}
                height={968}
                priority
                className="mt-12 w-1/2 rounded-[1.75rem] border border-border shadow-2xl"
              />
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              Everything you need to unwind
            </h2>
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {COLORBLOOM_FEATURES.map((f) => (
                <div key={f.title} className="glass-card rounded-2xl p-6">
                  <h3 className="font-display text-base font-bold text-foreground">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="screens" className="scroll-mt-28 py-12">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">Take a look</h2>
          </div>
          <div className="mx-auto mt-8 flex max-w-6xl snap-x snap-mandatory gap-5 overflow-x-auto px-6 pb-4">
            {COLORBLOOM_SCREENS.map((s) => (
              <figure key={s.src} className="w-52 shrink-0 snap-start sm:w-60">
                <Image
                  src={s.src}
                  alt={`ColorBloom: ${s.title}`}
                  width={540}
                  height={968}
                  className="rounded-[1.5rem] border border-border shadow-lg"
                />
                <figcaption className="mt-3">
                  <span className="block text-sm font-bold text-foreground">{s.title}</span>
                  <span className="text-xs text-muted">{s.caption}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-4xl px-6">
            <div className="border-glow rounded-3xl p-8 text-center sm:p-12">
              <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground">Start coloring today</h2>
              <p className="mx-auto mt-3 max-w-xl text-muted">Free to download. No account needed, no ads.</p>
              <StoreButton className="mt-7" />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
