"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { normalizeRegion, type Point } from "@/lib/recorder/coords";
import type { Rect } from "@/lib/recorder/format";

export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface-2/50 p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
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
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm text-foreground">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
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
