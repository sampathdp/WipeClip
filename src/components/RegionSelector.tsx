"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Region, WatermarkCandidate } from "@/lib/toolsApi";

type Box = { x: number; y: number; w: number; h: number };
type Corner = "tl" | "tr" | "bl" | "br";
type DragMode =
  | { type: "draw"; start: { x: number; y: number } }
  | { type: "move"; start: { x: number; y: number }; startBox: Box }
  | { type: "resize"; corner: Corner; start: { x: number; y: number }; startBox: Box };

const CORNERS: { key: Corner; cursor: string; style: React.CSSProperties }[] = [
  { key: "tl", cursor: "nwse-resize", style: { top: -6, left: -6 } },
  { key: "tr", cursor: "nesw-resize", style: { top: -6, right: -6 } },
  { key: "bl", cursor: "nesw-resize", style: { bottom: -6, left: -6 } },
  { key: "br", cursor: "nwse-resize", style: { bottom: -6, right: -6 } },
];

export default function RegionSelector({
  previewUrl,
  naturalWidth,
  naturalHeight,
  suggestion,
  onChange,
}: {
  previewUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  suggestion?: WatermarkCandidate | null;
  onChange: (region: Region) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const boxRef = useRef<Box | null>(null);
  const dragMode = useRef<DragMode | null>(null);
  // The wrapper div has no explicit height - it's sized by the <img>'s
  // rendered content, which needs its own async load/decode before it has
  // real layout dimensions. previewUrl/naturalWidth/naturalHeight all
  // become available in the same render (see UploadDemo's pickFile), so
  // without this, the effect below can run while clientHeight is still 0,
  // making scaleY = naturalHeight/0 = Infinity and the emitted region
  // Infinity/NaN - which a FastAPI int field can't parse, surfacing as a
  // 422 with no useful message. Derived (not reset via a separate effect)
  // so a new previewUrl naturally makes this false with no extra render.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const imgLoaded = loadedFor === previewUrl;

  useEffect(() => {
    boxRef.current = box;
  }, [box]);

  const emit = useCallback(
    (b: Box) => {
      const el = wrapRef.current;
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
      const scaleX = naturalWidth / el.clientWidth;
      const scaleY = naturalHeight / el.clientHeight;
      onChange({
        x: Math.round(b.x * scaleX),
        y: Math.round(b.y * scaleY),
        w: Math.round(b.w * scaleX),
        h: Math.round(b.h * scaleY),
      });
    },
    [naturalWidth, naturalHeight, onChange]
  );

  // Prefill from the auto-detected candidate when there's a confident one;
  // otherwise fall back to the old sensible default (bottom-right corner,
  // ~20% width) - either way the user can still drag to relocate/resize.
  // Guarded on imgLoaded (see above) and re-runs once it flips true, so
  // this never computes off a zero-height wrapper.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !imgLoaded || el.clientWidth === 0 || el.clientHeight === 0) return;
    let b: Box;
    if (suggestion) {
      const scaleX = el.clientWidth / naturalWidth;
      const scaleY = el.clientHeight / naturalHeight;
      b = {
        x: suggestion.x * scaleX,
        y: suggestion.y * scaleY,
        w: suggestion.w * scaleX,
        h: suggestion.h * scaleY,
      };
    } else {
      const w = el.clientWidth * 0.2;
      const h = w * (naturalHeight / naturalWidth) * 0.6;
      b = { x: el.clientWidth - w - 8, y: el.clientHeight - h - 8, w, h };
    }
    setBox(b);
    emit(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naturalWidth, naturalHeight, suggestion, imgLoaded]);

  const pointFromEvent = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return {
      x: Math.min(Math.max(e.clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(e.clientY - rect.top, 0), rect.height),
    };
  };

  const startDrag = (e: React.PointerEvent, mode: DragMode) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragMode.current = mode;
  };

  return (
    <div>
      <div
        ref={wrapRef}
        className="relative w-full touch-none select-none overflow-hidden rounded-xl border border-cyan-500/30 bg-black shadow-lg"
        onPointerDown={(e) => {
          const p = pointFromEvent(e);
          startDrag(e, { type: "draw", start: p });
          setBox({ x: p.x, y: p.y, w: 0, h: 0 });
        }}
        onPointerMove={(e) => {
          const mode = dragMode.current;
          if (!mode) return;
          const el = wrapRef.current!;
          const p = pointFromEvent(e);

          if (mode.type === "draw") {
            setBox({
              x: Math.min(mode.start.x, p.x),
              y: Math.min(mode.start.y, p.y),
              w: Math.abs(p.x - mode.start.x),
              h: Math.abs(p.y - mode.start.y),
            });
          } else if (mode.type === "move") {
            const dx = p.x - mode.start.x;
            const dy = p.y - mode.start.y;
            const { w, h } = mode.startBox;
            const x = Math.min(Math.max(mode.startBox.x + dx, 0), el.clientWidth - w);
            const y = Math.min(Math.max(mode.startBox.y + dy, 0), el.clientHeight - h);
            setBox({ x, y, w, h });
          } else if (mode.type === "resize") {
            const sb = mode.startBox;
            let left = sb.x;
            let top = sb.y;
            let right = sb.x + sb.w;
            let bottom = sb.y + sb.h;
            if (mode.corner.includes("l")) left = p.x;
            if (mode.corner.includes("r")) right = p.x;
            if (mode.corner.includes("t")) top = p.y;
            if (mode.corner.includes("b")) bottom = p.y;
            setBox({
              x: Math.min(left, right),
              y: Math.min(top, bottom),
              w: Math.abs(right - left),
              h: Math.abs(bottom - top),
            });
          }
        }}
        onPointerUp={() => {
          dragMode.current = null;
          const b = boxRef.current;
          if (b && b.w > 6 && b.h > 6) emit(b);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl}
          alt="Video preview frame"
          className="block w-full"
          style={{ aspectRatio: `${naturalWidth} / ${naturalHeight}` }}
          draggable={false}
          onLoad={() => setLoadedFor(previewUrl)}
        />
        {box && (
          <div
            className="absolute border-2 border-cyan-400 bg-cyan-400/20 shadow-[0_0_15px_rgba(34,211,238,0.4)] cursor-move"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            onPointerDown={(e) => {
              const p = pointFromEvent(e);
              startDrag(e, { type: "move", start: p, startBox: box });
            }}
          >
            {CORNERS.map(({ key, cursor, style }) => (
              <span
                key={key}
                className="absolute h-3.5 w-3.5 rounded-full bg-white shadow-[0_0_6px_#22d3ee]"
                style={{ ...style, cursor }}
                onPointerDown={(e) => {
                  const p = pointFromEvent(e);
                  startDrag(e, { type: "resize", corner: key, start: p, startBox: box });
                }}
              />
            ))}
          </div>
        )}
      </div>
      <p className="mt-2.5 text-xs text-muted flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
        {suggestion
          ? suggestion.label
            ? `Detected a ${suggestion.label} watermark — drag to adjust, or resize with the corner handles.`
            : "Auto-detected likely watermark region — drag to adjust, or resize with the corner handles."
          : "No obvious watermark detected — click & drag on the frame to mark it, then resize with the corner handles."}
      </p>
    </div>
  );
}
