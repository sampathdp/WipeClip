import { requireAdmin } from "@/lib/admin";
import { PLANS, type PlanKey } from "@/lib/credits";
import { livePromo, promoSettings } from "@/lib/promo";
import { savePromo } from "@/app/admin/actions";
import { Card, Field, Notice, PageHeader, Stat, button, fmtDate, fmtMoney, input, one, type SearchParams, type Tone } from "@/app/admin/ui";

/** datetime-local value (UTC) from an ISO date. */
const local = (iso: string | null | undefined) => (iso ? iso.slice(0, 16) : "");

/** Starting values for a first promotion: ends 14 days from now, any account.
 * Outside the component so the purity lint rule allows the clock read. */
function defaults() {
  const now = new Date();
  return {
    endsAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) + "T23:59",
  };
}

const STATUS_TONE: Record<string, Tone> = { Live: "success", Off: "neutral", Ended: "neutral", Incomplete: "warning" };

export default async function AdminPromotion({ searchParams }: { searchParams: SearchParams }) {
  const { admin } = await requireAdmin();
  const notice = one((await searchParams).notice);
  const s = await promoSettings(admin);
  const live = livePromo(s);
  const d = defaults();

  const { data: orders } = s?.code
    ? await admin.from("payment_orders").select("amount_cents, currency").eq("promo_code", s.code).eq("status", "paid")
    : { data: [] };
  const revenue = new Map<string, number>();
  for (const o of orders ?? []) revenue.set(o.currency, (revenue.get(o.currency) ?? 0) + o.amount_cents);

  const status = live ? "Live" : !s?.enabled ? "Off" : s.ends_at && new Date(s.ends_at) <= new Date() ? "Ended" : "Incomplete";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "";
  const plans = (s?.plans ?? ["starter", "pro"]) as string[];

  return (
    <>
      <PageHeader title="Promotion" description="One discount code for the pricing page and the newsletter." />
      <Notice text={notice} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Status" value={status} tone={STATUS_TONE[status]} hint={s?.code ? `Code ${s.code}` : undefined} />
        <Stat label="Paid orders with code" value={(orders ?? []).length} tone="accent" />
        {[...revenue].map(([currency, cents]) => (
          <Stat key={currency} label="Discounted revenue" value={fmtMoney(cents, currency)} tone="info" />
        ))}
      </div>

      {live && (
        <Card title="Offer link" description="The newsletter uses this link. Eligible signed-in accounts get the discount at checkout, once per account.">
          <code className="block break-all rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs">{`${siteUrl}/pricing?promo=${live.code}`}</code>
        </Card>
      )}

      <Card title="Settings" description="Applies to the next checkout, no redeploy needed.">
        <form action={savePromo} className="grid gap-5 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface-2 px-4 py-3 sm:col-span-2">
            <span>
              <span className="block text-sm font-semibold">Promotion is on</span>
              <span className="block text-xs text-muted">Turning it off archives the matching Paddle discount.</span>
            </span>
            <input type="checkbox" name="enabled" value="1" defaultChecked={s?.enabled ?? false} className="h-5 w-5 accent-[var(--accent)]" />
          </label>

          <Field label="Code" hint="Carried by the email link. Letters, digits, - or _.">
            <input name="code" defaultValue={s?.code ?? "THANKYOU50"} className={`${input} w-full font-mono uppercase`} />
          </Field>

          <Field label="Percent off">
            <input name="percent" type="number" min={1} max={99} defaultValue={s?.percent ?? 50} className={`${input} w-full`} />
          </Field>

          <Field label="Ends (UTC)">
            <input name="endsAt" type="datetime-local" defaultValue={local(s?.ends_at) || d.endsAt} className={`${input} w-full`} />
          </Field>

          <Field label="Only accounts created before (UTC)" hint="Optional. Leave empty so any account can use it once.">
            <input name="accountsBefore" type="datetime-local" defaultValue={local(s?.accounts_before)} className={`${input} w-full`} />
          </Field>

          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-xs font-semibold text-foreground">Plans it applies to</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(PLANS) as PlanKey[]).map((k) => (
                <label
                  key={k}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-sm transition hover:bg-surface-2 has-[:checked]:border-accent has-[:checked]:bg-accent/5"
                >
                  <input type="checkbox" name="plans" value={k} defaultChecked={plans.includes(k)} className="h-4 w-4 accent-[var(--accent)]" />
                  <span>
                    <span className="block font-semibold">
                      {PLANS[k].label}
                      {PLANS[k].period ? ` (${PLANS[k].period === "year" ? "1 year" : "30 days"})` : ""}
                    </span>
                    <span className="block text-xs text-muted">{PLANS[k].priceLabel}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-4 border-t border-border pt-5 sm:col-span-2">
            <button className={button}>Save promotion</button>
            <p className="flex-1 text-[11px] text-muted">
              Saving also creates or updates the matching Paddle discount (same percent, plans and end date).
            </p>
          </div>
        </form>
      </Card>

      <Card title="Details">
        <dl className="divide-y divide-border text-sm">
          <div className="flex flex-wrap justify-between gap-2 pb-2.5">
            <dt className="text-muted">Paddle discount</dt>
            <dd className="font-mono text-xs">{s?.paddle_discount_id ?? "none yet"}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2 py-2.5">
            <dt className="text-muted">Last saved</dt>
            <dd>
              {fmtDate(s?.updated_at)} {s?.updated_by ? `by ${s.updated_by}` : ""}
            </dd>
          </div>
        </dl>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">
          <li>
            Customers enter the code on the pricing page (or open the email link). Each account can use it once; Paddle&apos;s own
            discount box is hidden.
          </li>
          <li>Payments.lk (Sri Lanka) checkouts are discounted directly by the server.</li>
        </ul>
      </Card>
    </>
  );
}
