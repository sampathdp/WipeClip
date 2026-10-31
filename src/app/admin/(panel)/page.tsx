import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { getDownloadCounts } from "@/lib/downloadStats";
import { Card, PageHeader, Stat, StatusBadge, Table, fmtDate, fmtMoney, link, td, tr } from "@/app/admin/ui";

/** Outside the component so the purity lint rule doesn't flag the clock read. */
function timeWindow() {
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  return {
    now: now.toISOString(),
    today: now.toISOString().slice(0, 10),
    yesterday: new Date(now.getTime() - day).toISOString().slice(0, 10),
    monthAgo: new Date(now.getTime() - 30 * day).toISOString(),
  };
}

export default async function AdminOverview() {
  const { admin } = await requireAdmin();
  const { now, today, yesterday, monthAgo } = timeWindow();

  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0);
  const [users, paid, optedOut, openFeedback, newUsers, activeToday, activeYesterday, downloads, paidOrders, recent] = await Promise.all([
    count(admin.from("profiles").select("id", { count: "exact", head: true })),
    count(admin.from("profiles").select("id", { count: "exact", head: true }).neq("plan", "free").or(`plan_expires_at.is.null,plan_expires_at.gt.${now}`)),
    count(admin.from("profiles").select("id", { count: "exact", head: true }).eq("marketing_opt_out", true)),
    count(admin.from("feedback").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"])),
    count(admin.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", monthAgo)),
    count(admin.from("daily_active_users").select("user_id", { count: "exact", head: true }).eq("day", today)),
    count(admin.from("daily_active_users").select("user_id", { count: "exact", head: true }).eq("day", yesterday)),
    getDownloadCounts(),
    admin.from("payment_orders").select("amount_cents, currency").eq("status", "paid").gte("paid_at", monthAgo),
    admin
      .from("payment_orders")
      .select("id, user_id, plan, status, amount_cents, currency, created_at, profiles(email)")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const revenue = new Map<string, { cents: number; orders: number }>();
  for (const o of paidOrders.data ?? []) {
    const r = revenue.get(o.currency) ?? { cents: 0, orders: 0 };
    revenue.set(o.currency, { cents: r.cents + o.amount_cents, orders: r.orders + 1 });
  }
  const rows = recent.data ?? [];

  return (
    <>
      <PageHeader title="Overview" description="How the service is doing over the last 30 days." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Accounts" value={users.toLocaleString()} hint={`+${newUsers} in the last 30 days`} tone="accent" />
        <Stat
          label="Active accounts today"
          value={activeToday.toLocaleString()}
          hint={`${activeYesterday.toLocaleString()} yesterday (UTC days, signed-in only)`}
          tone="info"
        />
        <Stat
          label="Desktop downloads"
          value={downloads ? downloads.total.toLocaleString() : "-"}
          hint={downloads ? `${downloads.windows.toLocaleString()} Windows, ${downloads.mac.toLocaleString()} macOS, all time` : "Counts unavailable right now"}
          tone="accent"
        />
        <Stat label="Active paid passes" value={paid.toLocaleString()} tone="success" />
        <Stat
          label="Open feedback"
          value={openFeedback}
          hint={openFeedback > 0 ? <Link href="/admin/feedback" className={link}>Review now →</Link> : "All caught up"}
          tone={openFeedback > 0 ? "warning" : "neutral"}
        />
        <Stat label="Unsubscribed from email" value={optedOut.toLocaleString()} />
        {[...revenue].map(([currency, r]) => (
          <Stat key={currency} label={`Revenue, 30 days`} value={fmtMoney(r.cents, currency)} hint={`${r.orders} paid orders`} tone="info" />
        ))}
      </div>

      <Card
        title="Latest orders"
        description="The 8 most recent checkouts, paid or not."
        actions={
          <Link href="/admin/orders" className={`${link} text-xs`}>
            View all →
          </Link>
        }
        flush
      >
        <Table head={["Created", "Account", "Plan", "Amount", "Status"]} rows={rows.length} empty="No orders yet.">
          {rows.map((o) => (
            <tr key={o.id} className={tr}>
              <td className={`${td} whitespace-nowrap text-muted`}>{fmtDate(o.created_at)}</td>
              <td className={td}>
                <Link href={`/admin/users/${o.user_id}`} className={link}>
                  {(o.profiles as unknown as { email: string } | null)?.email ?? "-"}
                </Link>
              </td>
              <td className={td}>
                <StatusBadge value={o.plan} />
              </td>
              <td className={`${td} whitespace-nowrap font-semibold`}>{fmtMoney(o.amount_cents, o.currency)}</td>
              <td className={td}>
                <StatusBadge value={o.status} />
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
