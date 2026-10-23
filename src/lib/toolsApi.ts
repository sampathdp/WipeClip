import { apiFetch, localEngine, type LocalEngine } from "@/lib/platform";
import type { DiskMedia } from "@/lib/editor/types";
import { readDiskFile } from "@/lib/platform/media";

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

/** The desktop app's own engine (see localEngine) takes the same requests
 * as the cloud backend, plus its per-launch token. */
function engineHeaders(engine: LocalEngine): Record<string, string> {
  return { "X-Local-Token": engine.token };
}

export class ContentBlockedError extends ApiError {}
export class InsufficientCreditsError extends ApiError {}
/** Today's free preview for this tool is used up (see src/lib/imageTool.ts). */
export class PreviewLimitError extends ApiError {}
export class AuthRequiredError extends ApiError {}
export class ProRequiredError extends ApiError {}
/** The export needs a higher plan (resolution or premium features). */
export class PlanRequiredError extends ApiError {}

/** How far a render is: "checking" its files, then "rendering" with
 * `progress` 0..1 (null when unknown). Reported by the desktop app's
 * local engine (backend/app/progress.py). */
export interface RenderProgress {
  phase: "checking" | "rendering";
  progress: number | null;
}

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
  if (code === "preview_limit") throw new PreviewLimitError(msg, code);
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

/** Direct uploads (see backend/app/uploads.py): rather than posting the
 * video to the backend - which bills for every second of the upload - the
 * browser PUTs it straight to a storage bucket with a signed URL and then
 * sends the backend only its upload id. One upload per File serves both
 * probeVideo and processVideo. null means the backend has no bucket
 * configured, so the file itself gets posted like before. */
const directUploads = new WeakMap<File, Promise<string | null>>();

/** Upload tickets (see src/app/api/upload-ticket/route.ts): the backend's
 * upload-url and probe routes refuse calls without one. One per File,
 * dropped when it fails or expires so the next try asks again. */
const uploadTickets = new WeakMap<File, Promise<string>>();

async function requestUploadTicket(file: File, signal?: AbortSignal): Promise<string> {
  const res = await apiFetch("/api/upload-ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ size: file.size }),
    signal,
  });
  if (!res.ok) await throwApiError(res, "Upload failed. Try again.");
  return ((await res.json()) as { ticket: string }).ticket;
}

function uploadTicket(file: File, signal?: AbortSignal): Promise<string> {
  let ticket = uploadTickets.get(file);
  if (!ticket) {
    ticket = requestUploadTicket(file, signal);
    uploadTickets.set(file, ticket);
    ticket.catch(() => uploadTickets.delete(file));
  }
  return ticket;
}

async function uploadDirect(file: File, signal?: AbortSignal): Promise<string | null> {
  const body = new FormData();
  body.append("ticket", await uploadTicket(file, signal));
  body.append("size", String(file.size));
  const dot = file.name.lastIndexOf(".");
  body.append("extension", dot >= 0 ? file.name.slice(dot) : "");
  const res = await fetch(`${TOOLS_API_URL}/api/video/upload-url`, { method: "POST", body, signal });
  if (res.status === 403) uploadTickets.delete(file);
  if (res.status === 404) return null;
  if (!res.ok) await throwApiError(res, "Upload failed. Try again.");
  const { uploadId, url, headers } = (await res.json()) as {
    uploadId: string;
    url: string;
    headers: Record<string, string>;
  };
  const put = await fetch(url, { method: "PUT", headers, body: file, signal });
  if (!put.ok) throw new ApiError("Upload failed. Try again.");
  return uploadId;
}

/** Appends the video to `body`: its direct-upload id, uploading it first
 * if this File hasn't been yet, or the file itself. */
async function appendVideo(body: FormData, file: File, signal?: AbortSignal): Promise<void> {
  let upload = directUploads.get(file);
  if (!upload) {
    upload = uploadDirect(file, signal);
    directUploads.set(file, upload);
    // The backend claims the ticket when it signs the upload URL, so a
    // failed upload needs a fresh ticket for its retry too.
    upload.catch(() => {
      directUploads.delete(file);
      uploadTickets.delete(file);
    });
  }
  const uploadId = await upload;
  if (uploadId) body.append("upload_id", uploadId);
  else body.append("file", file);
}

/** 410: the direct upload is gone (expired) - the next try uploads again,
 * with a fresh ticket. */
function forgetExpiredUpload(file: File, res: Response): void {
  if (res.status === 410) {
    directUploads.delete(file);
    uploadTickets.delete(file);
  }
}

/** A video to send: its contents, or (desktop app) a file that stays on
 * disk, which the local engine reads by path and the cloud backend only
 * gets once it has been read. */
export type MediaInput = File | DiskMedia;

const isDisk = (m: MediaInput): m is DiskMedia => !(m instanceof Blob);
/** Bytes for the cloud backend: a disk file is read here. */
const asFile = (m: MediaInput): Promise<File> => (isDisk(m) ? readDiskFile(m) : Promise.resolve(m));

export async function probeVideo(
  input: MediaInput
): Promise<{ info: VideoInfo; previewUrl: string }> {
  const engine = await localEngine();
  let res: Response;
  // Only set when uploaded (the upload caches are keyed by File).
  let file: File | null = null;
  if (engine) {
    // Desktop app: checked on this machine - no upload, no ticket.
    const body = new FormData();
    if (isDisk(input)) body.append("path", input.path);
    else body.append("file", input);
    res = await fetch(`${engine.url}/api/video/probe`, { method: "POST", body, headers: engineHeaders(engine) });
  } else {
    assertBackendEnabled();
    file = await asFile(input);
    const body = new FormData();
    await appendVideo(body, file);
    body.append("ticket", await uploadTicket(file));
    res = await fetch(`${TOOLS_API_URL}/api/video/probe`, {
      method: "POST",
      body,
    });
  }

  if (file) {
    forgetExpiredUpload(file, res);
    if (res.status === 403) uploadTickets.delete(file);
  }
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
async function getTicket(route: string, payload: Record<string, unknown> & { local?: boolean }, fallback: string, signal?: AbortSignal) {
  // A local job never touches the cloud backend, so its kill switch doesn't apply.
  if (!payload.local) assertBackendEnabled();
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
 *
 * `duration` is the whole file's length in seconds; with a `range`, the
 * range's length is billed instead.
 */
export async function processVideo(
  input: MediaInput,
  region: Region,
  resolution: Resolution,
  duration: number,
  signal?: AbortSignal,
  range?: { start: number; end: number }
): Promise<Blob> {
  const failed = "Processing failed. Try again.";
  const seconds = range ? Math.min(range.end, duration) - range.start : duration;
  const body = new FormData();
  let target = TOOLS_API_URL;
  let headers: Record<string, string> = {};
  let ticket: string | null = null;

  // Desktop app on a paid plan: runs on this machine, no credits spent. A
  // free plan is refused the local ticket (plan_required) and uses the cloud
  // backend and credits, as on the website.
  const engine = await localEngine();
  if (engine) {
    try {
      ({ ticket } = await getTicket("/api/process", { resolution, filename: input.name, duration: seconds, local: true }, failed, signal));
      target = engine.url;
      headers = engineHeaders(engine);
      if (isDisk(input)) body.append("path", input.path);
      else body.append("file", input);
    } catch (e) {
      if (!(e instanceof PlanRequiredError)) throw e;
    }
  }
  let file: File | null = null;
  if (!ticket) {
    // Upload before the ticket spends any credits (usually already done by
    // probeVideo for this same File).
    assertBackendEnabled();
    file = await asFile(input);
    await appendVideo(body, file, signal);
    ({ ticket } = await getTicket("/api/process", { resolution, filename: file.name, duration: seconds }, failed, signal));
  }
  body.append("ticket", ticket);
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
  const res = await fetch(`${target}/api/video/process`, {
    method: "POST",
    body,
    headers,
    signal,
  });

  // The backend deletes a direct upload once a job on it succeeds.
  if (file) {
    if (res.ok) directUploads.delete(file);
    forgetExpiredUpload(file, res);
  }
  if (!res.ok) {
    await throwApiError(res, failed);
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
  sources: MediaInput[],
  overlays: Blob[],
  audios: MediaInput[],
  background: File | null,
  resolution: Resolution,
  signal?: AbortSignal,
  onProgress?: (p: RenderProgress) => void
): Promise<Blob> {
  const projectJson = JSON.stringify(project);
  const exportFailed = "Export failed. Your original video is safe. Please try exporting again.";
  // Desktop app: rendered on this machine (same plan rules, from the ticket).
  const engine = await localEngine();
  const { ticket } = await getTicket("/api/export", { project: projectJson, resolution, local: Boolean(engine) }, exportFailed, signal);
  const body = new FormData();
  body.append("ticket", ticket);
  // Byte-for-byte the string the ticket was issued for (it carries its hash).
  body.append("project", projectJson);
  // The local engine reads disk files by path (source_paths/audio_paths,
  // in order, null = the next uploaded file); the cloud gets every file.
  const files = async (field: string, list: MediaInput[]) => {
    if (engine && list.some(isDisk)) body.append(`${field.slice(0, -1)}_paths`, JSON.stringify(list.map((m) => (isDisk(m) ? m.path : null))));
    for (const m of list) {
      if (engine && isDisk(m)) continue;
      const f = await asFile(m);
      body.append(field, f, f.name);
    }
  };
  await files("sources", sources);
  overlays.forEach((image, i) => body.append("overlays", image, `layer-${i}.png`));
  await files("audios", audios);
  if (background) body.append("background", background, background.name);

  if (!engine) {
    const res = await fetch(`${TOOLS_API_URL}/api/video/export`, { method: "POST", body, signal });
    if (!res.ok) await throwApiError(res, exportFailed);
    return res.blob();
  }

  // Local engine: watch the render under a job id, and stop it there when
  // `signal` aborts (aborting the request alone wouldn't stop ffmpeg).
  const jobId = crypto.randomUUID();
  body.append("job_id", jobId);
  const job = `${engine.url}/api/jobs/${jobId}`;
  const cancel = () => void fetch(`${job}/cancel`, { method: "POST", headers: engineHeaders(engine) }).catch(() => {});
  signal?.addEventListener("abort", cancel, { once: true });
  const poll = setInterval(() => {
    void fetch(job, { headers: engineHeaders(engine) })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: RenderProgress | null) => p && onProgress?.(p))
      .catch(() => {});
  }, 700);
  try {
    const res = await fetch(`${engine.url}/api/video/export`, { method: "POST", body, headers: engineHeaders(engine), signal });
    if (!res.ok) await throwApiError(res, exportFailed);
    return await res.blob();
  } finally {
    clearInterval(poll);
    signal?.removeEventListener("abort", cancel);
  }
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
 *
 * "preview" is the free daily low-resolution result; "full" needs sign-in
 * and a credit (see src/lib/imageTool.ts).
 */
export async function removeBackground(file: File, quality: ToolQuality): Promise<Blob> {
  const body = new FormData();
  body.append("file", file);
  body.append("quality", quality);

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

export type ToolQuality = "preview" | "full";

export type SharpenStrength = "light" | "standard" | "strong";

/** Goes through /api/sharpen-image - same free, non-Pro gate as
 * removeBackground above.
 */
export async function sharpenImage(file: File, strength: SharpenStrength, quality: ToolQuality): Promise<Blob> {
  const body = new FormData();
  body.append("file", file);
  body.append("strength", strength);
  body.append("quality", quality);

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

/** The frame grabber runs in the browser; this asks /api/frame-grab whether
 * the next capture may be taken, spending today's free preview or a credit
 * for full resolution. Resolves to whether it must be downscaled. */
export async function allowFrameGrab(quality: ToolQuality): Promise<{ preview: boolean }> {
  const res = await apiFetch("/api/frame-grab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quality }),
  });
  if (!res.ok) await throwApiError(res, "Couldn't capture the frame. Try again.");
  return res.json();
}
