import Link from "next/link";

export type RelatedLink = { href: string; label: string; desc: string };

export default function RelatedGuides({ links }: { links: RelatedLink[] }) {
  return (
    <section className="py-16">
      <div className="mx-auto max-w-3xl px-6">
        <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
          Related reading
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="glass-card-interactive block rounded-2xl p-5"
            >
              <h3 className="font-display text-sm font-bold text-foreground tracking-tight">
                {l.label}
              </h3>
              <p className="mt-1.5 text-xs text-muted leading-relaxed">{l.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
