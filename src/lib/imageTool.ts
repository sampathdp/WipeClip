import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, getRequestAuth, isSupabaseConfigured } from "@/lib/supabase/server";
import { IMAGE_CREDIT_COST } from "@/lib/credits";
import { BACKEND_DISABLED, BACKEND_DISABLED_MESSAGE, TOOLS_API_URL } from "@/lib/toolsApi";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";

/** The free web tools: background remover, photo sharpener and the video
 * frame grabber. Each gives everyone, signed in or not, one free
 * low-resolution result a day; a full-resolution result needs an account
 * and costs IMAGE_CREDIT_COST. The free one is downscaled by the backend
 * (IMAGE_PREVIEW_MAX_MEGAPIXELS in its config.py) before processing, so it
 * is also the cheap one to run.
 */
export type FreeTool = "bg-remove" | "sharpen" | "frame";

export type ToolQuality = "preview" | "full";

export const FREE_PREVIEWS_PER_DAY = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ detail: { code, message } }, { status });
}

export function toolQuality(value: unknown): ToolQuality {
  return value === "full" ? "full" : "preview";
}

type Gate =
  | { ok: true; preview: true }
  | { ok: true; preview: false; refund: () => Promise<void> }
  | { ok: false; response: NextResponse };

/** Lets one job through: a free preview (counted against today's
 * allowance, keyed on the account or else the IP) or a paid full-resolution
 * one (credit spent here; call `refund` if the job then fails). */
export async function gateFreeTool(
  request: NextRequest,
  tool: FreeTool,
  quality: ToolQuality,
  filename: string | null
): Promise<Gate> {
  if (!isSupabaseConfigured()) {
    return { ok: false, response: errorResponse("server_error", "Accounts aren't configured yet.", 501) };
  }
  // Cookie session on the website, bearer token from the desktop app.
  const { user } = await getRequestAuth(request);

  if (quality === "preview") {
    if (!(await checkRateLimit(`free-preview:${tool}:${rateLimitKeyFor(request, user?.id)}`, FREE_PREVIEWS_PER_DAY, DAY_MS))) {
      return {
        ok: false,
        response: errorResponse(
          "preview_limit",
          user
            ? `You've used today's free preview. Get the full-resolution result for ${IMAGE_CREDIT_COST} credit, or come back tomorrow.`
            : "You've used today's free preview. Sign in to get the full-resolution result with your free daily credits.",
          429
        ),
      };
    }
    return { ok: true, preview: true };
  }

  if (!user) {
    return { ok: false, response: errorResponse("auth_required", "Sign in to get the full-resolution result.", 401) };
  }
  if (!(await checkRateLimit(`${rateLimitKeyFor(request, user.id)}:${tool}`, 30, 60 * 60 * 1000))) {
    return { ok: false, response: errorResponse("rate_limited", "Too many processing requests. Try again later.", 429) };
  }

  // Locked to service_role at the DB level, same as /api/process.
  const admin = createServiceClient();
  const { data: consumed, error } = await admin.rpc("consume_credits", {
    p_user_id: user.id,
    p_amount: IMAGE_CREDIT_COST,
    p_resolution: "image",
  });
  if (error) return { ok: false, response: errorResponse("server_error", error.message, 500) };
  if (!consumed) {
    return {
      ok: false,
      response: errorResponse(
        "insufficient_credits",
        `Not enough credits (${IMAGE_CREDIT_COST}). Free credits renew daily, or buy more.`,
        402
      ),
    };
  }
  void admin.rpc("tag_last_transaction", { p_user_id: user.id, p_tool: tool, p_filename: filename });

  return {
    ok: true,
    preview: false,
    refund: async () => {
      await admin.rpc("refund_credits", { p_user_id: user.id, p_amount: IMAGE_CREDIT_COST, p_resolution: "image" });
    },
  };
}

/** /api/remove-background and /api/sharpen-image: gate the job, then pass
 * the form to the backend with `preview` set by the server (never the
 * client's own value) and stream the image back. A failed paid job is
 * refunded. The browser never talks to the backend directly. */
export async function proxyFreeTool(request: NextRequest, tool: Exclude<FreeTool, "frame">, backendPath: string) {
  if (BACKEND_DISABLED) return errorResponse("service_unavailable", BACKEND_DISABLED_MESSAGE, 503);

  const formData = await request.formData();
  const file = formData.get("file");
  const gate = await gateFreeTool(request, tool, toolQuality(formData.get("quality")), file instanceof File ? file.name : null);
  if (!gate.ok) return gate.response;
  formData.delete("quality");
  formData.set("preview", gate.preview ? "true" : "false");

  let backendRes: Response;
  try {
    backendRes = await fetch(`${TOOLS_API_URL}${backendPath}`, {
      method: "POST",
      body: formData,
      headers: process.env.INTERNAL_API_SECRET ? { "X-Internal-Process-Secret": process.env.INTERNAL_API_SECRET } : undefined,
    });
  } catch (e) {
    if (!gate.preview) await gate.refund();
    return errorResponse("backend_unreachable", e instanceof Error ? e.message : "Could not reach the processing backend.", 502);
  }

  if (!backendRes.ok) {
    if (!gate.preview) await gate.refund();
    return new NextResponse(await backendRes.text(), {
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
