"use client";

import { useEffect, useRef, useState } from "react";
import { useClockTime, type Clock } from "@/lib/editor/clock";
import { rasterKey } from "@/lib/editor/rasters";
import type { RasterSticker } from "@/lib/editor/stickers";
import { overlayWidth } from "@/lib/editor/textRaster";
import { overlayFrame } from "@/lib/editor/timeline";
import { overlayValues } from "@/lib/editor/keyframes";
import { spriteIndex } from "@/lib/editor/textAnim";
import { layerMaskUrl } from "@/lib/editor/shapeMask";
import { FRAME_PAD, frameActive, frameUrls } from "@/lib/editor/layerFrame";
import { CANVAS_BOUNDS, cropEdge, layerRect, rectBounds, snapBounds, unionBounds, type Bounds, type Edge, type LayerRect, type Size, type VideoLayer } from "@/lib/editor/layerGeometry";
import { drawKeyedFrame } from "@/lib/editor/chromaKey";
import { previewMixer } from "@/lib/editor/audioMixer";
import { bgVideoTime, drawMatteFrame, fullMatte, matteJobKey, useMatteJob } from "@/lib/editor/matte";
import type { ChromaKey, Crop, MediaSource, Overlay, WebcamMatte } from "@/lib/editor/types";

type Sign = -1 | 1;

type Drag =
  | {
      kind: "move";
      /** Every layer that moves, with where it was. */
      items: { id: string; x: number; y: number }[];
      px: number;
      py: number;
      /** The rectangle around them when the drag started, and what it snaps to. */
      bounds: Bounds;
      targets: Bounds[];
    }
  | { kind: "resize"; id: string; ax: number; ay: number; cx: number; cy: number; dist: number; start: number }
  | { kind: "rotate"; id: string; cx: number; cy: number; a0: number; r0: number }
  | { kind: "crop"; id: string; edge: Edge; px: number; py: number; layer: VideoLayer; natural: Size; time: number };

/** Guides pull within this many pixels of the preview. */
const SNAP_PX = 6;
const NO_GUIDES: { x: number[]; y: number[] } = { x: [], y: [] };
const CORNERS: { sx: Sign; sy: Sign; cls: string }[] = [
  { sx: -1, sy: -1, cls: "-left-2 -top-2 cursor-nwse-resize" },
  { sx: 1, sy: -1, cls: "-right-2 -top-2 cursor-nesw-resize" },
  { sx: -1, sy: 1, cls: "-bottom-2 -left-2 cursor-nesw-resize" },
  { sx: 1, sy: 1, cls: "-bottom-2 -right-2 cursor-nwse-resize" },
];
const EDGES: { edge: Edge; cls: string }[] = [
  { edge: "left", cls: "-left-1 top-1/2 h-6 w-2 -translate-y-1/2 cursor-ew-resize" },
  { edge: "right", cls: "-right-1 top-1/2 h-6 w-2 -translate-y-1/2 cursor-ew-resize" },
  { edge: "top", cls: "-top-1 left-1/2 h-2 w-6 -translate-x-1/2 cursor-ns-resize" },
  { edge: "bottom", cls: "-bottom-1 left-1/2 h-2 w-6 -translate-x-1/2 cursor-ns-resize" },
];

/** Stickers, text, images and video layers drawn over the preview in
 * canvas-relative units (fractions of the canvas), bottom to top in project
 * order, using the same PNG (or video) the export composites - so position,
 * size, rotation, opacity and animation land the same in both.
 *
 * Layers are picked, moved, resized, cropped (video layers, by their edges)
 * and turned here. Several picked layers move together. A move snaps to the
 * canvas's edges and centre and to the other layers' (layerGeometry.ts),
 * with guides; Alt holds snapping off.
 */
export default function OverlayLayer({
  clock,
  canvasSize,
  overlays,
  rasters,
  sources,
  playback,
  selectedId,
  picked,
  labels,
  snapping = true,
  onSelect,
  onPick,
  onChange,
  onChangeRaw,
  onGestureStart,
  onGestureEnd,
  onEditText,
}: {
  clock: Clock;
  canvasSize: { width: number; height: number };
  overlays: Overlay[];
  rasters: { byKey: Record<string, RasterSticker>; byId: Record<string, RasterSticker> };
  /** Webcam background removal reads a layer's disk file and its background. */
  sources: Record<string, MediaSource>;
  /** Player state the video layers follow. */
  playback: { playing: boolean; rate: number; volume: number; muted: boolean };
  selectedId: string | null;
  /** Layers picked together with the selected one (ids). */
  picked?: ReadonlySet<string>;
  /** Layer names, shown on the selected layer. */
  labels?: Record<string, string>;
  /** Moves snap to the canvas and the other layers. */
  snapping?: boolean;
  onSelect: (id: string | null) => void;
  /** Shift/Ctrl+click: adds the layer to the picked ones, or takes it out. */
  onPick?: (id: string) => void;
  onChange: (id: string, patch: Partial<Overlay>) => void;
  /** A change that isn't a keyframe even on an animated layer (its crop). */
  onChangeRaw?: (id: string, patch: Partial<Overlay>) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  onEditText: (id: string) => void;
}) {
  const time = useClockTime(clock);
  const outerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [guides, setGuides] = useState(NO_GUIDES);
  const drag = useRef<Drag | null>(null);
  // Every shown layer's box, for snapping and for moving several together.
  const rects = useRef(new Map<string, LayerRect>());

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

  /** A press on a layer: picks it, and starts moving it - with the other
   * picked layers when it's one of several. */
  const press = (e: React.PointerEvent, o: Overlay) => {
    if ((e.shiftKey || e.ctrlKey || e.metaKey) && onPick) {
      e.stopPropagation();
      e.preventDefault();
      onPick(o.id);
      return;
    }
    const together = !!picked && picked.size > 1 && picked.has(o.id);
    if (!together) onSelect(o.id);
    const ids = together ? overlays.filter((x) => picked.has(x.id) && !x.locked && rects.current.has(x.id)).map((x) => x.id) : [o.id];
    const boxes = ids.map((id) => rects.current.get(id)).filter((r): r is LayerRect => !!r);
    if (!boxes.length) return;
    const moving = new Set(ids);
    const p = toCanvas(e);
    begin(e, {
      kind: "move",
      items: boxes.map((r) => ({ id: r.id, x: r.x, y: r.y })),
      px: p.x,
      py: p.y,
      bounds: unionBounds(boxes.map((r) => rectBounds(r, canvasSize))),
      targets: [CANVAS_BOUNDS, ...[...rects.current.values()].filter((r) => !moving.has(r.id)).map((r) => rectBounds(r, canvasSize))],
    });
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toCanvas(e);
    if (d.kind === "move") {
      let dx = p.x - d.px;
      let dy = p.y - d.py;
      if (snapping && !e.altKey) {
        const b = { l: d.bounds.l + dx, t: d.bounds.t + dy, r: d.bounds.r + dx, b: d.bounds.b + dy };
        const s = snapBounds(b, d.targets, { x: SNAP_PX / Math.max(1, p.r.width), y: SNAP_PX / Math.max(1, p.r.height) });
        dx += s.dx;
        dy += s.dy;
        setGuides(s.x.length || s.y.length ? { x: s.x, y: s.y } : NO_GUIDES);
      } else setGuides(NO_GUIDES);
      for (const it of d.items) onChange(it.id, { x: Math.min(1.3, Math.max(-0.3, it.x + dx)), y: Math.min(1.3, Math.max(-0.3, it.y + dy)) });
      return;
    }
    const o = overlays.find((x) => x.id === d.id);
    if (!o) return;
    if (d.kind === "resize") {
      // The opposite corner stays where it is.
      const dist = Math.hypot((p.x - d.ax) * p.r.width, (p.y - d.ay) * p.r.height);
      const lo = o.kind === "text" ? 0.015 : 0.03;
      const hi = o.kind === "text" ? 0.5 : 2;
      const next = Math.min(hi, Math.max(lo, (d.start * dist) / Math.max(1, d.dist)));
      const ratio = next / d.start;
      const centre = { x: d.ax + (d.cx - d.ax) * ratio, y: d.ay + (d.cy - d.ay) * ratio };
      if (o.kind === "text") onChange(d.id, { ...centre, text: { ...o.text, size: next } } as Partial<Overlay>);
      else onChange(d.id, { ...centre, width: next });
    } else if (d.kind === "crop") {
      // How far the edge moved outward, along the layer's own axis.
      const a = (rects.current.get(d.id)?.rotation ?? 0) * (Math.PI / 180);
      const mx = (p.x - d.px) * p.r.width;
      const my = (p.y - d.py) * p.r.height;
      const along = d.edge === "left" || d.edge === "right" ? (mx * Math.cos(a) + my * Math.sin(a)) / p.r.width : (-mx * Math.sin(a) + my * Math.cos(a)) / p.r.height;
      const out = d.edge === "left" || d.edge === "top" ? -along : along;
      (onChangeRaw ?? onChange)(d.id, cropEdge(d.layer, d.natural, canvasSize, d.edge, out, d.time) as Partial<Overlay>);
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
    setGuides(NO_GUIDES);
    onGestureEnd();
  };

  const shown = new Map<string, LayerRect>();
  const chrome: React.ReactNode[] = [];
  const layers = overlays.map((o) => {
    if (o.hidden) return null;
    const v = overlayValues(o, time);
    const frame = overlayFrame({ ...o, opacity: v.opacity }, time);
    const img = rasters.byKey[rasterKey(o)] ?? rasters.byId[o.id];
    if (!frame || !img) return null;
    const rect = layerRect(o, overlayWidth(o, img, canvasSize), img, canvasSize, time);
    shown.set(o.id, rect);
    const selected = o.id === selectedId;
    const also = !selected && !!picked?.has(o.id);
    const w = rect.w * size.width;
    const h = rect.h * size.height;
    const hover = selected || also ? "" : "hover:outline hover:outline-1 hover:outline-white/60";
    const video = o.kind === "video" ? o : null;
    const frameArt = video && frameActive(video.frame) ? frameUrls(video.frame, w / Math.max(1, h)) : null;
    const pad = FRAME_PAD * Math.min(w, h);
    const el = (
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
        {frameArt?.under && (
          // eslint-disable-next-line @next/next/no-img-element -- the shadow's own PNG, as the export composites it
          <img src={frameArt.under} alt="" aria-hidden draggable={false} className="pointer-events-none absolute max-w-none" style={{ left: -pad, top: -pad, width: w + 2 * pad, height: h + 2 * pad }} />
        )}
        {video ? (
          <OverlayVideo
            layerId={o.id}
            url={img.url}
            sourceTime={video.offset + (time - o.start)}
            layerTime={time - o.start}
            gain={video.volume}
            playback={playback}
            chromaKey={o.key ?? null}
            matte={video.matte ? fullMatte(video.matte) : null}
            matteKey={video.matte ? matteJobKey(sources[video.sourceId], fullMatte(video.matte).detail) : null}
            bgSource={video.matte?.bgSourceId ? (sources[video.matte.bgSourceId] ?? null) : null}
            mask={layerMaskUrl(o.mask, video.frame?.radius ?? 0, w / Math.max(1, h))}
            crop={video.crop ?? null}
            className={`cursor-move ${hover}`}
            onPointerDown={(e) => press(e, o)}
          />
        ) : img.sprite ? (
          <SpriteCell
            url={img.url}
            sprite={img.sprite}
            index={spriteIndex(img.sprite.times, time - o.start)}
            className={`h-full w-full cursor-move ${hover}`}
            onDoubleClick={() => o.kind === "text" && onEditText(o.id)}
            onPointerDown={(e) => press(e, o)}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img.url}
            alt=""
            draggable={false}
            className={`h-full w-full cursor-move ${hover}`}
            onDoubleClick={() => o.kind === "text" && onEditText(o.id)}
            onPointerDown={(e) => press(e, o)}
          />
        )}
        {frameArt?.over && (
          // eslint-disable-next-line @next/next/no-img-element -- the border's own PNG, as the export composites it
          <img src={frameArt.over} alt="" aria-hidden draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />
        )}
      </div>
    );
    // Outline and handles go above every layer (pushed to `chrome`, drawn
    // last): a layer on top would otherwise cover them, and they'd fade,
    // blend and mask with their own layer. Same box and turn as the layer.
    if (selected || also) {
      chrome.push(
        <div
          key={o.id}
          // A locked layer shows its outline but can't be dragged by its handles.
          className={`pointer-events-none absolute ${o.locked ? "" : "[&_button]:pointer-events-auto"}`}
          style={{
            left: v.x * size.width,
            top: v.y * size.height,
            width: w,
            height: h,
            transform: `translate(-50%, -50%) translate(${frame.dx * size.width}px, ${frame.dy * size.height}px) rotate(${v.rotation + frame.rotate}deg) scale(${frame.scale})`,
          }}
        >
          {also && <div className="pointer-events-none absolute -inset-0.5 rounded-sm border border-dashed border-accent-2" />}
          {selected && (
            <>
              <div className="pointer-events-none absolute -inset-0.5 rounded-sm border-2 border-accent-2 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" />
              {labels?.[o.id] && (
                <span
                  className="pointer-events-none absolute left-0 max-w-full truncate rounded bg-accent-2 px-1 text-[10px] font-semibold leading-4 text-black"
                  style={rect.y - rect.h / 2 < 0.08 ? { top: 4, left: 4 } : { bottom: "100%", marginBottom: 4 }}
                >
                  {labels[o.id]}
                </span>
              )}
              {CORNERS.map((c) => (
                <button
                  key={`${c.sx}${c.sy}`}
                  type="button"
                  aria-label="Resize layer"
                  title="Drag to resize"
                  className={`absolute h-4 w-4 rounded-full border-2 border-accent-2 bg-white shadow ${c.cls}`}
                  onPointerDown={(e) => {
                    // The opposite corner, on the canvas, in the layer's own turn.
                    const a = (v.rotation * Math.PI) / 180;
                    const ox = (-c.sx * rect.w * canvasSize.width) / 2;
                    const oy = (-c.sy * rect.h * canvasSize.height) / 2;
                    const ax = v.x + (ox * Math.cos(a) - oy * Math.sin(a)) / canvasSize.width;
                    const ay = v.y + (ox * Math.sin(a) + oy * Math.cos(a)) / canvasSize.height;
                    const p = toCanvas(e);
                    const dist = Math.hypot((p.x - ax) * p.r.width, (p.y - ay) * p.r.height);
                    begin(e, { kind: "resize", id: o.id, ax, ay, cx: v.x, cy: v.y, dist, start: (o.kind === "text" ? o.text.size : o.width) * v.scale });
                  }}
                />
              ))}
              {video &&
                EDGES.map((g) => (
                  <button
                    key={g.edge}
                    type="button"
                    aria-label={`Crop the ${g.edge} edge`}
                    title="Drag to crop"
                    className={`absolute rounded-sm border border-accent-2 bg-white shadow ${g.cls}`}
                    onPointerDown={(e) => {
                      const p = toCanvas(e);
                      begin(e, { kind: "crop", id: o.id, edge: g.edge, px: p.x, py: p.y, layer: video, natural: { width: img.width, height: img.height }, time });
                    }}
                  />
                ))}
              {/* Above the box, or below it for a layer at the top of the stage,
                  where a handle above would be cut off. */}
              <button
                type="button"
                aria-label="Rotate layer"
                title="Drag to rotate (Shift snaps to 15°)"
                className="absolute left-1/2 flex h-5 w-5 -translate-x-1/2 cursor-grab items-center justify-center rounded-full border-2 border-accent-2 bg-white text-[10px] font-bold leading-none text-accent shadow"
                style={rect.y - rect.h / 2 < 0.12 ? { top: "100%", marginTop: 10 } : { bottom: "100%", marginBottom: 10 }}
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
    }
    return el;
  });
  // Kept for the next press: read only in the pointer handlers.
  useEffect(() => {
    rects.current = shown;
  });

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
        {guides.x.map((x) => (
          <div key={`x${x}`} className="pointer-events-none absolute inset-y-0 z-50 w-px bg-accent-2/90" style={{ left: `${x * 100}%` }} />
        ))}
        {guides.y.map((y) => (
          <div key={`y${y}`} className="pointer-events-none absolute inset-x-0 z-50 h-px bg-accent-2/90" style={{ top: `${y * 100}%` }} />
        ))}
        {layers}
        {chrome}
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
  layerId,
  url,
  sourceTime,
  layerTime,
  gain,
  playback,
  chromaKey,
  matte,
  matteKey,
  bgSource,
  mask,
  crop,
  className,
  onPointerDown,
}: {
  /** Shape mask image (data URL) over the layer. */
  mask: string | null;
  /** The part of the frame shown; null = all of it. */
  crop: Crop | null;
  layerId: string;
  url: string;
  sourceTime: number;
  /** Seconds since the layer started (a background video's clock). */
  layerTime: number;
  gain: number;
  playback: { playing: boolean; rate: number; volume: number; muted: boolean };
  chromaKey: ChromaKey | null;
  /** Webcam background removal; the original shows until its matted file is ready. */
  matte: WebcamMatte | null;
  /** Which engine job (matte.ts matteJobKey) the matted file comes from. */
  matteKey: string | null;
  bgSource: MediaSource | null;
  className: string;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const keyed = useRef<HTMLCanvasElement>(null);
  const matted = useRef<HTMLVideoElement>(null);
  const bgVideo = useRef<HTMLVideoElement>(null);
  const bgImage = useRef<HTMLImageElement>(null);
  const job = useMatteJob(matte ? matteKey : null);
  const matteUrl = matte && job?.status === "ready" ? job.url : null;
  const bg = matte && (matte.mode === "image" || matte.mode === "video") && bgSource && bgSource.kind !== "audio" ? bgSource : null;
  const bgIsVideo = !!bg && bg.duration > 0;
  // Drawn on a canvas instead of the video: chroma key, or the matted file.
  const drawn = !!chromaKey || !!matteUrl;
  const { playing, rate, volume, muted } = playback;

  // The video stays mounted (it plays the sound and decodes) but hidden,
  // and a canvas shows each frame keyed, or matted (the matted file's own
  // hidden video, kept on the same time).
  useEffect(() => {
    if (!chromaKey && !(matte && matteUrl)) return;
    let raf = 0;
    const draw = () => {
      const canvas = keyed.current;
      if (canvas && matte && matteUrl && matted.current) {
        const b = bgIsVideo ? bgVideo.current : bgImage.current;
        const ready = b && (b instanceof HTMLVideoElement ? b.readyState >= 2 : b.complete && b.naturalWidth > 0);
        drawMatteFrame(matted.current, canvas, matte, ready && bg ? { el: b, width: bg.width, height: bg.height } : null);
      } else if (canvas && chromaKey && ref.current) drawKeyedFrame(ref.current, canvas, chromaKey);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [chromaKey, matte, matteUrl, bg, bgIsVideo]);

  // The matted file and a background video follow the playhead like the layer's own video.
  const loop = matte?.loop ?? true;
  const bgDuration = bg?.duration ?? 0;
  useEffect(() => {
    follow(matted.current, sourceTime, playing, rate);
    if (bgIsVideo) {
      const t = bgVideoTime(layerTime, bgDuration, loop);
      // A held last frame doesn't play on.
      follow(bgVideo.current, t, playing && (loop || layerTime < bgDuration), rate);
    }
  }, [sourceTime, layerTime, playing, rate, bgIsVideo, bgDuration, loop, matteUrl]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.playbackRate = rate;
    // Through the preview's mixer once it's engaged (PreviewPlayer), so
    // the layer is metered and follows the master gain like the export.
    // A silent layer (a webcam) isn't routed; one routed before stays routed.
    const mixer = previewMixer();
    const routed = mixer.engaged && gain > 0 ? mixer.route(el, `layer:${layerId}`) : mixer.existing(el);
    if (routed) {
      el.muted = false;
      el.volume = 1;
      routed.gain.value = muted ? 0 : Math.max(0, volume * gain);
    } else {
      el.muted = muted;
      // HTML media volume can't exceed 1, so >100% previews at 100%.
      el.volume = Math.min(1, Math.max(0, volume * gain));
    }
    const drift = Math.abs(el.currentTime - sourceTime);
    if (el.readyState >= 1 && !el.seeking && drift > (playing ? 0.3 : 0.04)) el.currentTime = sourceTime;
    if (playing && el.paused && !el.ended) el.play().catch(() => {});
    if (!playing && !el.paused) el.pause();
  }, [sourceTime, gain, playing, rate, volume, muted, layerId]);

  useEffect(() => {
    const el = ref.current;
    return () => el?.pause();
  }, []);
  useEffect(() => {
    const els = [matted.current, bgVideo.current];
    return () => els.forEach((el) => el?.pause());
  }, [matteUrl, bgIsVideo]);

  const maskStyle = mask ? { maskImage: `url("${mask}")`, WebkitMaskImage: `url("${mask}")`, maskSize: "100% 100%", WebkitMaskSize: "100% 100%" } : undefined;
  // The whole picture, larger than the box and shifted so the kept part
  // fills it; the box (which also carries the mask) cuts the rest off.
  const picture = crop
    ? { position: "absolute" as const, left: `${(-crop.x / crop.w) * 100}%`, top: `${(-crop.y / crop.h) * 100}%`, width: `${100 / crop.w}%`, height: `${100 / crop.h}%`, maxWidth: "none" }
    : { width: "100%", height: "100%" };
  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`} style={maskStyle} onPointerDown={onPointerDown}>
      <video
        ref={ref}
        src={url}
        // With CORS from the start: a keyed layer (chroma key) reads its pixels
        // on a canvas, and a disk file (asset protocol, another origin) would
        // taint it otherwise. The preview mixer needs the same for its sound.
        crossOrigin={cors(url)}
        playsInline
        preload="auto"
        draggable={false}
        aria-hidden
        className={drawn ? HIDDEN : "block object-fill"}
        style={drawn ? undefined : picture}
      />
      {matteUrl && <video ref={matted} src={matteUrl} crossOrigin={cors(matteUrl)} muted playsInline preload="auto" aria-hidden className={HIDDEN} />}
      {matteUrl && bg && (bgIsVideo ? (
        <video ref={bgVideo} src={bg.url} crossOrigin={cors(bg.url)} muted playsInline preload="auto" aria-hidden className={HIDDEN} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- drawn onto the canvas, never shown
        <img ref={bgImage} src={bg.url} crossOrigin={cors(bg.url)} alt="" aria-hidden className={HIDDEN} />
      ))}
      {drawn && <canvas ref={keyed} className="block" style={picture} aria-hidden />}
    </div>
  );
}

const HIDDEN = "pointer-events-none absolute inset-0 h-full w-full opacity-0";

/** Media the matte canvas reads pixels from: disk files come from the
 * asset protocol, another origin, so they're loaded with CORS (which it
 * answers) or the canvas would be tainted and unreadable. */
const cors = (url: string) => (/^(blob|data):/.test(url) ? undefined : "anonymous");

/** Keeps a muted helper video (matted file, background video) on `time`:
 * re-seeked on a real jump, otherwise left to play - like the layer's own. */
function follow(el: HTMLVideoElement | null, time: number, playing: boolean, rate: number) {
  if (!el) return;
  el.playbackRate = rate;
  const drift = Math.abs(el.currentTime - time);
  if (el.readyState >= 1 && !el.seeking && drift > (playing ? 0.3 : 0.04)) el.currentTime = time;
  if (playing && el.paused && !el.ended) el.play().catch(() => {});
  if (!playing && !el.paused) el.pause();
}
