/** getUserMedia/getDisplayMedia failures in words, for the recorder. Pure -
 * see tests/desktop/recorder.test.ts.
 */
import type { PrivacyKind } from "@/lib/platform/recorder";

export type RecorderPlatform = "windows" | "macos" | "linux" | "web";
export type MediaKind = "screen" | "microphone" | "camera";

export function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : typeof e === "string" ? e : fallback;
}

/** The message to show, with the settings page that fixes it where there
 * is one. Names are the DOMException names the WebViews throw: denied
 * permission (NotAllowedError, SecurityError), no such device
 * (NotFoundError, OverconstrainedError), device busy or failed to start
 * (NotReadableError, AbortError), API missing (NotSupportedError,
 * TypeError). */
export function mediaError(e: unknown, what: MediaKind, platform: RecorderPlatform): { message: string; settings?: PrivacyKind } {
  const name = (e as DOMException)?.name;
  const thing = what === "screen" ? "screen recording" : what;
  if (name === "NotAllowedError" || name === "SecurityError") {
    if (what === "screen" && platform === "windows") return { message: "Screen selection was cancelled." };
    return {
      message:
        platform === "macos"
          ? `WipeClip isn't allowed to use ${thing}. Turn it on for WipeClip in System Settings > Privacy & Security${what === "screen" ? ", then quit and reopen WipeClip" : ""}.`
          : `Access to the ${thing} was blocked. Allow it for WipeClip in Windows Settings > Privacy & security.`,
      settings: what === "screen" ? "screen" : what,
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return { message: `No ${what === "screen" ? "screen to capture" : what} was found.` };
  if (name === "NotReadableError" || name === "AbortError") return { message: `The ${thing === "screen recording" ? "screen" : what} is in use by another app or couldn't be started.` };
  if (name === "NotSupportedError" || name === "TypeError") return { message: `${what === "screen" ? "Screen capture" : `The ${what}`} isn't supported by this system's web engine.` };
  return { message: errorText(e, `Couldn't start the ${what}.`) };
}
