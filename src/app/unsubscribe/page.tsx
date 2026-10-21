import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";

export const metadata: Metadata = {
  title: "Email preferences",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/** Where the unsubscribe link in every newsletter lands. Opening it changes
 * nothing - the button posts to /api/unsubscribe, which comes back here with
 * ?done=out|in - so a mail scanner that follows links can't unsubscribe
 * anyone. One click, no sign-in, and a way to undo it. */
export default async function UnsubscribePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const userId = one(params.u);
  const token = one(params.t);
  const done = one(params.done);
  const valid = verifyUnsubscribeToken(userId, token);

  let email: string | null = null;
  let optedOut = false;
  if (valid && isSupabaseConfigured()) {
    const { data } = await createServiceClient()
      .from("profiles")
      .select("email, marketing_opt_out")
      .eq("id", userId)
      .single();
    email = data?.email ?? null;
    optedOut = Boolean(data?.marketing_opt_out);
  }

  const action = `/api/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`;

  return (
    <div className="flex flex-1 flex-col min-h-screen">
      <Navbar />
      <main className="flex flex-1 flex-col items-center justify-center px-6 pt-36 pb-28 text-center">
        {!valid || !email ? (
          <>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-foreground">This link isn&apos;t valid</h1>
            <p className="mt-4 max-w-md text-sm text-muted">
              Use the unsubscribe link from the most recent email we sent you, or email{" "}
              <a href="mailto:support@wipeclip.co" className="underline hover:text-foreground">
                support@wipeclip.co
              </a>{" "}
              and we&apos;ll unsubscribe you by hand.
            </p>
          </>
        ) : optedOut ? (
          <>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-foreground">
              {done === "out" ? "You're unsubscribed" : "You're not subscribed"}
            </h1>
            <p className="mt-4 max-w-md text-sm text-muted">
              {email} won&apos;t get offers or news from WipeClip any more. We&apos;ll still send emails about your
              account, such as receipts and password resets.
            </p>
            <form method="post" action={action} className="mt-8">
              <input type="hidden" name="action" value="resubscribe" />
              <button type="submit" className="btn-secondary rounded-full px-6 py-3 text-sm font-semibold">
                Unsubscribed by mistake? Subscribe again
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-foreground">
              {done === "in" ? "You're subscribed again" : "Unsubscribe from WipeClip emails"}
            </h1>
            <p className="mt-4 max-w-md text-sm text-muted">
              {done === "in"
                ? `${email} will get occasional offers and product news. You can unsubscribe at any time.`
                : `Stop offers and product news to ${email}. Account emails, such as receipts and password resets, will still arrive.`}
            </p>
            <form method="post" action={action} className="mt-8">
              <input type="hidden" name="action" value="unsubscribe" />
              <button type="submit" className="btn-primary rounded-full px-6 py-3 text-sm font-bold">
                Unsubscribe
              </button>
            </form>
          </>
        )}
        <Link href="/" className="mt-6 text-xs text-muted underline hover:text-foreground">
          Back to WipeClip
        </Link>
      </main>
      <Footer />
    </div>
  );
}
