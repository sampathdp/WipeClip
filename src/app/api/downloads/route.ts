import { NextResponse } from "next/server";
import { getDownloadCounts } from "@/lib/downloadStats";

/** Installer download counts for the count shown under the download buttons. */
export async function GET() {
  const counts = await getDownloadCounts();
  if (!counts) return NextResponse.json({ error: "Download counts are unavailable." }, { status: 503 });
  return NextResponse.json(counts, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
