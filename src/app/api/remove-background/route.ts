import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { IMAGE_CREDIT_COST } from "@/lib/credits";
import { TOOLS_API_URL } from "@/lib/toolsApi";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";

/** Free-tool analogue of /api/process (video): same anonymous-preview +
 * signed-in-credit gate in front of the FastAPI backend's
 * /api/image/auto-enhance, but with no Pro requirement - unlike
 * /api/process-image (the object-removal image tool, which is
 * Pro-gated), background removal is meant to be a low-friction free tool
 * that drives traffic to the paid object-removal tool, not a paid feature
 * itself. The browser never talks to the FastAPI backend directly, same
 * reasoning as the other process routes.
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
    // Looser than video's 3/24h: a single-image auto-enhance pass is far
    // cheaper than a video encode, and this tool exists specifically to be
    // the easy, no-signup front door - see /api/process's anonymous branch
    // for the pattern this mirrors.
    if (!(await checkRateLimit(`anon-bg-remove:${rateLimitKeyFor(request)}`, 5, 24 * 60 * 60 * 1000))) {
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
    // Hard-set, ignoring whatever the client sent - anonymous callers only
    // ever get the downscaled preview (matches remove.bg's free-tier
    // resolution cap; see BG_REMOVE_PREVIEW_MAX_MEGAPIXELS in the backend's
    // config.py). Signed-in callers below never set this, so they always
    // get full resolution regardless of plan - same "sign in unlocks it"
    // gate the video tool already uses for 1080p/4K.
    formData.set("preview", "true");

    let backendRes: Response;
    try {
      backendRes = await fetch(`${TOOLS_API_URL}/api/image/auto-enhance`, {
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
        "Content-Type": backendRes.headers.get("Content-Type") ?? "image/png",
        "Content-Disposition": backendRes.headers.get("Content-Disposition") ?? "attachment",
      },
    });
  }

  if (!(await checkRateLimit(`${rateLimitKeyFor(request, user.id)}:bg-remove`, 30, 60 * 60 * 1000))) {
    return NextResponse.json(
      { detail: { code: "rate_limited", message: "Too many processing requests. Try again later." } },
      { status: 429 }
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

  const uploadedFile = formData.get("file");
  void supabaseAdmin.rpc("tag_last_transaction", {
    p_user_id: user.id,
    p_tool: "bg-remove",
    p_filename: uploadedFile instanceof File ? uploadedFile.name : null,
  });

  let backendRes: Response;
  try {
    backendRes = await fetch(`${TOOLS_API_URL}/api/image/auto-enhance`, {
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
