// Small shared pieces for the admin pages - plain server components.
import Link from "next/link";

export type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export function Notice({ text }: { text: string }) {
  if (!text) return null;
  const failed = /fail|could not|invalid|isn.t|must|unknown|not set|no live|not updated|to turn it on/i.test(text);
  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
        failed
          ? "border-danger/40 bg-danger/10 text-foreground"
          : "border-success/40 bg-success/10 text-foreground"
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
          failed ? "bg-danger" : "bg-success"
        }`}
      >
        {failed ? "!" : "✓"}
      </span>
      <span>{text}</span>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  back,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground">
            <span aria-hidden>←</span> {back.label}
          </Link>
        )}
        <h1 className="font-display text-2xl font-extrabold tracking-tight break-all sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  description,
  actions,
  flush,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** No inner padding - for edge-to-edge tables. */
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-bold text-foreground">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

const TONES = {
  neutral: "bg-surface-3 text-muted",
  accent: "bg-accent/15 text-accent",
  info: "bg-accent-2/15 text-cyan-600 dark:text-accent-2",
  success: "bg-success/15 text-emerald-600 dark:text-success",
  warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  danger: "bg-danger/15 text-rose-600 dark:text-danger",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${TONES[tone]}`}>
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  paid: "success",
  resolved: "success",
  live: "success",
  subscribed: "success",
  open: "info",
  in_progress: "warning",
  incomplete: "warning",
  failed: "danger",
  refunded: "warning",
  charged_back: "danger",
  ended: "neutral",
  expired: "neutral",
  closed: "neutral",
  off: "neutral",
  unsubscribed: "neutral",
  free: "neutral",
  lite: "info",
  starter: "accent",
  pro: "accent",
};

/** A status, plan or similar keyword as a coloured pill. */
export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted">-</span>;
  return <Badge tone={STATUS_TONES[value.toLowerCase()] ?? "neutral"}>{value.replace(/_/g, " ")}</Badge>;
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: Tone;
}) {
  const bar = {
    neutral: "bg-border",
    accent: "bg-accent",
    info: "bg-accent-2",
    success: "bg-success",
    warning: "bg-amber-500",
    danger: "bg-danger",
  }[tone];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-extrabold tracking-tight text-foreground">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div aria-hidden className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-3 text-muted">
        ∅
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {children && <p className="mt-1 max-w-sm text-xs text-muted">{children}</p>}
    </div>
  );
}

/** Scrollable table wrapper with a built-in empty row. */
export function Table({
  head,
  empty = "Nothing here yet.",
  rows,
  children,
}: {
  head: string[];
  empty?: string;
  rows: number;
  children: React.ReactNode;
}) {
  if (rows === 0) return <EmptyState title={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className={table}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pages, link }: { page: number; pages: number; link: (p: number) => string }) {
  const item = "rounded-lg border border-border px-3 py-1.5 font-semibold transition";
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-5 py-3 text-xs text-muted">
      <span>
        Page <strong className="text-foreground">{page}</strong> of {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={link(page - 1)} className={`${item} hover:bg-surface-2 hover:text-foreground`}>
            ← Previous
          </Link>
        ) : (
          <span className={`${item} opacity-40`}>← Previous</span>
        )}
        {page < pages ? (
          <Link href={link(page + 1)} className={`${item} hover:bg-surface-2 hover:text-foreground`}>
            Next →
          </Link>
        ) : (
          <span className={`${item} opacity-40`}>Next →</span>
        )}
      </div>
    </div>
  );
}

/** Labelled form control. */
export function Field({ label, hint, className = "", children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <span className="block text-xs font-semibold text-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] leading-relaxed text-muted">{hint}</span>}
    </label>
  );
}

export const table = "w-full text-left text-sm";
export const th =
  "whitespace-nowrap border-b border-border bg-surface-2/60 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted";
export const td = "border-b border-border/60 px-4 py-3 align-top text-foreground";
export const tr = "transition-colors hover:bg-surface-2/50";
export const input =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/25";
export const button =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground shadow-sm transition hover:bg-accent-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50";
export const buttonSecondary =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";
export const link = "font-medium text-accent hover:underline";

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

/** "USD 8.99" / "LKR 2,700" from whole cents. */
export function fmtMoney(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
