import { NextRequest } from "next/server";
import { preflight, withCors } from "@/lib/cors";
import { proxyFreeTool } from "@/lib/imageTool";

/** Background removal (the backend's /api/image/auto-enhance): one free
 * low-resolution result a day, full resolution for a credit - see
 * src/lib/imageTool.ts. Not Pro-gated like /api/process-image: this is the
 * low-friction free tool that brings people to the site.
 */
export async function POST(request: NextRequest) {
  return withCors(request, await proxyFreeTool(request, "bg-remove", "/api/image/auto-enhance"));
}

export function OPTIONS(request: NextRequest) {
  return preflight(request);
}
