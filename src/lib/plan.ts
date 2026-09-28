import type { SupabaseClient } from "@supabase/supabase-js";

/** The tier a profile is on right now. Starter/Pro are 30-day passes bought
 * through Payments.lk (see src/app/api/webhooks/payments-lk/route.ts):
 * grant_paid_credits sets `plan` and `plan_expires_at`, and a pass that has
 * run out reads as 'free' here without needing a scheduled job to reset it.
 * A null expiry means the tier was set without one (e.g. by hand), so it
 * never lapses.
 */
export function effectivePlan(profile: { plan: string; plan_expires_at: string | null }): string {
  if (profile.plan === "free") return "free";
  if (profile.plan_expires_at && new Date(profile.plan_expires_at).getTime() <= Date.now()) return "free";
  return profile.plan;
}

/** Single source of truth for "is this user on the Pro plan" - reads the
 * same `profiles` columns /api/credits already exposes. Callers can pass
 * either the RLS-scoped session client (for checking the caller's own plan)
 * or the service-role client.
 */
export async function isProUser(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from("profiles").select("plan, plan_expires_at").eq("id", userId).single();
  return data ? effectivePlan(data) === "pro" : false;
}
