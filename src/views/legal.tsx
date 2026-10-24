import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { buildPageMetadata } from "@/lib/seo";
import { AI_CLEANUP_ENABLED } from "@/lib/features";
import { localeHref, type Lang } from "@/lib/i18n";
import { fmt, getLegal } from "@/i18n";
import type { LegalBlock } from "@/i18n/types";

const PAGES = {
  privacy: "/privacy",
  terms: "/terms",
  refund: "/refund-policy",
  dmca: "/dmca",
} as const;

export type LegalPage = keyof typeof PAGES;

export function legalMetadata(page: LegalPage, lang: Lang): Metadata {
  const t = getLegal(lang)[page];
  return buildPageMetadata({ title: t.title, description: t.description, path: PAGES[page], lang });
}

/** Inline text: [label](/path or mailto:) links and **bold**. */
function Inline({ text, lang }: { text: string; lang: Lang }) {
  return (
    <>
      {text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/).map((part, i) => {
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const [, label, href] = link;
          return href.startsWith("/") ? (
            <Link key={i} href={localeHref(lang, href)} className="underline hover:text-foreground">
              {label}
            </Link>
          ) : (
            <a key={i} href={href} className="underline hover:text-foreground">
              {label}
            </a>
          );
        }
        const bold = part.match(/^\*\*([^*]+)\*\*$/);
        if (bold) return <strong key={i}>{bold[1]}</strong>;
        return part;
      })}
    </>
  );
}

function Block({ block, lang }: { block: LegalBlock; lang: Lang }) {
  if ("h" in block) return <h2 className="mt-10 font-display text-xl font-bold tracking-tight">{block.h}</h2>;
  if ("p" in block)
    return (
      <p className="mt-3 text-sm leading-6 text-muted">
        <Inline text={block.p} lang={lang} />
      </p>
    );
  if ("ul" in block)
    return (
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
        {block.ul.map((item, i) => (
          <li key={i}>
            <Inline text={item} lang={lang} />
          </li>
        ))}
      </ul>
    );
  const [title, ...lines] = block.box;
  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-surface/50 p-4 text-sm text-muted">
      <p className="font-semibold text-foreground">{title}</p>
      {lines.map((line, i) => (
        <p key={i} className="mt-1">
          <Inline text={line} lang={lang} />
        </p>
      ))}
    </div>
  );
}

export default function LegalView({ page, lang }: { page: LegalPage; lang: Lang }) {
  const legal = getLegal(lang);
  const t = legal[page];
  const updated = new Date(`${t.updated}T00:00:00Z`).toLocaleDateString(lang, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  // The terms name the AI tools that use credits.
  const aiTools = page === "terms" ? (AI_CLEANUP_ENABLED ? legal.terms.aiToolsWithCleanup : legal.terms.aiTools) : "";
  const blocks = t.blocks
    .filter((b) => b.ai === undefined || b.ai === AI_CLEANUP_ENABLED)
    .map((b) => ("p" in b ? { ...b, p: fmt(b.p, { aiTools }) } : "ul" in b ? { ...b, ul: b.ul.map((li) => fmt(li, { aiTools })) } : b));

  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-32 pb-24">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{t.title}</h1>
        <p className="mt-2 text-sm text-muted">{fmt(legal.lastUpdated, { date: updated })}</p>
        {legal.translationNote && (
          <p className="mt-4 rounded-lg border border-border/60 bg-surface/50 p-3 text-xs text-muted">
            <Inline text={fmt(legal.translationNote, { english: PAGES[page] })} lang="en" />
          </p>
        )}
        {blocks.map((b, i) => (
          <Block key={i} block={b} lang={lang} />
        ))}
      </main>
      <Footer lang={lang} />
    </div>
  );
}
