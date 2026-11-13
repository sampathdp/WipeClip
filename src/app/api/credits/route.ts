import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { accessPlan, effectivePlan, grandfatheredPlan, isAppRequest } from "@/lib/plan";
import { inTrial, trialEndsAt } from "@/lib/launch";
import { preflight, withCors } from "@/lib/cors";
import { edgeCountry, rememberCountry } from "@/lib/geo";

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
  const admin = createServiceClient();
  const { error: resetErr } = await admin.rpc("ensure_daily_reset", {
    p_user_id: user.id,
  });
  if (resetErr) {
    return NextResponse.json({ error: resetErr.message }, { status: 500 });
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("plan, plan_expires_at, free_credits, paid_credits, country, created_at")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    return NextResponse.json({ error: error?.message ?? "No profile found." }, { status: 500 });
  }

  // Every signed-in page load asks for the balance, so this is where the
  // account's country for the admin stats stays current.
  await rememberCountry(admin, user.id, edgeCountry(request.headers), profile.country);
  // ...and where today's active accounts are counted: one row per account
  // per day, so repeat loads are a no-op. A failed write only misses a count.
  const { error: activeErr } = await admin
    .from("daily_active_users")
    .upsert({ user_id: user.id }, { onConflict: "day,user_id", ignoreDuplicates: true });
  if (activeErr) console.error("Could not record the active account", activeErr.message);

  return NextResponse.json({
    email: user.email,
    // The trial unlocks the desktop app only; the website sees what was bought.
    plan: await grandfatheredPlan(admin, user.id, isAppRequest(request) ? accessPlan(profile) : effectivePlan(profile)),
    trialEndsAt: inTrial(profile.created_at) ? trialEndsAt(profile.created_at).toISOString() : null,
    planExpiresAt: profile.plan_expires_at,
    freeCredits: profile.free_credits,
    paidCredits: profile.paid_credits,
    total: profile.free_credits + profile.paid_credits,
  });
}
