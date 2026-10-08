import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { CAPTIONS_CREDIT_COST } from "@/lib/credits";
import { TOOLS_API_URL } from "@/lib/toolsApi";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";

/** Editor auto captions -> backend /api/video/captions. Signed-in only:
 * transcription is real compute, so it costs CAPTIONS_CREDIT_COST credits,
 * refunded if the backend fails. The body is the browser's speech WAV plus
 * the chosen language; the JSON transcript is passed straight back.
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
      { detail: { code: "auth_required", message: "Sign in to generate captions." } },
      { status: 401 }
    );
  }

  if (!(await checkRateLimit(`${rateLimitKeyFor(request, user.id)}:captions`, 20, 60 * 60 * 1000))) {
    return NextResponse.json(
      { detail: { code: "rate_limited", message: "Too many caption requests. Try again later." } },
      { status: 429 }
    );
  }

  const formData = await request.formData();
  const supabaseAdmin = createServiceClient();

  const { data: consumed, error: consumeErr } = await supabaseAdmin.rpc("consume_credits", {
    p_user_id: user.id,
    p_amount: CAPTIONS_CREDIT_COST,
    p_resolution: "captions",
  });
  if (consumeErr) {
    return NextResponse.json({ detail: { code: "server_error", message: consumeErr.message } }, { status: 500 });
  }
  if (!consumed) {
    return NextResponse.json(
      {
        detail: {
          code: "insufficient_credits",
          message: `Not enough credits (${CAPTIONS_CREDIT_COST}). Free credits renew daily, or buy more.`,
        },
      },
      { status: 402 }
    );
  }
  void supabaseAdmin.rpc("tag_last_transaction", { p_user_id: user.id, p_tool: "captions", p_filename: null });

  const refund = () =>
    supabaseAdmin.rpc("refund_credits", { p_user_id: user.id, p_amount: CAPTIONS_CREDIT_COST, p_resolution: "captions" });

  let backendRes: Response;
  try {
    backendRes = await fetch(`${TOOLS_API_URL}/api/video/captions`, {
      method: "POST",
      body: formData,
      headers: process.env.INTERNAL_API_SECRET ? { "X-Internal-Process-Secret": process.env.INTERNAL_API_SECRET } : undefined,
    });
  } catch (e) {
    await refund();
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
    await refund();
    return new NextResponse(await backendRes.text(), {
      status: backendRes.status,
      headers: { "Content-Type": backendRes.headers.get("Content-Type") ?? "application/json" },
    });
  }

  return new NextResponse(backendRes.body, { status: 200, headers: { "Content-Type": "application/json" } });
}
