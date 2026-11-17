import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, getRequestAuth, isSupabaseConfigured } from "@/lib/supabase/server";
import { preflight, withCors } from "@/lib/cors";
import { BACKEND_DISABLED, BACKEND_DISABLED_MESSAGE, type Resolution } from "@/lib/toolsApi";
import { checkRateLimit, rateLimitKeyFor } from "@/lib/rateLimit";
import { issueTicket, sha256Hex } from "@/lib/jobTicket";
import { accessPlan, effectivePlan, grandfatheredPlan, isAppRequest } from "@/lib/plan";
import {
  canExportAt,
  featuresAboveTier,
  TIER_LABELS,
  TIER_LIMITS,
  tierForFeatures,
  tierForResolution,
  toTier,
  type PremiumCheckable,
  type Tier,
} from "@/lib/entitlements";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ detail: { code, message } }, { status });
}

const RESOLUTIONS: ReadonlySet<string> = new Set<Resolution>(["720p", "1080p", "4k"]);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Plan gate for the backend's editor export (/api/video/export). Takes
 * JSON `{ project, resolution }` - `project` is the timeline JSON string -
 * and answers `{ ticket, resolution }`: the browser then uploads the files
 * with that ticket straight to the backend (see src/lib/jobTicket.ts for
 * why they don't pass through here). The ticket pins the checked project
 * (by hash), resolution, branding and compact encoding.
 *
 * Exports don't spend credits - the subscription tier decides what's
 * allowed (see src/lib/entitlements.ts): the highest resolution, whether
 * premium transitions/filters/effects may be rendered, the daily export
 * count, and whether the backend stamps the free-tier "Made with WipeClip"
 * mark. Anonymous callers are treated as the free tier with a tighter
 * daily limit; the editor only gates the download itself behind sign-in.
 */
export async function POST(request: NextRequest) {
  return withCors(request, await handle(request));
}

export function OPTIONS(request: NextRequest) {
  return preflight(request);
}

async function handle(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return errorResponse("server_error", "Accounts aren't configured yet.", 501);
  }

  const { supabase, user } = await getRequestAuth(request);

  let tier: Tier = "free";
  if (user) {
    if (!(await checkRateLimit(`${rateLimitKeyFor(request, user.id)}:export`, 30, 60 * 60 * 1000))) {
      return errorResponse("rate_limited", "Too many exports. Try again later.", 429);
    }
    const { data: profile } = await supabase.from("profiles").select("plan, plan_expires_at, created_at").eq("id", user.id).single();
    // The trial counts in the desktop app only.
    tier = profile
      ? toTier(await grandfatheredPlan(createServiceClient(), user.id, isAppRequest(request) ? accessPlan(profile) : effectivePlan(profile)))
      : "free";
  }
  const limits = TIER_LIMITS[tier];

  let body: { project?: unknown; resolution?: unknown; local?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("bad_project", "Invalid project data.", 400);
  }
  // The kill switch is for the cloud backend; a local export never reaches it.
  if (BACKEND_DISABLED && body.local !== true) {
    return errorResponse("service_unavailable", BACKEND_DISABLED_MESSAGE, 503);
  }
  const projectJson = typeof body.project === "string" ? body.project : "";
  const resolution = user ? String(body.resolution ?? "720p") : "720p";
  if (!RESOLUTIONS.has(resolution)) {
    return errorResponse("bad_resolution", "Unknown resolution.", 400);
  }
  // The desktop app renders on the user's own computer, so its limit is higher.
  const local = body.local === true;
  if (!canExportAt(tier, resolution as Resolution, local)) {
    const needed = TIER_LABELS[tierForResolution(resolution as Resolution, local)];
    return errorResponse("plan_required", `${resolution === "4k" ? "4K" : resolution} export needs the ${needed} plan.`, 403);
  }

  let project: PremiumCheckable;
  try {
    project = JSON.parse(projectJson);
    if (!Array.isArray(project.clips) || !Array.isArray(project.effects ?? [])) throw new Error();
    project.effects ??= [];
  } catch {
    return errorResponse("bad_project", "Invalid project data.", 400);
  }
  const locked = featuresAboveTier(project, tier);
  if (locked.length) {
    return errorResponse(
      "plan_required",
      `This project uses premium features (${locked.map((f) => f.name).join(", ")}). Upgrade to the ${TIER_LABELS[tierForFeatures(locked)]} plan or remove them to export.`,
      403
    );
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

  const ticket = issueTicket({
    kind: "export",
    resolution,
    branding: limits.exportBranding,
    compact: limits.compactExport,
    projectHash: sha256Hex(projectJson),
    // The desktop app renders on its own engine.
    // Same plan rules either way, plus the plan's export length there.
    ...(local ? { local: true, maxSeconds: limits.maxExportSeconds } : {}),
  });
  // Counted for the admin panel's exports per day. A failed write only
  // misses a count; it never stops the export.
  const { error: countErr } = await createServiceClient()
    .from("export_events")
    .insert({ user_id: user?.id ?? null, plan: tier, resolution, desktop: local });
  if (countErr) console.error("Could not record the export", countErr.message);
  return NextResponse.json({ ticket, resolution });
}
