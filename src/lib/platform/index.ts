/** The seam between the website and the WipeClip desktop app (Tauri). Every
 * function here keeps today's browser behaviour on the website and only
 * does something different when IS_DESKTOP is set at build time, so the
 * editor itself stays a single codebase. Tauri modules are imported lazily
 * inside desktop-only branches and never load on the website.
 */
import { createClient } from "@/lib/supabase/client";
import { DESKTOP_AUTH_REDIRECT, IS_DESKTOP, SITE_ORIGIN } from "./env";

export { IS_DESKTOP, SITE_ORIGIN } from "./env";

async function invoke<T>(cmd: string, args?: Record<string, unknown> | Uint8Array, headers?: Record<string, string>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args, headers ? { headers } : undefined);
}

/** URL for one of the site's own API routes (/api/...). Relative on the
 * website; absolute to the production site in the desktop app. */
export function apiUrl(path: string): string {
  return IS_DESKTOP ? `${SITE_ORIGIN}${path}` : path;
}

/** fetch() for the site's own API routes. On the website the session
 * cookie rides along as before; the desktop app adds the Supabase access
 * token as a bearer token instead (see getRequestAuth on the server). */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!IS_DESKTOP) return fetch(path, init);
  const headers = new Headers(init.headers);
  const { data } = await createClient().auth.getSession();
  if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  return fetch(apiUrl(path), { ...init, headers });
}

/** A page on the website, e.g. "/pricing". */
export function siteUrl(path: string): string {
  return IS_DESKTOP ? `${SITE_ORIGIN}${path}` : path;
}

/** Where email links and OAuth send the user back to. */
export function authRedirectUrl(): string {
  return IS_DESKTOP ? DESKTOP_AUTH_REDIRECT : `${window.location.origin}/auth/callback`;
}

/** Opens a URL in the system browser (desktop) or a new tab (website). The
 * desktop side only opens https URLs on WipeClip's and Supabase's hosts. */
export async function openExternal(url: string): Promise<void> {
  if (!IS_DESKTOP) {
    window.open(url, "_blank", "noopener");
    return;
  }
  await invoke("open_external", { url });
}

export interface DesktopCapabilities {
  desktop: boolean;
  /** Export can be saved straight to a folder the user picks. */
  nativeSave: boolean;
  platform: "windows" | "macos" | "linux" | "web";
  version: string | null;
}

export async function getDesktopCapabilities(): Promise<DesktopCapabilities> {
  if (!IS_DESKTOP) return { desktop: false, nativeSave: false, platform: "web", version: null };
  return invoke<DesktopCapabilities>("desktop_capabilities");
}

export interface LocalEngine {
  /** e.g. http://127.0.0.1:52011 */
  url: string;
  /** Sent as X-Local-Token on every request. */
  token: string;
}

/** The desktop app's bundled processing engine (src-tauri/src/engine.rs),
 * started on first use. null on the website, or when this build has no
 * engine or it couldn't start - callers then use the cloud backend. Asked
 * per job rather than cached: the app restarts a stopped engine on a new
 * port, and answers instantly while it's running. */
export async function localEngine(): Promise<LocalEngine | null> {
  if (!IS_DESKTOP) return null;
  try {
    return await invoke<LocalEngine | null>("local_engine");
  } catch (err) {
    console.warn("[engine] local engine unavailable, using the cloud backend", err);
    return null;
  }
}

/** Memory this machine can give to heavy work, in GB: what's free now where
 * the OS says (desktop on Windows), else half the total. The desktop app asks
 * the OS (src-tauri/src/system.rs); the website only has
 * navigator.deviceMemory (Chromium, rounded and capped at 8). null if unknown. */
export async function memoryBudgetGb(): Promise<number | null> {
  const GB = 1024 ** 3;
  if (IS_DESKTOP) {
    try {
      const m = await invoke<{ totalBytes: number | null; availableBytes: number | null }>("system_memory");
      if (m.availableBytes != null) return m.availableBytes / GB;
      if (m.totalBytes != null) return m.totalBytes / GB / 2;
    } catch (err) {
      console.warn("[system] memory unknown", err);
    }
  }
  const reported = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return reported ? reported / 2 : null;
}

export type SaveResult = { status: "saved"; path: string } | { status: "cancelled" };

/** Saves an exported video. Website: the usual browser download. Desktop:
 * the OS save dialog picks the destination first, then the bytes are
 * written beside it under a temporary name and renamed into place, so a
 * failed write never leaves a half-written file under the chosen name. */
export async function saveExportFile(blob: Blob, suggestedName: string): Promise<SaveResult> {
  if (!IS_DESKTOP) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { status: "saved", path: suggestedName };
  }
  const token = await invoke<string | null>("choose_export_path", { suggestedName });
  if (!token) return { status: "cancelled" };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const path = await invoke<string>("write_export", bytes, { "x-export-token": token });
  return { status: "saved", path };
}

/** Shows the folder holding a saved export (desktop only). */
export async function revealExport(path: string): Promise<void> {
  if (IS_DESKTOP) await invoke("reveal_export", { path });
}

/** A native error dialog (desktop) or alert (website), also written to the
 * desktop app's log file. For failures the editor's own UI can't show. */
export async function showDesktopError(title: string, message: string): Promise<void> {
  if (!IS_DESKTOP) {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  await invoke("show_error", { title, message });
}

/** Saves a small text export (subtitles, transcript, chapter list).
 * Website: a browser download. Desktop: the OS save dialog. The extension
 * must be .srt, .vtt, .txt or .json. */
export async function saveTextFile(suggestedName: string, contents: string): Promise<SaveResult> {
  if (!IS_DESKTOP) {
    const type = suggestedName.endsWith(".json") ? "application/json" : suggestedName.endsWith(".vtt") ? "text/vtt" : "text/plain";
    const url = URL.createObjectURL(new Blob([contents], { type: `${type};charset=utf-8` }));
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { status: "saved", path: suggestedName };
  }
  const path = await invoke<string | null>("save_text_file", { suggestedName, contents });
  return path ? { status: "saved", path } : { status: "cancelled" };
}

export interface AppUpdate {
  version: string;
  notes: string | null;
}

export type UpdateProgress = { event: "progress"; downloaded: number; total: number | null } | { event: "installing" };

/** A newer desktop version from the release feed, or null (also on the
 * website and in dev builds). */
export async function checkForUpdate(): Promise<AppUpdate | null> {
  if (!IS_DESKTOP) return null;
  return invoke<AppUpdate | null>("update_check");
}

/** Downloads and installs the update found by `checkForUpdate`, then the
 * app restarts. Rejects while a recording is running. */
export async function installUpdate(onProgress: (p: UpdateProgress) => void): Promise<void> {
  const { Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<UpdateProgress>();
  channel.onmessage = onProgress;
  await invoke("update_install", { onProgress: channel });
}

/** Opens the third-party notices shipped with the desktop app. */
export async function openNotices(): Promise<void> {
  if (IS_DESKTOP) await invoke("open_notices");
}

/** OK/Cancel confirmation. Always use this instead of window.confirm: in
 * the desktop app the dialog plugin replaces window.confirm with an async
 * version whose Promise is always truthy, so `if (!window.confirm(...))`
 * would never stop anything. */
export async function confirmAction(message: string, opts: { title?: string; okLabel?: string } = {}): Promise<boolean> {
  // eslint-disable-next-line no-restricted-properties -- the website (no dialog plugin) keeps the native, synchronous confirm
  if (!IS_DESKTOP) return window.confirm(message);
  return invoke<boolean>("confirm_action", { title: opts.title ?? "WipeClip", message, okLabel: opts.okLabel ?? "OK" });
}
