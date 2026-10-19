import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { preflight, withCors } from "@/lib/cors";

/** Called once, post-signup, with the ?ref= code carried through from the
 * landing page. claim_referral (supabase/schema.sql) is idempotent per
 * referee and rejects self-referral/unknown codes by returning false -
 * this route treats that as a normal (not-error) outcome, since a missing
 * or already-used code isn't something the caller needs to retry.
 */
export async function POST(request: NextRequest) {
  return withCors(request, await handle(request));
}

export function OPTIONS(request: NextRequest) {
  return preflight(request);
}

async function handle(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Accounts aren't configured yet." }, { status: 501 });
  }

  const { user } = await getRequestAuth(request);

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) {
    return NextResponse.json({ error: "Missing referral code." }, { status: 400 });
  }

  const supabaseAdmin = createServiceClient();
  const { data: granted, error } = await supabaseAdmin.rpc("claim_referral", {
    p_referee: user.id,
    p_referrer_code: code,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ granted: Boolean(granted) });
}
