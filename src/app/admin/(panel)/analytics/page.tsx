import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { countryName } from "@/lib/geo";
import { BarList, ColumnChart, Country } from "@/app/admin/charts";
import { Card, Notice, PageHeader, Stat, StatusBadge, Table, fmtMoney, one, td, tr, type SearchParams } from "@/app/admin/ui";

const RANGES = [7, 30, 90, 365];

type Stats = {
  since: string;
  signups: { day: string; count: number }[];
  checkouts: { day: string; started: number; paid: number }[];
  revenue: { day: string; currency: string; cents: number }[];
  countries: { country: string; currency: string; started: number; paid: number; cents: number }[];
  statuses: { status: string; count: number }[];
  /** Missing until schema.sql is run again after daily_active_users was added. */
  active_users?: { day: string; count: number }[];
  users_by_country: { country: string; count: number }[];
  /** Exports started (plan check passed). Missing until schema.sql is run
   * again after export_events was added. */
  exports?: { day: string; count: number; desktop: number; accounts: number }[];
  exports_by_resolution?: { resolution: string; count: number }[];
};

const RESOLUTION_LABEL: Record<string, string> = { "720p": "720p", "1080p": "1080p", "4k": "4K" };

/** "22 Oct" from "2026-10-22". */
const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "-");

export default async function AdminAnalytics({ searchParams }: { searchParams: SearchParams }) {
  const { admin } = await requireAdmin();
  const params = await searchParams;
  const days = RANGES.includes(Number(one(params.days))) ? Number(one(params.days)) : 30;

  const { data, error } = await admin.rpc("admin_dashboard_stats", { p_days: days });
  const stats = data as Stats | null;

  if (error || !stats) {
    return (
      <>
        <PageHeader title="Analytics" />
        <Notice
          text={`Could not load the stats: ${error?.message ?? "no data"}. Run supabase/schema.sql again in the Supabase SQL editor to add admin_dashboard_stats.`}
        />
      </>
    );
  }

  const signups = stats.signups.reduce((n, d) => n + d.count, 0);
  const started = stats.checkouts.reduce((n, d) => n + d.started, 0);
  const paid = stats.checkouts.reduce((n, d) => n + d.paid, 0);
  const active = stats.active_users ?? [];
  const activeAvg = active.length ? Math.round(active.reduce((n, d) => n + d.count, 0) / active.length) : 0;
  const activePeak = Math.max(0, ...active.map((d) => d.count));
  const exportDays = stats.exports ?? [];
  const exportsTotal = exportDays.reduce((n, d) => n + d.count, 0);
  const exportsDesktop = exportDays.reduce((n, d) => n + d.desktop, 0);
  const exportsPeak = Math.max(0, ...exportDays.map((d) => d.count));

  // Revenue per currency: one chart each, since LKR and USD don't share a scale.
  const currencies = [...new Set(stats.revenue.map((r) => r.currency))].sort();
  const revenueByCurrency = currencies.map((currency) => {
    const byDay = new Map(stats.revenue.filter((r) => r.currency === currency).map((r) => [r.day, r.cents]));
    const series = stats.signups.map(({ day }) => ({ day, cents: byDay.get(day) ?? 0 }));
    return { currency, total: series.reduce((n, d) => n + d.cents, 0), series };
  });

  // Checkouts per country, all currencies together.
  const byCountry = new Map<string, { started: number; paid: number; revenue: Map<string, number> }>();
  for (const c of stats.countries) {
    const row = byCountry.get(c.country) ?? { started: 0, paid: 0, revenue: new Map() };
    row.started += c.started;
    row.paid += c.paid;
    if (c.cents) row.revenue.set(c.currency, (row.revenue.get(c.currency) ?? 0) + c.cents);
    byCountry.set(c.country, row);
  }
  const countryRows = [...byCountry].sort((a, b) => b[1].started - a[1].started);
  const totalUsers = stats.users_by_country.reduce((n, u) => n + u.count, 0);

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Sign-ups, exports, checkouts and where buyers are. Days are in UTC."
        actions={
          <div className="flex gap-1 rounded-lg border border-border bg-background p-1">
            {RANGES.map((r) => (
              <Link
                key={r}
                href={`/admin/analytics?days=${r}`}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                  r === days ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {r === 365 ? "1 year" : `${r} days`}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="New accounts" value={signups.toLocaleString()} tone="accent" />
        <Stat label="Pay button presses" value={started.toLocaleString()} hint="Checkouts started" tone="info" />
        <Stat label="Paid orders" value={paid.toLocaleString()} hint={`${pct(paid, started)} of checkouts`} tone="success" />
        <Stat label="Countries buying" value={countryRows.filter(([, r]) => r.paid > 0).length} hint={`${countryRows.length} started a checkout`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Active accounts per day"
          description={
            active.length
              ? `Signed-in accounts that used the site or app. ${activeAvg.toLocaleString()} a day on average, peak ${activePeak.toLocaleString()}.`
              : "Run supabase/schema.sql again to start counting active accounts."
          }
        >
          <ColumnChart data={active.map((d) => ({ label: dayLabel(d.day), value: d.count }))} />
        </Card>
        <Card
          title="Exports per day"
          description={
            stats.exports
              ? `Exports started: ${exportsTotal.toLocaleString()} in this period (${exportsDesktop.toLocaleString()} in the desktop app), peak ${exportsPeak.toLocaleString()} a day. The solid part is the desktop app.`
              : "Run supabase/schema.sql again to start counting exports."
          }
        >
          <ColumnChart
            legend={["All", "Desktop app"]}
            data={exportDays.map((d) => ({
              label: dayLabel(d.day),
              value: d.count,
              overlay: d.desktop,
              title: `${dayLabel(d.day)}: ${d.count} exports (${d.desktop} desktop, ${d.count - d.desktop} website), ${d.accounts} accounts`,
            }))}
          />
        </Card>
        <Card title="Exports by resolution" description="Exports started in this period, by the size picked.">
          <BarList
            empty="No exports in this period."
            rows={(stats.exports_by_resolution ?? []).map((r) => ({
              key: r.resolution,
              label: RESOLUTION_LABEL[r.resolution] ?? r.resolution,
              value: r.count,
              detail: pct(r.count, exportsTotal),
            }))}
          />
        </Card>
        <Card title="New accounts per day">
          <ColumnChart data={stats.signups.map((d) => ({ label: dayLabel(d.day), value: d.count }))} />
        </Card>
        <Card title="Checkouts per day" description="Each column is checkouts started; the solid part is the ones paid.">
          <ColumnChart
            legend={["Started", "Paid"]}
            data={stats.checkouts.map((d) => ({
              label: dayLabel(d.day),
              value: d.started,
              overlay: d.paid,
              title: `${dayLabel(d.day)}: ${d.started} started, ${d.paid} paid`,
            }))}
          />
        </Card>
        {revenueByCurrency.map((r) => (
          <Card key={r.currency} title={`Revenue per day, ${r.currency}`} description={`${fmtMoney(r.total, r.currency)} in this period`}>
            <ColumnChart
              format={(c) => (c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}
              data={r.series.map((d) => ({ label: dayLabel(d.day), value: d.cents, title: `${dayLabel(d.day)}: ${fmtMoney(d.cents, r.currency)}` }))}
            />
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Checkouts by country" description="Where buyers were when they pressed the pay button.">
          <BarList
            empty="No checkouts in this period."
            rows={countryRows.slice(0, 10).map(([code, r]) => ({
              key: code || "unknown",
              label: <Country code={code} />,
              value: r.started,
              detail: `${r.paid} paid`,
            }))}
          />
        </Card>
        <Card title="Accounts by country" description={`All ${totalUsers.toLocaleString()} accounts, by the country they were last seen in.`}>
          <BarList
            rows={stats.users_by_country.slice(0, 10).map((u) => ({
              key: u.country || "unknown",
              label: <Country code={u.country} />,
              value: u.count,
              detail: pct(u.count, totalUsers),
            }))}
          />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Country breakdown" description="Checkouts in this period, every country." flush>
            <Table head={["Country", "Started", "Paid", "Conversion", "Revenue"]} rows={countryRows.length} empty="No checkouts in this period.">
              {countryRows.map(([code, r]) => (
                <tr key={code || "unknown"} className={tr}>
                  <td className={td}>
                    <Link href={`/admin/orders?country=${code || "unknown"}`} className="hover:underline" title={`Orders from ${countryName(code)}`}>
                      <Country code={code} />
                    </Link>
                  </td>
                  <td className={`${td} tabular-nums`}>{r.started}</td>
                  <td className={`${td} tabular-nums font-semibold`}>{r.paid}</td>
                  <td className={`${td} tabular-nums text-muted`}>{pct(r.paid, r.started)}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {r.revenue.size ? [...r.revenue].map(([cur, cents]) => fmtMoney(cents, cur)).join(" + ") : <span className="text-muted">-</span>}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
        <Card title="Order status" description="Checkouts started in this period.">
          <BarList
            empty="No checkouts in this period."
            rows={stats.statuses.map((s) => ({ key: s.status, label: <StatusBadge value={s.status} />, value: s.count, detail: pct(s.count, started) }))}
          />
        </Card>
      </div>
    </>
  );
}
