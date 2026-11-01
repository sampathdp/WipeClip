import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { preflight, withCors } from "@/lib/cors";
import { billedMinutes, formatCleanupLimit, MAX_CLEANUP_SECONDS, RESOLUTION_CREDIT_COST, videoCreditCost } from "@/lib/credits";
import { TIER_LABELS, toTier } from "@/lib/entitlements";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";
import { effectivePlan } from "@/lib/plan";
import { issueTicket } from "@/lib/jobTicket";
import { BACKEND_DISABLED, BACKEND_DISABLED_MESSAGE, type Resolution } from "@/lib/toolsApi";
import { AI_CLEANUP_ENABLED } from "@/lib/features";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ detail: { code, message } }, { status });
}

/** Server-side gate for the FastAPI backend's video object removal
 * (/api/video/process). Takes JSON `{ resolution, filename, duration }` and answers
 * `{ ticket, resolution }`; the browser then uploads the video with that
 * ticket straight to the backend (see src/lib/jobTicket.ts). Signed-in
 * callers spend credits atomically here, before the ticket exists; the
 * backend refunds them through /api/internal/ticket if the job fails or is
 * rejected. The ticket also carries the quality tier, decided from the
 * caller's real plan - that's what keeps both non-bypassable.
 *
 * Anonymous callers are allowed through too, deliberately: the product
 * lets anyone upload/process/preview a result with no account, only
 * gating the actual download behind sign-in (see UploadDemo.tsx's
 * isSignedIn-gated download button + SignInModal). Since there's no
 * account to charge or hold accountable, that path skips the credit
 * ledger entirely and is instead bounded by a much tighter IP-based rate
 * limit plus a hard 720p cap (both below) - a free preview, not an open
 * compute spigot.
 */
export async function POST(request: NextRequest) {
  return withCors(request, await handle(request));
}

export function OPTIONS(request: NextRequest) {
  return preflight(request);
}

async function handle(request: NextRequest) {
  if (!AI_CLEANUP_ENABLED) {
    return errorResponse("not_found", "This feature isn't available.", 404);
  }
  if (!isSupabaseConfigured()) {
    return errorResponse("server_error", "Accounts aren't configured yet.", 501);
  }

  let body: { resolution?: unknown; filename?: unknown; local?: unknown; duration?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("bad_request", "Invalid request.", 400);
  }
  // Seconds of video the job will process (the whole upload, or the
  // editor's clip range). Billed per started minute; the ticket carries the
  // seconds that were paid for and the backend refuses a longer video, so
  // understating it buys nothing.
  const duration = typeof body.duration === "number" ? body.duration : NaN;
  if (!Number.isFinite(duration) || duration <= 0) {
    return errorResponse("bad_request", "Missing video length. Refresh the page and try again.", 400);
  }
  // The kill switch is for the cloud backend; a local job never reaches it.
  if (BACKEND_DISABLED && body.local !== true) {
    return errorResponse("service_unavailable", BACKEND_DISABLED_MESSAGE, 503);
  }

  const { supabase, user } = await getRequestAuth(request);

  if (!user && body.local === true) {
    return errorResponse("plan_required", "AI cleanup on this computer needs a paid plan.", 402);
  }
  if (!user) {
    // 3 free anonymous previews/24h/IP - no account to charge or hold
    // accountable, so this has to be tight regardless of the resolution
    // cap below. Namespaced separately from other IP-keyed limits
    // (rateLimitKeyFor's own "ip:" prefix) so it can't collide with them.
    if (!(await checkRateLimit(`anon-process:${rateLimitKeyFor(request)}`, 3, 24 * 60 * 60 * 1000))) {
      return errorResponse("rate_limited", "Free preview limit reached for today. Sign in for more.", 429);
    }
    const maxSeconds = MAX_CLEANUP_SECONDS.anon;
    if (duration > maxSeconds) {
      return errorResponse(
        "too_long",
        `Free previews are limited to ${formatCleanupLimit(maxSeconds)} of video. Sign in to clean up longer clips.`,
        400
      );
    }
    // Hard cap, ignoring whatever the client sent - defense in depth
    // alongside the UI already disabling non-720p options when signed out.
    const ticket = issueTicket({ kind: "process", resolution: "720p", quality: "standard", userId: null, cost: 0, maxSeconds });
    return NextResponse.json({ ticket, resolution: "720p" });
  }

  // 30 processing requests/hour/user - the credit system already caps
  // spend, this caps raw request/compute volume independent of balance
  // (e.g. repeated failed attempts, or free-tier requests that cost credits
  // but still burn a full ffmpeg encode either way).
  if (!(await checkRateLimit(`${rateLimitKeyFor(request, user.id)}:video`, 30, 60 * 60 * 1000))) {
    return errorResponse("rate_limited", "Too many processing requests. Try again later.", 429);
  }

  const resolution = String(body.resolution ?? "720p");
  if (!Object.hasOwn(RESOLUTION_CREDIT_COST, resolution)) {
    return errorResponse("bad_resolution", "Unknown resolution.", 400);
  }
  const cost = videoCreditCost(resolution as Resolution, duration);

  const { data: profile } = await supabase.from("profiles").select("plan, plan_expires_at").eq("id", user.id).single();
  const plan = profile ? effectivePlan(profile) : "free";

  // The desktop app's own engine: the user's machine does the work, so paid
  // plans run it without spending credits or a length limit. The ticket is
  // marked local, which the cloud backend refuses, so it can't buy a free
  // job there.
  if (body.local === true) {
    if (plan === "free") {
      return errorResponse("plan_required", "AI cleanup on this computer needs a paid plan.", 402);
    }
    const quality = plan === "pro" ? "pro" : "standard";
    const ticket = issueTicket({ kind: "process", resolution, quality, userId: user.id, cost: 0, local: true });
    return NextResponse.json({ ticket, resolution });
  }

  const tier = toTier(plan);
  const tierMaxSeconds = MAX_CLEANUP_SECONDS[tier];
  if (duration > tierMaxSeconds) {
    return errorResponse(
      "too_long",
      `Your ${TIER_LABELS[tier]} plan's limit is ${formatCleanupLimit(tierMaxSeconds)} of video per cleanup. Trim the clip or upgrade for longer ones.`,
      400
    );
  }
  // The paid-for minutes, so a video a little longer than reported (but
  // inside what was charged) still runs; never past the plan's limit.
  const maxSeconds = Math.min(billedMinutes(duration) * 60, tierMaxSeconds);

  // consume_credits/refund_credits are locked to service_role at the DB
  // level (see supabase/schema.sql) - they run with elevated privilege and
  // must never be reachable with the caller's own session, only after this
  // route has already verified `user` above.
  const supabaseAdmin = createServiceClient();

  const { data: consumed, error: consumeErr } = await supabaseAdmin.rpc("consume_credits", {
    p_user_id: user.id,
    p_amount: cost,
    p_resolution: resolution,
  });
  if (consumeErr) {
    return errorResponse("server_error", consumeErr.message, 500);
  }
  if (!consumed) {
    return errorResponse(
      "insufficient_credits",
      `Not enough credits for ${resolution} (${cost} credit${cost > 1 ? "s" : ""}). Free credits renew daily, or buy more.`,
      402
    );
  }

  // Best-effort: tags the transaction just inserted with which tool ran
  // and the source filename, for the Job History view. Not billing-
  // critical, so its result is intentionally not checked.
  void supabaseAdmin.rpc("tag_last_transaction", {
    p_user_id: user.id,
    p_tool: "video",
    p_filename: typeof body.filename === "string" ? body.filename.slice(0, 255) : null,
  });

  // Pro-only quality tier (optical-flow-assisted reconstruction in the
  // backend's video.py) - decided here, server-side, from the caller's
  // actual plan, never from a client-supplied value, so it can't be
  // requested by a non-Pro account.
  const quality = plan === "pro" ? "pro" : "standard";

  const ticket = issueTicket({ kind: "process", resolution, quality, userId: user.id, cost, maxSeconds });
  return NextResponse.json({ ticket, resolution });
}
