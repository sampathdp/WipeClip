import { NextResponse } from "next/server";
import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

/** Own referral code + share link, open to every signed-in user regardless
 * of plan (growth lever, not a paywalled feature). Generates the code
 * lazily on first call via ensure_referral_code - most accounts never pay
 * for a code they don't use.
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

  const supabaseAdmin = createServiceClient();
  const { data: code, error: codeErr } = await supabaseAdmin.rpc("ensure_referral_code", {
    p_user_id: user.id,
  });
  if (codeErr) {
    return NextResponse.json({ error: codeErr.message }, { status: 500 });
  }

  const { data: profile } = await supabase.from("profiles").select("referred_by").eq("id", user.id).single();

  return NextResponse.json({
    code,
    alreadyReferred: Boolean(profile?.referred_by),
  });
}
