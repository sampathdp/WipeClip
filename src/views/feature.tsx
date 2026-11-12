import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Breadcrumbs from "@/components/Breadcrumbs";
import DownloadButtons from "@/components/DownloadButtons";
import { buildPageMetadata, faqJsonLd, jsonLdString, softwareAppJsonLd, SITE_URL } from "@/lib/seo";
import { FEATURE_PAGES, SHOT_SIZE, type FeaturePage, type FeatureShot } from "@/lib/feature-pages";

export function featureMetadata(page: FeaturePage): Metadata {
  return buildPageMetadata({ title: page.title, description: page.description, path: page.path });
}

function Shot({ shot, priority = false }: { shot: FeatureShot; priority?: boolean }) {
  return (
    <figure>
      <Image
        src={shot.src}
        alt={shot.alt}
        {...SHOT_SIZE}
        priority={priority}
        sizes="(min-width: 1152px) 1104px, 100vw"
        className="w-full rounded-2xl border border-border shadow-2xl"
      />
      <figcaption className="mt-3 text-center text-sm text-muted">{shot.caption}</figcaption>
    </figure>
  );
}

/** One desktop app feature, aimed at the searches people make for it.
 * English only; the copy lives in src/lib/feature-pages.ts. */
export default function FeatureView({ page }: { page: FeaturePage }) {
  const pageUrl = `${SITE_URL}${page.path}`;
  const related = FEATURE_PAGES.filter((p) => p.path !== page.path);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${pageUrl}#webpage`,
        url: pageUrl,
        name: page.title,
        description: page.description,
        inLanguage: "en",
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#app` },
        primaryImageOfPage: `${SITE_URL}${page.hero.src}`,
      },
      softwareAppJsonLd({ screenshot: [page.hero, ...page.shots].map((s) => `${SITE_URL}${s.src}`) }),
      faqJsonLd(page.faqs),
    ],
  };

  return (
    <div className="flex flex-1 flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      <Navbar />
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Download", href: "/download" }, { label: page.name }]} />
      <main className="flex-1">
        <section className="relative overflow-hidden pt-8 pb-12">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-48 left-1/4 -z-10 h-[650px] w-[950px] rounded-full bg-gradient-to-b from-accent/10 via-accent-2/5 to-transparent blur-[140px] dark:from-accent/25 dark:via-accent-2/15"
          />
          <div className="mx-auto max-w-4xl px-6 text-center">
            <span className="inline-block rounded-full border border-accent/40 bg-accent/10 px-3.5 py-1 text-xs font-semibold text-accent">
              {page.eyebrow}
            </span>
            <h1 className="mt-5 font-display text-4xl font-extrabold tracking-tight text-foreground text-balance sm:text-6xl">
              {page.h1}{" "}
              <span className="bg-gradient-to-r from-accent via-accent-light to-accent-2 bg-clip-text text-transparent">
                {page.h1Accent}
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">{page.intro}</p>
            <div className="mx-auto mt-8 flex max-w-xl justify-center">
              <DownloadButtons compact />
            </div>
          </div>
          <div className="mx-auto mt-12 max-w-6xl px-6">
            <Shot shot={page.hero} priority />
          </div>
        </section>

        <section className="py-12">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">How it works</h2>
            <ol className="mt-8 grid gap-5 md:grid-cols-3">
              {page.steps.map((s, i) => (
                <li key={s.title} className="glass-card rounded-2xl p-6">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-r from-accent to-accent-2 text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 font-display text-lg font-bold text-foreground">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="py-12">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">What you get</h2>
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {page.highlights.map((h) => (
                <div key={h.title} className="glass-card rounded-2xl p-6">
                  <h3 className="font-display text-base font-bold text-foreground">{h.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{h.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="mx-auto max-w-6xl space-y-14 px-6">
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">See it in the app</h2>
            {page.shots.map((s) => (
              <Shot key={s.src} shot={s} />
            ))}
          </div>
        </section>

        <section className="py-12">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="text-center font-display text-3xl font-extrabold tracking-tight text-foreground">Questions</h2>
            <div className="mt-8 space-y-3">
              {page.faqs.map((f) => (
                <details key={f.q} className="glass-card group rounded-2xl p-5">
                  <summary className="cursor-pointer list-none font-semibold text-foreground">{f.q}</summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="font-display text-2xl font-extrabold tracking-tight text-foreground">More in WipeClip</h2>
            <div className="mt-6 grid gap-5 sm:grid-cols-3">
              {related.map((p) => (
                <Link key={p.path} href={p.path} className="glass-card-interactive rounded-2xl p-6">
                  <span className="font-display text-base font-bold text-foreground">{p.name}</span>
                  <span className="mt-2 block text-sm leading-relaxed text-muted">{p.description}</span>
                </Link>
              ))}
              <Link href="/download" className="glass-card-interactive rounded-2xl p-6">
                <span className="font-display text-base font-bold text-foreground">Screen recorder and editor</span>
                <span className="mt-2 block text-sm leading-relaxed text-muted">
                  Record your screen, add automatic zooms, cut pauses, add transitions, text and music.
                </span>
              </Link>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-4xl px-6">
            <div className="border-glow rounded-3xl p-8 text-center sm:p-12">
              <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground">Try it free</h2>
              <p className="mx-auto mt-3 max-w-xl text-muted">{page.cta}</p>
              <div className="mt-7 flex justify-center">
                <DownloadButtons compact />
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
