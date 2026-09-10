"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type DemoMode = "slider" | "scanner" | "reticle";

const SAMPLES = [
  { id: "sintel", label: "Cinematic Demo", src: "/demo-sintel.mp4", tag: "1080p • 60 FPS" },
  { id: "nature", label: "Nature Macro", src: "/demo-video.mp4", tag: "4K • Lossless" },
];

export default function BeforeAfterDemo() {
  const [activeSample, setActiveSample] = useState(0);
  const [mode, setMode] = useState<DemoMode>("slider");
  const [percent, setPercent] = useState(50);
  const [scanPercent, setScanPercent] = useState(50);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [timecode, setTimecode] = useState("00:00:01:14");

  const [inView, setInView] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragging = useRef(false);
  const dragRect = useRef<DOMRect | null>(null);

  // Defer video decode/network work until the deck actually scrolls into view.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Automated Laser Scanner Animation loop
  useEffect(() => {
    if (mode !== "scanner") return;
    let direction = 1;
    let current = 20;

    const interval = setInterval(() => {
      current += direction * 0.75;
      if (current >= 85) direction = -1;
      if (current <= 15) direction = 1;
      setScanPercent(current);
    }, 20);

    return () => clearInterval(interval);
  }, [mode]);

  const updateFromClientX = useCallback((clientX: number) => {
    const rect = dragRect.current;
    if (!rect) return;
    const ratio = ((clientX - rect.left) / rect.width) * 100;
    setPercent(Math.min(100, Math.max(0, ratio)));
  }, []);

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const s = e.currentTarget.currentTime;
    const mins = Math.floor(s / 60).toString().padStart(2, "0");
    const secs = Math.floor(s % 60).toString().padStart(2, "0");
    const frames = Math.floor((s % 1) * 30).toString().padStart(2, "0");
    setTimecode(`00:${mins}:${secs}:${frames}`);
  };

  const togglePlay = () => {
    setInView(true);
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (videoRef.current) videoRef.current.muted = nextMuted;
  };

  useEffect(() => {
    const v = videoRef.current;
    if (v && inView) {
      v.play().catch(() => {});
    }
  }, [activeSample, inView]);

  const effectivePercent = mode === "scanner" ? scanPercent : mode === "reticle" ? 100 : percent;

  return (
    <div className="relative">
      {/* Studio Header HUD Toolbar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Sample Switcher Pills */}
        <div className="flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border p-1">
          {SAMPLES.map((sample, idx) => (
            <button
              key={sample.id}
              onClick={() => setActiveSample(idx)}
              className={`rounded-full px-3 py-1 font-medium transition-all ${
                activeSample === idx
                  ? "bg-[#6947e8] text-white shadow-[0_0_12px_rgba(124,92,255,0.5)]"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {sample.label}
            </button>
          ))}
        </div>

        {/* Vision Mode Selectors */}
        <div className="flex items-center gap-1 rounded-full bg-surface-2/90 border border-border p-1 font-mono text-[11px]">
          <button
            onClick={() => setMode("slider")}
            className={`rounded-full px-2.5 py-1 transition-all ${
              mode === "slider"
                ? "bg-cyan-500/20 text-cyan-600 border border-cyan-400/40 shadow-[0_0_10px_rgba(34,211,238,0.3)]"
                : "text-muted hover:text-foreground"
            }`}
          >
            Split Scrub
          </button>
          <button
            onClick={() => setMode("scanner")}
            className={`rounded-full px-2.5 py-1 transition-all ${
              mode === "scanner"
                ? "bg-cyan-500/20 text-cyan-600 border border-cyan-400/40 shadow-[0_0_10px_rgba(34,211,238,0.3)]"
                : "text-muted hover:text-foreground"
            }`}
          >
            AI Laser Scan
          </button>
          <button
            onClick={() => setMode("reticle")}
            className={`rounded-full px-2.5 py-1 transition-all ${
              mode === "reticle"
                ? "bg-cyan-500/20 text-cyan-600 border border-cyan-400/40 shadow-[0_0_10px_rgba(34,211,238,0.3)]"
                : "text-muted hover:text-foreground"
            }`}
          >
            Target Lock
          </button>
        </div>
      </div>

      {/* Main Holographic Video Deck */}
      <div
        ref={containerRef}
        className="glass-card group relative aspect-video w-full select-none overflow-hidden rounded-[2rem] border border-cyan-500/30 shadow-[0_25px_70px_rgba(15,23,42,0.12)] dark:shadow-[0_25px_70px_rgba(0,0,0,0.9)] cursor-ew-resize bg-black"
        onPointerDown={(e) => {
          if (mode === "slider") {
            dragging.current = true;
            dragRect.current = containerRef.current?.getBoundingClientRect() ?? null;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            updateFromClientX(e.clientX);
          }
        }}
        onPointerMove={(e) => {
          if (dragging.current && mode === "slider") updateFromClientX(e.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
          dragRect.current = null;
        }}
      >
        {/* Continuous HD Video Stream (Always 100% visible on both sides) */}
        <video
          ref={videoRef}
          key={SAMPLES[activeSample].id}
          src={inView ? SAMPLES[activeSample].src : undefined}
          className="absolute inset-0 h-full w-full object-cover"
          muted={isMuted}
          loop
          playsInline
          preload="none"
          onTimeUpdate={handleTimeUpdate}
        >
          <track kind="captions" label="No spoken audio" srcLang="en" src="/captions/silent.vtt" default />
        </video>

        {/* Futuristic Cyber Corner Bracket HUD Accents */}
        <div className="pointer-events-none absolute top-3 left-3 z-30 h-4 w-4 border-t-2 border-l-2 border-cyan-400 opacity-70" />
        <div className="pointer-events-none absolute top-3 right-3 z-30 h-4 w-4 border-t-2 border-r-2 border-cyan-400 opacity-70" />
        <div className="pointer-events-none absolute bottom-3 left-3 z-30 h-4 w-4 border-b-2 border-l-2 border-cyan-400 opacity-70" />
        <div className="pointer-events-none absolute bottom-3 right-3 z-30 h-4 w-4 border-b-2 border-r-2 border-cyan-400 opacity-70" />

        {/* Live HUD Telemetry Header */}
        <div className="pointer-events-none absolute top-4 left-5 z-30 flex items-center gap-3 font-mono text-[10px] text-cyan-300/90 tracking-wider">
          <span className="flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 border border-cyan-500/30 backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            REC {timecode}
          </span>
          <span className="hidden sm:inline-block rounded-md bg-black/60 px-2 py-0.5 border border-white/10 text-muted backdrop-blur-md">
            {SAMPLES[activeSample].tag}
          </span>
        </div>

        {/* Clean State Badge (Left Side) */}
        <span className="pointer-events-none absolute bottom-5 left-5 z-20 inline-flex items-center gap-2 rounded-full bg-black/75 backdrop-blur-md px-3.5 py-1.5 text-xs font-semibold text-emerald-400 border border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          AI Inpainted &bull; Clean Master
        </span>

        {/* Watermarked Region & Overlay (Clipped to the right of the divider) */}
        <div
          className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
          style={{ clipPath: `inset(0 0 0 ${effectivePercent}%)` }}
        >
          {/* Subtle watermark scanline overlay on watermarked side */}
          <div className="absolute inset-0 bg-cyan-50/70 backdrop-contrast-[1.05]" />

          {/* Original State Badge (Right Side) */}
          <span className="absolute bottom-5 right-5 inline-flex items-center gap-1.5 rounded-full bg-black/75 backdrop-blur-md px-3.5 py-1.5 text-xs font-medium text-muted border border-border shadow-lg">
            Original with overlay
          </span>

          {/* Simulated Creator Watermark Badge */}
          <div className="absolute bottom-16 right-8 z-20 flex items-center gap-2.5 rounded-xl bg-black/85 backdrop-blur-md px-4 py-2 border border-white/20 shadow-2xl">
            <div className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-ping" />
            <div className="flex flex-col text-left">
              <span className="text-[11px] font-bold tracking-wider text-white uppercase leading-none font-mono">
                @WATERMARK_PROTECTED
              </span>
              <span className="text-[9px] font-mono text-zinc-400 mt-1 leading-none">
                ENCODED OVERLAY &bull; 2026
              </span>
            </div>
          </div>

          {/* AI Neural Target Lock Reticle (When Mode is Reticle) */}
          {mode === "reticle" && (
            <div className="absolute bottom-14 right-6 z-25 flex flex-col items-end pointer-events-none">
              <div className="relative p-2 border-2 border-dashed border-cyan-400 bg-cyan-400/10 rounded-2xl shadow-[0_0_25px_rgba(34,211,238,0.5)] animate-pulse">
                <span className="absolute -top-2.5 -left-2.5 bg-cyan-400 text-black text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shadow">
                  TARGET ACQUIRED: 99.8%
                </span>
                <div className="h-16 w-56" />
              </div>
            </div>
          )}
        </div>

        {/* Holographic Scanner Laser Beam (When Mode is Scanner) */}
        {mode === "scanner" && (
          <div
            className="pointer-events-none absolute inset-y-0 z-30 w-1 bg-gradient-to-b from-cyan-300 via-white to-accent shadow-[0_0_20px_#22d3ee,0_0_35px_#7c5cff]"
            style={{ left: `${scanPercent}%` }}
          >
            {/* Glowing laser flare head */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
              <div className="h-24 w-6 bg-cyan-400/40 blur-md rounded-full" />
              <div className="h-4 w-4 rounded-full bg-white shadow-[0_0_15px_#ffffff]" />
            </div>
          </div>
        )}

        {/* Interactive Scrub Handle (When Mode is Slider) */}
        {mode === "slider" && (
          <div
            className="absolute inset-y-0 z-30 w-0.5 bg-gradient-to-b from-cyan-400 via-white to-accent shadow-[0_0_15px_#22d3ee]"
            style={{ left: `${percent}%` }}
          >
            <div className="absolute top-1/2 left-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-surface-2/95 backdrop-blur-md border-2 border-cyan-400 text-cyan-600 shadow-[0_0_25px_rgba(34,211,238,0.7)] group-hover:scale-110 transition-transform">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M8 5l-6 7 6 7M16 5l6 7-6 7"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        )}

        {/* Floating Media Controls (Play/Pause & Mute) */}
        <div className="absolute top-4 right-5 z-30 flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className="rounded-full bg-black/60 backdrop-blur-md p-2 text-white/90 border border-white/15 transition-all hover:bg-black/80 hover:border-cyan-400 hover:text-cyan-300 shadow-lg"
            aria-label={isPlaying ? "Pause video" : "Play video"}
          >
            {isPlaying ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMute();
            }}
            className="rounded-full bg-black/60 backdrop-blur-md p-2 text-white/90 border border-white/15 transition-all hover:bg-black/80 hover:border-cyan-400 hover:text-cyan-300 shadow-lg"
            aria-label={isMuted ? "Unmute audio" : "Mute audio"}
          >
            {isMuted ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 9v6h4l5 5V4L7 9H3zM17 8l4 8m0-8l-4 8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 9v6h4l5 5V4L7 9H3zM15.5 8.5a5 5 0 010 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
