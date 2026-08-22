"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";

interface Capture {
  id: string;
  url: string;
  time: number;
}

const MAX_BYTES = 500 * 1024 * 1024;
const SUGGEST_SAMPLE_COUNT = 24;
const SUGGEST_RESULT_COUNT = 5;
const SEEK_TIMEOUT_MS = 1500;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2);
  return `${m}:${s.padStart(5, "0")}`;
}

/** Resolves once the video has actually seeked to `time` (or after a
 * timeout, so one stuck frame - a broken keyframe, an edge-of-stream
 * seek - can't hang the whole scan). */
function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener("seeked", finish);
      resolve();
    };
    video.addEventListener("seeked", finish);
    video.currentTime = time;
    setTimeout(finish, SEEK_TIMEOUT_MS);
  });
}

/** Cheap, dependency-free "is this a good thumbnail" heuristic: favors
 * frames that are well-exposed (not near-black/white) and visually
 * detailed (high contrast + strong edges), which in practice screens
 * out blank/transition frames and rewards sharp, in-focus ones. */
function scoreFrame(data: Uint8ClampedArray, width: number, height: number) {
  const lum = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    lum[p] = l;
    sum += l;
  }
  const brightness = sum / lum.length;

  let variance = 0;
  for (let p = 0; p < lum.length; p++) {
    const d = lum[p] - brightness;
    variance += d * d;
  }
  const contrast = Math.sqrt(variance / lum.length);

  let edgeSum = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      edgeSum += Math.abs(lum[idx + 1] - lum[idx - 1]) + Math.abs(lum[idx + width] - lum[idx - width]);
    }
  }
  const edges = edgeSum / ((width - 2) * (height - 2));

  return { brightness, score: contrast * 0.6 + edges * 0.4 };
}

async function suggestCoverFrames(
  video: HTMLVideoElement,
  onProgress: (done: number, total: number) => void
): Promise<{ time: number; blob: Blob; score: number }[]> {
  const duration = video.duration;
  if (!duration || !isFinite(duration)) return [];

  const margin = duration * 0.04;
  const start = margin;
  const span = Math.max(duration - margin * 2, 0.1);
  const sampleCount = Math.max(6, Math.min(SUGGEST_SAMPLE_COUNT, Math.ceil(duration * 4)));

  const probe = document.createElement("canvas");
  probe.width = 160;
  probe.height = 90;
  const pctx = probe.getContext("2d", { willReadFrequently: true });
  if (!pctx) return [];

  const wasPaused = video.paused;
  const originalTime = video.currentTime;
  video.pause();

  const candidates: { time: number; score: number }[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = sampleCount === 1 ? start : start + (span * i) / (sampleCount - 1);
    await seekTo(video, t);
    pctx.drawImage(video, 0, 0, probe.width, probe.height);
    const { data } = pctx.getImageData(0, 0, probe.width, probe.height);
    const { brightness, score } = scoreFrame(data, probe.width, probe.height);
    if (brightness < 12 || brightness > 245) continue;
    candidates.push({ time: t, score });
    onProgress(i + 1, sampleCount);
  }

  candidates.sort((a, b) => b.score - a.score);

  const minGap = span / (SUGGEST_RESULT_COUNT * 1.5);
  const picked: { time: number; score: number }[] = [];
  for (const c of candidates) {
    if (picked.length >= SUGGEST_RESULT_COUNT) break;
    if (picked.every((p) => Math.abs(p.time - c.time) >= minGap)) picked.push(c);
  }
  for (const c of candidates) {
    if (picked.length >= SUGGEST_RESULT_COUNT) break;
    if (!picked.includes(c)) picked.push(c);
  }
  picked.sort((a, b) => a.time - b.time);

  const full = document.createElement("canvas");
  full.width = video.videoWidth;
  full.height = video.videoHeight;
  const fctx = full.getContext("2d");

  const results: { time: number; blob: Blob; score: number }[] = [];
  if (fctx) {
    for (const p of picked) {
      await seekTo(video, p.time);
      fctx.drawImage(video, 0, 0, full.width, full.height);
      const blob = await new Promise<Blob | null>((resolve) => full.toBlob(resolve, "image/png"));
      if (blob) results.push({ time: p.time, blob, score: p.score });
    }
  }

  await seekTo(video, originalTime);
  if (!wasPaused) video.play().catch(() => {});

  return results;
}

/** Entirely client-side: the video file is never uploaded anywhere, a
 * frame is drawn straight from the <video> element into a <canvas> and
 * exported as a PNG blob. No backend call, no credit/rate-limit gate -
 * there's no per-use cost to gate, unlike every other tool on this site.
 */
export default function VideoFrameGrabberDemo() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [suggestions, setSuggestions] = useState<Capture[]>([]);
  const [bestSuggestionId, setBestSuggestionId] = useState<string | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestProgress, setSuggestProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const pickFile = useCallback((picked: File | undefined) => {
    if (!picked) return;
    if (!picked.type.startsWith("video/")) {
      setError("Please choose a video file.");
      return;
    }
    if (picked.size > MAX_BYTES) {
      setError("File exceeds the 500MB limit.");
      return;
    }
    setError(null);
    setFile(picked);
    setVideoUrl(URL.createObjectURL(picked));
    setCaptures([]);
    setSuggestions([]);
    setBestSuggestionId(null);
  }, []);

  const reset = useCallback(() => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    captures.forEach((c) => URL.revokeObjectURL(c.url));
    suggestions.forEach((s) => URL.revokeObjectURL(s.url));
    setFile(null);
    setVideoUrl(null);
    setVideoSize(null);
    setCaptures([]);
    setSuggestions([]);
    setBestSuggestionId(null);
    setError(null);
  }, [videoUrl, captures, suggestions]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) return;
      setCaptures((prev) => [
        { id: `${Date.now()}-${Math.random()}`, url: URL.createObjectURL(blob), time: video.currentTime },
        ...prev,
      ]);
    }, "image/png");
  }, []);

  const removeCapture = useCallback((id: string) => {
    setCaptures((prev) => {
      const found = prev.find((c) => c.id === id);
      if (found) URL.revokeObjectURL(found.url);
      return prev.filter((c) => c.id !== id);
    });
  }, []);

  const runSuggest = useCallback(async () => {
    const video = videoRef.current;
    if (!video || isSuggesting) return;

    suggestions.forEach((s) => URL.revokeObjectURL(s.url));
    setSuggestions([]);
    setBestSuggestionId(null);
    setIsSuggesting(true);
    setSuggestProgress({ done: 0, total: 0 });
    setError(null);

    try {
      const frames = await suggestCoverFrames(video, (done, total) => setSuggestProgress({ done, total }));
      if (frames.length === 0) {
        setError("Couldn't find good cover frames in this video — try grabbing one manually instead.");
        return;
      }
      const withIds = frames.map((f) => ({
        id: `sugg-${f.time}-${Math.random()}`,
        url: URL.createObjectURL(f.blob),
        time: f.time,
        score: f.score,
      }));
      const best = withIds.reduce((a, b) => (b.score > a.score ? b : a));
      setSuggestions(withIds.map(({ id, url, time }) => ({ id, url, time })));
      setBestSuggestionId(best.id);
    } finally {
      setIsSuggesting(false);
    }
  }, [isSuggesting, suggestions]);

  const useSuggestion = useCallback((suggestion: Capture) => {
    setCaptures((prev) => [suggestion, ...prev]);
    setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
  }, []);

  return (
    <div
      id="upload"
      className="glass-card mx-auto max-w-3xl scroll-mt-28 rounded-[2rem] p-6 sm:p-10 border border-cyan-500/20 shadow-[0_20px_50px_rgba(15,23,42,0.08)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.7)]"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl text-foreground">
            Try it now: <span className="text-gradient">Grab Video Frames</span>
          </h2>
          <p className="mt-1.5 text-sm sm:text-base text-muted">
            Scrub to any moment, capture it as a PNG. 100% in your browser — nothing is uploaded.
          </p>
        </div>
      </div>

      {!file && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => inputRef.current?.click()}
          className={`mt-8 flex cursor-pointer flex-col items-center justify-center rounded-[1.75rem] border-2 border-dashed px-6 py-14 text-center transition-all ${
            isDragOver
              ? "border-cyan-400 bg-cyan-50 scale-[1.01] shadow-[0_0_30px_rgba(34,211,238,0.25)]"
              : "border-border hover:border-cyan-500/50 hover:bg-surface-2/40 hover:shadow-[0_0_20px_rgba(124,92,255,0.15)]"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-accent/20 to-accent-2/20 border border-cyan-400/30 text-cyan-600 shadow-[0_0_20px_rgba(34,211,238,0.2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="text-base font-semibold text-foreground">Drop your video here, or click to browse</p>
          <p className="mt-1 text-xs sm:text-sm text-muted">MP4, MOV, WebM &bull; Up to 500MB &bull; Never leaves your device</p>
        </div>
      )}

      {file && videoUrl && (
        <div className="mt-8 rounded-[1.75rem] bg-surface-2/70 border border-border p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-4">
            <div className="min-w-0">
              <p className="truncate font-semibold text-foreground">{file.name}</p>
              <p className="text-xs sm:text-sm text-muted mt-0.5">
                {videoSize ? `${videoSize.width}×${videoSize.height}` : ""}
              </p>
            </div>
            <button onClick={reset} className="shrink-0 text-xs font-semibold text-muted transition-colors hover:text-cyan-600">
              Start over
            </button>
          </div>

          <div className="mt-5">
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className="mx-auto max-h-96 w-full rounded-2xl border border-border bg-black"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                setVideoSize({ width: v.videoWidth, height: v.videoHeight });
              }}
            />
            <canvas ref={canvasRef} className="hidden" />

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={captureFrame}
                className="btn-primary flex-1 rounded-full py-3.5 text-sm font-semibold flex items-center justify-center gap-2"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span>Capture This Frame</span>
              </button>
              <button
                onClick={runSuggest}
                disabled={!videoSize || isSuggesting}
                className="btn-secondary flex-1 rounded-full py-3.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSuggesting ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="animate-spin">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
                  </svg>
                )}
                <span>{isSuggesting ? `Scanning… ${suggestProgress.done}/${suggestProgress.total || SUGGEST_SAMPLE_COUNT}` : "Suggest Cover Frames"}</span>
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-muted">
              Play, pause, or scrub the video above to the moment you want, then capture — or let us scan the clip
              for a few sharp, well-lit frames that work well as a cover image.
            </p>
          </div>

          {(isSuggesting || suggestions.length > 0) && (
            <div className="mt-8 border-t border-border/60 pt-6">
              <div className="mb-4 flex items-center justify-between gap-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Suggested cover frames{suggestions.length > 0 ? ` (${suggestions.length})` : ""}
                </p>
                {isSuggesting && (
                  <span className="text-[11px] font-mono text-muted">
                    {suggestProgress.done}/{suggestProgress.total || SUGGEST_SAMPLE_COUNT}
                  </span>
                )}
              </div>

              {isSuggesting && suggestions.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-10">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="animate-spin text-cyan-600">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <p className="text-xs text-muted">Scanning the video for sharp, well-lit frames…</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {suggestions.map((s) => (
                    <div key={s.id} className="group relative overflow-hidden rounded-xl border border-border bg-black">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.url} alt={`Suggested cover frame at ${formatTime(s.time)}`} className="aspect-video w-full object-cover" />
                      {s.id === bestSuggestionId && (
                        <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow">
                          Best pick
                        </span>
                      )}
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/70 px-2 py-1.5 backdrop-blur-sm">
                        <span className="font-mono text-[10px] text-white">{formatTime(s.time)}</span>
                        <div className="flex items-center gap-2">
                          <a
                            href={s.url}
                            download={`cover-${formatTime(s.time).replace(":", "m")}s.png`}
                            className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-700"
                          >
                            Download
                          </a>
                          <button
                            onClick={() => useSuggestion(s)}
                            className="text-[10px] font-semibold text-cyan-600 hover:text-cyan-700"
                          >
                            Use this
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {captures.length > 0 && (
            <div className="mt-8 border-t border-border/60 pt-6">
              <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">
                Captured frames ({captures.length})
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {captures.map((c) => (
                  <div key={c.id} className="group relative overflow-hidden rounded-xl border border-border bg-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.url} alt={`Frame at ${formatTime(c.time)}`} className="aspect-video w-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/70 px-2 py-1.5 backdrop-blur-sm">
                      <span className="font-mono text-[10px] text-white">{formatTime(c.time)}</span>
                      <div className="flex items-center gap-2">
                        <a
                          href={c.url}
                          download={`frame-${formatTime(c.time).replace(":", "m")}s.png`}
                          className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-700"
                        >
                          Download
                        </a>
                        <button
                          onClick={() => removeCapture(c.id)}
                          className="text-[10px] font-semibold text-rose-600 hover:text-rose-700"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-cyan-500/20 bg-cyan-50/70 p-4 text-center">
            <p className="text-xs sm:text-sm text-muted">
              Need to remove a watermark instead of just grabbing a frame?{" "}
              <Link href="/" className="font-semibold text-cyan-600 underline hover:text-cyan-700">
                Try WipeClip.co&apos;s watermark remover free
              </Link>
            </p>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-center text-xs sm:text-sm font-medium text-rose-600">{error}</p>}
    </div>
  );
}
