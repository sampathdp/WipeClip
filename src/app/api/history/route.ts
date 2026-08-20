import { NextResponse } from "next/server";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { isProUser } from "@/lib/plan";

/** Read-only usage log for the signed-in user, backed entirely by
 * credit_transactions (already populated by consume_credits/refund_credits
 * and tagged with tool/filename by tag_last_transaction - see
 * supabase/schema.sql). No new storage subsystem: this is a view over data
 * that already existed for billing purposes.
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Accounts aren't configured yet." }, { status: 501 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!(await isProUser(supabase, user.id))) {
    return NextResponse.json({ error: "Job history is a Pro plan feature." }, { status: 403 });
  }

  // RLS ("read own transactions") already scopes this to the caller's own
  // rows even though we're on the session client, not the service client.
  const { data, error } = await supabase
    .from("credit_transactions")
    .select("id, kind, amount, resolution, tool, filename, created_at")
    .in("kind", ["consume", "refund"])
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ transactions: data });
}
