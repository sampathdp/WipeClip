import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { button, input, one, type SearchParams } from "@/app/admin/ui";
import { adminSignIn, adminSignOut } from "./actions";

export const metadata: Metadata = {
  title: "Admin sign in",
  robots: { index: false, follow: false },
};

/** Outside the (panel) group, so it isn't behind the admin check itself. */
export default async function AdminLogin({ searchParams }: { searchParams: SearchParams }) {
  const error = one((await searchParams).error);

  let signedInAs: string | null = null;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.email_confirmed_at && isAdminEmail(user.email)) redirect("/admin");
    signedInAs = user?.email ?? null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2/40 px-4 text-foreground">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-7 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-2 font-display font-extrabold text-white">
            W
          </span>
          <div>
            <h1 className="font-display text-lg font-extrabold leading-tight">WipeClip admin</h1>
            <p className="text-xs text-muted">Sign in to manage the service</p>
          </div>
        </div>

        {signedInAs ? (
          <>
            <p className="mt-3 text-sm text-muted">
              You&apos;re signed in as <strong className="text-foreground">{signedInAs}</strong>, which has no admin
              access. Sign out to use an admin account.
            </p>
            <form action={adminSignOut} className="mt-5">
              <button className={`${button} w-full py-3`}>Sign out</button>
            </form>
          </>
        ) : (
          <form action={adminSignIn} className="mt-5 space-y-3">
            {error && (
              <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
                {error}
              </p>
            )}
            <label className="block space-y-1.5 text-xs font-semibold text-foreground">
              <span>Email</span>
              <input name="email" type="email" required autoComplete="username" className={`${input} w-full`} />
            </label>
            <label className="block space-y-1.5 text-xs font-semibold text-foreground">
              <span>Password</span>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className={`${input} w-full`}
              />
            </label>
            <button className={`${button} w-full py-3`}>Sign in</button>
          </form>
        )}

        <p className="mt-5 text-center text-[11px] text-muted">
          Signed up with Google and have no password?{" "}
          <Link href="/sign-in" className="font-medium text-accent hover:underline">
            Set one with Forgot password
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
