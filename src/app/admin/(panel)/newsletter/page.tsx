import { requireAdmin } from "@/lib/admin";
import { currentPromo } from "@/lib/promo";
import { PLANS } from "@/lib/credits";
import { eligibleRecipients, newsletterConfig, previewMessage, promoEndsOn, sentIds } from "@/lib/newsletter";
import { sendNewsletterBatch, sendNewsletterTest } from "@/app/admin/actions";
import { Badge, Card, Field, Notice, PageHeader, Stat, button, buttonSecondary, input, one, type SearchParams } from "@/app/admin/ui";

// A 500-email send is 5 Resend calls a second apart, plus the recipient
// lookup - give the action room beyond the platform default.
export const maxDuration = 120;

function Step({ n, title, description, children }: { n: number; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="flex gap-4 rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">{n}</span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-bold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
        <div className="mt-4">{children}</div>
      </div>
    </section>
  );
}

export default async function AdminNewsletter({ searchParams }: { searchParams: SearchParams }) {
  const { admin, user } = await requireAdmin();
  const params = await searchParams;
  const config = newsletterConfig();
  const promo = await currentPromo(admin);
  const campaign = /^[a-z0-9-]{3,60}$/.test(one(params.campaign))
    ? one(params.campaign)
    : `promo-${(promo?.code ?? "none").toLowerCase().replace(/[^a-z0-9-]/g, "")}`;

  let stats: { eligible: number; sent: number; remaining: number } | null = null;
  let statsError = "";
  if (promo) {
    try {
      const [all, done] = await Promise.all([eligibleRecipients(admin, promo), sentIds(admin, campaign)]);
      const remaining = all.filter((r) => !done.has(r.id)).length;
      stats = { eligible: all.length, sent: done.size, remaining };
    } catch (e) {
      statsError = e instanceof Error ? e.message : "Could not load recipients.";
    }
  }
  // Rendered for the signed-in admin, exactly as their own copy would look.
  const metaName = user.user_metadata?.full_name ?? user.user_metadata?.name;
  const preview = promo
    ? previewMessage(promo, campaign, {
        id: user.id,
        email: user.email ?? "",
        name: typeof metaName === "string" ? metaName : null,
      })
    : null;

  const { count: unsubscribed } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("marketing_opt_out", true);

  const sendingReady = !("error" in config);
  const progress = stats && stats.eligible > 0 ? Math.round((stats.sent / stats.eligible) * 100) : 0;

  return (
    <>
      <PageHeader title="Newsletter" description="Email the current promotion to subscribed accounts, in batches." />
      <Notice text={one(params.notice) || statsError} />

      <Card title="Setup" description="Change the offer under Promotion. Full guide: docs/NEWSLETTER.md.">
        <dl className="divide-y divide-border text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2 pb-3">
            <dt className="text-muted">Sending</dt>
            <dd className="text-right">
              {sendingReady ? (
                <span className="inline-flex flex-wrap items-center justify-end gap-2">
                  <Badge tone="success">Ready</Badge>
                  <span className="text-xs text-muted">from {config.from}</span>
                </span>
              ) : (
                <span className="inline-flex flex-wrap items-center justify-end gap-2">
                  <Badge tone="danger">Not set</Badge>
                  <span className="text-xs text-muted">{config.error}</span>
                </span>
              )}
            </dd>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-2 pt-3">
            <dt className="text-muted">Promotion</dt>
            <dd className="max-w-xl text-right">
              {promo ? (
                <span className="text-xs">
                  <Badge tone="success">Live</Badge>{" "}
                  {promo.percent}% off {promo.plans.map((p) => PLANS[p]?.label ?? p).join(", ")} with code{" "}
                  <code className="font-mono font-semibold">{promo.code}</code>, until {promoEndsOn(promo)}
                  {promo.accountsBefore ? `, accounts created before ${promo.accountsBefore.toISOString().slice(0, 10)}` : ""}
                  {promo.paddleDiscountId ? "" : " - no Paddle discount, so card buyers outside Sri Lanka pay full price"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Badge tone="danger">None live</Badge>
                  <span className="text-xs text-muted">turn one on under Promotion</span>
                </span>
              )}
            </dd>
          </div>
        </dl>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Eligible recipients" value={stats?.eligible ?? "-"} hint="Confirmed and subscribed" tone="accent" />
        <Stat label="Already sent" value={stats?.sent ?? "-"} hint={campaign} tone="success" />
        <Stat label="Still to send" value={stats?.remaining ?? "-"} tone={stats?.remaining ? "warning" : "neutral"} />
        <Stat label="Unsubscribed (all time)" value={unsubscribed ?? 0} />
      </div>

      {stats && stats.eligible > 0 && (
        <div>
          <div className="mb-1.5 flex justify-between text-xs text-muted">
            <span>Campaign progress</span>
            <span className="font-semibold text-foreground">{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <Card>
        <form className="flex flex-wrap items-end gap-2">
          <Field label="Campaign" hint="Sends are tracked per campaign name, so nobody gets the same one twice." className="min-w-0 flex-1">
            <input id="campaign" name="campaign" defaultValue={campaign} className={`${input} w-full font-mono`} />
          </Field>
          <button className={`${buttonSecondary} mb-[22px]`}>Switch</button>
        </form>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Step n={1} title="Send a test to yourself" description="Check SPF, DKIM and DMARC say PASS, with an Unsubscribe link next to the sender.">
          <form action={sendNewsletterTest}>
            <input type="hidden" name="campaign" value={campaign} />
            <button className={buttonSecondary} disabled={!promo || !sendingReady}>
              Send test email
            </button>
          </form>
        </Step>

        <Step
          n={2}
          title="Send to the next accounts"
          description="Up to 500 per click. On a new domain, start around 200 a day and roughly double each day."
        >
          <form action={sendNewsletterBatch} className="flex flex-wrap gap-2">
            <input type="hidden" name="campaign" value={campaign} />
            <input name="count" type="number" min={1} max={500} defaultValue={200} aria-label="How many" className={`${input} w-24`} />
            <input name="confirm" placeholder="Type SEND" autoComplete="off" aria-label="Confirm" className={`${input} w-32 font-mono`} />
            <button className={button} disabled={!promo || !sendingReady || stats?.remaining === 0}>
              Send batch
            </button>
          </form>
        </Step>
      </div>

      <Card title="Preview" description="Rendered for your own account, exactly as it would arrive.">
        {preview ? (
          <>
            <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-surface-2 p-4 text-xs">
              <dt className="text-muted">From</dt>
              <dd>{preview.from}</dd>
              <dt className="text-muted">Reply-To</dt>
              <dd>{preview.replyTo}</dd>
              <dt className="text-muted">Subject</dt>
              <dd className="font-semibold">{preview.subject}</dd>
            </dl>
            {/* sandbox: the email is shown, never run - and its links open outside the panel. */}
            <iframe
              title="Email preview"
              srcDoc={preview.html}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              className="h-[900px] w-full rounded-xl border border-border bg-white"
            />
            <details className="mt-4 text-xs">
              <summary className="cursor-pointer font-semibold text-muted hover:text-foreground">Plain-text version</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-border bg-surface-2 p-4 font-mono">{preview.text}</pre>
            </details>
          </>
        ) : (
          <p className="text-sm text-muted">Turn a promotion on under Promotion to preview the email.</p>
        )}
      </Card>
    </>
  );
}
