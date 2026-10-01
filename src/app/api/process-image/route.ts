import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { IMAGE_CREDIT_COST } from "@/lib/credits";
import { TOOLS_API_URL } from "@/lib/toolsApi";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";
import { isProUser } from "@/lib/plan";

/** Image-tool analogue of /api/process: same auth-then-credit-then-forward
 * gate in front of the FastAPI backend, plus a Pro-plan check (the image
 * tool is a Pro-only feature, unlike video which is open to every plan).
 * The browser never talks to the FastAPI backend's /api/image/remove
 * directly, same reasoning as the video route.
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
      { detail: { code: "auth_required", message: "Sign in to process an image." } },
      { status: 401 }
    );
  }

  // Same per-user request cap as /api/process, independent of credit balance.
  if (!(await checkRateLimit(`${rateLimitKeyFor(request, user.id)}:image-object`, 30, 60 * 60 * 1000))) {
    return NextResponse.json(
      { detail: { code: "rate_limited", message: "Too many processing requests. Try again later." } },
      { status: 429 }
    );
  }

  if (!(await isProUser(supabase, user.id))) {
    return NextResponse.json(
      {
        detail: {
          code: "pro_required",
          message: "The image tool is a Pro plan feature. Upgrade to use it.",
        },
      },
      { status: 403 }
    );
  }

  const formData = await request.formData();

  // Locked to service_role at the DB level, same as /api/process.
  const supabaseAdmin = createServiceClient();

  const { data: consumed, error: consumeErr } = await supabaseAdmin.rpc("consume_credits", {
    p_user_id: user.id,
    p_amount: IMAGE_CREDIT_COST,
    p_resolution: "image",
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
          message: `Not enough credits (${IMAGE_CREDIT_COST}). Free credits renew daily, or buy more.`,
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
    p_tool: "image",
    p_filename: uploadedFile instanceof File ? uploadedFile.name : null,
  });

  let backendRes: Response;
  try {
    backendRes = await fetch(`${TOOLS_API_URL}/api/image/remove`, {
      method: "POST",
      body: formData,
      headers: process.env.INTERNAL_API_SECRET
        ? { "X-Internal-Process-Secret": process.env.INTERNAL_API_SECRET }
        : undefined,
    });
  } catch (e) {
    await supabaseAdmin.rpc("refund_credits", {
      p_user_id: user.id,
      p_amount: IMAGE_CREDIT_COST,
      p_resolution: "image",
    });
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
    await supabaseAdmin.rpc("refund_credits", {
      p_user_id: user.id,
      p_amount: IMAGE_CREDIT_COST,
      p_resolution: "image",
    });
    const body = await backendRes.text();
    return new NextResponse(body, {
      status: backendRes.status,
      headers: { "Content-Type": backendRes.headers.get("Content-Type") ?? "application/json" },
    });
  }

  return new NextResponse(backendRes.body, {
    status: 200,
    headers: {
      "Content-Type": backendRes.headers.get("Content-Type") ?? "image/png",
      "Content-Disposition": backendRes.headers.get("Content-Disposition") ?? "attachment",
    },
  });
}
