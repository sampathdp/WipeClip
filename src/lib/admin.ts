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

/** The signed-in user if they are a confirmed admin, else null. */
export async function getAdminUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user && user.email_confirmed_at && isAdminEmail(user.email) ? user : null;
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
