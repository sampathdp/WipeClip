/** Desktop-only bridge to the recorder's native half (src-tauri/src/
 * recording, src-tauri/src/input, src-tauri/src/shortcuts.rs). Every call
 * throws on the website; the recorder UI is only offered when IS_DESKTOP.
 */
import type { DisplayInfo, InputSettings, PermissionState } from "@/lib/recorder/format";
import type { RawInputEvent } from "@/lib/recorder/events";
import { IS_DESKTOP } from "./env";

async function invoke<T>(cmd: string, args?: Record<string, unknown> | Uint8Array, headers?: Record<string, string>): Promise<T> {
  if (!IS_DESKTOP) throw new Error("The screen recorder is only available in the WipeClip desktop app.");
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args, headers ? { headers } : undefined);
}

/** Tauri rejects with the command's error string; make it an Error. */
function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(typeof e === "string" ? e : "Something went wrong.");
}

async function call<T>(cmd: string, args?: Record<string, unknown> | Uint8Array, headers?: Record<string, string>): Promise<T> {
  try {
    return await invoke<T>(cmd, args, headers);
  } catch (e) {
    throw asError(e);
  }
}

// --- storage ----------------------------------------------------------------

export const recordingDefaultDir = () => call<string>("recording_default_dir");
export const recordingChooseDir = () => call<string | null>("recording_choose_dir");
export const recordingStorage = (dir: string) => call<{ freeBytes: number | null }>("recording_storage", { dir });

export const recordingBegin = (dir: string, folderName: string, manifest: string) =>
  call<{ id: string; path: string }>("recording_begin", { dir, folderName, manifest });

export const recordingAppend = (id: string, file: string, bytes: Uint8Array) =>
  call<void>("recording_append", bytes, { "x-recording": id, "x-file": file });

export const recordingWrite = (id: string, file: string, bytes: Uint8Array) =>
  call<void>("recording_write", bytes, { "x-recording": id, "x-file": file });

export const recordingFinish = (id: string, manifest: string) => call<string>("recording_finish", { id, manifest });
export const recordingDiscard = (path: string) => call<void>("recording_discard", { path });

export async function recordingRead(path: string, file: string): Promise<ArrayBuffer> {
  const data = await call<ArrayBuffer | number[]>("recording_read", { path, file });
  return data instanceof ArrayBuffer ? data : new Uint8Array(data).buffer;
}

export interface FoundRecording {
  path: string;
  manifest: string;
  sizes: Record<string, number>;
}

export const recordingOpen = () => call<FoundRecording | null>("recording_open");
export const recordingScanIncomplete = (dir: string) => call<FoundRecording[]>("recording_scan_incomplete", { dir });
export const recordingUpdateManifest = (path: string, manifest: string) => call<void>("recording_update_manifest", { path, manifest });
export const recordingReveal = (path: string) => call<void>("recording_reveal", { path });

// --- native screen capture (Windows) ------------------------------------------------

export interface NativeCaptureSupport {
  supported: boolean;
  /** The yellow capture border can be turned off (Windows 11). */
  borderless: boolean;
  /** The pointer can be left out of the frames. */
  cursorControl: boolean;
}

export interface NativeCaptureSource {
  /** "monitor:<handle>" or "window:<handle>". */
  id: string;
  kind: "monitor" | "window";
  name: string;
  app: string | null;
  /** Desktop rectangle, physical pixels. */
  bounds: { x: number; y: number; width: number; height: number };
  primary: boolean;
  /** recorder_displays id, for monitors. */
  displayId: string | null;
  minimized: boolean;
}

export interface NativeCaptureOptions {
  /** Recording id from recordingBegin; files go into its folder. */
  recording: string;
  source: string;
  fps: number;
  maxHeight: number | null;
  bitrate: number;
  /** Pointer drawn into the frames. */
  cursor: boolean;
  systemAudio: boolean;
}

export interface NativeCaptureStarted {
  width: number;
  height: number;
  frameRate: number;
  systemAudio: boolean;
  /** ms from the command arriving to recording time 0. */
  setupMs: number;
  /** Recording time 0 on the capture clock (captureClock). */
  t0Ms: number;
  warnings: string[];
  encoder: "hardware" | "software";
}

export interface NativeCaptureStatus {
  screenBytes: number;
  audioBytes: number;
  frames: number;
  dropped: number;
  contentWidth: number;
  contentHeight: number;
  /** Capture ended on its own (window closed, display gone, encoder failed). */
  ended: string | null;
  warnings: string[];
}

export interface NativeCaptureStopped {
  screenBytes: number;
  audioBytes: number;
  durationMs: number;
  frames: number;
  dropped: number;
  systemAudio: boolean;
  warnings: string[];
}

export const captureSupport = () => call<NativeCaptureSupport>("capture_support");
export const captureSources = () => call<NativeCaptureSource[]>("capture_sources");
export const captureStart = (options: NativeCaptureOptions) => call<NativeCaptureStarted>("capture_start", { options });
/** `atMs`: when it happened on the capture clock (else: when the command arrives). */
export const capturePause = (paused: boolean, atMs?: number) => call<void>("capture_pause", { paused, atMs: atMs ?? null });
export const captureStatus = () => call<NativeCaptureStatus>("capture_status");
export const captureStop = (atMs?: number) => call<NativeCaptureStopped>("capture_stop", { atMs: atMs ?? null });
/** The native capture clock (QPC) in ms. */
export const captureClock = () => call<number>("capture_clock");
export const captureExcludeWindow = (exclude: boolean) => call<void>("capture_exclude_window", { exclude });

/** width, height (u32 LE), then RGBA. */
function toImageData(data: ArrayBuffer | number[]): ImageData {
  const buf = data instanceof ArrayBuffer ? data : new Uint8Array(data).buffer;
  const head = new DataView(buf, 0, 8);
  const width = head.getUint32(0, true);
  const height = head.getUint32(4, true);
  return new ImageData(new Uint8ClampedArray(buf, 8, width * height * 4), width, height);
}

/** A still of a source, fitted into maxWidth x maxHeight. */
export async function captureThumbnail(id: string, maxWidth: number, maxHeight: number): Promise<ImageData> {
  return toImageData(await call<ArrayBuffer | number[]>("capture_thumbnail", { id, maxWidth, maxHeight }));
}

/** The latest recorded frame, scaled to fit (mini player preview). */
export async function capturePreview(maxWidth: number, maxHeight: number): Promise<ImageData> {
  return toImageData(await call<ArrayBuffer | number[]>("capture_preview", { maxWidth, maxHeight }));
}

// --- mini player ------------------------------------------------------------------

export const MINI_LABEL = "recorder-mini";
export const MINI_STATE_EVENT = "recorder://mini-state";

export interface MiniState {
  elapsedMs: number;
  status: "recording" | "paused" | "stopping";
}

/** Opens/closes the always-on-top mini player (never in the recording). */
export const recorderMini = (show: boolean) => call<void>("recorder_mini", { show });

export async function sendMiniState(state: MiniState): Promise<void> {
  if (!IS_DESKTOP) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo(MINI_LABEL, MINI_STATE_EVENT, state);
}

export const MINI_ACTION_EVENT = "recorder://mini-action";
/** Mini player buttons. Unlike the start/stop hotkey, "stop" can only stop. */
export type MiniAction = "pause" | "marker" | "stop";

export async function sendMiniAction(action: MiniAction): Promise<void> {
  if (!IS_DESKTOP) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("main", MINI_ACTION_EVENT, action);
}

export async function onMiniAction(handler: (action: MiniAction) => void): Promise<() => void> {
  if (!IS_DESKTOP) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<MiniAction>(MINI_ACTION_EVENT, (e) => handler(e.payload));
}

/** The latest recorded frame at full size. */
export async function captureFrame(): Promise<ImageData> {
  return toImageData(await call<ArrayBuffer | number[]>("capture_frame"));
}

// --- displays, window, settings ------------------------------------------------

export const recorderDisplays = () => call<DisplayInfo[]>("recorder_displays");
export const recorderWindow = (minimize: boolean) => call<void>("recorder_window", { minimize });
export type PrivacyKind = "screen" | "microphone" | "camera" | "input";
export const openPrivacySettings = (kind: PrivacyKind) => call<void>("open_privacy_settings", { kind });

// --- input monitor ---------------------------------------------------------------

export interface NativeInputPermissions {
  mouse: Exclude<PermissionState, "unknown">;
  keyboard: Exclude<PermissionState, "unknown">;
  activeWindow: Exclude<PermissionState, "unknown">;
}

export const inputPermissions = () => call<NativeInputPermissions>("input_permissions");
export const inputRequestAccess = () => call<NativeInputPermissions>("input_request_access");
export const inputStart = (settings: InputSettings) =>
  call<{ pointer: [number, number] | null; warnings: string[] }>("input_start", { settings });
export const inputNow = () => call<number>("input_now");
export const inputDrain = () => call<{ events: RawInputEvent[]; dropped: number }>("input_drain");
export const inputStop = () => call<{ events: RawInputEvent[]; dropped: number }>("input_stop");

// --- hotkeys -------------------------------------------------------------------------

export type ShortcutAction = "toggle" | "pause" | "marker" | "screenshot";
export interface ShortcutStatus {
  action: ShortcutAction;
  accelerator: string;
  error: string | null;
}

export const recorderShortcuts = (enable: boolean) => call<ShortcutStatus[]>("recorder_shortcuts", { enable });

export async function onRecorderShortcut(handler: (action: ShortcutAction) => void): Promise<() => void> {
  if (!IS_DESKTOP) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<ShortcutAction>("recorder://shortcut", (e) => handler(e.payload));
}
