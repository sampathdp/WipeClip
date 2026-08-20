"use client";

import { useCallback, useRef, useState } from "react";

export default function ImageCompareSlider({
  beforeSrc,
  afterSrc,
}: {
  beforeSrc: string;
  afterSrc: string;
}) {
  const [percent, setPercent] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updateFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = ((clientX - rect.left) / rect.width) * 100;
    setPercent(Math.min(100, Math.max(0, ratio)));
  }, []);

  return (
    <div>
      <div
        ref={containerRef}
        className="glass-card group relative aspect-video w-full select-none overflow-hidden rounded-[1.75rem] bg-black border border-cyan-500/25 shadow-2xl cursor-ew-resize"
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          updateFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) updateFromClientX(e.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={afterSrc} alt="Cleaned result" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
        <span className="absolute bottom-4 right-4 z-10 inline-flex items-center gap-1.5 rounded-full bg-surface-2/80 backdrop-blur-md px-3.5 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/30 shadow-lg">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Clean Result
        </span>

        <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={beforeSrc} alt="Original" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
          <span className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2/80 backdrop-blur-md px-3.5 py-1 text-xs font-medium text-muted border border-border shadow-lg">
            Original
          </span>
        </div>

        <div
          className="absolute inset-y-0 z-10 w-0.5 bg-gradient-to-b from-cyan-400 via-white to-accent shadow-[0_0_12px_#22d3ee]"
          style={{ left: `${percent}%` }}
        >
          <div className="absolute top-1/2 left-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-surface-2 border-2 border-cyan-400 text-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.6)] group-hover:scale-110 transition-transform">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
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
      </div>
      <p className="mt-2.5 text-center text-xs text-muted flex items-center justify-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
        Drag the handle to compare original vs clean image
      </p>
    </div>
  );
}
