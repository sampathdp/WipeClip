"use client";

import { useRef, useState, type ReactNode } from "react";
import { useClockTime, type Clock } from "@/lib/editor/clock";
import { animateOverlayPatch, overlayValues } from "@/lib/editor/keyframes";
import { DEFAULT_FRAME, MAX_BORDER, cleanFrame } from "@/lib/editor/layerFrame";
import {
  CORNER_LABELS,
  applyCrop,
  cornerPosition,
  frameLayer,
  layerAspect,
  layerCrop,
  layerRect,
  resetTransform,
  type AlignOp,
  type CellFit,
  type Corner,
  type Size,
  type VideoLayer,
} from "@/lib/editor/layerGeometry";
import { LAYOUT_PRESETS, MAX_GAP, gridCells, type LayoutPreset } from "@/lib/editor/layouts";
import { SHAPE_LABELS } from "@/lib/editor/shapes";
import { sourceName } from "@/lib/editor/sourceFile";
import { getStickerDef, stickerThumbSrc } from "@/lib/editor/stickers";
import type { Crop, LayerFrame, MediaSource, Overlay } from "@/lib/editor/types";
import { ActionButton, PanelShell } from "./Inspector";
import { TrashIcon } from "./icons";
import { SliderField, type Gesture } from "./Panels";

/** Changes a layer as a whole, given the playhead time - for edits that
 * aren't one animated value (a crop, a stretch, fitting to the canvas). */
export type LayerEdit = (fn: (o: Overlay, t: number) => Overlay) => void;

export const LAYER_TYPE_LABELS: Record<Overlay["kind"], string> = { video: "Video", image: "Image", text: "Text", sticker: "Sticker", shape: "Shape" };

/** A layer's name: the user's own, or what it shows. */
export function layerName(o: Overlay, sources: Record<string, MediaSource>): string {
  if (o.name?.trim()) return o.name.trim();
  if (o.kind === "text") return o.text.content.split("\n")[0].slice(0, 28) || "Text";
  if (o.kind === "sticker") return getStickerDef(o.stickerId)?.label ?? "Sticker";
  if (o.kind === "shape") return SHAPE_LABELS[o.shape.type];
  const src = sources[o.sourceId];
  return (src ? sourceName(src) : undefined) ?? (o.kind === "video" ? "Video" : "Image");
}

function Title({ children }: { children: ReactNode }) {
  return <p className="mb-2 mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</p>;
}

const numCls =
  "w-full min-w-0 rounded-md border border-border bg-surface px-2 py-1.5 text-right font-mono text-xs text-foreground focus:border-accent-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-2/40 disabled:opacity-40";

/** A number field that commits on blur or Enter (one undo step per edit,
 * not per keystroke); Up/Down step it. */
function NumField({
  label,
  value,
  min,
  max,
  step = 1,
  digits = 1,
  suffix,
  disabled,
  title,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  digits?: number;
  suffix?: string;
  disabled?: boolean;
  title?: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = Number(value.toFixed(digits));
  const send = (v: number) => {
    if (Number.isFinite(v)) onCommit(Math.min(max, Math.max(min, v)));
  };
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft.replace(",", "."));
    setDraft(null);
    if (draft.trim() !== "" && v !== shown) send(v);
  };
  return (
    <label className="flex min-w-0 items-center gap-1.5" title={title}>
      <span className="w-7 shrink-0 text-[11px] font-semibold text-muted">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        aria-label={title ?? label}
        value={draft ?? String(shown)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          else if (e.key === "Escape") setDraft(null);
          else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setDraft(null);
            send(shown + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
          }
        }}
        className={numCls}
      />
      {suffix && <span className="w-3 shrink-0 text-[11px] text-muted">{suffix}</span>}
    </label>
  );
}

const chip = (on: boolean) =>
  `rounded-full border px-2.5 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
    on ? "border-accent-2 bg-accent-2 text-black" : "border-border bg-surface text-foreground hover:border-accent/50"
  }`;

// --- transform ----------------------------------------------------------------

const CORNER_GRID: Corner[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];

/** Position, size, rotation, opacity and crop as numbers, with fit / fill /
 * stretch, reset and corner placement. Positions and sizes are percent of
 * the canvas; an animated layer's edits land in a keyframe at the playhead
 * (the crop excepted: it's the same over the whole layer). */
export function LayerTransformSection({
  overlay: o,
  natural,
  canvas,
  clock,
  onChange,
  onEdit,
  gesture,
}: {
  overlay: Overlay;
  /** The layer's picture size (its raster, or its video's frame); null until it's loaded. */
  natural: Size | null;
  canvas: Size;
  clock: Clock;
  onChange: (patch: Partial<Overlay>) => void;
  onEdit: LayerEdit;
  gesture: Gesture;
}) {
  const time = useClockTime(clock);
  const v = overlayValues(o, time);
  const isText = o.kind === "text";
  const video = o.kind === "video" ? o : null;
  // Until the picture's size is known, its box can't be measured.
  const rect = natural && !isText ? layerRect(o, o.width, natural, canvas, time) : null;
  const canvasAr = canvas.width / canvas.height;
  const aspect = natural ? layerAspect(o, natural) : canvasAr;
  // The width at which it exactly fits inside the canvas: 100% scale.
  const fitWidth = aspect > canvasAr ? 1 : aspect / canvasAr;
  const crop = layerCrop(o);
  const stretched = !!video?.aspect;
  const pct = (n: number) => n * 100;

  const setWidth = (w: number) => {
    if (!video || !stretched || !rect) return onChange({ width: w });
    // Stretched: the height stays, so the shape changes with the width.
    onEdit((cur, t) => {
      const c = cur as VideoLayer;
      const next = { ...c, aspect: ((c.aspect ?? aspect) * w) / Math.max(1e-6, rect.w) };
      return { ...next, ...animateOverlayPatch(next, { width: w }, t) } as Overlay;
    });
  };
  const setHeight = (h: number) => {
    if (!rect) return;
    if (!video || !stretched) return onChange({ width: (rect.w * h) / Math.max(1e-6, rect.h) });
    onEdit((cur) => ({ ...cur, aspect: (rect.w * canvas.width) / Math.max(1, h * canvas.height) }) as Overlay);
  };
  const setCrop = (next: Crop) => video && natural && onEdit((cur, t) => ({ ...cur, ...applyCrop(cur as VideoLayer, natural, canvas, next, t) }) as Overlay);
  const frame = (fit: CellFit) => video && natural && onEdit((cur, t) => frameLayer(cur as VideoLayer, natural, canvas, fit, t));

  return (
    <div className="space-y-3">
      <Title>Transform</Title>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <NumField label="X" title="Horizontal position of the centre, percent of the canvas width" value={pct(v.x)} min={-30} max={130} suffix="%" onCommit={(n) => onChange({ x: n / 100 })} />
        <NumField label="Y" title="Vertical position of the centre, percent of the canvas height" value={pct(v.y)} min={-30} max={130} suffix="%" onCommit={(n) => onChange({ y: n / 100 })} />
        {rect && (
          <>
            <NumField label="W" title="Width, percent of the canvas width" value={pct(rect.w)} min={3} max={200} suffix="%" onCommit={(n) => setWidth(n / 100)} />
            <NumField label="H" title="Height, percent of the canvas height" value={pct(rect.h)} min={1} max={400} suffix="%" onCommit={(n) => setHeight(n / 100)} />
            <NumField
              label="Size"
              title="Scale: 100% fits the canvas exactly"
              value={pct(rect.w / fitWidth)}
              min={3}
              max={400}
              suffix="%"
              disabled={stretched}
              onCommit={(n) => onChange({ width: (fitWidth * n) / 100 })}
            />
          </>
        )}
        {isText && (
          <NumField
            label="Size"
            title="Text size, percent of the canvas height"
            value={pct(o.text.size * v.scale)}
            min={1.5}
            max={50}
            suffix="%"
            onCommit={(n) => onChange({ text: { ...o.text, size: n / 100 } } as Partial<Overlay>)}
          />
        )}
        <NumField label="Rot" title="Rotation, degrees clockwise" value={v.rotation} min={-180} max={180} suffix="°" onCommit={(n) => onChange({ rotation: n })} />
      </div>
      {video && (
        <label className="flex items-center gap-2 text-xs font-medium text-foreground">
          <input
            type="checkbox"
            className="accent-[var(--accent)]"
            checked={!stretched}
            onChange={(e) => onEdit((cur) => ({ ...cur, aspect: e.target.checked ? undefined : aspect }) as Overlay)}
          />
          Keep the picture&apos;s proportions
        </label>
      )}
      <SliderField label="Rotation" value={Math.round(v.rotation)} min={-180} max={180} neutral={0} format={(n) => `${n}°`} onChange={(n) => onChange({ rotation: n })} gesture={gesture} />
      <SliderField label="Opacity" value={Math.round(v.opacity * 100)} min={0} max={100} neutral={100} format={(n) => `${n}%`} onChange={(n) => onChange({ opacity: n / 100 })} gesture={gesture} />

      {video && natural && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Title>Crop</Title>
            {video.crop && (
              <button type="button" onClick={() => setCrop({ x: 0, y: 0, w: 1, h: 1 })} className="rounded px-1 text-[10px] font-semibold text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2">
                Reset crop
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <NumField label="L" title="Crop from the left, percent of the video's width" value={pct(crop.x)} min={0} max={90} suffix="%" onCommit={(n) => setCrop({ ...crop, x: n / 100, w: crop.x + crop.w - n / 100 })} />
            <NumField label="R" title="Crop from the right, percent of the video's width" value={pct(1 - crop.x - crop.w)} min={0} max={95} suffix="%" onCommit={(n) => setCrop({ ...crop, w: 1 - n / 100 - crop.x })} />
            <NumField label="T" title="Crop from the top, percent of the video's height" value={pct(crop.y)} min={0} max={90} suffix="%" onCommit={(n) => setCrop({ ...crop, y: n / 100, h: crop.y + crop.h - n / 100 })} />
            <NumField label="B" title="Crop from the bottom, percent of the video's height" value={pct(1 - crop.y - crop.h)} min={0} max={95} suffix="%" onCommit={(n) => setCrop({ ...crop, h: 1 - n / 100 - crop.y })} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted">Or drag the bars on the layer&apos;s edges in the preview.</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {video && natural ? (
          <>
            <ActionButton onClick={() => frame("fit")} title="Center it and show all of it, as large as fits the canvas">
              Fit
            </ActionButton>
            <ActionButton onClick={() => frame("fill")} title="Cover the whole canvas, cropping what doesn't fit">
              Fill
            </ActionButton>
            <ActionButton onClick={() => frame("stretch")} title="Pull it to the canvas's shape, without cropping">
              Stretch
            </ActionButton>
          </>
        ) : (
          rect && (
            <ActionButton onClick={() => onChange({ x: 0.5, y: 0.5, width: fitWidth })} title="Center it, as large as fits the canvas">
              Fit
            </ActionButton>
          )
        )}
        <ActionButton
          onClick={() => onEdit((cur, t) => resetTransform(cur, natural ?? canvas, canvas, t))}
          title="Back to the middle at its default size: no rotation, crop, stretch or transparency"
        >
          Reset
        </ActionButton>
      </div>

      {rect && (
        <div>
          <Title>Place</Title>
          <div className="grid w-28 grid-cols-3 gap-1" role="group" aria-label="Place on the canvas">
            {CORNER_GRID.map((c) => (
              <button
                key={c}
                type="button"
                title={CORNER_LABELS[c]}
                aria-label={CORNER_LABELS[c]}
                onClick={() => onChange(cornerPosition(rect, canvas, c))}
                className="flex h-7 items-center justify-center rounded border border-border bg-surface text-muted hover:border-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
              >
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** A video layer's rounded corners, border and shadow (layerFrame.ts). */
export function LayerFrameSection({ frame, onChange, gesture }: { frame: LayerFrame | undefined; onChange: (f: LayerFrame | undefined) => void; gesture: Gesture }) {
  const f = frame ?? DEFAULT_FRAME;
  const set = (patch: Partial<LayerFrame>) => onChange(cleanFrame({ ...f, ...patch }));
  return (
    <div className="space-y-3">
      <Title>Corners, border and shadow</Title>
      <SliderField label="Corner radius" value={Math.round(f.radius * 100)} min={0} max={100} neutral={0} format={(n) => `${n}%`} onChange={(n) => set({ radius: n / 100 })} gesture={gesture} />
      <SliderField label="Border" value={Math.round((f.border / MAX_BORDER) * 100)} min={0} max={100} neutral={0} format={(n) => `${n}%`} onChange={(n) => set({ border: (n / 100) * MAX_BORDER })} gesture={gesture} />
      {f.border > 0 && (
        <label className="flex items-center justify-between gap-2 text-xs font-medium text-foreground">
          Border color
          <input
            type="color"
            value={f.borderColor}
            onFocus={gesture.onGestureStart}
            onBlur={gesture.onGestureEnd}
            onChange={(e) => set({ borderColor: e.target.value })}
            className="h-8 w-12 cursor-pointer rounded border border-border bg-surface"
          />
        </label>
      )}
      <SliderField label="Shadow" value={Math.round(f.shadow * 100)} min={0} max={100} neutral={0} format={(n) => `${n}%`} onChange={(n) => set({ shadow: n / 100 })} gesture={gesture} />
    </div>
  );
}

// --- align and distribute ---------------------------------------------------

export interface ArrangeControls {
  /** Unlocked layers picked. */
  count: number;
  onAlign: (op: AlignOp) => void;
  onDistribute: (axis: "h" | "v", mode: "centers" | "gaps") => void;
  onEqual: (dim: "width" | "height") => void;
  onFit: () => void;
  onCenter: () => void;
  snapping: boolean;
  onSnapping: (on: boolean) => void;
}

/** A 16 px glyph: a guide line and bars, drawn from rectangles. */
function Glyph({ rects, line }: { rects: [number, number, number, number][]; line?: [number, number, number, number] }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
      {line && <rect x={line[0]} y={line[1]} width={line[2]} height={line[3]} fill="currentColor" opacity={0.55} />}
      {rects.map((r, i) => (
        <rect key={i} x={r[0]} y={r[1]} width={r[2]} height={r[3]} rx={0.75} fill="currentColor" />
      ))}
    </svg>
  );
}

const ALIGN_BUTTONS: { op: AlignOp; label: string; canvas: string; glyph: ReactNode }[] = [
  { op: "left", label: "Align left", canvas: "Left edge of the canvas", glyph: <Glyph line={[1, 1, 1, 14]} rects={[[3, 3, 10, 4], [3, 9, 6, 4]]} /> },
  { op: "hcenter", label: "Align centers horizontally", canvas: "Center horizontally on the canvas", glyph: <Glyph line={[7.5, 1, 1, 14]} rects={[[3, 3, 10, 4], [5, 9, 6, 4]]} /> },
  { op: "right", label: "Align right", canvas: "Right edge of the canvas", glyph: <Glyph line={[14, 1, 1, 14]} rects={[[3, 3, 10, 4], [7, 9, 6, 4]]} /> },
  { op: "top", label: "Align top", canvas: "Top edge of the canvas", glyph: <Glyph line={[1, 1, 14, 1]} rects={[[3, 3, 4, 10], [9, 3, 4, 6]]} /> },
  { op: "vcenter", label: "Align centers vertically", canvas: "Center vertically on the canvas", glyph: <Glyph line={[1, 7.5, 14, 1]} rects={[[3, 3, 4, 10], [9, 5, 4, 6]]} /> },
  { op: "bottom", label: "Align bottom", canvas: "Bottom edge of the canvas", glyph: <Glyph line={[1, 14, 14, 1]} rects={[[3, 3, 4, 10], [9, 7, 4, 6]]} /> },
];

function ArrangeButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded border border-border bg-surface text-foreground hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/** Align, distribute and match sizes: one layer against the canvas, several
 * against each other. Every button is one undo step. */
export function ArrangeBar({ controls: c }: { controls: ArrangeControls }) {
  const many = c.count > 1;
  return (
    <div className="space-y-2">
      <Title>{many ? `Arrange ${c.count} layers` : "Align to the canvas"}</Title>
      <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Align">
        {ALIGN_BUTTONS.map((b) => (
          <ArrangeButton key={b.op} label={many ? b.label : b.canvas} onClick={() => c.onAlign(b.op)} disabled={c.count < 1}>
            {b.glyph}
          </ArrangeButton>
        ))}
      </div>
      {many && (
        <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Distribute and match sizes">
          <ArrangeButton label="Distribute horizontally: centers evenly spaced (3 or more layers)" disabled={c.count < 3} onClick={() => c.onDistribute("h", "centers")}>
            <Glyph line={[1, 13, 14, 1]} rects={[[1, 4, 3, 7], [6.5, 4, 3, 7], [12, 4, 3, 7]]} />
          </ArrangeButton>
          <ArrangeButton label="Distribute vertically: centers evenly spaced (3 or more layers)" disabled={c.count < 3} onClick={() => c.onDistribute("v", "centers")}>
            <Glyph line={[13, 1, 1, 14]} rects={[[4, 1, 7, 3], [4, 6.5, 7, 3], [4, 12, 7, 3]]} />
          </ArrangeButton>
          <ArrangeButton label="Equal spacing horizontally: the same gap between layers (3 or more)" disabled={c.count < 3} onClick={() => c.onDistribute("h", "gaps")}>
            <Glyph rects={[[1, 3, 2, 10], [6, 5, 4, 6], [13, 3, 2, 10]]} />
          </ArrangeButton>
          <ArrangeButton label="Equal spacing vertically: the same gap between layers (3 or more)" disabled={c.count < 3} onClick={() => c.onDistribute("v", "gaps")}>
            <Glyph rects={[[3, 1, 10, 2], [5, 6, 6, 4], [3, 13, 10, 2]]} />
          </ArrangeButton>
          <ArrangeButton label="Equal width: as wide as the selected layer" onClick={() => c.onEqual("width")}>
            <Glyph line={[1, 13, 14, 1]} rects={[[1, 3, 14, 3], [1, 8, 14, 3]]} />
          </ArrangeButton>
          <ArrangeButton label="Equal height: as high as the selected layer" onClick={() => c.onEqual("height")}>
            <Glyph line={[13, 1, 1, 14]} rects={[[3, 1, 3, 14], [8, 1, 3, 14]]} />
          </ArrangeButton>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton onClick={c.onFit} disabled={c.count < 1} title="As large as fits inside the canvas, centered">
          Fit to canvas
        </ActionButton>
        <ActionButton onClick={c.onCenter} disabled={c.count < 1} title="Move to the middle of the canvas">
          Center
        </ActionButton>
        <label className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-foreground" title="Dragging a layer snaps to the canvas's edges and centre and to other layers. Hold Alt to turn it off for one drag.">
          <input type="checkbox" className="accent-[var(--accent)]" checked={c.snapping} onChange={(e) => c.onSnapping(e.target.checked)} />
          Snap
        </label>
      </div>
    </div>
  );
}

// --- split-screen layouts --------------------------------------------------------

/** A layout drawn at the canvas's shape: numbered screens, the ones there's
 * a video for filled in. */
function LayoutThumb({ cells, canvas, filled }: { cells: { x: number; y: number; w: number; h: number }[]; canvas: Size; filled: number }) {
  const W = 64;
  const H = Math.max(20, Math.min(96, Math.round((W * canvas.height) / canvas.width)));
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="rounded-sm">
      <rect width={W} height={H} className="fill-surface-3" />
      {cells.map((c, i) => (
        <g key={i}>
          <rect
            x={c.x * W + 1}
            y={c.y * H + 1}
            width={Math.max(1, c.w * W - 2)}
            height={Math.max(1, c.h * H - 2)}
            rx={1.5}
            className={i < filled ? "fill-accent/70 stroke-accent" : "fill-transparent stroke-muted"}
            strokeWidth={1}
            strokeDasharray={i < filled ? undefined : "2 2"}
          />
          <text x={(c.x + c.w / 2) * W} y={(c.y + c.h / 2) * H + 3} textAnchor="middle" fontSize={8} fontWeight={700} className={i < filled ? "fill-white" : "fill-muted"}>
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

export interface LayoutChoice {
  cells: { x: number; y: number; w: number; h: number }[];
  /** A picture-in-picture preset: no spacing, the first screen is the main video. */
  over: boolean;
  fit: "fill" | "fit";
  gap: number;
  main: boolean;
  label: string;
}

/** Split-screen and picture-in-picture layouts. Each screen stays its own
 * layer: this only places what's there. */
export function LayoutPanel({
  canvas,
  clock,
  layersAt,
  mainPlaced,
  onApply,
  onAddVideo,
  onReleaseMain,
  onClose,
  gesture,
}: {
  canvas: Size;
  clock: Clock;
  /** Names of the video layers showing at a time, bottom to top - what a layout places. */
  layersAt: (t: number) => string[];
  /** The main video is in a screen of a layout. */
  mainPlaced: boolean;
  onApply: (choice: LayoutChoice) => void;
  /** Adds a video as a layer, then places the last layout again. */
  onAddVideo: (file: File) => void;
  onReleaseMain: () => void;
  onClose: () => void;
  gesture: Gesture;
}) {
  const [fit, setFit] = useState<"fill" | "fit">("fill");
  const [gap, setGap] = useState(0);
  const [main, setMain] = useState(true);
  const [cols, setCols] = useState(2);
  const [rows, setRows] = useState(2);
  const input = useRef<HTMLInputElement>(null);
  const layers = layersAt(useClockTime(clock));
  const have = (usesMain: boolean) => layers.length + (usesMain ? 1 : 0);
  const apply = (p: LayoutPreset) => onApply({ cells: p.cells, over: !!p.over, fit, gap, main: p.over ? true : main, label: p.label });
  return (
    <PanelShell title="Split screen" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-[11px] text-muted">
          Puts the videos showing at the playhead into screens. Every screen stays its own layer: move, resize, crop or animate any of them afterwards.
        </p>
        <div className="rounded-lg border border-border bg-surface p-3">
          <p className="text-xs font-semibold text-foreground">
            {have(main)} {have(main) === 1 ? "video" : "videos"} to place
          </p>
          <ol className="mt-1.5 space-y-0.5 text-[11px] text-muted">
            {main && <li>1. Main video (the Video row)</li>}
            {layers.map((n, i) => (
              <li key={i} className="truncate">
                {i + (main ? 2 : 1)}. {n}
              </li>
            ))}
          </ol>
          <input
            ref={input}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onAddVideo(f);
            }}
          />
          <div className="mt-2.5 flex flex-wrap gap-2">
            <ActionButton onClick={() => input.current?.click()} tone="accent" title="Add another video as a layer at the playhead">
              + Add a video
            </ActionButton>
            {mainPlaced && (
              <ActionButton onClick={onReleaseMain} title="Put the main video back over the whole canvas">
                Main video full screen
              </ActionButton>
            )}
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="How videos fill their screens">
            <button type="button" role="radio" aria-checked={fit === "fill"} className={chip(fit === "fill")} onClick={() => setFit("fill")} title="Each video is cropped to its screen's shape">
              Fill screens
            </button>
            <button type="button" role="radio" aria-checked={fit === "fit"} className={chip(fit === "fit")} onClick={() => setFit("fit")} title="All of each video shows inside its screen">
              Fit inside
            </button>
          </div>
          <SliderField label="Spacing" value={Math.round((gap / MAX_GAP) * 100)} min={0} max={100} neutral={0} format={(n) => `${n}%`} onChange={(n) => setGap((n / 100) * MAX_GAP)} gesture={gesture} />
          <label className="flex items-center gap-2 text-xs font-medium text-foreground">
            <input type="checkbox" className="accent-[var(--accent)]" checked={main} onChange={(e) => setMain(e.target.checked)} />
            The main video takes screen 1
          </label>
        </div>

        {LAYOUT_PRESETS.map((g) => (
          <div key={g.group}>
            <Title>{g.group}</Title>
            <div className="grid grid-cols-3 gap-2">
              {g.presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.hint}
                  onClick={() => apply(p)}
                  className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-surface p-2 text-[10px] font-semibold leading-tight text-foreground hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
                >
                  <LayoutThumb cells={p.cells} canvas={canvas} filled={have(p.over ? true : main)} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div>
          <Title>Custom grid</Title>
          <div className="flex items-center gap-3">
            <LayoutThumb cells={gridCells(cols, rows)} canvas={canvas} filled={have(main)} />
            <div className="space-y-1.5">
              {(
                [
                  ["Columns", cols, setCols],
                  ["Rows", rows, setRows],
                ] as const
              ).map(([label, value, set]) => (
                <div key={label} className="flex items-center gap-1.5" role="radiogroup" aria-label={label}>
                  <span className="w-14 text-[11px] font-semibold text-muted">{label}</span>
                  {[1, 2, 3, 4].map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={value === n} className={chip(value === n)} onClick={() => set(n)}>
                      {n}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2.5">
            <ActionButton onClick={() => onApply({ cells: gridCells(cols, rows), over: false, fit, gap, main, label: `${cols} x ${rows} grid` })} disabled={cols * rows < 2}>
              Use this grid
            </ActionButton>
          </div>
          <p className="mt-2 text-[11px] text-muted">For any other arrangement, drag and resize the screens on the preview: they snap to each other and to the canvas.</p>
        </div>
      </div>
    </PanelShell>
  );
}

// --- layers ---------------------------------------------------------------------

const iconBtn =
  "rounded p-1 text-xs leading-none text-muted hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:cursor-not-allowed disabled:opacity-30";

/** Every layer, top of the picture first: name, type and thumbnail, with
 * show/hide, lock, duplicate, delete, rename (double-click) and order
 * (drag, or the arrows). Shift/Ctrl+click picks several. Auto captions are
 * one row: there can be hundreds, and the Captions panel edits them. */
export function LayersPanel({
  overlays,
  selectedId,
  picked,
  sources,
  thumbs,
  groupColors,
  arrange,
  onSelect,
  onPick,
  onPatch,
  onStack,
  onDuplicate,
  onDelete,
  onOpenCaptions,
  onClose,
}: {
  overlays: Overlay[];
  selectedId: string | null;
  /** Ids of the layers picked together. */
  picked: ReadonlySet<string>;
  sources: Record<string, MediaSource>;
  /** A frame of each video source, for video layers. */
  thumbs: Record<string, string | undefined>;
  /** Group stripe colors by layer id. */
  groupColors: ReadonlyMap<string, string>;
  /** Align / distribute tools, shown under the list when layers are picked. */
  arrange?: ReactNode;
  onSelect: (id: string) => void;
  onPick: (id: string) => void;
  /** Name, hidden, locked: never a keyframe. */
  onPatch: (id: string, patch: Partial<Overlay>) => void;
  /** Moves a layer right above or below another in the stacking order. */
  onStack: (id: string, targetId: string, where: "above" | "below") => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenCaptions: () => void;
  onClose: () => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; where: "above" | "below" } | null>(null);
  const captions = overlays.filter((o) => o.caption).length;
  const topFirst = overlays.filter((o) => !o.caption).reverse();

  return (
    <PanelShell title="Layers" onClose={onClose}>
      <p className="mb-3 text-[11px] text-muted">
        Top of the list is drawn on top; the main video and the background are always underneath. Drag a layer to reorder it, double-click its name to rename it, Shift or Ctrl+click to
        select several.
      </p>
      {topFirst.length === 0 && <p className="text-xs text-muted">No layers yet. Add a video, text, stickers or images.</p>}
      <ul className="space-y-1.5">
        {topFirst.map((o, i) => {
          const name = layerName(o, sources);
          const sticker = o.kind === "sticker" ? getStickerDef(o.stickerId) : undefined;
          const thumb = sticker ? stickerThumbSrc(sticker) : o.kind === "image" ? sources[o.sourceId]?.url : o.kind === "video" ? thumbs[o.sourceId] : null;
          const selected = o.id === selectedId;
          const also = !selected && picked.has(o.id);
          const group = groupColors.get(o.id);
          const drop = dropAt?.id === o.id && dragId && dragId !== o.id ? dropAt.where : null;
          return (
            <li
              key={o.id}
              draggable={renaming !== o.id}
              onDragStart={(e) => {
                setDragId(o.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", o.id);
              }}
              onDragOver={(e) => {
                if (!dragId || dragId === o.id) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                // The list is top first: its upper half is "above" in the picture.
                setDropAt({ id: o.id, where: e.clientY < r.top + r.height / 2 ? "above" : "below" });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dropAt && dragId !== dropAt.id) onStack(dragId, dropAt.id, dropAt.where);
                setDragId(null);
                setDropAt(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropAt(null);
              }}
              style={group ? { boxShadow: `inset 3px 0 0 ${group}` } : undefined}
              className={`relative flex items-center gap-1.5 rounded-lg border px-2 py-1.5 ${
                selected ? "border-accent-2 bg-accent-2/10" : also ? "border-dashed border-accent-2 bg-accent-2/5" : "border-border bg-surface"
              } ${dragId === o.id ? "opacity-50" : ""}`}
            >
              {drop && <span aria-hidden className={`pointer-events-none absolute inset-x-1 h-0.5 rounded bg-accent-2 ${drop === "above" ? "-top-1" : "-bottom-1"}`} />}
              <button
                type="button"
                onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey ? onPick(o.id) : onSelect(o.id))}
                onDoubleClick={() => setRenaming(o.id)}
                aria-pressed={selected || also}
                className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-3 text-xs font-bold text-foreground">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" draggable={false} className={`h-full w-full ${o.kind === "video" ? "object-cover" : "object-contain"}`} />
                  ) : sticker?.kind === "emoji" ? (
                    (sticker as { char: string }).char
                  ) : o.kind === "video" ? (
                    "▶"
                  ) : o.kind === "text" ? (
                    "T"
                  ) : (
                    "★"
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  {renaming === o.id ? (
                    <input
                      autoFocus
                      defaultValue={o.name ?? name}
                      maxLength={60}
                      aria-label="Layer name"
                      onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (o.name ?? "") && v !== name) onPatch(o.id, { name: v || undefined });
                        else if (!v && o.name) onPatch(o.id, { name: undefined });
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        else if (e.key === "Escape") setRenaming(null);
                      }}
                      className="w-full rounded border border-accent-2 bg-surface px-1 py-0.5 text-xs text-foreground focus:outline-none"
                    />
                  ) : (
                    <span className={`block truncate text-xs font-semibold ${o.hidden ? "text-muted line-through" : "text-foreground"}`}>{name}</span>
                  )}
                  <span className="block text-[10px] text-muted">
                    {LAYER_TYPE_LABELS[o.kind]}
                    {o.keyframes?.length ? " · animated" : ""}
                  </span>
                </span>
              </button>
              <div className="flex shrink-0 items-center">
                <button type="button" className={iconBtn} title="Bring forward" aria-label="Bring forward" disabled={i === 0} onClick={() => onStack(o.id, topFirst[i - 1].id, "above")}>
                  ↑
                </button>
                <button type="button" className={iconBtn} title="Send backward" aria-label="Send backward" disabled={i === topFirst.length - 1} onClick={() => onStack(o.id, topFirst[i + 1].id, "below")}>
                  ↓
                </button>
                <button type="button" className={iconBtn} title={o.hidden ? "Show" : "Hide"} aria-label={o.hidden ? "Show layer" : "Hide layer"} aria-pressed={o.hidden} onClick={() => onPatch(o.id, { hidden: !o.hidden })}>
                  {o.hidden ? "◌" : "◉"}
                </button>
                <button type="button" className={iconBtn} title={o.locked ? "Unlock" : "Lock"} aria-label={o.locked ? "Unlock layer" : "Lock layer"} aria-pressed={o.locked} onClick={() => onPatch(o.id, { locked: !o.locked })}>
                  {o.locked ? "🔒" : "🔓"}
                </button>
                <button type="button" className={iconBtn} title="Duplicate" aria-label="Duplicate layer" onClick={() => onDuplicate(o.id)}>
                  ⧉
                </button>
                <button type="button" className={iconBtn} title="Rename" aria-label="Rename layer" onClick={() => setRenaming(o.id)}>
                  ✎
                </button>
                <button type="button" className={iconBtn} title={o.locked ? "Unlock to delete" : "Delete"} aria-label="Delete layer" disabled={o.locked} onClick={() => onDelete(o.id)}>
                  <TrashIcon width={13} height={13} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {captions > 0 && (
        <button
          type="button"
          onClick={onOpenCaptions}
          className="mt-2 flex w-full items-center justify-between rounded-lg border border-dashed border-border px-3 py-2 text-left text-[11px] text-muted hover:border-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
        >
          <span>
            {captions} auto {captions === 1 ? "caption" : "captions"}
          </span>
          <span className="font-semibold">Open Captions</span>
        </button>
      )}
      {arrange && <div className="mt-4 border-t border-border pt-3">{arrange}</div>}
    </PanelShell>
  );
}
