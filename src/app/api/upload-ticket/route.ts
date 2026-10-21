import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth, isSupabaseConfigured } from "@/lib/supabase/server";
import { preflight, withCors } from "@/lib/cors";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";
import { issueTicket } from "@/lib/jobTicket";
import { BACKEND_DISABLED, BACKEND_DISABLED_MESSAGE } from "@/lib/toolsApi";

/** Matches MAX_VIDEO_UPLOAD_BYTES in backend/app/config.py. */
const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ detail: { code, message } }, { status });
}

/** Gate for the backend's /api/video/upload-url and /api/video/probe, which
 * the browser calls directly (videos are too big to pass through here).
 * Takes JSON `{ size }` and answers `{ ticket }`; the backend refuses both
 * routes without a valid ticket (see backend/app/tickets.py), so the rate
 * limits below are what bound uploads to our bucket and probe compute.
 *
 * Anonymous callers are allowed, like /api/process's free previews, under
 * a tighter IP-based limit.
 */
export async function POST(request: NextRequest) {
  return withCors(request, await handle(request));
}

export function OPTIONS(request: NextRequest) {
  return preflight(request);
}

async function handle(request: NextRequest) {
  if (BACKEND_DISABLED) {
    return errorResponse("service_unavailable", BACKEND_DISABLED_MESSAGE, 503);
  }

  let body: { size?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("bad_request", "Invalid request.", 400);
  }
  const size = Number(body.size);
  if (!Number.isInteger(size) || size <= 0) {
    return errorResponse("bad_request", "Invalid file size.", 400);
  }
  if (size > MAX_UPLOAD_BYTES) {
    return errorResponse("too_large", `File too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB)`, 400);
  }

  const user = isSupabaseConfigured() ? (await getRequestAuth(request)).user : null;
  const allowed = user
    ? await checkRateLimit(`${rateLimitKeyFor(request, user.id)}:upload`, 60, 60 * 60 * 1000)
    : await checkRateLimit(`anon-upload:${rateLimitKeyFor(request)}`, 20, 60 * 60 * 1000);
  if (!allowed) {
    return errorResponse(
      "rate_limited",
      user ? "Too many uploads. Try again later." : "Too many uploads. Sign in or try again later.",
      429
    );
  }

  return NextResponse.json({ ticket: issueTicket({ kind: "upload", maxBytes: size }) });
}
