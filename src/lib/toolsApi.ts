export const TOOLS_API_URL =
  process.env.NEXT_PUBLIC_TOOLS_API_URL ?? "http://localhost:8001";

export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export class ContentBlockedError extends ApiError {}
export class InsufficientCreditsError extends ApiError {}
export class AuthRequiredError extends ApiError {}

async function throwApiError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => null);
  const detail = data?.detail;
  const message = typeof detail === "string" ? detail : detail?.message;
  const code = typeof detail === "object" ? detail?.code : undefined;
  const msg = message ?? fallback;
  if (code === "content_blocked") throw new ContentBlockedError(msg, code);
  if (code === "insufficient_credits") throw new InsufficientCreditsError(msg, code);
  if (code === "auth_required") throw new AuthRequiredError(msg, code);
  throw new ApiError(msg, code);
}

export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
  fps: number;
}

export async function probeVideo(
  file: File
): Promise<{ info: VideoInfo; previewUrl: string }> {
  const body = new FormData();
  body.append("file", file);

  const res = await fetch(`${TOOLS_API_URL}/api/video/probe`, {
    method: "POST",
    body,
  });

  if (!res.ok) {
    await throwApiError(res, "Could not read that video.");
  }

  const info: VideoInfo = {
    width: Number(res.headers.get("X-Video-Width")),
    height: Number(res.headers.get("X-Video-Height")),
    duration: Number(res.headers.get("X-Video-Duration")),
    fps: Number(res.headers.get("X-Video-Fps")),
  };
  const blob = await res.blob();
  return { info, previewUrl: URL.createObjectURL(blob) };
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WatermarkCandidate extends Region {
  confidence: number;
  label?: string | null; // matched reference logo's name (e.g. "tiktok"),
                          // or null for an unidentified static-region match
}

/** Best-effort watermark region suggestion (temporal-static-region
 * detection - see detect_watermark_candidates in the backend). Doesn't
 * touch billing, so it's called directly like /probe. Never throws: a
 * failed/empty detection just means no suggestion, the user still marks
 * the region manually via RegionSelector.
 */
export async function detectWatermark(file: File): Promise<WatermarkCandidate[]> {
  const body = new FormData();
  body.append("file", file);
  try {
    const res = await fetch(`${TOOLS_API_URL}/api/video/detect-watermark`, {
      method: "POST",
      body,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.candidates ?? [];
  } catch {
    return [];
  }
}

export type Resolution = "720p" | "1080p" | "4k";

/** Goes through our own /api/process route (credit-gated), not the FastAPI
 * backend directly - that's what makes credit consumption non-bypassable.
 * See src/app/api/process/route.ts.
 */
export async function processVideo(
  file: File,
  mode: "remove" | "replace",
  region: Region,
  resolution: Resolution,
  logo?: File | null
): Promise<Blob> {
  const body = new FormData();
  body.append("file", file);
  body.append("mode", mode);
  body.append("x", String(region.x));
  body.append("y", String(region.y));
  body.append("w", String(region.w));
  body.append("h", String(region.h));
  body.append("resolution", resolution);
  if (mode === "replace" && logo) body.append("logo", logo);

  const res = await fetch("/api/process", {
    method: "POST",
    body,
  });

  if (!res.ok) {
    await throwApiError(res, "Processing failed. Try again.");
  }

  return res.blob();
}
