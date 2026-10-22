import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { effectivePlan } from "@/lib/plan";
import { Country } from "@/app/admin/charts";
import {
  Badge,
  Card,
  Notice,
  PageHeader,
  Pagination,
  StatusBadge,
  Table,
  button,
  buttonSecondary,
  fmtDate,
  input,
  link,
  one,
  td,
  tr,
  type SearchParams,
} from "@/app/admin/ui";

const PAGE_SIZE = 50;

export default async function AdminUsers({ searchParams }: { searchParams: SearchParams }) {
  const { admin } = await requireAdmin();
  const params = await searchParams;
  const q = one(params.q).slice(0, 100);
  const plan = one(params.plan);
  const page = Math.max(1, Number(one(params.page)) || 1);

  let query = admin
    .from("profiles")
    .select("id, email, plan, plan_expires_at, tester_access, paid_credits, marketing_opt_out, country, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  // Escaped for ilike: % and _ are wildcards, and a comma would break the filter.
  if (q) query = query.ilike("email", `%${q.replace(/[%_\\,]/g, (c) => `\\${c}`)}%`);
  if (plan) query = query.eq("plan", plan);
  const { data, count, error } = await query;

  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const pageLink = (p: number) => `/admin/users?${new URLSearchParams({ q, plan, page: String(p) })}`;
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Users" description="Find an account to see its plan, credits and orders, or to grant access." />
      <Notice text={one(params.notice) || (error ? `Failed: ${error.message}` : "")} />

      <Card
        title={`${(count ?? 0).toLocaleString()} accounts`}
        actions={
          <form className="flex w-full flex-wrap gap-2 sm:w-auto">
            <input name="q" type="search" defaultValue={q} placeholder="Search by email…" className={`${input} min-w-0 flex-1 sm:w-64`} />
            <select name="plan" defaultValue={plan} className={input}>
              <option value="">All plans</option>
              <option value="free">Free</option>
              <option value="lite">Lite</option>
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
            </select>
            <button className={button}>Search</button>
            {(q || plan) && (
              <Link href="/admin/users" className={buttonSecondary}>
                Clear
              </Link>
            )}
          </form>
        }
        flush
      >
        <Table
          head={["Email", "Country", "Plan now", "Pass ends", "Paid credits", "Marketing email", "Joined"]}
          rows={rows.length}
          empty={q || plan ? "No accounts match these filters." : "No accounts yet."}
        >
          {rows.map((u) => (
            <tr key={u.id} className={tr}>
              <td className={td}>
                <Link href={`/admin/users/${u.id}`} className={link}>
                  {u.email}
                </Link>
              </td>
              <td className={`${td} text-muted`}>
                <Country code={u.country} />
              </td>
              <td className={td}>
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <StatusBadge value={effectivePlan(u)} />
                  {u.tester_access && <Badge tone="info">Tester</Badge>}
                </span>
              </td>
              <td className={`${td} whitespace-nowrap text-muted`}>{u.plan === "free" ? "-" : fmtDate(u.plan_expires_at)}</td>
              <td className={`${td} font-semibold`}>{u.paid_credits}</td>
              <td className={td}>
                {u.marketing_opt_out ? <Badge>Unsubscribed</Badge> : <Badge tone="success">Subscribed</Badge>}
              </td>
              <td className={`${td} whitespace-nowrap text-muted`}>{fmtDate(u.created_at)}</td>
            </tr>
          ))}
        </Table>
        <Pagination page={page} pages={pages} link={pageLink} />
      </Card>
    </>
  );
}
