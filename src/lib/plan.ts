import type { SupabaseClient } from "@supabase/supabase-js";
import { inTrial } from "./launch";

/** The tier a profile is on right now. Starter/Pro are 30-day passes bought
 * through Payments.lk (see src/app/api/webhooks/payments-lk/route.ts):
 * grant_paid_credits sets `plan` and `plan_expires_at`, and a pass that has
 * run out reads as 'free' here without needing a scheduled job to reset it.
 * A null expiry means the tier was set without one (e.g. by hand), so it
 * never lapses. This is what was bought; accessPlan adds the trial.
 */
export function effectivePlan(profile: { plan: string; plan_expires_at: string | null }): string {
  if (profile.plan === "free") return "free";
  if (profile.plan_expires_at && new Date(profile.plan_expires_at).getTime() <= Date.now()) return "free";
  return profile.plan;
}

/** The tier the desktop app's editor can use right now: Pro during the
 * account's 30-day trial (src/lib/launch.ts), otherwise what it bought.
 * Only the app's requests get the trial (see isAppRequest); the website's
 * tools, credits and history read effectivePlan. */
export function accessPlan(profile: { plan: string; plan_expires_at: string | null; created_at: string | null }): string {
  return inTrial(profile.created_at) ? "pro" : effectivePlan(profile);
}

/** When Lite's editing tools were split with Starter (src/lib/entitlements.ts
 * FEATURE_TIER). Lite passes paid before this keep everything they bought. */
export const LITE_SPLIT_AT = "2026-11-14T00:00:00Z";

/** `plan` as the editor and the export should treat it: a Lite pass paid
 * before LITE_SPLIT_AT reads as Starter (the tools Lite had then, and a
 * little more) until it runs out. Needs the service client: payment
 * orders have no read policy. */
export async function grandfatheredPlan(admin: SupabaseClient, userId: string, plan: string): Promise<string> {
  if (plan !== "lite") return plan;
  const { count } = await admin
    .from("payment_orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "paid")
    .in("plan", ["lite", "lite_yearly"])
    .lt("paid_at", LITE_SPLIT_AT);
  return count ? "starter" : plan;
}

/** The desktop app signs its API calls with a bearer token; the website
 * uses the session cookie (getRequestAuth in src/lib/supabase/server.ts). */
export function isAppRequest(request: Request): boolean {
  return request.headers.get("authorization")?.startsWith("Bearer ") ?? false;
}

/** Single source of truth for "is this user on the Pro plan" - reads the
 * same `profiles` columns /api/credits already exposes. Callers can pass
 * either the RLS-scoped session client (for checking the caller's own plan)
 * or the service-role client. A bought plan only: the trial is app-only.
 */
export async function isProUser(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from("profiles").select("plan, plan_expires_at").eq("id", userId).single();
  return data ? effectivePlan(data) === "pro" : false;
}
