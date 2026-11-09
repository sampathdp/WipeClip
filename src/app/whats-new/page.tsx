import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Breadcrumbs from "@/components/Breadcrumbs";
import GuideHeader from "@/components/guides/GuideHeader";
import CtaBanner from "@/components/CtaBanner";
import { buildPageMetadata, jsonLdString, SITE_URL } from "@/lib/seo";
import { LATEST_RELEASE, RELEASES } from "@/lib/releases";

const title = "What's New in WipeClip: Release Notes";
const description = `WipeClip release notes for Windows and Mac: every update to the free desktop video editor and screen recorder. Latest: v${LATEST_RELEASE.version}, ${LATEST_RELEASE.date}.`;

export const metadata: Metadata = buildPageMetadata({ title, description, path: "/whats-new" });

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** The desktop app's changelog, English only like the in-app notes it
 * shares a source with (desktop/release-notes.json). */
export default function WhatsNewPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/whats-new`,
        url: `${SITE_URL}/whats-new`,
        name: title,
        description,
        dateModified: LATEST_RELEASE.date,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#app` },
      },
      {
        "@type": "ItemList",
        name: "WipeClip releases",
        itemListElement: RELEASES.map((r, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${SITE_URL}/whats-new#v${r.version}`,
          name: `WipeClip ${r.version}`,
        })),
      },
    ],
  };

  return (
    <div className="flex flex-1 flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      <Navbar />
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "What's new" }]} />
      <main className="flex-1">
        <GuideHeader
          eyebrow={`Latest: v${LATEST_RELEASE.version}`}
          h1={
            <>
              What&apos;s new in <span className="text-gradient">WipeClip</span>
            </>
          }
          intro="Every update to the free desktop video editor and screen recorder for Windows and Mac. The app updates itself and shows these notes after each update."
        />
        <section className="pt-10 pb-8">
          <ol className="relative mx-auto max-w-3xl space-y-6 px-6 before:absolute before:top-2 before:bottom-2 before:left-[2.7rem] before:w-px before:bg-border">
            {RELEASES.map((r, i) => (
              <li key={r.version} id={`v${r.version}`} className="relative scroll-mt-28 pl-10">
                <span
                  aria-hidden
                  className={`absolute left-[0.85rem] top-7 h-3 w-3 rounded-full ring-4 ring-background ${i === 0 ? "bg-rose-500" : "bg-accent"}`}
                />
                <article className={`${i === 0 ? "border-glow" : "glass-card"} rounded-2xl p-6`}>
                  <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 className="font-display text-xl font-extrabold tracking-tight text-foreground">
                      <a href={`#v${r.version}`} className="hover:underline">
                        Version {r.version}
                      </a>
                    </h2>
                    {i === 0 && (
                      <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                        Latest
                      </span>
                    )}
                    <time dateTime={r.date} className="text-xs text-muted">
                      {formatDate(r.date)}
                    </time>
                  </header>
                  <ul className="mt-4 space-y-2.5">
                    {r.notes.map((n) => (
                      <li key={n} className="flex gap-2.5 text-sm leading-relaxed text-foreground">
                        <span aria-hidden className="mt-0.5 font-bold text-cyan-600">
                          {n.startsWith("Fixed") ? "✓" : n.startsWith("New") ? "✦" : "•"}
                        </span>
                        <span>{n}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              </li>
            ))}
          </ol>
        </section>
        <CtaBanner />
      </main>
      <Footer />
    </div>
  );
}
