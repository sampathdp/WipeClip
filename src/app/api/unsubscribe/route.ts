import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";

/** Marketing email opt-out, keyed by the signed link in every newsletter
 * (src/lib/unsubscribe.ts) - no sign-in needed. Two callers:
 * - mail clients, via the List-Unsubscribe header: an RFC 8058 one-click
 *   POST with the body "List-Unsubscribe=One-Click", answered with 200;
 * - the /unsubscribe page's form, with action=unsubscribe|resubscribe,
 *   answered with a 303 back to that page.
 * Always a POST, so link scanners that open every URL in an email can't
 * unsubscribe anyone by accident.
 */
export async function POST(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("u") ?? "";
  const token = request.nextUrl.searchParams.get("t") ?? "";
  if (!verifyUnsubscribeToken(userId, token)) {
    return NextResponse.json({ error: "This unsubscribe link is not valid." }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Accounts aren't configured yet." }, { status: 501 });
  }

  const form = await request.formData().catch(() => null);
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  const optOut = oneClick || form?.get("action") !== "resubscribe";

  const { error } = await createServiceClient()
    .from("profiles")
    .update({ marketing_opt_out: optOut, marketing_opt_out_at: optOut ? new Date().toISOString() : null })
    .eq("id", userId);
  if (error) {
    console.error("[unsubscribe] update failed", error);
    return NextResponse.json({ error: "Could not update your email preferences. Please try again." }, { status: 500 });
  }

  if (oneClick) return NextResponse.json({ ok: true });
  const back = new URL("/unsubscribe", process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin);
  back.search = new URLSearchParams({ u: userId, t: token, done: optOut ? "out" : "in" }).toString();
  return NextResponse.redirect(back, 303);
}
