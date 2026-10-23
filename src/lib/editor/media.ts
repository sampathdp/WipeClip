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

export interface Waveform {
  rate: number; // peaks per second of source time
  peaks: Float32Array; // 0..1, normalized to the loudest peak
}

const WAVE_RATE = 50;
const WAVE_SAMPLE_RATE = 8000; // decode low-rate: plenty for drawing, ~6x less memory
export const MAX_WAVE_FILE_BYTES = 400 * 1024 * 1024;

/** Peak envelope of a file's audio for the timeline. Unlike the helpers
 * above this does read the whole file into memory (decodeAudioData needs
 * the bytes), so very large files are skipped. Resolves null when the file
 * has no decodable audio, is too large, or `signal` aborts.
 */
export async function generateWaveform(file: File, signal: AbortSignal): Promise<Waveform | null> {
  if (file.size > MAX_WAVE_FILE_BYTES) return null;
  try {
    const bytes = await file.arrayBuffer();
    if (signal.aborted) return null;
    const audio = await new OfflineAudioContext(1, 1, WAVE_SAMPLE_RATE).decodeAudioData(bytes);
    if (signal.aborted) return null;
    const block = Math.max(1, Math.round(audio.sampleRate / WAVE_RATE));
    const count = Math.ceil(audio.length / block);
    const peaks = new Float32Array(count);
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      const data = audio.getChannelData(ch);
      for (let i = 0; i < count; i++) {
        let max = peaks[i];
        const end = Math.min(data.length, (i + 1) * block);
        for (let s = i * block; s < end; s++) {
          const v = data[s] < 0 ? -data[s] : data[s];
          if (v > max) max = v;
        }
        peaks[i] = max;
      }
    }
    let loudest = 0;
    for (const p of peaks) if (p > loudest) loudest = p;
    if (loudest < 1e-4) return null; // silent track - nothing to draw
    for (let i = 0; i < count; i++) peaks[i] /= loudest;
    return { rate: audio.sampleRate / block, peaks };
  } catch {
    return null;
  }
}

/** Duration of an audio (or video) file's audio, via an <audio> element.
 * Rejects with "media_error" when the browser can't decode it. */
export function loadAudioMeta(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const a = document.createElement("audio");
    a.preload = "metadata";
    const done = () => {
      a.removeAttribute("src");
      a.load();
    };
    a.onloadedmetadata = () => {
      const d = a.duration;
      done();
      if (Number.isFinite(d) && d > 0) resolve(d);
      else reject(new Error("media_error"));
    };
    a.onerror = () => {
      done();
      reject(new Error("media_error"));
    };
    a.src = url;
  });
}

const MAX_IMAGE_SIDE = 2048;

/** Decodes an uploaded PNG/JPEG/WebP and re-encodes it as a PNG no larger
 * than 2048px on its long side - the size the export accepts - so preview
 * and export use the exact same pixels. */
export async function normalizeImage(file: File): Promise<{ file: File; width: number; height: number }> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("media_error");
  });
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("media_error"))), "image/png")
  );
  const name = file.name.replace(/\.[^.]+$/, "") + ".png";
  return { file: new File([blob], name, { type: "image/png" }), width, height };
}
