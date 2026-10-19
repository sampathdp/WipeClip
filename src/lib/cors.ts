import type { NextResponse } from "next/server";

/** CORS for the few routes the WipeClip desktop app calls (/api/process,
 * /api/export, /api/credits, /api/referrals/claim). The desktop app's pages
 * are served from Tauri's own origin, so these calls are cross-origin and
 * carry a Supabase bearer token instead of cookies (see getRequestAuth in
 * src/lib/supabase/server.ts). Only the Tauri origins are allowed - no
 * wildcard, and no credentials mode, since cookies are never involved.
 *
 * DESKTOP_DEV_ORIGINS (comma-separated, e.g. "http://localhost:3100") adds
 * the desktop dev server's origin for local testing; leave it unset in
 * production.
 */
const DESKTOP_ORIGINS = new Set([
  "tauri://localhost", // macOS
  "http://tauri.localhost", // Windows
  "https://tauri.localhost", // Windows with useHttpsScheme
]);

function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (DESKTOP_ORIGINS.has(origin)) return origin;
  const extra = process.env.DESKTOP_DEV_ORIGINS?.split(",").map((o) => o.trim()) ?? [];
  return extra.includes(origin) ? origin : null;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/** Answer for an OPTIONS preflight. */
export function preflight(request: Request): Response {
  const origin = allowedOrigin(request);
  return new Response(null, { status: origin ? 204 : 403, headers: origin ? corsHeaders(origin) : undefined });
}

/** Adds CORS headers to `response` when the request came from the desktop app. */
export function withCors<T extends Response | NextResponse>(request: Request, response: T): T {
  const origin = allowedOrigin(request);
  if (origin) {
    for (const [k, v] of Object.entries(corsHeaders(origin))) response.headers.set(k, v);
  }
  return response;
}
