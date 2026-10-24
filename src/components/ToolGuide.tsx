/** "How to" steps plus a short fact sheet for a free tool page. Plain,
 * crawlable text: it's what search snippets and AI answers quote when
 * someone asks how to do the task or what the tool's limits are. */
export default function ToolGuide({
  title,
  steps,
  facts,
  factsTitle = "At a glance",
}: {
  title: string;
  steps: string[];
  facts: { label: string; value: string }[];
  factsTitle?: string;
}) {
  return (
    <section className="py-16">
      <div className="mx-auto grid max-w-5xl gap-10 px-6 md:grid-cols-[1.3fr_1fr]">
        <div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground">{title}</h2>
          <ol className="mt-6 space-y-4">
            {steps.map((step, i) => (
              <li key={step} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-500/40 bg-surface-2 text-sm font-bold text-cyan-600">
                  {i + 1}
                </span>
                <p className="pt-1 text-sm leading-relaxed text-muted">{step}</p>
              </li>
            ))}
          </ol>
        </div>
        <div className="glass-card rounded-2xl border border-border/80 p-6">
          <h3 className="font-display text-lg font-bold text-foreground">{factsTitle}</h3>
          <dl className="mt-4 space-y-3 text-sm">
            {facts.map((f) => (
              <div key={f.label} className="flex justify-between gap-4 border-b border-border/50 pb-3 last:border-0 last:pb-0">
                <dt className="text-muted">{f.label}</dt>
                <dd className="text-right font-medium text-foreground">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
