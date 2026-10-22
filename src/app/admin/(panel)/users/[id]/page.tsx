import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { effectivePlan } from "@/lib/plan";
import { PLANS, type PlanKey } from "@/lib/credits";
import { TIERS, TIER_LABELS } from "@/lib/entitlements";
import { addCredits, grantPlan, removeCredits, setMarketing, setPlan, setTesterAccess } from "@/app/admin/actions";
import {
  Badge,
  Card,
  Notice,
  PageHeader,
  Stat,
  StatusBadge,
  Table,
  button,
  buttonSecondary,
  fmtDate,
  fmtMoney,
  input,
  one,
  td,
  tr,
  type SearchParams,
} from "@/app/admin/ui";

export default async function AdminUser({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { admin } = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const notice = one((await searchParams).notice);

  const [{ data: profile }, { data: auth }, { data: orders }, { data: txns }] = await Promise.all([
    admin.from("profiles").select("*").eq("id", id).single(),
    admin.auth.admin.getUserById(id),
    admin.from("payment_orders").select("*").eq("user_id", id).order("created_at", { ascending: false }).limit(20),
    admin.from("credit_transactions").select("*").eq("user_id", id).order("id", { ascending: false }).limit(30),
  ]);
  if (!profile) notFound();
  const authUser = auth?.user;
  const expires = profile.plan_expires_at ? String(profile.plan_expires_at).slice(0, 10) : "";
  const plan = effectivePlan(profile);

  const details: [string, React.ReactNode][] = [
    ["Stored plan", profile.plan],
    ["Email confirmed", fmtDate(authUser?.email_confirmed_at)],
    ["Last sign-in", fmtDate(authUser?.last_sign_in_at)],
    ["Joined", fmtDate(profile.created_at)],
    [
      "Marketing email",
      profile.marketing_opt_out ? `Unsubscribed ${fmtDate(profile.marketing_opt_out_at)}` : "Subscribed",
    ],
    ["Paddle customer", <span key="c" className="break-all font-mono text-xs">{profile.paddle_customer_id ?? "-"}</span>],
    ["Account id", <span key="i" className="break-all font-mono text-xs">{profile.id}</span>],
  ];

  return (
    <>
      <PageHeader
        back={{ href: "/admin/users", label: "All users" }}
        title={profile.email}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge value={plan} />
            {profile.tester_access && <Badge tone="info">Tester</Badge>}
            {profile.marketing_opt_out ? <Badge>Unsubscribed</Badge> : <Badge tone="success">Subscribed</Badge>}
            {!authUser?.email_confirmed_at && <Badge tone="warning">Email not confirmed</Badge>}
          </span>
        }
      />
      <Notice text={notice} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Plan now" value={<span className="capitalize">{plan}</span>} tone="accent" hint={plan === "free" ? undefined : `Ends ${fmtDate(profile.plan_expires_at)}`} />
        <Stat label="Paid credits" value={profile.paid_credits} tone="success" />
        <Stat label="Free credits today" value={profile.free_credits} tone="info" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Card title="Account details">
            <dl className="divide-y divide-border text-sm">
              {details.map(([k, v]) => (
                <div key={k} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-3">
          <Card
            title="Tester access"
            description={
              profile.tester_access
                ? "On: Pro with no end date, and AI jobs use no credits. Turning it off moves the account back to Free."
                : "Free full access for testing: Pro with no end date, and AI jobs use no credits."
            }
          >
            <form action={setTesterAccess}>
              <input type="hidden" name="userId" value={id} />
              <input type="hidden" name="on" value={profile.tester_access ? "0" : "1"} />
              <button className={`${profile.tester_access ? buttonSecondary : button} w-full`}>
                {profile.tester_access ? "Turn off tester access" : "Give free full access"}
              </button>
            </form>
          </Card>

          <Card title="Grant a plan or credit pack" description="Same as a purchase: adds the credits and starts or extends the pass. Use for manual payments.">
            <form action={grantPlan} className="flex flex-wrap gap-2">
              <input type="hidden" name="userId" value={id} />
              <select name="plan" className={`${input} min-w-0 flex-1`} defaultValue="starter">
                {(Object.keys(PLANS) as PlanKey[]).map((k) => (
                  <option key={k} value={k}>
                    {PLANS[k].label}
                    {PLANS[k].period ? ` (${PLANS[k].period === "year" ? "1 year" : "30 days"})` : ""} - {PLANS[k].credits} credits
                  </option>
                ))}
              </select>
              <button className={button}>Grant</button>
            </form>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="Add credits" description="Adds paid credits only.">
              <form action={addCredits} className="flex gap-2">
                <input type="hidden" name="userId" value={id} />
                <input name="amount" type="number" min={1} max={10000} required placeholder="e.g. 50" className={`${input} min-w-0 flex-1`} />
                <button className={button}>Add</button>
              </form>
            </Card>

            <Card title="Remove credits" description="Takes paid credits back, e.g. after a refund. Stops at 0.">
              <form action={removeCredits} className="flex gap-2">
                <input type="hidden" name="userId" value={id} />
                <input name="amount" type="number" min={1} max={10000} required placeholder="e.g. 50" className={`${input} min-w-0 flex-1`} />
                <button className={buttonSecondary}>Remove</button>
              </form>
            </Card>

            <Card title="Marketing email" description={profile.marketing_opt_out ? "This account gets no newsletters." : "This account can receive newsletters."}>
              <form action={setMarketing}>
                <input type="hidden" name="userId" value={id} />
                <input type="hidden" name="optOut" value={profile.marketing_opt_out ? "0" : "1"} />
                <button className={`${buttonSecondary} w-full`}>{profile.marketing_opt_out ? "Subscribe again" : "Unsubscribe"}</button>
              </form>
            </Card>
          </div>

          <Card title="Correct plan and end date" description="No end date means the pass never lapses. Credits are not changed.">
            <form action={setPlan} className="flex flex-wrap gap-2">
              <input type="hidden" name="userId" value={id} />
              <select name="plan" defaultValue={profile.plan} className={input}>
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {TIER_LABELS[t]}
                  </option>
                ))}
              </select>
              <input name="expires" type="date" defaultValue={expires} className={`${input} min-w-0 flex-1`} />
              <button className={buttonSecondary}>Save</button>
            </form>
          </Card>
        </div>
      </div>

      <Card title="Orders" description="Latest 20." flush>
        <Table head={["Created", "Plan", "Amount", "Provider", "Promo", "Status", "Paid"]} rows={(orders ?? []).length} empty="No orders from this account.">
          {(orders ?? []).map((o) => (
            <tr key={o.id} className={tr}>
              <td className={`${td} whitespace-nowrap text-muted`}>{fmtDate(o.created_at)}</td>
              <td className={td}>
                <StatusBadge value={o.plan} />
              </td>
              <td className={`${td} whitespace-nowrap font-semibold`}>{fmtMoney(o.amount_cents, o.currency)}</td>
              <td className={`${td} text-muted`}>{o.provider}</td>
              <td className={td}>{o.promo_code ? <code className="font-mono text-xs">{o.promo_code}</code> : <span className="text-muted">-</span>}</td>
              <td className={td}>
                <StatusBadge value={o.status} />
              </td>
              <td className={`${td} whitespace-nowrap text-muted`}>{fmtDate(o.paid_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Credit history" description="Latest 30 changes." flush>
        <Table head={["When", "Kind", "Amount", "Tool", "Reference"]} rows={(txns ?? []).length} empty="No credit changes yet.">
          {(txns ?? []).map((t) => (
            <tr key={t.id} className={tr}>
              <td className={`${td} whitespace-nowrap text-muted`}>{fmtDate(t.created_at)}</td>
              <td className={td}>
                <Badge>{t.kind}</Badge>
              </td>
              <td className={`${td} font-mono font-semibold ${t.amount > 0 ? "text-success" : "text-danger"}`}>
                {t.amount > 0 ? `+${t.amount}` : t.amount}
              </td>
              <td className={`${td} text-muted`}>{t.tool ?? "-"}</td>
              <td className={`${td} break-all font-mono text-xs text-muted`}>{t.ls_event_id ?? "-"}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
