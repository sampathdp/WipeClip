import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { RESOLUTION_CREDIT_COST } from "@/lib/credits";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";
import { isProUser } from "@/lib/plan";
import { issueTicket } from "@/lib/jobTicket";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ detail: { code, message } }, { status });
}

/** Server-side gate for the FastAPI backend's video object removal
 * (/api/video/process). Takes JSON `{ resolution, filename }` and answers
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
  if (!isSupabaseConfigured()) {
    return errorResponse("server_error", "Accounts aren't configured yet.", 501);
  }

  let body: { resolution?: unknown; filename?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("bad_request", "Invalid request.", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // 3 free anonymous previews/24h/IP - no account to charge or hold
    // accountable, so this has to be tight regardless of the resolution
    // cap below. Namespaced separately from other IP-keyed limits
    // (rateLimitKeyFor's own "ip:" prefix) so it can't collide with them.
    if (!(await checkRateLimit(`anon-process:${rateLimitKeyFor(request)}`, 3, 24 * 60 * 60 * 1000))) {
      return errorResponse("rate_limited", "Free preview limit reached for today. Sign in for more.", 429);
    }
    // Hard cap, ignoring whatever the client sent - defense in depth
    // alongside the UI already disabling non-720p options when signed out.
    const ticket = issueTicket({ kind: "process", resolution: "720p", quality: "standard", userId: null, cost: 0 });
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
  const cost = RESOLUTION_CREDIT_COST[resolution as keyof typeof RESOLUTION_CREDIT_COST];
  if (!cost) {
    return errorResponse("bad_resolution", "Unknown resolution.", 400);
  }

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
  const quality = (await isProUser(supabase, user.id)) ? "pro" : "standard";

  const ticket = issueTicket({ kind: "process", resolution, quality, userId: user.id, cost });
  return NextResponse.json({ ticket, resolution });
}
