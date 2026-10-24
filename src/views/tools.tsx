import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Breadcrumbs from "@/components/Breadcrumbs";
import GuideHeader from "@/components/guides/GuideHeader";
import { buildPageMetadata, jsonLdString, SITE_URL } from "@/lib/seo";
import { TOOLS, type ToolEntry } from "@/lib/site-pages";
import { localeHref, type Lang } from "@/lib/i18n";
import { getDict, toolCopy } from "@/i18n";

export function toolsMetadata(lang: Lang): Metadata {
  const t = getDict(lang).toolsPage;
  return buildPageMetadata({ title: t.title, description: t.description, path: "/tools", lang });
}

const CATEGORIES: ToolEntry["category"][] = ["video", "image"];

const BADGE_STYLE: Record<ToolEntry["availability"], string> = {
  free: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  pro: "border-accent/30 bg-accent/10 text-accent",
  desktop: "border-cyan-500/30 bg-cyan-500/10 text-cyan-600",
};

export default function ToolsView({ lang }: { lang: Lang }) {
  const d = getDict(lang);
  const t = d.toolsPage;
  const href = (path: string) => localeHref(lang, path);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: t.title,
    itemListElement: TOOLS.map((tool, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: toolCopy(lang, tool).title,
      url: `${SITE_URL}${href(tool.href)}`,
    })),
  };

  return (
    <div className="flex flex-1 flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      <Navbar />
      <Breadcrumbs items={[{ label: t.home, href: href("/") }, { label: t.crumb }]} />
      <main className="flex-1 pb-24">
        <GuideHeader
          eyebrow={t.eyebrow}
          h1={
            <>
              {t.h1[0]}
              <span className="text-gradient">{t.h1[1]}</span>
              {t.h1[2]}
            </>
          }
          intro={t.intro}
        />
        {CATEGORIES.map((category) => (
          <section key={category} className="pt-12">
            <div className="mx-auto max-w-3xl px-6">
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">{t.sections[category].heading}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{t.sections[category].intro}</p>
              <ul className="mt-6 grid gap-4 sm:grid-cols-2">
                {TOOLS.filter((tool) => tool.category === category).map((tool) => {
                  const copy = toolCopy(lang, tool);
                  return (
                    <li key={tool.href}>
                      <Link href={href(tool.href)} className="glass-card-interactive flex h-full flex-col rounded-2xl p-5">
                        <span
                          className={`self-start rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${BADGE_STYLE[tool.availability]}`}
                        >
                          {d.toolCatalog.availability[tool.availability]}
                        </span>
                        <h3 className="mt-3 font-display text-base font-bold tracking-tight text-foreground">{copy.title}</h3>
                        <p className="mt-1.5 text-sm leading-relaxed text-muted">{copy.desc}</p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        ))}
      </main>
      <Footer lang={lang} />
    </div>
  );
}
