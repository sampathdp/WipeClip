import { NextRequest, NextResponse } from "next/server";
import { gateFreeTool, toolQuality } from "@/lib/imageTool";

/** The video frame grabber runs in the browser, so there's no job to proxy:
 * this only answers whether the next capture may be taken, spending
 * today's free preview or a credit for full resolution (see
 * src/lib/imageTool.ts). Takes JSON `{ quality }`, answers `{ preview }`.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const gate = await gateFreeTool(request, "frame", toolQuality(body?.quality), null);
  if (!gate.ok) return gate.response;
  return NextResponse.json({ preview: gate.preview });
}
