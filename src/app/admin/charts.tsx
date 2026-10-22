// Small chart pieces for the admin pages - plain server components, drawn
// with HTML boxes so they stay sharp at any width and need no chart library.
// Hovering a bar shows its exact value (the native title tooltip).
import { countryFlag, countryName } from "@/lib/geo";

/** A whole-number axis top that reads cleanly: 1, 2, 5 or 10 times a power of ten. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(max));
  return ([1, 2, 5, 10].map((m) => m * step).find((v) => v >= max) ?? max);
}

export type Column = { label: string; value: number; overlay?: number; title?: string };

/** One column per point (e.g. per day), with an optional overlay series drawn
 * inside each column (e.g. paid out of started). Three gridlines; the first,
 * middle and last labels under the axis. */
export function ColumnChart({
  data,
  format = (n) => n.toLocaleString(),
  legend,
  height = 160,
}: {
  data: Column[];
  format?: (n: number) => string;
  /** Names of the main series and the overlay, shown when there is an overlay. */
  legend?: [string, string];
  height?: number;
}) {
  const top = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const ticks = [top, top / 2, 0];
  const shown = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);

  return (
    <figure className="space-y-3">
      {legend && (
        <figcaption className="flex flex-wrap gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-accent/30" />
            {legend[0]}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-accent" />
            {legend[1]}
          </span>
        </figcaption>
      )}
      <div className="flex gap-2">
        <div className="flex shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-muted" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {format(t)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height }}>
            {ticks.map((t, i) => (
              <span
                key={t}
                aria-hidden
                className={`absolute inset-x-0 border-t ${i === ticks.length - 1 ? "border-border" : "border-dashed border-border/60"}`}
                style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}
              />
            ))}
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {data.map((d) => (
                <div
                  key={d.label}
                  title={d.title ?? `${d.label}: ${format(d.value)}`}
                  className="group relative flex h-full min-w-0 flex-1 items-end"
                >
                  <span
                    className={`relative block w-full rounded-t-[3px] transition-opacity group-hover:opacity-80 ${
                      d.overlay === undefined ? "bg-accent" : "bg-accent/30"
                    }`}
                    style={{ height: `${(d.value / top) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }}
                  >
                    {d.overlay !== undefined && d.overlay > 0 && (
                      <span
                        className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-accent"
                        style={{ height: `${(d.overlay / Math.max(d.value, 1)) * 100}%`, minHeight: 2 }}
                      />
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1.5 flex text-[10px] text-muted">
            {data.map((d, i) => (
              <span key={d.label} className={`min-w-0 flex-1 whitespace-nowrap ${i === data.length - 1 ? "text-right" : i === 0 ? "" : "text-center"}`}>
                {shown.has(i) ? d.label : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

export type BarRow = { key: string; label: React.ReactNode; value: number; detail?: React.ReactNode };

/** Ranked horizontal bars with the label and value as text beside each. */
export function BarList({
  rows,
  format = (n) => n.toLocaleString(),
  empty = "No data yet.",
}: {
  rows: BarRow[];
  format?: (n: number) => string;
  empty?: string;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-xs text-muted">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} title={`${typeof r.label === "string" ? r.label : r.key}: ${format(r.value)}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-foreground">{r.label}</span>
            <span className="shrink-0 tabular-nums font-semibold text-foreground">
              {format(r.value)}
              {r.detail && <span className="ml-1.5 text-xs font-normal text-muted">{r.detail}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value > 0 ? 4 : 0 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** "🇱🇰 Sri Lanka" for a country code; "🌐 Unknown" for none. */
export function Country({ code }: { code: string | null | undefined }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden>{countryFlag(code)}</span>
      <span>{countryName(code)}</span>
    </span>
  );
}
