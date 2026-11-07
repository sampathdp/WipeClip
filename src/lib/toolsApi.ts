import { apiFetch, EngineUnavailableError, localEngine, type LocalEngine } from "@/lib/platform";
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
  // No message (a proxy's HTML or plain-text error page): keep the status,
  // or there's nothing to go on when a user reports it.
  const msg = message || `${fallback} (error ${res.status})`;
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
/** A finished export the desktop engine left on disk (`keep` below). */
export interface RenderedFile {
  path: string;
  size: number;
  type: string;
}

export async function exportEditorProject(
  project: unknown,
  sources: MediaInput[],
  overlays: Blob[],
  audios: MediaInput[],
  background: File | null,
  resolution: Resolution,
  signal?: AbortSignal,
  onProgress?: (p: RenderProgress) => void,
  /** Desktop engine: leave the result on disk instead of sending it back,
   * so a long export never has to fit in memory. */
  keep = false
): Promise<Blob | RenderedFile> {
  const projectJson = JSON.stringify(project);
  const exportFailed = "Export failed. Your original video is safe. Please try exporting again.";
  // Desktop app: rendered on this machine (same plan rules, from the ticket).
  const engine = await localEngine();
  const { ticket } = await getTicket("/api/export", { project: projectJson, resolution, local: Boolean(engine) }, exportFailed, signal);
  const body = new FormData();
  body.append("ticket", ticket);
  // Byte-for-byte the string the ticket was issued for (it carries its hash).
  // The engine takes it as a file: form fields are capped at 1 MB there,
  // which a long project (captions, cursor rows) can pass.
  if (engine) body.append("project_file", new Blob([projectJson], { type: "application/json" }), "project.json");
  else body.append("project", projectJson);
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
    if (keep) body.append("keep_output", "true");
    const res = await fetch(`${engine.url}/api/video/export`, { method: "POST", body, headers: engineHeaders(engine), signal });
    if (!res.ok) await throwApiError(res, exportFailed);
    return keep ? ((await res.json()) as RenderedFile) : await res.blob();
  } finally {
    clearInterval(poll);
    signal?.removeEventListener("abort", cancel);
  }
}

/** Desktop app: a cleaned copy of a clip's sound for source seconds
 * `start`..`end` (background noise reduced, loudness evened out - see
 * backend/app/pipeline/audio_clean.py), as AAC. Runs on the local engine
 * only, free like the import check. */
export async function cleanAudio(
  input: MediaInput,
  start: number,
  end: number,
  opts: { denoise: number; level: boolean; repair?: boolean },
  signal?: AbortSignal
): Promise<{ blob: Blob; gain: number }> {
  const engine = await localEngine();
  if (!engine) throw new ApiError("Audio cleanup runs on this computer and needs the WipeClip desktop app's engine.", "engine_required");
  const body = new FormData();
  if (isDisk(input)) body.append("path", input.path);
  else body.append("file", input);
  body.append("start", start.toFixed(3));
  body.append("end", end.toFixed(3));
  body.append("denoise", String(opts.denoise));
  body.append("level", opts.level ? "true" : "false");
  if (opts.repair) body.append("repair", "true");
  const res = await fetch(`${engine.url}/api/audio/clean`, { method: "POST", body, headers: engineHeaders(engine), signal });
  if (!res.ok) await throwApiError(res, "This audio couldn't be cleaned up.");
  // A repaired copy is scaled under full scale; this undoes it (an older
  // engine sends nothing: 1).
  const gain = Number(res.headers.get("X-Clean-Gain") ?? 1);
  return { blob: await res.blob(), gain: Number.isFinite(gain) && gain > 0 ? gain : 1 };
}

/** The engine's NVIDIA graphics card support (speech.py gpu_status). */
export interface EngineGpu {
  available: boolean;
  /** Its libraries are downloaded. */
  ready: boolean;
  sizeMb: number;
}

/** "auto" heard a language whose own model isn't downloaded (Sinhala, Tamil, ...). */
export class ModelNeededError extends ApiError {
  constructor(
    message: string,
    readonly language: string
  ) {
    super(message, "model_needed");
  }
}

/** Desktop app: the sound of a file on this machine, decoded by the engine
 * straight from disk (backend/app/main.py api_audio_decode), so the page
 * never reads the whole file and long videos aren't skipped. Null without an
 * engine, or when the file has no sound it can read. */
export async function engineAudio(path: string, rate: number, channels: 1 | 2): Promise<AudioBuffer | null> {
  const engine = await optionalEngine().catch(() => null);
  if (!engine) return null;
  const body = new FormData();
  body.append("path", path);
  body.append("rate", String(rate));
  body.append("channels", String(channels));
  const res = await fetch(`${engine.url}/api/audio/decode`, { method: "POST", body, headers: engineHeaders(engine) }).catch(() => null);
  if (!res?.ok) return null;
  const data = new Float32Array(await res.arrayBuffer());
  const length = Math.floor(data.length / channels);
  if (length === 0) return null;
  const buf = new AudioBuffer({ length, numberOfChannels: channels, sampleRate: rate });
  if (channels === 1) {
    buf.copyToChannel(data, 0);
  } else {
    const left = buf.getChannelData(0);
    const right = buf.getChannelData(1);
    for (let i = 0; i < length; i++) {
      left[i] = data[2 * i];
      right[i] = data[2 * i + 1];
    }
  }
  return buf;
}

/** Desktop app: a file's waveform peaks (50 a second, not normalized),
 * measured by the engine as it decodes, never the whole file in memory.
 * Null without an engine or sound. */
export async function enginePeaks(path: string, signal?: AbortSignal): Promise<{ rate: number; peaks: Float32Array } | null> {
  const engine = await optionalEngine().catch(() => null);
  if (!engine) return null;
  const body = new FormData();
  body.append("path", path);
  const res = await fetch(`${engine.url}/api/audio/peaks`, { method: "POST", body, headers: engineHeaders(engine), signal }).catch(() => null);
  if (!res?.ok) return null;
  return { rate: 50, peaks: new Float32Array(await res.arrayBuffer()) };
}

/** Desktop app: the engine's speech model for `language` ("auto" or a
 * Whisper code; backend/app/pipeline/speech.py): whether it's downloaded
 * yet, its size, the graphics card support, and whether it's a model of
 * the language's own (Sinhala, Tamil, ...) rather than the general one. Null without an engine
 * (the website), or when it can't start - captions then run in the browser. */
export async function engineSpeechModel(language: string): Promise<{ ready: boolean; sizeMb: number; gpu: EngineGpu; own?: boolean } | null> {
  const engine = await optionalEngine().catch(() => null);
  if (!engine) return null;
  const res = await fetch(`${engine.url}/api/speech/model?language=${encodeURIComponent(language)}`, { headers: engineHeaders(engine) }).catch(() => null);
  return res?.ok ? ((await res.json()) as { ready: boolean; sizeMb: number; gpu: EngineGpu; own?: boolean }) : null;
}

/** Desktop app: a word-timed transcript of 16 kHz mono `samples`, made by
 * the engine (faster-whisper on this machine's cores - much faster than
 * the browser's), which downloads the model first if needed. `signal`
 * stops it there too. Null without an engine. */
export async function engineTranscribe(
  samples: Float32Array,
  language: string,
  gpu: boolean,
  onProgress: (stage: "download" | "prepare" | "transcribe", value: number) => void,
  signal?: AbortSignal,
  /** hint: names and words to expect; accurate: slower, more careful decoding. */
  opts: { hint?: string; accurate?: boolean } = {}
): Promise<{ language: string; words: { start: number; end: number; text: string }[] } | null> {
  const engine = await optionalEngine();
  if (!engine) return null;
  const jobId = crypto.randomUUID();
  const body = new FormData();
  body.append("audio", new Blob([samples as Float32Array<ArrayBuffer>], { type: "application/octet-stream" }), "speech.f32");
  body.append("language", language);
  body.append("gpu", gpu ? "true" : "false");
  body.append("job_id", jobId);
  if (opts.hint?.trim()) body.append("hint", opts.hint.trim().slice(0, 2000));
  if (opts.accurate) body.append("accurate", "true");
  const job = `${engine.url}/api/jobs/${jobId}`;
  const cancel = () => void fetch(`${job}/cancel`, { method: "POST", headers: engineHeaders(engine) }).catch(() => {});
  signal?.addEventListener("abort", cancel, { once: true });
  const poll = setInterval(() => {
    void fetch(job, { headers: engineHeaders(engine) })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { phase: string; progress: number | null } | null) => {
        if (p && (p.phase === "download" || p.phase === "prepare" || p.phase === "transcribe")) onProgress(p.phase, p.progress ?? 0);
      })
      .catch(() => {});
  }, 700);
  try {
    const res = await fetch(`${engine.url}/api/speech/transcribe`, { method: "POST", body, headers: engineHeaders(engine), signal });
    if (res.status === 409) {
      const detail = (await res.json().catch(() => null))?.detail;
      if (detail?.code === "model_needed") throw new ModelNeededError(detail.message, detail.language);
      throw new DOMException("Speech recognition cancelled", "AbortError");
    }
    if (!res.ok) await throwApiError(res, "Speech recognition failed.");
    return (await res.json()) as { language: string; words: { start: number; end: number; text: string }[] };
  } finally {
    clearInterval(poll);
    signal?.removeEventListener("abort", cancel);
  }
}

/** Desktop app: whether the engine's voice translation models are
 * downloaded (backend/app/pipeline/dub.py), and what's left to download.
 * Null without an engine (the website). */
export async function engineDubModels(): Promise<{ ready: boolean; sizeMb: number } | null> {
  const engine = await optionalEngine().catch(() => null);
  if (!engine) return null;
  const res = await fetch(`${engine.url}/api/dub/models`, { headers: engineHeaders(engine) }).catch(() => null);
  return res?.ok ? ((await res.json()) as { ready: boolean; sizeMb: number }) : null;
}

export type DubStage = "download" | "separate" | "voice" | "speak";

/** Desktop app: the speech in `channels` (44.1 kHz stereo, timeline time)
 * said again in English in the speaker's voice, by the engine. `sentences`:
 * each source sentence's times and its English text. Resolves to a WAV
 * with three channels - the English voice, then the background in stereo.
 * `signal` stops it in the engine too. */
export async function engineDub(
  channels: Float32Array[],
  sentences: { start: number; end: number; text: string }[],
  onProgress: (stage: DubStage, value: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const engine = await localEngine();
  if (!engine) throw new EngineUnavailableError();
  const n = channels[0].length;
  const interleaved = new Float32Array(n * 2);
  const [left, right] = [channels[0], channels[1] ?? channels[0]];
  for (let i = 0; i < n; i++) {
    interleaved[2 * i] = left[i];
    interleaved[2 * i + 1] = right[i];
  }
  const jobId = crypto.randomUUID();
  const body = new FormData();
  body.append("audio", new Blob([interleaved], { type: "application/octet-stream" }), "mix.f32");
  body.append("sentences", JSON.stringify(sentences));
  body.append("job_id", jobId);
  const job = `${engine.url}/api/jobs/${jobId}`;
  const cancel = () => void fetch(`${job}/cancel`, { method: "POST", headers: engineHeaders(engine) }).catch(() => {});
  signal?.addEventListener("abort", cancel, { once: true });
  const poll = setInterval(() => {
    void fetch(job, { headers: engineHeaders(engine) })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { phase: string; progress: number | null } | null) => {
        if (p && ["download", "separate", "voice", "speak"].includes(p.phase)) onProgress(p.phase as DubStage, p.progress ?? 0);
      })
      .catch(() => {});
  }, 700);
  try {
    const res = await fetch(`${engine.url}/api/dub/render`, { method: "POST", body, headers: engineHeaders(engine), signal });
    if (res.status === 409) throw new DOMException("Voice translation cancelled", "AbortError");
    if (!res.ok) await throwApiError(res, "Voice translation failed.");
    return await res.blob();
  } finally {
    clearInterval(poll);
    signal?.removeEventListener("abort", cancel);
  }
}

export interface MattedVideo {
  /** The matted file on this machine (picture on top, mask below). */
  path: string;
  /** Its width and half height. */
  width: number;
  height: number;
  fps: number;
}

/** Desktop app: the matted file of a webcam video - webcam background
 * removal (backend/app/pipeline/matte.py), made by the engine on this
 * machine if it isn't cached yet. The video is a disk file (`path`), or one
 * held in memory (`key` + `file`): the engine is asked by key first and gets
 * the file only if it doesn't have it yet (a local hand-over; nothing goes
 * online). `signal` stops it in the engine too. */
export async function engineMatte(
  input: { path: string } | { key: string; file: File },
  duration: number,
  detail: "fine" | "fast",
  onProgress: (value: number) => void,
  signal?: AbortSignal
): Promise<MattedVideo> {
  const engine = await localEngine();
  if (!engine) throw new EngineUnavailableError();
  const jobId = crypto.randomUUID();
  const form = (withFile: boolean) => {
    const body = new FormData();
    if ("path" in input) body.append("path", input.path);
    else {
      body.append("key", input.key);
      if (withFile) body.append("file", input.file, input.file.name || "webcam.mp4");
    }
    body.append("duration", String(Math.max(0, Math.round(duration * 1000) / 1000)));
    body.append("detail", detail);
    body.append("job_id", jobId);
    return body;
  };
  const job = `${engine.url}/api/jobs/${jobId}`;
  const cancel = () => void fetch(`${job}/cancel`, { method: "POST", headers: engineHeaders(engine) }).catch(() => {});
  signal?.addEventListener("abort", cancel, { once: true });
  const poll = setInterval(() => {
    void fetch(job, { headers: engineHeaders(engine) })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { phase: string; progress: number | null } | null) => {
        if (p?.phase === "matte") onProgress(p.progress ?? 0);
      })
      .catch(() => {});
  }, 500);
  try {
    const send = (withFile: boolean) => fetch(`${engine.url}/api/matte/render`, { method: "POST", body: form(withFile), headers: engineHeaders(engine), signal });
    let res = await send(false);
    if (res.status === 409) {
      const detail = (await res.clone().json().catch(() => null))?.detail;
      if (detail?.code === "need_file") res = await send(true);
    }
    if (res.status === 409) throw new DOMException("Background removal cancelled", "AbortError");
    if (!res.ok) await throwApiError(res, "Couldn't remove the background from this video.");
    return (await res.json()) as MattedVideo;
  } finally {
    clearInterval(poll);
    signal?.removeEventListener("abort", cancel);
  }
}

/** Desktop app: scene analysis of a screen recording by the engine on this
 * machine (backend/app/pipeline/scenes.py; the result's shape is
 * sceneAnalysis.ts ScreenAnalysis). `clicks`: [t, x, y] in source seconds
 * and frame fractions. Nothing goes online. `signal` stops it in the engine. */
export async function engineSceneAnalyze(
  input: { path: string } | { key: string; file: File },
  level: "quick" | "thorough",
  clicks: [number, number, number][],
  duration: number,
  onProgress: (stage: "scan" | "read", value: number) => void,
  signal?: AbortSignal
): Promise<unknown> {
  const engine = await localEngine();
  if (!engine) throw new EngineUnavailableError();
  const jobId = crypto.randomUUID();
  const form = (withFile: boolean) => {
    const body = new FormData();
    if ("path" in input) body.append("path", input.path);
    else {
      body.append("key", input.key);
      if (withFile) body.append("file", input.file, input.file.name || "recording.mp4");
    }
    body.append("level", level);
    body.append("clicks", JSON.stringify(clicks));
    body.append("duration", String(Math.max(0, Math.round(duration * 1000) / 1000)));
    body.append("job_id", jobId);
    return body;
  };
  const job = `${engine.url}/api/jobs/${jobId}`;
  const cancel = () => void fetch(`${job}/cancel`, { method: "POST", headers: engineHeaders(engine) }).catch(() => {});
  signal?.addEventListener("abort", cancel, { once: true });
  const poll = setInterval(() => {
    void fetch(job, { headers: engineHeaders(engine) })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { phase: string; progress: number | null } | null) => {
        if (p?.phase === "scan" || p?.phase === "read") onProgress(p.phase, p.progress ?? 0);
      })
      .catch(() => {});
  }, 500);
  try {
    const send = (withFile: boolean) => fetch(`${engine.url}/api/scene/analyze`, { method: "POST", body: form(withFile), headers: engineHeaders(engine), signal });
    let res = await send(false);
    if (res.status === 409 && (await res.clone().json().catch(() => null))?.detail?.code === "need_file") res = await send(true);
    if (res.status === 409) throw new DOMException("Scene analysis cancelled", "AbortError");
    if (!res.ok) await throwApiError(res, "The screen couldn't be analyzed.");
    return await res.json();
  } finally {
    clearInterval(poll);
    signal?.removeEventListener("abort", cancel);
  }
}

/** Desktop app: the person mask (w x h bytes, 255 = person) of one small
 * live webcam frame (RGBA), for the recorder's preview. By the engine on
 * this machine; nothing goes online. */
export async function engineMatteFrame(rgba: Uint8ClampedArray, w: number, h: number, signal?: AbortSignal): Promise<Uint8Array> {
  const engine = await localEngine();
  if (!engine) throw new EngineUnavailableError();
  const res = await fetch(`${engine.url}/api/matte/frame?w=${w}&h=${h}`, {
    method: "POST",
    body: new Blob([rgba as Uint8ClampedArray<ArrayBuffer>]),
    headers: { ...engineHeaders(engine), "Content-Type": "application/octet-stream" },
    signal,
  });
  if (!res.ok) await throwApiError(res, "Background removal isn't available right now.");
  return new Uint8Array(await res.arrayBuffer());
}

/** The engine for optional measurements: null when there's none or it
 * couldn't start (the analysis then goes without the picture). */
async function optionalEngine(): Promise<LocalEngine | null> {
  try {
    return await localEngine();
  } catch (e) {
    if (e instanceof EngineUnavailableError) return null;
    throw e;
  }
}

/** How much the picture changes in each source range of a video on this
 * machine (backend/app/pipeline/activity.py), 0..1 per range. Local engine
 * only; null without it. At most 50 ranges per call. */
export async function videoActivity(path: string, ranges: [number, number][], signal?: AbortSignal): Promise<number[] | null> {
  const engine = await optionalEngine();
  if (!engine) return null;
  const body = new FormData();
  body.append("path", path);
  body.append("ranges", JSON.stringify(ranges.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000])));
  const res = await fetch(`${engine.url}/api/video/activity`, { method: "POST", body, headers: engineHeaders(engine), signal });
  if (!res.ok) await throwApiError(res, "The video couldn't be checked for on-screen activity.");
  const data = (await res.json()) as { ranges: { changing: number }[] };
  return data.ranges.map((r) => r.changing);
}

/** Picture change and scene-change scores (0..100) of sampled frames in
 * source seconds start..end of a video on this machine
 * (backend/app/pipeline/activity.py motion_profile). Local engine only;
 * null without it. At most 600 s per call. */
export async function videoMotion(
  path: string,
  start: number,
  end: number,
  signal?: AbortSignal
): Promise<{ times: number[]; motion: number[]; scene: number[] } | null> {
  const engine = await optionalEngine();
  if (!engine) return null;
  const body = new FormData();
  body.append("path", path);
  body.append("start", start.toFixed(3));
  body.append("end", end.toFixed(3));
  const res = await fetch(`${engine.url}/api/video/motion`, { method: "POST", body, headers: engineHeaders(engine), signal });
  if (!res.ok) await throwApiError(res, "The video couldn't be measured for movement.");
  return (await res.json()) as { times: number[]; motion: number[]; scene: number[] };
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

  const res = await apiFetch("/api/remove-background", {
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

  const res = await apiFetch("/api/sharpen-image", {
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
