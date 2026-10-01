import { NextRequest, NextResponse } from "next/server";
import { Agent } from "undici";
import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { RESOLUTION_CREDIT_COST } from "@/lib/credits";
import { TOOLS_API_URL } from "@/lib/toolsApi";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";

// Same long-running backend call as /api/process - see the comment there.
const backendDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

export const maxDuration = 60;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ detail: { code, message } }, { status });
}

async function forwardToBackend(formData: FormData): Promise<Response | null> {
  try {
    return await fetch(`${TOOLS_API_URL}/api/video/export`, {
      method: "POST",
      body: formData,
      headers: process.env.INTERNAL_API_SECRET
        ? { "X-Internal-Process-Secret": process.env.INTERNAL_API_SECRET }
        : undefined,
      dispatcher: backendDispatcher,
    } as RequestInit & { dispatcher: Agent });
  } catch (e) {
    console.error("[export] backend unreachable", e);
    return null;
  }
}

function relay(backendRes: Response) {
  return new NextResponse(backendRes.body, {
    status: backendRes.status,
    headers: {
      "Content-Type":
        backendRes.headers.get("Content-Type") ?? (backendRes.ok ? "video/mp4" : "application/json"),
    },
  });
}

/** Credit gate in front of the backend's editor export
 * (/api/video/export), mirroring /api/process exactly: signed-in callers
 * spend credits for the chosen resolution (refunded if the render fails),
 * anonymous callers get a tightly rate-limited 720p render with no credit
 * ledger - the editor, like the cleanup tool, only gates the download
 * itself behind sign-in.
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return errorResponse("server_error", "Accounts aren't configured yet.", 501);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (!(await checkRateLimit(`anon-export:${rateLimitKeyFor(request)}`, 3, 24 * 60 * 60 * 1000))) {
      return errorResponse("rate_limited", "Free export limit reached for today. Sign in for more.", 429);
    }
    const formData = await request.formData();
    formData.set("resolution", "720p");
    const backendRes = await forwardToBackend(formData);
    if (!backendRes) {
      return errorResponse("backend_unreachable", "Couldn't reach the export service. Please try again.", 502);
    }
    return relay(backendRes);
  }

  if (!(await checkRateLimit(`${rateLimitKeyFor(request, user.id)}:export`, 30, 60 * 60 * 1000))) {
    return errorResponse("rate_limited", "Too many exports. Try again later.", 429);
  }

  const formData = await request.formData();
  const resolution = String(formData.get("resolution") ?? "720p");
  const cost = RESOLUTION_CREDIT_COST[resolution as keyof typeof RESOLUTION_CREDIT_COST];
  if (!cost) {
    return errorResponse("bad_resolution", "Unknown resolution.", 400);
  }

  const supabaseAdmin = createServiceClient();
  const { data: consumed, error: consumeErr } = await supabaseAdmin.rpc("consume_credits", {
    p_user_id: user.id,
    p_amount: cost,
    p_resolution: resolution,
  });
  if (consumeErr) {
    console.error("[export] consume_credits failed", consumeErr);
    return errorResponse("server_error", "Something went wrong. Please try again.", 500);
  }
  if (!consumed) {
    return errorResponse(
      "insufficient_credits",
      `Not enough credits for ${resolution} (${cost} credit${cost > 1 ? "s" : ""}). Free credits renew daily, or buy more.`,
      402
    );
  }

  const firstSource = formData.get("sources");
  void supabaseAdmin.rpc("tag_last_transaction", {
    p_user_id: user.id,
    p_tool: "editor",
    p_filename: firstSource instanceof File ? firstSource.name : null,
  });

  const backendRes = await forwardToBackend(formData);
  if (!backendRes || !backendRes.ok) {
    await supabaseAdmin.rpc("refund_credits", { p_user_id: user.id, p_amount: cost, p_resolution: resolution });
    if (!backendRes) {
      return errorResponse("backend_unreachable", "Couldn't reach the export service. Please try again.", 502);
    }
  }
  return relay(backendRes);
}
