"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { PLANS, type PlanKey } from "@/lib/credits";
import { TIERS, type Tier } from "@/lib/entitlements";
import { escapeHtml, sendEmail } from "@/lib/email";
import { currentPromo } from "@/lib/promo";
import { PaddleError, paddleEnvironment, priceIdFor, syncPromoDiscount } from "@/lib/paddle";
import { eligibleRecipients, newsletterConfig, newsletterMessage, sendCampaign, sendResendBatch, sentIds } from "@/lib/newsletter";

// Every action re-checks the admin itself: server actions are plain POST
// endpoints, reachable without going through the admin layout. Each one ends
// by redirecting back with ?notice=, which the page shows as a banner.

const UUID_RE = /^[0-9a-f-]{36}$/i;

function str(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function back(path: string, notice: string): never {
  revalidatePath("/admin", "layout");
  redirect(`${path}?notice=${encodeURIComponent(notice)}`);
}

/** Same as a purchase webhook: adds the plan's credits and starts (or
 * extends) its pass. For payments taken by hand, e.g. over WhatsApp. */
export async function grantPlan(form: FormData) {
  const { admin, user } = await requireAdmin();
  const userId = str(form, "userId");
  const plan = str(form, "plan") as PlanKey;
  if (!UUID_RE.test(userId) || !Object.hasOwn(PLANS, plan)) back("/admin/users", "Unknown account or plan.");
  const { credits, tier, days } = PLANS[plan];
  const { error } = await admin.rpc("grant_paid_credits", {
    p_user_id: userId,
    p_amount: credits,
    p_event_id: `admin:${user.email}:${randomUUID()}`,
    p_plan: tier,
    p_plan_days: days,
  });
  back(`/admin/users/${userId}`, error ? `Failed: ${error.message}` : `Granted ${PLANS[plan].label}${days ? ` (${days} days)` : ""} and ${credits} credits.`);
}

export async function addCredits(form: FormData) {
  const { admin, user } = await requireAdmin();
  const userId = str(form, "userId");
  const amount = Number(str(form, "amount"));
  if (!UUID_RE.test(userId) || !Number.isInteger(amount) || amount < 1 || amount > 10000) {
    back(`/admin/users/${userId}`, "Credits must be a whole number from 1 to 10000.");
  }
  const { error } = await admin.rpc("grant_paid_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_event_id: `admin:${user.email}:${randomUUID()}`,
  });
  back(`/admin/users/${userId}`, error ? `Failed: ${error.message}` : `Added ${amount} credits.`);
}

/** Direct correction of the tier and its end date, without touching credits. */
export async function setPlan(form: FormData) {
  const { admin } = await requireAdmin();
  const userId = str(form, "userId");
  const plan = str(form, "plan") as Tier;
  const expires = str(form, "expires");
  if (!UUID_RE.test(userId) || !TIERS.includes(plan)) back("/admin/users", "Unknown account or plan.");
  const expiresAt = expires ? new Date(`${expires}T23:59:59Z`) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) back(`/admin/users/${userId}`, "That end date isn't valid.");
  const { error } = await admin
    .from("profiles")
    .update({ plan, plan_expires_at: plan === "free" ? null : (expiresAt?.toISOString() ?? null) })
    .eq("id", userId);
  back(`/admin/users/${userId}`, error ? `Failed: ${error.message}` : "Plan updated.");
}

export async function setMarketing(form: FormData) {
  const { admin } = await requireAdmin();
  const userId = str(form, "userId");
  const optOut = str(form, "optOut") === "1";
  if (!UUID_RE.test(userId)) back("/admin/users", "Unknown account.");
  const { error } = await admin
    .from("profiles")
    .update({ marketing_opt_out: optOut, marketing_opt_out_at: optOut ? new Date().toISOString() : null })
    .eq("id", userId);
  back(`/admin/users/${userId}`, error ? `Failed: ${error.message}` : optOut ? "Unsubscribed from marketing email." : "Subscribed to marketing email.");
}

const FEEDBACK_STATUSES = ["open", "in_progress", "resolved", "closed"];

export async function updateFeedback(form: FormData) {
  const { admin } = await requireAdmin();
  const id = Number(str(form, "id"));
  const status = str(form, "status");
  const reply = str(form, "reply").slice(0, 5000);
  const emailReply = str(form, "emailReply") === "1";
  if (!Number.isInteger(id) || !FEEDBACK_STATUSES.includes(status)) back("/admin/feedback", "Unknown feedback or status.");

  const { data, error } = await admin
    .from("feedback")
    .update({ status, admin_reply: reply || null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("email, subject")
    .single();
  if (error) back("/admin/feedback", `Failed: ${error.message}`);

  let note = "Saved.";
  if (emailReply && reply && data?.email) {
    const sent = await sendEmail({
      to: data.email,
      subject: `Re: ${data.subject}`,
      text: `${reply}\n\n- The WipeClip team`,
      html: `<p>${escapeHtml(reply).replace(/\n/g, "<br>")}</p><p>- The WipeClip team</p>`,
      replyTo: process.env.EMAIL_REPLY_TO?.trim() || "support@wipeclip.co",
    });
    note = sent ? "Saved and emailed." : "Saved, but the email could not be sent.";
  }
  back("/admin/feedback", note);
}

const CAMPAIGN_RE = /^[a-z0-9-]{3,60}$/;

/** One copy to the signed-in admin's own address, marked [TEST]. */
export async function sendNewsletterTest(form: FormData) {
  const { user, admin } = await requireAdmin();
  const campaign = str(form, "campaign");
  const config = newsletterConfig();
  const promo = await currentPromo(admin);
  if ("error" in config) back("/admin/newsletter", config.error);
  if (!promo) back("/admin/newsletter", "No live promotion - turn one on under Promotion.");
  if (!CAMPAIGN_RE.test(campaign)) back("/admin/newsletter", "Campaign: lowercase letters, digits and dashes.");
  const name = user.user_metadata?.full_name ?? user.user_metadata?.name;
  const msg = newsletterMessage(config, promo, campaign, {
    id: user.id,
    email: user.email!,
    name: typeof name === "string" ? name : null,
  });
  let notice = `Test sent to ${user.email}.`;
  try {
    await sendResendBatch(config.apiKey, [{ ...msg, subject: `[TEST] ${msg.subject}` }], `${campaign}-test-${Date.now()}`);
  } catch (e) {
    notice = e instanceof Error ? e.message : "Test send failed.";
  }
  back("/admin/newsletter", notice);
}

/** Sends the campaign to the next `count` eligible accounts not yet sent
 * it. Capped per click so one request stays well inside the time limit
 * and the domain warms up gradually. */
export async function sendNewsletterBatch(form: FormData) {
  const { admin } = await requireAdmin();
  const campaign = str(form, "campaign");
  const count = Number(str(form, "count"));
  const config = newsletterConfig();
  const promo = await currentPromo(admin);
  if ("error" in config) back("/admin/newsletter", config.error);
  if (!promo) back("/admin/newsletter", "No live promotion - turn one on under Promotion.");
  if (!CAMPAIGN_RE.test(campaign)) back("/admin/newsletter", "Campaign: lowercase letters, digits and dashes.");
  if (str(form, "confirm") !== "SEND") back(`/admin/newsletter`, 'Type SEND to confirm.');
  if (!Number.isInteger(count) || count < 1 || count > 500) back("/admin/newsletter", "Send 1 to 500 at a time.");

  let notice: string;
  try {
    const [all, done] = await Promise.all([eligibleRecipients(admin, promo), sentIds(admin, campaign)]);
    const pending = all.filter((r) => !done.has(r.id)).slice(0, count);
    const sent = await sendCampaign(admin, config, promo, campaign, pending);
    notice = sent ? `Sent ${sent} emails for ${campaign}.` : `Nobody left to send ${campaign} to.`;
  } catch (e) {
    notice = e instanceof Error ? e.message : "Send failed.";
  }
  back("/admin/newsletter", notice);
}

const PROMO_CODE_RE = /^[A-Z0-9_-]{3,40}$/;

/** A datetime-local value ("2026-11-04T23:59"), read as UTC. */
function utcDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(/Z$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Saves the promotion (promo_settings) and creates or updates the matching
 * Paddle discount so card checkouts outside Sri Lanka get the same offer.
 * Takes effect on the next checkout - no redeploy. */
export async function savePromo(form: FormData) {
  const { admin, user } = await requireAdmin();
  const enabled = str(form, "enabled") === "1";
  const code = str(form, "code").toUpperCase();
  const percent = Number(str(form, "percent"));
  const plans = form.getAll("plans").filter((p): p is PlanKey => typeof p === "string" && Object.hasOwn(PLANS, p));
  const endsAt = utcDate(str(form, "endsAt"));
  const accountsBefore = utcDate(str(form, "accountsBefore"));

  if (code && !PROMO_CODE_RE.test(code)) back("/admin/promotion", "Code: 3 to 40 letters, digits, dashes or underscores.");
  if (str(form, "percent") && (!Number.isInteger(percent) || percent < 1 || percent > 99)) {
    back("/admin/promotion", "Percent must be a whole number from 1 to 99.");
  }
  if (str(form, "endsAt") && !endsAt) back("/admin/promotion", "That end date isn't valid.");
  if (str(form, "accountsBefore") && !accountsBefore) back("/admin/promotion", "That account cut-off date isn't valid.");
  if (enabled && (!code || !percent || plans.length === 0 || !endsAt)) {
    back("/admin/promotion", "To turn it on, fill in the code, percent, at least one plan and the end date.");
  }
  if (enabled && endsAt! <= new Date()) back("/admin/promotion", "The end date must be in the future.");

  const { data: existing } = await admin.from("promo_settings").select("paddle_discount_id").eq("id", 1).maybeSingle();
  let paddleDiscountId: string | null = existing?.paddle_discount_id ?? null;
  let paddleNote = "";
  try {
    if (paddleEnvironment() && (paddleDiscountId || enabled)) {
      const priceIds = plans.map(priceIdFor).filter((id): id is string => Boolean(id));
      if (enabled && priceIds.length === 0) throw new PaddleError("none of the chosen plans has a PADDLE_PRICE_* id.", 400);
      paddleDiscountId = await syncPromoDiscount({
        id: paddleDiscountId,
        percent,
        priceIds,
        expiresAt: endsAt ?? new Date(),
        description: `Promotion ${code} (${percent}% off)`,
        active: enabled,
      });
      paddleNote = enabled ? " Paddle discount is in sync." : paddleDiscountId ? " Paddle discount archived." : "";
    }
  } catch (e) {
    paddleNote = ` Paddle discount NOT updated: ${e instanceof Error ? e.message : "unknown error"} - card buyers outside Sri Lanka may not get the offer.`;
  }

  const { error } = await admin.from("promo_settings").upsert({
    id: 1,
    enabled,
    code: code || null,
    percent: percent || null,
    plans,
    ends_at: endsAt?.toISOString() ?? null,
    accounts_before: accountsBefore?.toISOString() ?? null,
    paddle_discount_id: paddleDiscountId,
    updated_at: new Date().toISOString(),
    updated_by: user.email,
  });
  back("/admin/promotion", error ? `Failed: ${error.message}` : `Saved - promotion is ${enabled ? "on" : "off"}.${paddleNote}`);
}
