"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { normalizeRegion, type Point } from "@/lib/recorder/coords";
import type { Rect } from "@/lib/recorder/format";
import { MIC_CHECK_SECONDS, analyzeMic, type MicReport } from "@/lib/recorder/micCheck";

/** A settings card. `collapsible` makes the header a disclosure (open unless `defaultOpen` is false). */
export function Section({
  title,
  hint,
  children,
  aside,
  collapsible,
  defaultOpen = true,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  /** Shown at the right of the header, e.g. a summary of the current choice. */
  aside?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const head = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </span>
      {aside && <span className="shrink-0 text-xs text-muted">{aside}</span>}
    </>
  );
  if (collapsible) {
    return (
      <details open={defaultOpen} className="group rounded-2xl border border-border bg-surface-2/50">
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl p-4 hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 [&::-webkit-details-marker]:hidden">
          {head}
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} className="shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="space-y-3 px-4 pb-4">{children}</div>
      </details>
    );
  }
  return (
    <section className="rounded-2xl border border-border bg-surface-2/50 p-4">
      <h3 className="flex items-center gap-3">{head}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-foreground">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent-2 ${checked ? "bg-accent-2" : "bg-surface-3"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${checked ? "left-[1.125rem]" : "left-0.5"}`} />
      </span>
    </label>
  );
}

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  label,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-foreground">{label}</span>
      <select
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
        className="max-w-[60%] rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export type Tone = "info" | "warn" | "error" | "ok";

export function Note({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  const styles: Record<Tone, string> = {
    info: "border-border bg-surface text-muted",
    ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    warn: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
    error: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  };
  return (
    <div role={tone === "error" ? "alert" : undefined} className={`rounded-xl border px-3 py-2 text-xs ${styles[tone]}`}>
      {children}
    </div>
  );
}

/** Live input level of an audio stream, 0..1, updated per animation frame. */
export function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      queueMicrotask(() => setLevel(0));
      return;
    }
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let raf = 0;
    let shown = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      // Fast attack, slow release, like a hardware meter.
      shown = peak > shown ? peak : shown * 0.92;
      setLevel(Math.min(1, shown));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close();
    };
  }, [stream]);
  return level;
}

export function LevelMeter({ level, label }: { level: number; label: string }) {
  const pct = Math.round(Math.sqrt(level) * 100); // perceptual-ish scale
  return (
    <div className="flex items-center gap-2" aria-label={label} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div
          className={`h-full rounded-full transition-[width] duration-75 ${pct > 92 ? "bg-rose-500" : pct > 70 ? "bg-amber-400" : "bg-emerald-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-[11px] tabular-nums text-muted">{pct}</span>
    </div>
  );
}

/** A <video> showing a live stream. */
export function LivePreview({ stream, className, mirror }: { stream: MediaStream | null; className?: string; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => {});
    return () => {
      v.srcObject = null;
    };
  }, [stream]);
  return <video ref={ref} muted playsInline className={`${className ?? ""} ${mirror ? "-scale-x-100" : ""}`} />;
}

/** The live camera with its background removed or blurred, as a preview of
 * what the editor will make (the recording itself stays the original).
 * Small frames go to the engine on this machine one after another; the
 * mask is smoothed over time here and scaled up over the full picture. If
 * the engine can't segment, the plain camera shows with a note. */
export function LiveMattePreview({
  stream,
  mode,
  segment,
  className,
  mirror,
  maxFps = 12,
}: {
  stream: MediaStream;
  mode: "remove" | "blur";
  segment: (rgba: Uint8ClampedArray, w: number, h: number, signal: AbortSignal) => Promise<Uint8Array>;
  className?: string;
  mirror?: boolean;
  /** At most this many masks a second: each is a round trip to the engine
   * (a neural network on the CPU) plus a full redraw. */
  maxFps?: number;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const v = video.current;
    const out = canvas.current;
    if (!v || !out) return;
    v.srcObject = stream;
    void v.play().catch(() => {});
    const abort = new AbortController();
    const small = document.createElement("canvas");
    const maskCanvas = document.createElement("canvas");
    const fg = document.createElement("canvas");
    let smooth: Float32Array | null = null;
    let raf = 0;
    let busy = false;
    let lastAt = 0;
    const draw = (mask: HTMLCanvasElement | null) => {
      const W = Math.min(640, v.videoWidth);
      const H = Math.round((v.videoHeight * W) / Math.max(1, v.videoWidth));
      if (!W || !H) return;
      if (out.width !== W) out.width = W;
      if (out.height !== H) out.height = H;
      const ctx = out.getContext("2d")!;
      ctx.clearRect(0, 0, W, H);
      if (!mask) {
        ctx.drawImage(v, 0, 0, W, H);
        return;
      }
      if (mode === "blur") {
        ctx.filter = `blur(${Math.round(H * 0.025)}px)`;
        ctx.drawImage(v, -H * 0.05, -H * 0.05, W + H * 0.1, H + H * 0.1);
        ctx.filter = "none";
      }
      fg.width = W;
      fg.height = H;
      const f = fg.getContext("2d")!;
      f.drawImage(v, 0, 0, W, H);
      f.globalCompositeOperation = "destination-in";
      f.imageSmoothingQuality = "high";
      f.drawImage(mask, 0, 0, W, H);
      f.globalCompositeOperation = "source-over";
      ctx.drawImage(fg, 0, 0);
    };
    const step = async () => {
      if (abort.signal.aborted) return;
      raf = requestAnimationFrame(() => void step());
      if (busy || v.readyState < 2 || !v.videoWidth || document.hidden) return;
      const t = performance.now();
      if (t - lastAt < 1000 / maxFps) return;
      lastAt = t;
      busy = true;
      try {
        const w = 256;
        const h = Math.max(16, Math.round((v.videoHeight * w) / v.videoWidth));
        small.width = w;
        small.height = h;
        const sctx = small.getContext("2d", { willReadFrequently: true })!;
        sctx.drawImage(v, 0, 0, w, h);
        const m = await segment(sctx.getImageData(0, 0, w, h).data, w, h, abort.signal);
        // Smoothed over time where it barely changes (less shimmer), new
        // where it moved (no trails) - as the editor's own pass does.
        if (!smooth || smooth.length !== m.length) smooth = Float32Array.from(m);
        else for (let i = 0; i < m.length; i++) {
          const d = m[i] - smooth[i];
          smooth[i] += d * Math.min(1, 0.35 + (2.5 * Math.abs(d)) / 255);
        }
        maskCanvas.width = w;
        maskCanvas.height = h;
        const mctx = maskCanvas.getContext("2d")!;
        const img = mctx.createImageData(w, h);
        for (let i = 0; i < smooth.length; i++) {
          // The editor's default edge curve: steeper, so faint halos drop.
          const a = Math.max(0, Math.min(1, (smooth[i] / 255 - 0.5) * 2 + 0.5));
          img.data[i * 4 + 3] = a * 255;
        }
        mctx.putImageData(img, 0, 0);
        draw(maskCanvas);
      } catch {
        if (!abort.signal.aborted) {
          setFailed(true);
          abort.abort();
          const loop = () => {
            draw(null);
            raf = requestAnimationFrame(loop);
          };
          loop();
        }
      } finally {
        busy = false;
      }
    };
    void step();
    return () => {
      abort.abort();
      cancelAnimationFrame(raf);
      v.srcObject = null;
    };
  }, [stream, mode, segment, maxFps]);
  return (
    <div className="relative">
      <video ref={video} muted playsInline className="hidden" />
      <canvas
        ref={canvas}
        className={`${className ?? ""} ${mirror ? "-scale-x-100" : ""}`}
        style={mode === "remove" ? { backgroundImage: "repeating-conic-gradient(#8884 0% 25%, transparent 0% 50%)", backgroundSize: "16px 16px" } : undefined}
      />
      {failed && (
        <p className="absolute inset-x-0 bottom-0 rounded-b-lg bg-black/60 px-2 py-1 text-[11px] text-white">
          Live preview isn&apos;t available; the editor still removes the background after recording.
        </p>
      )}
    </div>
  );
}

/** Preview of the captured surface with a draggable region on top.
 * `region` is in fractions of the surface; null = everything. */
export function RegionSelector({
  stream,
  region,
  onChange,
  enabled,
}: {
  stream: MediaStream;
  region: Rect | null;
  onChange: (r: Rect | null) => void;
  enabled: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ a: Point; b: Point } | null>(null);
  const [aspect, setAspect] = useState(16 / 9);

  useEffect(() => {
    const track = stream.getVideoTracks()[0];
    const update = () => {
      const s = track?.getSettings();
      if (s?.width && s?.height) setAspect(s.width / s.height);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [stream]);

  const at = (e: React.PointerEvent): Point => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const shown = drag ? normalizeRegion(drag.a, drag.b) : region;

  return (
    <div
      ref={boxRef}
      className={`relative mx-auto w-full overflow-hidden rounded-xl border border-border bg-black ${enabled ? "cursor-crosshair touch-none" : ""}`}
      style={{ aspectRatio: String(aspect), maxHeight: 340 }}
      onPointerDown={(e) => {
        if (!enabled) return;
        (e.target as Element).setPointerCapture(e.pointerId);
        const p = at(e);
        setDrag({ a: p, b: p });
      }}
      onPointerMove={(e) => drag && setDrag({ ...drag, b: at(e) })}
      onPointerUp={() => {
        if (!drag) return;
        const r = normalizeRegion(drag.a, drag.b);
        setDrag(null);
        if (r) onChange(r);
      }}
    >
      <LivePreview stream={stream} className="pointer-events-none h-full w-full object-contain" />
      {shown && (
        <div
          className="pointer-events-none absolute border-2 border-accent-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
          style={{
            left: `${shown.x * 100}%`,
            top: `${shown.y * 100}%`,
            width: `${shown.width * 100}%`,
            height: `${shown.height * 100}%`,
          }}
        />
      )}
      {enabled && !shown && (
        <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs font-semibold text-white drop-shadow">
          Drag on the preview to select the area to record
        </p>
      )}
    </div>
  );
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Microphone check (micCheck.ts): records MIC_CHECK_SECONDS from the
 * chosen microphone's stream, says how it sounds and what to change, and
 * plays the take back. Nothing is kept. */
export function MicCheck({ stream }: { stream: MediaStream }) {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "recording"; left: number } | { kind: "done"; report: MicReport; url: string } | { kind: "error"; message: string }>({ kind: "idle" });
  const stop = useRef<(() => void) | null>(null);
  // A running check ends with its microphone (the recorder keys this on
  // the stream, so a new microphone starts over).
  useEffect(() => () => stop.current?.(), [stream]);
  useEffect(() => () => void (state.kind === "done" && URL.revokeObjectURL(state.url)), [state]);

  const run = () => {
    if (typeof MediaRecorder === "undefined") {
      setState({ kind: "error", message: "This browser can't record sound for the check." });
      return;
    }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const parts: Blob[] = [];
    let cancelled = false;
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = async () => {
      if (cancelled) return;
      try {
        const blob = new Blob(parts, { type: rec.mimeType || mime || "audio/webm" });
        const ctx = new AudioContext();
        const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
        void ctx.close();
        setState({ kind: "done", report: analyzeMic(buf.getChannelData(0), buf.sampleRate), url: URL.createObjectURL(blob) });
      } catch {
        setState({ kind: "error", message: "The check couldn't read the recording. Try again, or pick another microphone." });
      }
    };
    rec.start();
    let left = MIC_CHECK_SECONDS;
    setState({ kind: "recording", left });
    const timer = setInterval(() => {
      left--;
      if (left > 0) setState({ kind: "recording", left });
      else {
        clearInterval(timer);
        if (rec.state !== "inactive") rec.stop();
      }
    }, 1000);
    stop.current = () => {
      cancelled = true;
      clearInterval(timer);
      if (rec.state !== "inactive") rec.stop();
      stop.current = null;
    };
  };

  return (
    <div className="space-y-2">
      {state.kind === "recording" ? (
        <div className="flex items-center gap-2 text-xs text-foreground" role="status">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" aria-hidden />
          Talk as you will in the video… {state.left} s
          <button
            type="button"
            className="font-semibold text-accent-2 hover:underline"
            onClick={() => {
              stop.current?.();
              setState({ kind: "idle" });
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={run}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
        >
          {state.kind === "done" ? "Check again" : `Check my microphone (${MIC_CHECK_SECONDS} s)`}
        </button>
      )}
      {state.kind === "done" && (
        <Note tone={state.report.issues.length === 0 ? "ok" : state.report.issues.includes("no-speech") || state.report.issues.includes("clipping") ? "error" : "warn"}>
          <p className="font-semibold">{state.report.verdict}</p>
          {state.report.tips.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {state.report.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          <audio controls src={state.url} className="mt-2 h-8 w-full" aria-label="Play the check back" />
        </Note>
      )}
      {state.kind === "error" && <Note tone="error">{state.message}</Note>}
    </div>
  );
}
