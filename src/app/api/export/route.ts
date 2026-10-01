import { NextRequest, NextResponse } from "next/server";
import { Agent } from "undici";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { TOOLS_API_URL, type Resolution } from "@/lib/toolsApi";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";
import { effectivePlan } from "@/lib/plan";
import {
  canExportAt,
  premiumFeaturesUsed,
  TIER_LABELS,
  TIER_LIMITS,
  tierForResolution,
  toTier,
  type PremiumCheckable,
  type Tier,
} from "@/lib/entitlements";

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

const RESOLUTIONS: ReadonlySet<string> = new Set<Resolution>(["720p", "1080p", "4k"]);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Plan gate in front of the backend's editor export (/api/video/export).
 * Exports don't spend credits - the subscription tier decides what's
 * allowed (see src/lib/entitlements.ts): the highest resolution, whether
 * premium transitions/filters/effects may be rendered, the daily export
 * count, and whether the backend stamps the free-tier "Made with WipeClip"
 * mark. Anonymous callers are treated as the free tier with a tighter
 * daily limit; the editor only gates the download itself behind sign-in.
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return errorResponse("server_error", "Accounts aren't configured yet.", 501);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let tier: Tier = "free";
  if (user) {
    if (!(await checkRateLimit(`${rateLimitKeyFor(request, user.id)}:export`, 30, 60 * 60 * 1000))) {
      return errorResponse("rate_limited", "Too many exports. Try again later.", 429);
    }
    const { data: profile } = await supabase.from("profiles").select("plan, plan_expires_at").eq("id", user.id).single();
    tier = profile ? toTier(effectivePlan(profile)) : "free";
  }
  const limits = TIER_LIMITS[tier];

  const formData = await request.formData();
  const resolution = user ? String(formData.get("resolution") ?? "720p") : "720p";
  if (!RESOLUTIONS.has(resolution)) {
    return errorResponse("bad_resolution", "Unknown resolution.", 400);
  }
  if (!canExportAt(tier, resolution as Resolution)) {
    const needed = TIER_LABELS[tierForResolution(resolution as Resolution)];
    return errorResponse("plan_required", `${resolution === "4k" ? "4K" : resolution} export needs the ${needed} plan.`, 403);
  }

  let project: PremiumCheckable;
  try {
    project = JSON.parse(String(formData.get("project") ?? ""));
    if (!Array.isArray(project.clips) || !Array.isArray(project.effects ?? [])) throw new Error();
    project.effects ??= [];
  } catch {
    return errorResponse("bad_project", "Invalid project data.", 400);
  }
  if (!limits.premiumEffects) {
    const premium = premiumFeaturesUsed(project);
    if (premium.length) {
      return errorResponse(
        "plan_required",
        `This project uses premium features (${premium.join(", ")}). Upgrade to any paid plan (from Lite) or remove them to export.`,
        403
      );
    }
  }

  // Counted only once the export is otherwise allowed, so a refused
  // attempt doesn't use up one of the day's exports.
  const dayKey = user ? `${rateLimitKeyFor(request, user.id)}:export-day` : `anon-export:${rateLimitKeyFor(request)}`;
  if (!(await checkRateLimit(dayKey, user ? limits.dailyExports : 3, DAY_MS))) {
    return errorResponse(
      "rate_limited",
      user ? "Daily export limit reached for your plan. Upgrade for more exports." : "Free export limit reached for today. Sign in for more.",
      429
    );
  }

  formData.set("resolution", resolution);
  // Always set server side: the backend trusts this field, so a client
  // value must never reach it.
  formData.set("branding", limits.exportBranding ? "1" : "0");

  const backendRes = await forwardToBackend(formData);
  if (!backendRes) {
    return errorResponse("backend_unreachable", "Couldn't reach the export service. Please try again.", 502);
  }
  return relay(backendRes);
}
