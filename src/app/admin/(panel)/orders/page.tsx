import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { Card, PageHeader, Pagination, StatusBadge, Table, fmtDate, fmtMoney, link, one, td, tr, type SearchParams } from "@/app/admin/ui";

const PAGE_SIZE = 50;
const STATUSES = ["open", "paid", "failed", "expired", "refunded", "charged_back"];

export default async function AdminOrders({ searchParams }: { searchParams: SearchParams }) {
  const { admin } = await requireAdmin();
  const params = await searchParams;
  const status = STATUSES.includes(one(params.status)) ? one(params.status) : "";
  const page = Math.max(1, Number(one(params.page)) || 1);

  let query = admin
    .from("payment_orders")
    .select("id, user_id, plan, status, amount_cents, currency, provider, promo_code, checkout_id, created_at, paid_at, profiles(email)", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) query = query.eq("status", status);
  const { data, count } = await query;

  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const pageLink = (p: number) => `/admin/orders?${new URLSearchParams({ status, page: String(p) })}`;
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Orders" description="Every checkout started on the site, newest first." />

      <div className="flex flex-wrap gap-2">
        {["", ...STATUSES].map((s) => (
          <Link
            key={s || "all"}
            href={s ? `/admin/orders?status=${s}` : "/admin/orders"}
            className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition ${
              s === status
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-background text-muted hover:text-foreground"
            }`}
          >
            {s || "All"}
          </Link>
        ))}
      </div>

      <Card title={`${(count ?? 0).toLocaleString()} orders`} flush>
        <Table
          head={["Created", "Account", "Plan", "Amount", "Provider", "Promo", "Status", "Checkout"]}
          rows={rows.length}
          empty="No orders with this status."
        >
          {rows.map((o) => (
            <tr key={o.id} className={tr}>
              <td className={`${td} whitespace-nowrap text-muted`}>{fmtDate(o.created_at)}</td>
              <td className={td}>
                <Link href={`/admin/users/${o.user_id}`} className={link}>
                  {(o.profiles as unknown as { email: string } | null)?.email ?? o.user_id}
                </Link>
              </td>
              <td className={td}>
                <StatusBadge value={o.plan} />
              </td>
              <td className={`${td} whitespace-nowrap font-semibold`}>{fmtMoney(o.amount_cents, o.currency)}</td>
              <td className={`${td} text-muted`}>{o.provider}</td>
              <td className={td}>{o.promo_code ? <code className="font-mono text-xs">{o.promo_code}</code> : <span className="text-muted">-</span>}</td>
              <td className={td}>
                <StatusBadge value={o.status} />
              </td>
              <td className={`${td} break-all font-mono text-xs text-muted`}>{o.checkout_id ?? "-"}</td>
            </tr>
          ))}
        </Table>
        <Pagination page={page} pages={pages} link={pageLink} />
      </Card>
    </>
  );
}
