import Link from "next/link";
import { localeHref, type Lang } from "@/lib/i18n";
import { getDict } from "@/i18n";
import { rich } from "@/i18n/rich";

export default function PrivacyProcessing({ lang = "en" }: { lang?: Lang }) {
  const t = getDict(lang).privacyProcessing;
  const link = (path: string, label: string) => (
    <Link href={localeHref(lang, path)} className="underline hover:text-foreground">
      {label}
    </Link>
  );
  return (
    <section id="privacy" className="scroll-mt-28 py-24 relative">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border px-3.5 py-1 text-xs font-semibold text-muted">
          {t.badge}
        </div>
        <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
          {t.title}
        </h2>

        <ul className="mt-10 space-y-4 text-left">
          {t.points.map((p) => (
            <li key={p} className="glass-card flex items-start gap-3 rounded-2xl p-5">
              <span className="mt-0.5 text-cyan-600 font-bold">✓</span>
              <span className="text-sm sm:text-base text-muted leading-relaxed">{p}</span>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-xs text-muted">
          {rich(t.more, { privacy: link("/privacy", t.privacy), terms: link("/terms", t.terms) })}
        </p>
      </div>
    </section>
  );
}
