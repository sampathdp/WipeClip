"use client";

import { useEffect, useRef, useState } from "react";
import { useClockTime, type Clock } from "@/lib/editor/clock";
import type { RasterSticker } from "@/lib/editor/stickers";
import { stickerFrame } from "@/lib/editor/timeline";
import type { Sticker } from "@/lib/editor/types";

type Drag =
  | { kind: "move"; id: string; px: number; py: number; x: number; y: number }
  | { kind: "resize"; id: string; cx: number; cy: number; dist: number; width: number }
  | { kind: "rotate"; id: string; cx: number; cy: number };

const SNAP = 0.015; // fraction of canvas - center guides pull within this

/** Stickers drawn over the preview, positioned in canvas-relative units
 * (fractions of the video frame) so they land in the same place at every
 * preview size, in fullscreen, and in the export. Uses the rasterized PNG
 * the export uploads, so the look matches exactly.
 */
export default function StickerLayer({
  clock,
  aspect,
  stickers,
  images,
  selectedId,
  onSelect,
  onChange,
  onGestureStart,
  onGestureEnd,
}: {
  clock: Clock;
  aspect: { width: number; height: number };
  stickers: Sticker[];
  images: Record<string, RasterSticker>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<Sticker>) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}) {
  const time = useClockTime(clock);
  const outerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [guides, setGuides] = useState({ x: false, y: false });
  const drag = useRef<Drag | null>(null);

  // Fit the video frame inside the stage (the stage itself is already
  // letterboxed, except in fullscreen where it fills the screen).
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ar = aspect.width / aspect.height;
    const fit = () => {
      const w = Math.min(el.clientWidth, el.clientHeight * ar);
      setSize({ width: w, height: w / ar });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect.width, aspect.height]);

  const toCanvas = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r };
  };

  const begin = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = d;
    onGestureStart();
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toCanvas(e);
    if (d.kind === "move") {
      let x = d.x + (p.x - d.px);
      let y = d.y + (p.y - d.py);
      const snapX = Math.abs(x - 0.5) < SNAP;
      const snapY = Math.abs(y - 0.5) < SNAP;
      if (snapX) x = 0.5;
      if (snapY) y = 0.5;
      setGuides({ x: snapX, y: snapY });
      onChange(d.id, { x: Math.min(1.2, Math.max(-0.2, x)), y: Math.min(1.2, Math.max(-0.2, y)) });
    } else if (d.kind === "resize") {
      const dist = Math.hypot((p.x - d.cx) * p.r.width, (p.y - d.cy) * p.r.height);
      const width = Math.min(1.5, Math.max(0.03, (d.width * dist) / Math.max(1, d.dist)));
      onChange(d.id, { width });
    } else {
      const angle = (Math.atan2((p.y - d.cy) * p.r.height, (p.x - d.cx) * p.r.width) * 180) / Math.PI + 90;
      let rotation = ((angle + 540) % 360) - 180;
      const nearest = Math.round(rotation / 45) * 45;
      if (Math.abs(rotation - nearest) < 4 || e.shiftKey) rotation = e.shiftKey ? Math.round(rotation / 15) * 15 : nearest;
      onChange(d.id, { rotation: Math.round(rotation * 10) / 10 });
    }
  };

  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setGuides({ x: false, y: false });
    onGestureEnd();
  };

  return (
    <div ref={outerRef} className="absolute inset-0 z-10 flex items-center justify-center">
      <div
        ref={boxRef}
        className="relative touch-none select-none"
        style={{ width: size.width, height: size.height }}
        onPointerDown={() => onSelect(null)}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {guides.x && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-accent-2/80" />}
        {guides.y && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-accent-2/80" />}
        {stickers.map((s) => {
          const frame = stickerFrame(s, time);
          const img = images[s.stickerId];
          if (!frame || !img) return null;
          const selected = s.id === selectedId;
          const w = s.width * size.width;
          const h = (w * img.height) / img.width;
          return (
            <div
              key={s.id}
              className="absolute"
              style={{
                left: s.x * size.width,
                top: s.y * size.height,
                width: w,
                height: h,
                transform: `translate(-50%, -50%) translateX(${frame.dx * size.width}px) rotate(${s.rotation}deg) scale(${frame.scale})`,
                opacity: frame.opacity,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt=""
                draggable={false}
                className={`h-full w-full cursor-move ${selected ? "" : "hover:outline hover:outline-1 hover:outline-white/60"}`}
                onPointerDown={(e) => {
                  onSelect(s.id);
                  const p = toCanvas(e);
                  begin(e, { kind: "move", id: s.id, px: p.x, py: p.y, x: s.x, y: s.y });
                }}
              />
              {selected && (
                <>
                  <div className="pointer-events-none absolute -inset-1 rounded-sm border-2 border-accent-2 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" />
                  <button
                    type="button"
                    aria-label="Resize sticker"
                    title="Drag to resize"
                    className="absolute -bottom-3 -right-3 h-5 w-5 cursor-nwse-resize rounded-full border-2 border-accent-2 bg-white shadow"
                    onPointerDown={(e) => {
                      const r = boxRef.current!.getBoundingClientRect();
                      const p = toCanvas(e);
                      const dist = Math.hypot((p.x - s.x) * r.width, (p.y - s.y) * r.height);
                      begin(e, { kind: "resize", id: s.id, cx: s.x, cy: s.y, dist, width: s.width });
                    }}
                  />
                  <div className="pointer-events-none absolute -top-7 left-1/2 h-4 w-px -translate-x-1/2 bg-accent-2" />
                  <button
                    type="button"
                    aria-label="Rotate sticker"
                    title="Drag to rotate (Shift snaps to 15°)"
                    className="absolute -top-10 left-1/2 h-5 w-5 -translate-x-1/2 cursor-grab rounded-full border-2 border-accent-2 bg-white shadow"
                    onPointerDown={(e) => begin(e, { kind: "rotate", id: s.id, cx: s.x, cy: s.y })}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
