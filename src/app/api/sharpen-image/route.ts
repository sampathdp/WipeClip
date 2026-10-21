import { NextRequest } from "next/server";
import { proxyFreeTool } from "@/lib/imageTool";

/** Photo sharpening (the backend's /api/image/sharpen), with the same free
 * preview and credit gate as /api/remove-background - see
 * src/lib/imageTool.ts.
 */
export function POST(request: NextRequest) {
  return proxyFreeTool(request, "sharpen", "/api/image/sharpen");
}
