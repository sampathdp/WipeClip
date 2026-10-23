import { NextRequest } from "next/server";
import { preflight, withCors } from "@/lib/cors";
import { proxyFreeTool } from "@/lib/imageTool";

/** Photo sharpening (the backend's /api/image/sharpen), with the same free
 * preview and credit gate as /api/remove-background - see
 * src/lib/imageTool.ts.
 */
export async function POST(request: NextRequest) {
  return withCors(request, await proxyFreeTool(request, "sharpen", "/api/image/sharpen"));
}

export function OPTIONS(request: NextRequest) {
  return preflight(request);
}
