"use client";

import { useMemo, useRef } from "react";
import { CameraCache } from "@/lib/editor/camera";
import { useClockTime, type Clock } from "@/lib/editor/clock";
import { maskRect } from "@/lib/editor/masks";
import { PointerCache } from "@/lib/editor/pointer";
import type { Layout } from "@/lib/editor/timeline";
import type { MediaSource, PrivacyMask, Project } from "@/lib/editor/types";

/** Move/resize handles for the selected privacy mask, drawn over the
 * preview at the mask's current on-screen rectangle. A video-anchored mask
 * is edited in its source's coordinates: on-screen drags are divided by
 * the current scale of the clip (crop, fit, zoom), so the mask stays on the
 * content it covers. */
export default function MaskEditLayer({
  clock,
  mask,
  lay,
  project,
  sources,
  canvasSize,
  onChange,
  onGestureStart,
  onGestureEnd,
}: {
  clock: Clock;
  mask: PrivacyMask;
  lay: Layout;
  project: Project;
  sources: Record<string, MediaSource>;
  canvasSize: { width: number; height: number };
  onChange: (patch: Partial<PrivacyMask>) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}) {
  const t = useClockTime(clock);
  const caches = useMemo(() => ({ camera: new CameraCache(), pointer: new PointerCache() }), []);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "move" | "resize"; x0: number; y0: number; m: PrivacyMask; sx: number; sy: number } | null>(null);
  const r = maskRect(mask, Math.min(Math.max(t, mask.start), mask.end - 1e-3), lay, project, sources, canvasSize, caches);
  if (!r) return null;
  // Canvas fractions per mask unit (1 for canvas masks).
  const sx = mask.space === "video" ? r.w / mask.w : 1;
  const sy = mask.space === "video" ? r.h / mask.h : 1;

  const begin = (e: React.PointerEvent, mode: "move" | "resize") => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, x0: e.clientX, y0: e.clientY, m: mask, sx, sy };
    onGestureStart();
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const box = boxRef.current?.parentElement?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = (e.clientX - d.x0) / box.width / d.sx;
    const dy = (e.clientY - d.y0) / box.height / d.sy;
    if (d.mode === "move") onChange({ x: d.m.x + dx, y: d.m.y + dy });
    else onChange({ w: Math.max(0.01, d.m.w + dx), h: Math.max(0.01, d.m.h + dy) });
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    onGestureEnd();
  };
  const following = mask.follow === "pointer";

  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0 z-[12]">
      <div
        className={`pointer-events-auto absolute border-2 border-dashed border-amber-400 ${following ? "cursor-default" : "cursor-move"}`}
        style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
        onPointerDown={(e) => !following && begin(e, "move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        title={following ? "Follows the pointer - resize only" : "Drag to move"}
      >
        <span className="absolute -top-5 left-0 rounded bg-amber-400 px-1 text-[10px] font-bold text-black">
          {mask.label || { blur: "Blur", pixelate: "Pixelate", solid: "Mask" }[mask.mode]}
        </span>
        <span
          className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-black bg-amber-400"
          onPointerDown={(e) => begin(e, "resize")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      </div>
    </div>
  );
}
