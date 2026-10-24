import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Breadcrumbs from "@/components/Breadcrumbs";
import GuideHeader from "@/components/guides/GuideHeader";
import { buildPageMetadata, jsonLdString, SITE_URL } from "@/lib/seo";
import { GUIDES } from "@/lib/site-pages";

const title = "Guides";
const description =
  "Plain-language guides from WipeClip on how AI video cleanup works, what it can and can't do, and how it affects video quality.";

export const metadata: Metadata = buildPageMetadata({ title, description, path: "/guides" });

export default function GuidesPage() {
  // Every current guide covers AI cleanup; with it off there is nothing to list.
  if (GUIDES.length === 0) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description,
    url: `${SITE_URL}/guides`,
    hasPart: GUIDES.map((g) => ({ "@type": "Article", headline: g.title, url: `${SITE_URL}${g.href}` })),
  };

  return (
    <div className="flex flex-1 flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      <Navbar />
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Guides" }]} />
      <main className="flex-1 pb-24">
        <GuideHeader
          eyebrow="Guides"
          h1={
            <>
              How WipeClip&apos;s <span className="text-gradient">AI cleanup</span> works
            </>
          }
          intro="What the technique does, where it struggles, and what actually changes in your video. Written for people deciding whether it fits their footage."
        />
        <section className="pt-10">
          <ul className="mx-auto grid max-w-3xl gap-4 px-6">
            {GUIDES.map((g) => (
              <li key={g.href}>
                <Link href={g.href} className="glass-card-interactive block rounded-2xl p-6">
                  <h2 className="font-display text-lg font-bold tracking-tight text-foreground">{g.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{g.description}</p>
                  <p className="mt-3 text-xs text-muted">
                    Updated <time dateTime={g.updated}>{g.updated}</time>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <Footer />
    </div>
  );
}
