import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { adminStep } from "@/lib/admin";
import { button, input, one, type SearchParams } from "@/app/admin/ui";
import { adminSignIn, adminSignOut, adminVerifyCode } from "./actions";

export const metadata: Metadata = {
  title: "Admin sign in",
  robots: { index: false, follow: false },
};

/** Outside the (panel) group, so it isn't behind the admin check itself. */
export default async function AdminLogin({ searchParams }: { searchParams: SearchParams }) {
  const error = one((await searchParams).error);

  let signedInAs: string | null = null;
  // The second-factor step: the factor to check a code against, and for a
  // new one, the QR code and secret to add it to an authenticator app.
  let mfa: { factorId: string; qr?: string; secret?: string } | null = null;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { user, step } = await adminStep(supabase);
    if (step === "ok") redirect("/admin");
    signedInAs = user?.email ?? null;
    if (step === "verify") {
      const { data } = await supabase.auth.mfa.listFactors();
      const factor = data?.totp[0];
      if (factor) mfa = { factorId: factor.id };
    } else if (step === "enroll") {
      // Unfinished enrollments from earlier visits would pile up (Supabase
      // caps them), so start from a clean slate each time.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const f of factors?.all ?? []) {
        if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "WipeClip admin" });
      if (data) {
        const qr = data.totp.qr_code;
        mfa = {
          factorId: data.id,
          qr: qr.startsWith("data:") ? qr : `data:image/svg+xml;utf-8,${encodeURIComponent(qr)}`,
          secret: data.totp.secret,
        };
      }
    }
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

        {mfa ? (
          <form action={adminVerifyCode} className="mt-5 space-y-3">
            {error && (
              <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
                {error}
              </p>
            )}
            {mfa.qr ? (
              <>
                <p className="text-sm text-muted">
                  Admin accounts need two-step sign-in. Scan this code with an authenticator app, then enter the
                  6-digit code it shows.
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element -- an inline data: SVG, nothing to optimize */}
                <img src={mfa.qr} alt="Authenticator setup QR code" className="mx-auto h-44 w-44 rounded-lg bg-white p-2" />
                <p className="break-all text-center font-mono text-[11px] text-muted">Or enter this key: {mfa.secret}</p>
              </>
            ) : (
              <p className="text-sm text-muted">
                Enter the 6-digit code from your authenticator app for <strong className="text-foreground">{signedInAs}</strong>.
              </p>
            )}
            <input type="hidden" name="factorId" value={mfa.factorId} />
            <label className="block space-y-1.5 text-xs font-semibold text-foreground">
              <span>Code</span>
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9 ]{6,7}"
                required
                autoComplete="one-time-code"
                className={`${input} w-full tracking-[0.3em]`}
              />
            </label>
            <button className={`${button} w-full py-3`}>Verify</button>
          </form>
        ) : signedInAs ? (
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
