import { NextRequest, NextResponse } from "next/server";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { RESOLUTION_CREDIT_COST } from "@/lib/credits";
import { TOOLS_API_URL } from "@/lib/toolsApi";

/** Server-side gate in front of the FastAPI processing backend: checks
 * auth, spends credits atomically before forwarding the job, and refunds
 * if the backend rejects or fails the request. The browser never talks to
 * the FastAPI backend's /process endpoint directly (unlike /probe, which
 * doesn't touch billing) - that's what makes the credit check
 * non-bypassable.
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
    return NextResponse.json(
      { detail: { code: "auth_required", message: "Sign in to process a video." } },
      { status: 401 }
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

  const { data: consumed, error: consumeErr } = await supabase.rpc("consume_credits", {
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
    await supabase.rpc("refund_credits", { p_user_id: user.id, p_amount: cost, p_resolution: resolution });
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
    await supabase.rpc("refund_credits", { p_user_id: user.id, p_amount: cost, p_resolution: resolution });
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
