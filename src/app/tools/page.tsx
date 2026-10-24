import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Breadcrumbs from "@/components/Breadcrumbs";
import GuideHeader from "@/components/guides/GuideHeader";
import { buildPageMetadata, jsonLdString, SITE_URL } from "@/lib/seo";
import { AVAILABILITY_LABEL, TOOLS, type ToolEntry } from "@/lib/site-pages";

const title = "Free Video and Photo Tools";
const description =
  "Every WipeClip tool in one place: a free screen recorder and video editor for Windows and Mac, plus browser tools to grab video frames, remove backgrounds and sharpen photos.";

export const metadata: Metadata = buildPageMetadata({ title, description, path: "/tools" });

const SECTIONS: { category: ToolEntry["category"]; heading: string; intro: string }[] = [
  {
    category: "video",
    heading: "Video",
    intro: "Record and edit in the desktop app, or pull a still frame out of any clip in your browser.",
  },
  {
    category: "image",
    heading: "Photos and images",
    intro: "Browser tools for photos. Each gives one free reduced-size result a day; full resolution costs 1 credit, and every account gets 2 free credits a day.",
  },
];

const BADGE_STYLE: Record<ToolEntry["availability"], string> = {
  free: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  pro: "border-accent/30 bg-accent/10 text-accent",
  desktop: "border-cyan-500/30 bg-cyan-500/10 text-cyan-600",
};

export default function ToolsPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: title,
    itemListElement: TOOLS.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.title,
      url: `${SITE_URL}${t.href}`,
    })),
  };

  return (
    <div className="flex flex-1 flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      <Navbar />
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Free tools" }]} />
      <main className="flex-1 pb-24">
        <GuideHeader
          eyebrow="The full toolkit"
          h1={
            <>
              Free <span className="text-gradient">video and photo</span> tools
            </>
          }
          intro="A screen recorder and video editor you install, plus quick tools that run in your browser. The badge on each says where it runs."
        />
        {SECTIONS.map((s) => (
          <section key={s.category} className="pt-12">
            <div className="mx-auto max-w-3xl px-6">
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">{s.heading}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.intro}</p>
              <ul className="mt-6 grid gap-4 sm:grid-cols-2">
                {TOOLS.filter((t) => t.category === s.category).map((t) => (
                  <li key={t.href}>
                    <Link href={t.href} className="glass-card-interactive flex h-full flex-col rounded-2xl p-5">
                      <span
                        className={`self-start rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${BADGE_STYLE[t.availability]}`}
                      >
                        {AVAILABILITY_LABEL[t.availability]}
                      </span>
                      <h3 className="mt-3 font-display text-base font-bold tracking-tight text-foreground">{t.title}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted">{t.desc}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </main>
      <Footer />
    </div>
  );
}
