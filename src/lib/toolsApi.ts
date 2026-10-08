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
export class ProRequiredError extends ApiError {}
/** The export needs a higher plan (resolution or premium features). */
export class PlanRequiredError extends ApiError {}

async function throwApiError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => null);
  const detail = data?.detail;
  // FastAPI's own automatic request-validation errors (a malformed/missing
  // form field - int fields getting a non-numeric string is the case that
  // actually bit us) shape `detail` as an array of {loc, msg, type}, not
  // the {code, message} object our own HTTPExceptions use. Without this
  // branch that array silently fell through to `fallback` ("Processing
  // failed. Try again.") with the real cause never surfacing anywhere.
  const message = typeof detail === "string"
    ? detail
    : Array.isArray(detail)
      ? detail.map((d) => (typeof d?.msg === "string" ? d.msg : JSON.stringify(d))).join("; ")
      : detail?.message;
  const code = typeof detail === "object" && !Array.isArray(detail) ? detail?.code : undefined;
  const msg = message || fallback;
  if (code === "content_blocked") throw new ContentBlockedError(msg, code);
  if (code === "insufficient_credits") throw new InsufficientCreditsError(msg, code);
  if (code === "auth_required") throw new AuthRequiredError(msg, code);
  if (code === "pro_required") throw new ProRequiredError(msg, code);
  if (code === "plan_required") throw new PlanRequiredError(msg, code);
  throw new ApiError(msg, code);
}

export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
  fps: number;
  // Only sent by backends new enough to have the editor; undefined means
  // "unknown", which callers should treat as "has audio".
  hasAudio?: boolean;
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
  const hasAudio = res.headers.get("X-Video-Has-Audio");
  if (hasAudio !== null) info.hasAudio = hasAudio === "1";
  const blob = await res.blob();
  return { info, previewUrl: URL.createObjectURL(blob) };
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Resolution = "720p" | "1080p" | "4k";

/** Goes through our own /api/process route (credit-gated), not the FastAPI
 * backend directly - that's what makes credit consumption non-bypassable.
 * See src/app/api/process/route.ts.
 */
export async function processVideo(
  file: File,
  region: Region,
  resolution: Resolution,
  signal?: AbortSignal,
  range?: { start: number; end: number }
): Promise<Blob> {
  const body = new FormData();
  body.append("file", file);
  body.append("mode", "remove");
  body.append("x", String(region.x));
  body.append("y", String(region.y));
  body.append("w", String(region.w));
  body.append("h", String(region.h));
  body.append("resolution", resolution);
  // Editor AI cleanup: process (and return) only this source-time range.
  if (range) {
    body.append("start", range.start.toFixed(3));
    body.append("end", range.end.toFixed(3));
  }

  // The backend inpaints frame-by-frame and only responds once the whole
  // clip is done - minutes for a long or high-resolution video - so this
  // request has no natural timeout. `signal` lets the caller impose a hard
  // ceiling (see UploadDemo) rather than spinning forever if it wedges.
  const res = await fetch("/api/process", {
    method: "POST",
    body,
    signal,
  });

  if (!res.ok) {
    await throwApiError(res, "Processing failed. Try again.");
  }

  return res.blob();
}

/** Renders a browser-editor project through our own /api/export route
 * (credit-gated like /api/process). `sources[0]` must be the original
 * upload - it sets the output size and frame rate. See
 * src/lib/editor/exportProject.ts for how the payload is assembled and
 * backend/app/main.py's api_video_export for how it's validated.
 */
export async function exportEditorProject(
  project: unknown,
  sources: File[],
  overlays: Blob[],
  audios: File[],
  background: File | null,
  resolution: Resolution,
  signal?: AbortSignal
): Promise<Blob> {
  const body = new FormData();
  body.append("project", JSON.stringify(project));
  body.append("resolution", resolution);
  for (const source of sources) body.append("sources", source, source.name);
  overlays.forEach((image, i) => body.append("overlays", image, `layer-${i}.png`));
  for (const audio of audios) body.append("audios", audio, audio.name);
  if (background) body.append("background", background, background.name);

  const res = await fetch("/api/export", { method: "POST", body, signal });
  if (!res.ok) {
    await throwApiError(res, "Export failed. Your original video is safe. Please try exporting again.");
  }
  return res.blob();
}

/** Goes through our own /api/process-image route (Pro-plan + credit
 * gated), not the FastAPI backend directly - same non-bypassable pattern
 * as processVideo/src/app/api/process/route.ts.
 */
export async function processImage(file: File, region: Region): Promise<Blob> {
  const body = new FormData();
  body.append("file", file);
  body.append("x", String(region.x));
  body.append("y", String(region.y));
  body.append("w", String(region.w));
  body.append("h", String(region.h));

  const res = await fetch("/api/process-image", {
    method: "POST",
    body,
  });

  if (!res.ok) {
    await throwApiError(res, "Processing failed. Try again.");
  }

  return res.blob();
}

/** Goes through /api/remove-background (credit-gated, no Pro requirement -
 * see that route for why this differs from processImage above). Backend
 * output is a transparent PNG (full_pipeline.auto_enhance), not a
 * region-marked reconstruction, so unlike processImage this takes no
 * Region - the whole point of this tool is zero-click background removal.
 */
export async function removeBackground(file: File): Promise<Blob> {
  const body = new FormData();
  body.append("file", file);

  const res = await fetch("/api/remove-background", {
    method: "POST",
    body,
  });

  if (!res.ok) {
    await throwApiError(res, "Processing failed. Try again.");
  }

  return res.blob();
}

export interface CaptionsResult {
  language: string;
  words: { start: number; end: number; text: string }[];
}

/** Editor auto captions via /api/captions (signed in, costs credits).
 * `wav` is the timeline's speech mix; word times come back in timeline
 * seconds. */
export async function generateCaptions(wav: Blob, language: string, signal?: AbortSignal): Promise<CaptionsResult> {
  const body = new FormData();
  body.append("file", wav, "speech.wav");
  body.append("language", language);
  const res = await fetch("/api/captions", { method: "POST", body, signal });
  if (!res.ok) await throwApiError(res, "Captioning failed. Try again.");
  return res.json();
}

export type SharpenStrength = "light" | "standard" | "strong";

/** Goes through /api/sharpen-image - same free, non-Pro gate as
 * removeBackground above.
 */
export async function sharpenImage(file: File, strength: SharpenStrength): Promise<Blob> {
  const body = new FormData();
  body.append("file", file);
  body.append("strength", strength);

  const res = await fetch("/api/sharpen-image", {
    method: "POST",
    body,
  });

  if (!res.ok) {
    await throwApiError(res, "Processing failed. Try again.");
  }

  return res.blob();
}
