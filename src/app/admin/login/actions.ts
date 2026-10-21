"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { checkRateLimit } from "@/lib/rateLimit";

function fail(error: string): never {
  redirect(`/admin/login?error=${encodeURIComponent(error)}`);
}

/** Email + password sign-in for the admin panel, with the same Supabase
 * accounts as the site. A non-admin account is signed straight back out,
 * so this form never leaves a normal user signed in. */
export async function adminSignIn(form: FormData) {
  if (!isSupabaseConfigured()) fail("Accounts aren't configured.");

  // 5 attempts per 15 minutes per IP - slows password guessing.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit(`ip:${ip}:admin-login`, 5, 15 * 60 * 1000))) {
    fail("Too many attempts. Try again in 15 minutes.");
  }

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) fail("Enter your email and password.");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) fail("Wrong email or password.");

  if (!data.user.email_confirmed_at || !isAdminEmail(data.user.email)) {
    await supabase.auth.signOut();
    fail("This account has no admin access.");
  }
  // The login page takes it from here: the authenticator code step, or
  // straight on to /admin when that isn't required.
  redirect("/admin/login");
}

/** Second step of the admin sign-in: checks a 6-digit authenticator code
 * against the account's TOTP factor, which raises the session to aal2.
 * The same form finishes enrolling a new factor (its first code verifies
 * it). Shares the password form's rate limit, so codes can't be guessed. */
export async function adminVerifyCode(form: FormData) {
  if (!isSupabaseConfigured()) fail("Accounts aren't configured.");

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit(`ip:${ip}:admin-login`, 5, 15 * 60 * 1000))) {
    fail("Too many attempts. Try again in 15 minutes.");
  }

  const factorId = String(form.get("factorId") ?? "");
  const code = String(form.get("code") ?? "").replace(/\s+/g, "");
  if (!factorId || !/^[0-9]{6}$/.test(code)) fail("Enter the 6-digit code from your authenticator app.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email_confirmed_at || !isAdminEmail(user.email)) fail("This account has no admin access.");

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) fail("That code didn't work. Check your authenticator app's time and try again.");
  redirect("/admin");
}

export async function adminSignOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
