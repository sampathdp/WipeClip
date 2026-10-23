"use client";

import { useEffect, useRef, useState } from "react";
import { useClockTime, type Clock } from "@/lib/editor/clock";
import { rasterKey } from "@/lib/editor/rasters";
import type { RasterSticker } from "@/lib/editor/stickers";
import { overlayWidth } from "@/lib/editor/textRaster";
import { overlayFrame } from "@/lib/editor/timeline";
import { overlayValues } from "@/lib/editor/keyframes";
import { spriteIndex } from "@/lib/editor/textAnim";
import { shapeMaskUrl } from "@/lib/editor/shapeMask";
import { drawKeyedFrame } from "@/lib/editor/chromaKey";
import type { ChromaKey, Overlay } from "@/lib/editor/types";

type Drag =
  | { kind: "move"; id: string; px: number; py: number; x: number; y: number }
  | { kind: "resize"; id: string; cx: number; cy: number; dist: number; start: number }
  | { kind: "rotate"; id: string; cx: number; cy: number; a0: number; r0: number };

const SNAP = 0.015; // fraction of canvas - center/edge guides pull within this
const GUIDES = [0.5, 0.1, 0.9]; // center + safe-area lines

/** Stickers, text, images and video layers drawn over the preview in
 * canvas-relative units (fractions of the canvas), bottom to top in project
 * order, using the same PNG (or video) the export composites - so position,
 * size, rotation, opacity and animation land the same in both.
 */
export default function OverlayLayer({
  clock,
  canvasSize,
  overlays,
  rasters,
  playback,
  selectedId,
  onSelect,
  onChange,
  onGestureStart,
  onGestureEnd,
  onEditText,
}: {
  clock: Clock;
  canvasSize: { width: number; height: number };
  overlays: Overlay[];
  rasters: { byKey: Record<string, RasterSticker>; byId: Record<string, RasterSticker> };
  /** Player state the video layers follow. */
  playback: { playing: boolean; rate: number; volume: number; muted: boolean };
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<Overlay>) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  onEditText: (id: string) => void;
}) {
  const time = useClockTime(clock);
  const outerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ar = canvasSize.width / canvasSize.height;
    const fit = () => {
      const w = Math.min(el.clientWidth, el.clientHeight * ar);
      setSize({ width: w, height: w / ar });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasSize.width, canvasSize.height]);

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

  const snap = (v: number) => {
    const g = GUIDES.find((line) => Math.abs(v - line) < SNAP);
    return g === undefined ? { v, g: null } : { v: g, g };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toCanvas(e);
    const o = overlays.find((x) => x.id === d.id);
    if (!o) return;
    if (d.kind === "move") {
      const sx = snap(d.x + (p.x - d.px));
      const sy = snap(d.y + (p.y - d.py));
      setGuides({ x: sx.g, y: sy.g });
      onChange(d.id, { x: Math.min(1.3, Math.max(-0.3, sx.v)), y: Math.min(1.3, Math.max(-0.3, sy.v)) });
    } else if (d.kind === "resize") {
      const dist = Math.hypot((p.x - d.cx) * p.r.width, (p.y - d.cy) * p.r.height);
      const ratio = dist / Math.max(1, d.dist);
      if (o.kind === "text") {
        onChange(d.id, { text: { ...o.text, size: Math.min(0.5, Math.max(0.015, d.start * ratio)) } } as Partial<Overlay>);
      } else {
        onChange(d.id, { width: Math.min(2, Math.max(0.03, d.start * ratio)) });
      }
    } else {
      // Relative to where the drag started, so the handle can sit anywhere.
      const angle = (Math.atan2((p.y - d.cy) * p.r.height, (p.x - d.cx) * p.r.width) * 180) / Math.PI;
      let rotation = ((d.r0 + angle - d.a0 + 540) % 360) - 180;
      const nearest = Math.round(rotation / 45) * 45;
      if (e.shiftKey) rotation = Math.round(rotation / 15) * 15;
      else if (Math.abs(rotation - nearest) < 4) rotation = nearest;
      onChange(d.id, { rotation: Math.round(rotation * 10) / 10 });
    }
  };

  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setGuides({ x: null, y: null });
    onGestureEnd();
  };

  return (
    // No z-index: it stacks above the masks and pointer by DOM order, and
    // a z-index would isolate the layers' blend modes from the video.
    <div ref={outerRef} className="absolute inset-0 flex items-center justify-center">
      <div
        ref={boxRef}
        className="relative touch-none select-none"
        style={{ width: size.width, height: size.height }}
        onPointerDown={() => onSelect(null)}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {guides.x !== null && (
          <div className="pointer-events-none absolute inset-y-0 z-50 w-px bg-accent-2/90" style={{ left: `${guides.x * 100}%` }} />
        )}
        {guides.y !== null && (
          <div className="pointer-events-none absolute inset-x-0 z-50 h-px bg-accent-2/90" style={{ top: `${guides.y * 100}%` }} />
        )}
        {overlays.map((o) => {
          if (o.hidden) return null;
          const v = overlayValues(o, time);
          const frame = overlayFrame({ ...o, opacity: v.opacity }, time);
          const img = rasters.byKey[rasterKey(o)] ?? rasters.byId[o.id];
          if (!frame || !img) return null;
          const selected = o.id === selectedId;
          const w = overlayWidth(o, img, canvasSize) * size.width * v.scale;
          const h = (w * img.height) / img.width;
          return (
            <div
              key={o.id}
              className="absolute"
              style={{
                left: v.x * size.width,
                top: v.y * size.height,
                width: w,
                height: h,
                transform: `translate(-50%, -50%) translate(${frame.dx * size.width}px, ${frame.dy * size.height}px) rotate(${v.rotation + frame.rotate}deg) scale(${frame.scale})`,
                opacity: frame.opacity,
                mixBlendMode: o.blend && o.blend !== "normal" ? (o.blend === "add" ? "plus-lighter" : o.blend) : undefined,
                pointerEvents: o.locked ? "none" : undefined,
              }}
            >
              {o.kind === "video" ? (
                <OverlayVideo
                  url={img.url}
                  sourceTime={o.offset + (time - o.start)}
                  gain={o.volume}
                  playback={playback}
                  chromaKey={o.key ?? null}
                  mask={o.mask ? shapeMaskUrl(o.mask, w / Math.max(1, h)) : null}
                  className={`h-full w-full cursor-move object-fill ${selected ? "" : "hover:outline hover:outline-1 hover:outline-white/60"}`}
                  onPointerDown={(e) => {
                    onSelect(o.id);
                    const p = toCanvas(e);
                    begin(e, { kind: "move", id: o.id, px: p.x, py: p.y, x: v.x, y: v.y });
                  }}
                />
              ) : img.sprite ? (
                <SpriteCell
                  url={img.url}
                  sprite={img.sprite}
                  index={spriteIndex(img.sprite.times, time - o.start)}
                  className={`h-full w-full cursor-move ${selected ? "" : "hover:outline hover:outline-1 hover:outline-white/60"}`}
                  onDoubleClick={() => o.kind === "text" && onEditText(o.id)}
                  onPointerDown={(e) => {
                    onSelect(o.id);
                    const p = toCanvas(e);
                    begin(e, { kind: "move", id: o.id, px: p.x, py: p.y, x: v.x, y: v.y });
                  }}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={img.url}
                  alt=""
                  draggable={false}
                  className={`h-full w-full cursor-move ${selected ? "" : "hover:outline hover:outline-1 hover:outline-white/60"}`}
                  onDoubleClick={() => o.kind === "text" && onEditText(o.id)}
                  onPointerDown={(e) => {
                    onSelect(o.id);
                    const p = toCanvas(e);
                    begin(e, { kind: "move", id: o.id, px: p.x, py: p.y, x: v.x, y: v.y });
                  }}
                />
              )}
              {selected && (
                <>
                  <div className="pointer-events-none absolute -inset-1 rounded-sm border-2 border-accent-2 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" />
                  <button
                    type="button"
                    aria-label="Resize layer"
                    title="Drag to resize"
                    className="absolute -bottom-3 -right-3 h-5 w-5 cursor-nwse-resize rounded-full border-2 border-accent-2 bg-white shadow"
                    onPointerDown={(e) => {
                      const r = boxRef.current!.getBoundingClientRect();
                      const p = toCanvas(e);
                      const dist = Math.hypot((p.x - v.x) * r.width, (p.y - v.y) * r.height);
                      begin(e, { kind: "resize", id: o.id, cx: v.x, cy: v.y, dist, start: (o.kind === "text" ? o.text.size : o.width) * v.scale });
                    }}
                  />
                  {/* Corner handle, not one floating above the box: that got clipped
                      by the stage for layers near the top edge. */}
                  <button
                    type="button"
                    aria-label="Rotate layer"
                    title="Drag to rotate (Shift snaps to 15°)"
                    className="absolute -left-3 -top-3 flex h-5 w-5 cursor-grab items-center justify-center rounded-full border-2 border-accent-2 bg-white text-[10px] font-bold leading-none text-accent shadow"
                    onPointerDown={(e) => {
                      const r = boxRef.current!.getBoundingClientRect();
                      const p = toCanvas(e);
                      const a0 = (Math.atan2((p.y - v.y) * r.height, (p.x - v.x) * r.width) * 180) / Math.PI;
                      begin(e, { kind: "rotate", id: o.id, cx: v.x, cy: v.y, a0, r0: v.rotation });
                    }}
                  >
                    ↻
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One cell of an animated text's sprite sheet (textAnim.ts): the sheet,
 * scaled so a cell fills the box, shifted to the current cell. */
function SpriteCell({
  url,
  sprite,
  index,
  className,
  onDoubleClick,
  onPointerDown,
}: {
  url: string;
  sprite: { cols: number; rows: number };
  index: number;
  className: string;
  onDoubleClick: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      className={className}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      style={{
        backgroundImage: `url("${url}")`,
        backgroundSize: `${sprite.cols * 100}% ${sprite.rows * 100}%`,
        backgroundPosition: `${sprite.cols > 1 ? ((index % sprite.cols) / (sprite.cols - 1)) * 100 : 0}% ${sprite.rows > 1 ? (Math.floor(index / sprite.cols) / (sprite.rows - 1)) * 100 : 0}%`,
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}

/** A video layer's <video>, kept on the playhead like the audio tracks in
 * PreviewPlayer: re-seeked on a real jump, otherwise left to play. Only
 * mounted while the layer is on screen; pausing on unmount matters, since a
 * detached media element keeps playing its sound.
 */
function OverlayVideo({
  url,
  sourceTime,
  gain,
  playback,
  chromaKey,
  mask,
  className,
  onPointerDown,
}: {
  /** Shape mask image (data URL) over the layer. */
  mask: string | null;
  url: string;
  sourceTime: number;
  gain: number;
  playback: { playing: boolean; rate: number; volume: number; muted: boolean };
  chromaKey: ChromaKey | null;
  className: string;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const keyed = useRef<HTMLCanvasElement>(null);

  // Keyed: the video stays mounted (it plays the sound and decodes) but
  // hidden, and a canvas shows each frame with the key color removed.
  useEffect(() => {
    if (!chromaKey) return;
    let raf = 0;
    const draw = () => {
      if (ref.current && keyed.current) drawKeyedFrame(ref.current, keyed.current, chromaKey);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [chromaKey]);
  const { playing, rate, volume, muted } = playback;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.playbackRate = rate;
    el.muted = muted;
    // HTML media volume can't exceed 1, so >100% previews at 100%.
    el.volume = Math.min(1, Math.max(0, volume * gain));
    const drift = Math.abs(el.currentTime - sourceTime);
    if (el.readyState >= 1 && !el.seeking && drift > (playing ? 0.3 : 0.04)) el.currentTime = sourceTime;
    if (playing && el.paused && !el.ended) el.play().catch(() => {});
    if (!playing && !el.paused) el.pause();
  }, [sourceTime, gain, playing, rate, volume, muted]);

  useEffect(() => {
    const el = ref.current;
    return () => el?.pause();
  }, []);

  const maskStyle = mask ? { maskImage: `url("${mask}")`, WebkitMaskImage: `url("${mask}")`, maskSize: "100% 100%", WebkitMaskSize: "100% 100%" } : undefined;
  const video = (
    <video
      ref={ref}
      src={url}
      playsInline
      preload="auto"
      draggable={false}
      aria-hidden
      className={chromaKey ? "pointer-events-none absolute inset-0 h-full w-full opacity-0" : className}
      style={chromaKey ? undefined : maskStyle}
      onPointerDown={chromaKey ? undefined : onPointerDown}
    />
  );
  if (!chromaKey) return video;
  return (
    <>
      {video}
      <canvas ref={keyed} className={`relative ${className}`} style={maskStyle} onPointerDown={onPointerDown} aria-hidden />
    </>
  );
}
