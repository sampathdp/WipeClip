import { apiFetch } from "@/lib/platform";

export const TOOLS_API_URL =
  process.env.NEXT_PUBLIC_TOOLS_API_URL ?? "http://localhost:8001";

/** Kill switch for the paid AI backend (see .env.local.example). When set,
 * every backend call fails fast with BACKEND_DISABLED_MESSAGE instead of
 * hitting a server that's been shut down. */
export const BACKEND_DISABLED = process.env.NEXT_PUBLIC_BACKEND_DISABLED === "true";
export const BACKEND_DISABLED_MESSAGE =
  "AI processing is temporarily unavailable while we work on the service. Please check back soon.";

export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

function assertBackendEnabled(): void {
  if (BACKEND_DISABLED) throw new ApiError(BACKEND_DISABLED_MESSAGE, "service_unavailable");
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
  assertBackendEnabled();
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

/** Asks one of our own routes (/api/process, /api/export) for a job ticket.
 * That route does every plan and credit check; the files then go straight
 * to the backend with the ticket - see src/lib/jobTicket.ts. */
async function getTicket(route: string, payload: unknown, fallback: string, signal?: AbortSignal) {
  assertBackendEnabled();
  const res = await apiFetch(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) await throwApiError(res, fallback);
  return (await res.json()) as { ticket: string; resolution: Resolution };
}

/** Object removal: /api/process checks and spends credits and hands back a
 * ticket, then the video goes to the backend with it. A failed job is
 * refunded by the backend. See src/app/api/process/route.ts.
 */
export async function processVideo(
  file: File,
  region: Region,
  resolution: Resolution,
  signal?: AbortSignal,
  range?: { start: number; end: number }
): Promise<Blob> {
  const { ticket } = await getTicket("/api/process", { resolution, filename: file.name }, "Processing failed. Try again.", signal);
  const body = new FormData();
  body.append("ticket", ticket);
  body.append("file", file);
  body.append("x", String(region.x));
  body.append("y", String(region.y));
  body.append("w", String(region.w));
  body.append("h", String(region.h));
  // Editor AI cleanup: process (and return) only this source-time range.
  if (range) {
    body.append("start", range.start.toFixed(3));
    body.append("end", range.end.toFixed(3));
  }

  // The backend inpaints frame-by-frame and only responds once the whole
  // clip is done - minutes for a long or high-resolution video - so this
  // request has no natural timeout. `signal` lets the caller impose a hard
  // ceiling (see UploadDemo) rather than spinning forever if it wedges.
  const res = await fetch(`${TOOLS_API_URL}/api/video/process`, {
    method: "POST",
    body,
    signal,
  });

  if (!res.ok) {
    await throwApiError(res, "Processing failed. Try again.");
  }

  return res.blob();
}

/** Renders a browser-editor project: /api/export checks the plan and hands
 * back a ticket, then the files go to the backend with it (same flow as
 * processVideo). `sources[0]` must be the original
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
  const projectJson = JSON.stringify(project);
  const exportFailed = "Export failed. Your original video is safe. Please try exporting again.";
  const { ticket } = await getTicket("/api/export", { project: projectJson, resolution }, exportFailed, signal);
  const body = new FormData();
  body.append("ticket", ticket);
  // Byte-for-byte the string the ticket was issued for (it carries its hash).
  body.append("project", projectJson);
  for (const source of sources) body.append("sources", source, source.name);
  overlays.forEach((image, i) => body.append("overlays", image, `layer-${i}.png`));
  for (const audio of audios) body.append("audios", audio, audio.name);
  if (background) body.append("background", background, background.name);

  const res = await fetch(`${TOOLS_API_URL}/api/video/export`, { method: "POST", body, signal });
  if (!res.ok) await throwApiError(res, exportFailed);
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

  assertBackendEnabled();

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

  assertBackendEnabled();

  const res = await fetch("/api/remove-background", {
    method: "POST",
    body,
  });

  if (!res.ok) {
    await throwApiError(res, "Processing failed. Try again.");
  }

  return res.blob();
}

export type SharpenStrength = "light" | "standard" | "strong";

/** Goes through /api/sharpen-image - same free, non-Pro gate as
 * removeBackground above.
 */
export async function sharpenImage(file: File, strength: SharpenStrength): Promise<Blob> {
  const body = new FormData();
  body.append("file", file);
  body.append("strength", strength);

  assertBackendEnabled();

  const res = await fetch("/api/sharpen-image", {
    method: "POST",
    body,
  });

  if (!res.ok) {
    await throwApiError(res, "Processing failed. Try again.");
  }

  return res.blob();
}
