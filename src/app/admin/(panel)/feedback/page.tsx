import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { updateFeedback } from "@/app/admin/actions";
import { Badge, Card, EmptyState, Notice, PageHeader, StatusBadge, button, fmtDate, input, link, one, type SearchParams } from "@/app/admin/ui";

const STATUSES = ["open", "in_progress", "resolved", "closed"];

export default async function AdminFeedback({ searchParams }: { searchParams: SearchParams }) {
  const { admin } = await requireAdmin();
  const params = await searchParams;
  const status = one(params.status) || "active";

  let query = admin.from("feedback").select("*").order("created_at", { ascending: false }).limit(100);
  if (status === "active") query = query.in("status", ["open", "in_progress"]);
  else if (STATUSES.includes(status)) query = query.eq("status", status);
  const { data } = await query;
  const items = data ?? [];

  return (
    <>
      <PageHeader title="Feedback" description="Bug reports and requests from users. Replies show up under Your requests." />
      <Notice text={one(params.notice)} />

      <div className="flex flex-wrap gap-2">
        {["active", ...STATUSES, "all"].map((s) => (
          <Link
            key={s}
            href={`/admin/feedback?status=${s}`}
            className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition ${
              s === status
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-background text-muted hover:text-foreground"
            }`}
          >
            {s.replace("_", " ")}
          </Link>
        ))}
      </div>

      {items.length === 0 && (
        <Card>
          <EmptyState title="Nothing here.">No feedback with this status.</EmptyState>
        </Card>
      )}

      {items.map((f) => (
        <Card
          key={f.id}
          title={
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">{f.kind}</Badge>
              <StatusBadge value={f.status} />
              <span>{f.subject}</span>
            </span>
          }
          description={
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              <span>#{f.id}</span>
              <span>{fmtDate(f.created_at)}</span>
              <span>
                {f.user_id ? (
                  <Link href={`/admin/users/${f.user_id}`} className={link}>
                    {f.email ?? "account"}
                  </Link>
                ) : (
                  (f.email ?? "anonymous")
                )}
              </span>
              {f.page_url && <span className="break-all">{f.page_url}</span>}
            </span>
          }
        >
          <p className="whitespace-pre-wrap rounded-xl bg-surface-2 p-4 text-sm leading-relaxed text-foreground">{f.message}</p>

          <form action={updateFeedback} className="mt-4 space-y-3">
            <input type="hidden" name="id" value={f.id} />
            <textarea
              name="reply"
              defaultValue={f.admin_reply ?? ""}
              rows={3}
              placeholder="Write a reply (shown to the user under Your requests)"
              className={`${input} w-full`}
            />
            <div className="flex flex-wrap items-center gap-3">
              <select name="status" defaultValue={f.status} className={input} aria-label="Status">
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
              {f.email && (
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" name="emailReply" value="1" className="h-4 w-4 accent-[var(--accent)]" /> Also email the reply to{" "}
                  {f.email}
                </label>
              )}
              <button className={`${button} ml-auto`}>Save</button>
            </div>
          </form>
        </Card>
      ))}
    </>
  );
}
