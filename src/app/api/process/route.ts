import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { RESOLUTION_CREDIT_COST } from "@/lib/credits";
import { TOOLS_API_URL } from "@/lib/toolsApi";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";
import { isProUser } from "@/lib/plan";

/** Server-side gate in front of the FastAPI processing backend. Signed-in
 * callers spend credits atomically before forwarding the job, refunded if
 * the backend rejects or fails the request. The browser never talks to the
 * FastAPI backend's /process endpoint directly (unlike /probe, which
 * doesn't touch billing) - that's what makes the credit check
 * non-bypassable.
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
    return NextResponse.json(
      { detail: { code: "server_error", message: "Accounts aren't configured yet." } },
      { status: 501 }
    );
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
      return NextResponse.json(
        {
          detail: {
            code: "rate_limited",
            message: "Free preview limit reached for today. Sign in for more.",
          },
        },
        { status: 429 }
      );
    }

    const formData = await request.formData();
    // Hard cap, ignoring whatever the client sent - defense in depth
    // alongside the UI already disabling non-720p options when signed out.
    formData.set("resolution", "720p");

    let backendRes: Response;
    try {
      backendRes = await fetch(`${TOOLS_API_URL}/api/video/process`, {
        method: "POST",
        body: formData,
        headers: process.env.INTERNAL_API_SECRET
          ? { "X-Internal-Process-Secret": process.env.INTERNAL_API_SECRET }
          : undefined,
      });
    } catch (e) {
      return NextResponse.json(
        {
          detail: {
            code: "backend_unreachable",
            message: e instanceof Error ? e.message : "Could not reach the processing backend.",
          },
        },
        { status: 502 }
      );
    }

    if (!backendRes.ok) {
      const body = await backendRes.text();
      return new NextResponse(body, {
        status: backendRes.status,
        headers: { "Content-Type": backendRes.headers.get("Content-Type") ?? "application/json" },
      });
    }

    return new NextResponse(backendRes.body, {
      status: 200,
      headers: {
        "Content-Type": backendRes.headers.get("Content-Type") ?? "video/mp4",
        "Content-Disposition": backendRes.headers.get("Content-Disposition") ?? "attachment",
      },
    });
  }

  // 30 processing requests/hour/user - the credit system already caps
  // spend, this caps raw request/compute volume independent of balance
  // (e.g. repeated failed attempts, or free-tier requests that cost credits
  // but still burn a full ffmpeg encode either way).
  if (!(await checkRateLimit(rateLimitKeyFor(request, user.id), 30, 60 * 60 * 1000))) {
    return NextResponse.json(
      { detail: { code: "rate_limited", message: "Too many processing requests. Try again later." } },
      { status: 429 }
    );
  }

  const formData = await request.formData();
  const resolution = String(formData.get("resolution") ?? "720p");
  const cost = RESOLUTION_CREDIT_COST[resolution as keyof typeof RESOLUTION_CREDIT_COST];

  if (!cost) {
    return NextResponse.json(
      { detail: { code: "bad_resolution", message: "Unknown resolution." } },
      { status: 400 }
    );
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
    return NextResponse.json(
      { detail: { code: "server_error", message: consumeErr.message } },
      { status: 500 }
    );
  }

  if (!consumed) {
    return NextResponse.json(
      {
        detail: {
          code: "insufficient_credits",
          message: `Not enough credits for ${resolution} (${cost} credit${cost > 1 ? "s" : ""}). Free credits renew daily, or buy more.`,
        },
      },
      { status: 402 }
    );
  }

  // Best-effort: tags the transaction just inserted with which tool ran
  // and the source filename, for the Job History view. Not billing-
  // critical, so its result is intentionally not checked.
  const uploadedFile = formData.get("file");
  void supabaseAdmin.rpc("tag_last_transaction", {
    p_user_id: user.id,
    p_tool: "video",
    p_filename: uploadedFile instanceof File ? uploadedFile.name : null,
  });

  // Pro-only quality tier (optical-flow-assisted reconstruction, see
  // remove_logo() in the backend's video.py) - decided here, server-side,
  // from the caller's actual plan, never from a client-supplied value, so
  // it can't be requested by a non-Pro account. mode="replace" ignores
  // this field entirely (no reconstruction involved), so it's harmless to
  // always set.
  if (formData.get("mode") === "remove" && (await isProUser(supabase, user.id))) {
    formData.set("quality", "pro");
  }

  let backendRes: Response;
  try {
    backendRes = await fetch(`${TOOLS_API_URL}/api/video/process`, {
      method: "POST",
      body: formData,
      headers: process.env.INTERNAL_API_SECRET
        ? { "X-Internal-Process-Secret": process.env.INTERNAL_API_SECRET }
        : undefined,
    });
  } catch (e) {
    await supabaseAdmin.rpc("refund_credits", { p_user_id: user.id, p_amount: cost, p_resolution: resolution });
    return NextResponse.json(
      {
        detail: {
          code: "backend_unreachable",
          message: e instanceof Error ? e.message : "Could not reach the processing backend.",
        },
      },
      { status: 502 }
    );
  }

  if (!backendRes.ok) {
    // Covers both real failures and a content-moderation rejection - either
    // way the user didn't get a usable result, so they get their credits back.
    await supabaseAdmin.rpc("refund_credits", { p_user_id: user.id, p_amount: cost, p_resolution: resolution });
    const body = await backendRes.text();
    return new NextResponse(body, {
      status: backendRes.status,
      headers: { "Content-Type": backendRes.headers.get("Content-Type") ?? "application/json" },
    });
  }

  return new NextResponse(backendRes.body, {
    status: 200,
    headers: {
      "Content-Type": backendRes.headers.get("Content-Type") ?? "video/mp4",
      "Content-Disposition": backendRes.headers.get("Content-Disposition") ?? "attachment",
    },
  });
}
