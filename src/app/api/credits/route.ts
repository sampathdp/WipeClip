import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { effectivePlan } from "@/lib/plan";
import { preflight, withCors } from "@/lib/cors";

export async function GET(request: NextRequest) {
  return withCors(request, await handle(request));
}

export function OPTIONS(request: NextRequest) {
  return preflight(request);
}

async function handle(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Accounts aren't configured yet." }, { status: 501 });
  }

  const { supabase, user } = await getRequestAuth(request);

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Applies the lazy daily free-credit reset before returning the balance,
  // so the number shown is never stale from a previous day. Locked to
  // service_role at the DB level (see supabase/schema.sql), so this needs
  // the service client, not the caller's own session.
  const { error: resetErr } = await createServiceClient().rpc("ensure_daily_reset", {
    p_user_id: user.id,
  });
  if (resetErr) {
    return NextResponse.json({ error: resetErr.message }, { status: 500 });
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("plan, plan_expires_at, free_credits, paid_credits")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    return NextResponse.json({ error: error?.message ?? "No profile found." }, { status: 500 });
  }

  return NextResponse.json({
    email: user.email,
    plan: effectivePlan(profile),
    planExpiresAt: profile.plan_expires_at,
    freeCredits: profile.free_credits,
    paidCredits: profile.paid_credits,
    total: profile.free_credits + profile.paid_credits,
  });
}
