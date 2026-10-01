/** Browser-side media helpers for the editor. All of these read through a
 * throwaway <video> element pointed at an object URL - the file is streamed
 * by the browser's media stack, never loaded into a JS buffer.
 */

export interface BrowserVideoMeta {
  duration: number;
  width: number;
  height: number;
}

function withVideo<T>(url: string, run: (v: HTMLVideoElement) => Promise<T>): Promise<T> {
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  v.src = url;
  return run(v).finally(() => {
    v.removeAttribute("src");
    v.load();
  });
}

function once(v: HTMLVideoElement, event: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, timeoutMs);
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("media_error"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      v.removeEventListener(event, ok);
      v.removeEventListener("error", fail);
    };
    v.addEventListener(event, ok);
    v.addEventListener("error", fail);
  });
}

/** Rejects with "media_error" when the browser can't decode the file (e.g.
 * HEVC in a browser without it) - the caller turns that into a clear
 * unsupported-format message.
 */
export function loadVideoMeta(url: string): Promise<BrowserVideoMeta> {
  return withVideo(url, async (v) => {
    await once(v, "loadedmetadata");
    if (!Number.isFinite(v.duration) || v.duration <= 0 || !v.videoWidth) {
      throw new Error("media_error");
    }
    return { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
  });
}

async function seek(v: HTMLVideoElement, time: number) {
  if (Math.abs(v.currentTime - time) < 0.001 && v.readyState >= 2) return;
  const done = once(v, "seeked");
  v.currentTime = time;
  await done;
}

/** One full-resolution frame at `time` as a PNG blob (display orientation). */
export function grabFrame(url: string, time: number): Promise<{ blob: Blob; width: number; height: number }> {
  return withVideo(url, async (v) => {
    await once(v, "loadeddata");
    await seek(v, Math.min(Math.max(0, time), Math.max(0, v.duration - 0.05)));
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode_failed"))), "image/png")
    );
    return { blob, width: canvas.width, height: canvas.height };
  });
}

export interface ThumbnailStrip {
  interval: number; // seconds between thumbnails
  urls: string[]; // JPEG data URLs, index i ~ time i*interval
}

/** Small evenly spaced thumbnails for timeline clips. Calls `onProgress`
 * as each one lands so the timeline fills in progressively; stops quietly
 * if `signal` aborts (source removed / editor closed).
 */
export async function generateThumbnails(
  url: string,
  duration: number,
  onProgress: (strip: ThumbnailStrip) => void,
  signal: AbortSignal
): Promise<void> {
  const count = Math.min(60, Math.max(8, Math.ceil(duration / 2)));
  const interval = duration / count;
  const urls: string[] = [];
  await withVideo(url, async (v) => {
    await once(v, "loadeddata");
    const height = 72;
    const width = Math.max(1, Math.round((v.videoWidth / v.videoHeight) * height));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    for (let i = 0; i < count; i++) {
      if (signal.aborted) return;
      try {
        await seek(v, Math.min(duration - 0.05, i * interval + interval / 2));
      } catch {
        break;
      }
      ctx.drawImage(v, 0, 0, width, height);
      urls.push(canvas.toDataURL("image/jpeg", 0.6));
      if (i % 4 === 3 || i === count - 1) onProgress({ interval, urls: [...urls] });
    }
  }).catch(() => {});
}
