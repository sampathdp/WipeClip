import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS } from "./credits.ts";
import type { Promo } from "./promo.ts";
import { unsubscribeApiUrl, unsubscribePageUrl } from "./unsubscribe.ts";
import { renderPromoNewsletter } from "./emails/promoNewsletter.ts";

// Sending the promotion newsletter, shared by the admin panel
// (src/app/admin/newsletter) and scripts/send-newsletter.ts. Who has been
// sent which campaign lives in the newsletter_sends table, so either can
// send in slices and resume without anyone getting it twice. Relative
// imports with extensions so the script can load this with plain Node.

export const BATCH_SIZE = 100; // Resend's batch endpoint maximum
const BATCH_PAUSE_MS = 1000; // well under Resend's default 2 requests/second

export type Recipient = { id: string; email: string; name: string | null };

export type NewsletterConfig = {
  siteUrl: string;
  from: string;
  replyTo: string;
  apiKey: string;
};

/** The sending config from env, or the reason it isn't ready. */
export function newsletterConfig(): NewsletterConfig | { error: string } {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  const from = process.env.EMAIL_FROM?.trim();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!siteUrl) return { error: "NEXT_PUBLIC_SITE_URL is not set." };
  if (!apiKey) return { error: "RESEND_API_KEY is not set." };
  if (!from || from.includes("resend.dev")) return { error: "EMAIL_FROM must be an address on your own verified domain." };
  if ((process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim().length ?? 0) < 32) {
    return { error: "EMAIL_UNSUBSCRIBE_SECRET must be set (at least 32 characters)." };
  }
  return { siteUrl, from, apiKey, replyTo: process.env.EMAIL_REPLY_TO?.trim() || "support@wipeclip.co" };
}

/** Confirmed, active accounts that haven't opted out and are old enough for
 * the promotion. Unconfirmed addresses are skipped: they are the ones most
 * likely to bounce or belong to someone who never signed up. */
export async function eligibleRecipients(admin: SupabaseClient, promo: Promo): Promise<Recipient[]> {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }

  const optedOut = await pagedIds("id", (a, b) => admin.from("profiles").select("id").eq("marketing_opt_out", true).range(a, b));
  const now = Date.now();
  return users
    .filter((u) => u.email && u.email_confirmed_at)
    .filter((u) => !u.banned_until || new Date(u.banned_until).getTime() < now)
    .filter((u) => !optedOut.has(u.id))
    .filter((u) => !promo.accountsBefore || new Date(u.created_at) < promo.accountsBefore)
    .map((u) => {
      const raw = u.user_metadata?.full_name ?? u.user_metadata?.name;
      return { id: u.id, email: u.email!.toLowerCase(), name: typeof raw === "string" && raw.trim() ? raw.trim() : null };
    });
}

/** Account ids already sent this campaign. */
export function sentIds(admin: SupabaseClient, campaign: string): Promise<Set<string>> {
  return pagedIds("user_id", (a, b) => admin.from("newsletter_sends").select("user_id").eq("campaign", campaign).range(a, b));
}

type Page = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

async function pagedIds(column: string, page: (from: number, to: number) => Page): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await page(offset, offset + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, string>[];
    rows.forEach((r) => ids.add(r[column]));
    if (rows.length < 1000) break;
  }
  return ids;
}

export function promoEndsOn(promo: Promo): string {
  return promo.endsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function renderFor(siteUrl: string, unsubscribeUrl: string, promo: Promo, campaign: string, r: Recipient) {
  const offer = new URL("/pricing", siteUrl);
  offer.search = new URLSearchParams({ promo: promo.code, utm_source: "newsletter", utm_campaign: campaign }).toString();
  return renderPromoNewsletter({
    siteUrl,
    unsubscribeUrl,
    offerUrl: offer.toString(),
    percent: promo.percent,
    endsOn: promoEndsOn(promo),
    name: r.name,
    starter: { price: PLANS.starter.priceLabel, credits: PLANS.starter.credits },
    pro: { price: PLANS.pro.priceLabel, credits: PLANS.pro.credits },
    yearly: promo.plans.includes("starter_yearly") || promo.plans.includes("pro_yearly"),
    code: promo.code,
    existingOnly: Boolean(promo.accountsBefore),
  });
}

export function newsletterMessage(config: NewsletterConfig, promo: Promo, campaign: string, r: Recipient) {
  const { subject, html, text } = renderFor(config.siteUrl, unsubscribePageUrl(config.siteUrl, r.id), promo, campaign, r);
  return {
    from: config.from,
    to: [r.email],
    reply_to: config.replyTo,
    subject,
    html,
    text,
    headers: {
      // RFC 8058 one-click unsubscribe - required by Gmail and Yahoo for bulk mail.
      "List-Unsubscribe": `<${unsubscribeApiUrl(config.siteUrl, r.id)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tags: [{ name: "campaign", value: campaign }],
  };
}

type Message = ReturnType<typeof newsletterMessage>;

/** The email as `r` would get it, for the admin preview. Works before
 * sending is configured: a missing site URL or unsubscribe secret falls back
 * to placeholders instead of failing. */
export function previewMessage(promo: Promo, campaign: string, r: Recipient) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") || "https://wipeclip.co";
  let unsubscribeUrl = `${siteUrl}/unsubscribe`;
  try {
    unsubscribeUrl = unsubscribePageUrl(siteUrl, r.id);
  } catch {
    // EMAIL_UNSUBSCRIBE_SECRET not set yet - the unsigned link is fine for a preview.
  }
  return {
    from: process.env.EMAIL_FROM?.trim() || "(EMAIL_FROM not set)",
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || "support@wipeclip.co",
    ...renderFor(siteUrl, unsubscribeUrl, promo, campaign, r),
  };
}

/** One Resend batch call (up to 100 emails), retried on 429/5xx. The
 * idempotency key makes a retried batch deliver only once. */
export async function sendResendBatch(apiKey: string, batch: Message[], key: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(batch),
    });
    if (res.ok) return;
    const body = await res.text().catch(() => "");
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, attempt * 2000));
      continue;
    }
    throw new Error(`Resend responded ${res.status}: ${body}`);
  }
}

/** Sends the campaign to everyone in `pending`, BATCH_SIZE at a time,
 * recording each batch in newsletter_sends as soon as Resend accepts it. */
export async function sendCampaign(
  admin: SupabaseClient,
  config: NewsletterConfig,
  promo: Promo,
  campaign: string,
  pending: Recipient[],
  onProgress?: (sent: number) => void
): Promise<number> {
  let sent = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const slice = pending.slice(i, i + BATCH_SIZE);
    await sendResendBatch(
      config.apiKey,
      slice.map((r) => newsletterMessage(config, promo, campaign, r)),
      `${campaign}-${slice[0].id}-${slice.length}`
    );
    const { error } = await admin
      .from("newsletter_sends")
      .upsert(slice.map((r) => ({ campaign, user_id: r.id })), { ignoreDuplicates: true });
    if (error) throw new Error(`Sent, but could not record the batch: ${error.message}`);
    sent += slice.length;
    onProgress?.(sent);
    if (i + BATCH_SIZE < pending.length) await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
  }
  return sent;
}
