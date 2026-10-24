import Link from "next/link";
import { GUIDES, TOOLS } from "@/lib/site-pages";
import { localeHref, type Lang } from "@/lib/i18n";
import { getDict, toolCopy } from "@/i18n";

/** Links from one tool page to the others (same category first), to any
 * guide about it, and to the full directory. */
export default function RelatedTools({ current, lang = "en" }: { current: string; lang?: Lang }) {
  const d = getDict(lang);
  const t = d.relatedTools;
  const self = TOOLS.find((tool) => tool.href === current);
  const others = TOOLS.filter((tool) => tool.href !== current).sort(
    (a, b) => Number(b.category === self?.category) - Number(a.category === self?.category),
  );
  const guides = GUIDES.filter((g) => self?.guides?.includes(g.href));

  return (
    <section className="py-16">
      <div className="mx-auto max-w-3xl px-6">
        <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">{t.title}</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {others.map((tool) => {
            const copy = toolCopy(lang, tool);
            return (
              <li key={tool.href}>
                <Link href={localeHref(lang, tool.href)} className="glass-card-interactive block h-full rounded-2xl p-5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-600">
                    {d.toolCatalog.availability[tool.availability]}
                  </span>
                  <h3 className="mt-1.5 font-display text-sm font-bold tracking-tight text-foreground">{copy.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">{copy.desc}</p>
                </Link>
              </li>
            );
          })}
        </ul>
        {guides.length > 0 && (
          <p className="mt-6 text-sm text-muted">
            {t.readMore}
            {guides.map((g, i) => (
              <span key={g.href}>
                {i > 0 && " · "}
                <Link href={g.href} className="underline hover:text-foreground">
                  {g.title}
                </Link>
              </span>
            ))}
          </p>
        )}
        <p className="mt-4 text-sm">
          <Link href={localeHref(lang, "/tools")} className="font-semibold text-cyan-600 underline hover:text-foreground">
            {t.seeAll}
          </Link>
        </p>
      </div>
    </section>
  );
}
