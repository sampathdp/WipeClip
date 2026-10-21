import { notFound, redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

/** Admins are the signed-in accounts whose email is in ADMIN_EMAILS
 * (comma-separated). Nobody is an admin while it is unset. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

/** Admins must sign in with a second factor (an authenticator-app code)
 * unless ADMIN_MFA_DISABLED=true - an escape hatch for a lost
 * authenticator, to be removed again once a new one is enrolled. */
export function adminMfaRequired(): boolean {
  return process.env.ADMIN_MFA_DISABLED !== "true";
}

/** Where a signed-in account stands on the way into the admin panel:
 * - "none": not signed in, or not an admin;
 * - "enroll": an admin who has no authenticator yet;
 * - "verify": an admin who has one but hasn't entered a code this session;
 * - "ok": through. */
export type AdminStep = "none" | "enroll" | "verify" | "ok";

export async function adminStep(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ user: User | null; step: AdminStep }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email_confirmed_at || !isAdminEmail(user.email)) return { user, step: "none" };
  if (!adminMfaRequired()) return { user, step: "ok" };
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (data?.currentLevel === "aal2") return { user, step: "ok" };
  return { user, step: data?.nextLevel === "aal2" ? "verify" : "enroll" };
}

/** The signed-in user if they are a confirmed admin who has passed the
 * second-factor check this session, else null. */
export async function getAdminUser(): Promise<User | null> {
  const { user, step } = await adminStep(await createClient());
  return step === "ok" ? user : null;
}

/** For every admin page and server action: the admin user and a
 * service-role client. Anyone else is sent to /admin/login, which signs in
 * or explains that the account has no admin access. Server actions are
 * reachable by direct POST, so each one must call this itself; the
 * layout's check alone is not enough. */
export async function requireAdmin(): Promise<{ user: User; admin: ReturnType<typeof createServiceClient> }> {
  if (!isSupabaseConfigured()) notFound();
  const user = await getAdminUser();
  if (!user) redirect("/admin/login");
  return { user, admin: createServiceClient() };
}
