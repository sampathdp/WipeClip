import Link from "next/link";
import { AVAILABILITY_LABEL, GUIDES, TOOLS } from "@/lib/site-pages";

/** Links from one tool page to the others (same category first), to any
 * guide about it, and to the full directory. */
export default function RelatedTools({ current }: { current: string }) {
  const self = TOOLS.find((t) => t.href === current);
  const others = TOOLS.filter((t) => t.href !== current).sort(
    (a, b) => Number(b.category === self?.category) - Number(a.category === self?.category),
  );
  const guides = GUIDES.filter((g) => self?.guides?.includes(g.href));

  return (
    <section className="py-16">
      <div className="mx-auto max-w-3xl px-6">
        <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">More tools</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {others.map((t) => (
            <li key={t.href}>
              <Link href={t.href} className="glass-card-interactive block h-full rounded-2xl p-5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-600">
                  {AVAILABILITY_LABEL[t.availability]}
                </span>
                <h3 className="mt-1.5 font-display text-sm font-bold tracking-tight text-foreground">{t.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">{t.desc}</p>
              </Link>
            </li>
          ))}
        </ul>
        {guides.length > 0 && (
          <p className="mt-6 text-sm text-muted">
            Read more:{" "}
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
          <Link href="/tools" className="font-semibold text-cyan-600 underline hover:text-foreground">
            See all free tools
          </Link>
        </p>
      </div>
    </section>
  );
}
