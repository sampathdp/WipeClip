import type { SupabaseClient } from "@supabase/supabase-js";

/** Single source of truth for "is this user on the $23.99 Pro plan" - reads
 * the same `profiles.plan` column /api/credits already exposes. `plan` is
 * the only tier signal (see supabase/schema.sql): set to 'pro' by the
 * grant_paid_credits RPC on a Lemon Squeezy grant event, reset to 'free' on
 * cancel/expire. Callers can pass either the RLS-scoped session client (for
 * checking the caller's own plan) or the service-role client.
 */
export async function isProUser(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from("profiles").select("plan").eq("id", userId).single();
  return data?.plan === "pro";
}
