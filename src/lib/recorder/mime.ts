/** Container/codec choice for MediaRecorder. MP4 (H.264/AAC) first: it's
 * what both WebViews record natively on current systems (WebView2 since
 * Chromium 126, WKWebView always), it seeks well in the editor and the
 * export backend reads it directly. WebM is the fallback for older
 * WebView2 runtimes. Pure - see tests/desktop/recorder.test.ts.
 */
import type { TrackKind } from "./format.ts";

const VIDEO_TYPES = [
  "video/mp4;codecs=avc1.640033",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

const AUDIO_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

export interface MimeChoice {
  mimeType: string;
  /** File name in the recording folder, e.g. "screen.mp4". */
  file: string;
}

export function pickMimeType(kind: TrackKind, isTypeSupported: (t: string) => boolean): MimeChoice | null {
  const video = kind === "screen" || kind === "webcam";
  const mimeType = (video ? VIDEO_TYPES : AUDIO_TYPES).find((t) => isTypeSupported(t));
  if (!mimeType) return null;
  return { mimeType, file: `${kind}.${extensionFor(mimeType)}` };
}

export function extensionFor(mimeType: string): string {
  const base = mimeType.split(";")[0].trim();
  if (base === "video/mp4") return "mp4";
  if (base === "audio/mp4") return "m4a";
  if (base === "audio/ogg") return "ogg";
  return "webm";
}

/** Type to give the File handed to the editor (no codec parameters). */
export function fileTypeFor(mimeType: string): string {
  return mimeType.split(";")[0].trim();
}
