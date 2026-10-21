import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanKey } from "./credits";

// One promotion at a time, stored in the single-row promo_settings table and
// edited at /admin/promotion, so it can start, change and stop without a
// redeploy. The newsletter link carries the code (/pricing?promo=...).
// Payments.lk has no discount objects, so its amount is reduced here; Paddle
// applies its own discount (paddle_discount_id, created and kept in sync by
// the admin page) with its own rounding and tax. Kept free of "@/" imports
// so scripts/send-newsletter.ts can load it with plain Node.

export type Promo = {
  code: string;
  percent: number;
  plans: PlanKey[];
  endsAt: Date;
  accountsBefore: Date | null;
  paddleDiscountId: string | undefined;
};

export type PromoSettings = {
  enabled: boolean;
  code: string | null;
  percent: number | null;
  plans: string[];
  ends_at: string | null;
  accounts_before: string | null;
  paddle_discount_id: string | null;
  updated_at: string;
  updated_by: string | null;
};

export async function promoSettings(admin: SupabaseClient): Promise<PromoSettings | null> {
  const { data, error } = await admin.from("promo_settings").select("*").eq("id", 1).maybeSingle();
  if (error) {
    console.error("[promo] could not read promo_settings", error.message);
    return null;
  }
  return data as PromoSettings | null;
}

/** The settings as a live promotion, or null if it is off, incomplete or over. */
export function livePromo(s: PromoSettings | null, now = new Date()): Promo | null {
  if (!s?.enabled || !s.code || !s.percent || !s.ends_at) return null;
  const endsAt = new Date(s.ends_at);
  if (!(s.percent > 0 && s.percent < 100) || now >= endsAt) return null;
  return {
    code: s.code,
    percent: s.percent,
    plans: s.plans as PlanKey[],
    endsAt,
    accountsBefore: s.accounts_before ? new Date(s.accounts_before) : null,
    paddleDiscountId: s.paddle_discount_id ?? undefined,
  };
}

/** Needs a service-role client: promo_settings has no RLS policies. */
export async function currentPromo(admin: SupabaseClient): Promise<Promo | null> {
  return livePromo(await promoSettings(admin));
}

/** The promotion for this plan and code, if the code is the live one. */
export async function promoFor(admin: SupabaseClient, plan: PlanKey, code: unknown): Promise<Promo | null> {
  if (typeof code !== "string" || !code.trim()) return null;
  const promo = await currentPromo(admin);
  if (!promo || code.trim().toUpperCase() !== promo.code.toUpperCase()) return null;
  return promo.plans.includes(plan) ? promo : null;
}

/** Why this account can't use the promotion, or null if it can. Any account
 * may use it (unless an account cut-off is set), but only once: a paid order
 * already carrying the code blocks a second one. */
export async function promoBlockedReason(admin: SupabaseClient, promo: Promo, userId: string): Promise<string | null> {
  const [{ data: profile }, { count }] = await Promise.all([
    admin.from("profiles").select("created_at").eq("id", userId).single(),
    admin
      .from("payment_orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("promo_code", promo.code)
      .eq("status", "paid"),
  ]);
  if ((count ?? 0) > 0) return "You've already used this code - it works once per account.";
  if (promo.accountsBefore && (!profile || new Date(profile.created_at) >= promo.accountsBefore)) {
    return "This code is only for accounts created before the offer started.";
  }
  return null;
}

/** Whole cents after the discount, rounded to the nearest cent. */
export function discounted(amountCents: number, percent: number): number {
  return Math.round((amountCents * (100 - percent)) / 100);
}
