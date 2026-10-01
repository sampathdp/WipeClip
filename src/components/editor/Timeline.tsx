"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useClockTime, type Clock } from "@/lib/editor/clock";
import type { ThumbnailStrip } from "@/lib/editor/media";
import { getStickerDef, stickerThumbSrc } from "@/lib/editor/stickers";
import {
  MIN_CLIP_SECONDS,
  TRANSITION_LABELS,
  clipVisualSpan,
  formatTime,
  type Layout,
} from "@/lib/editor/timeline";
import type { Clip, MediaSource, Selection, Sticker } from "@/lib/editor/types";
import { ZoomInIcon, ZoomOutIcon } from "./icons";

const PAD = 16; // px before t=0 so the first trim handle is reachable
const CLIP_H = 64;
const LANE_H = 30;
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

type Gesture =
  | { kind: "trim"; clipId: string; edge: "start" | "end"; x0: number; start: number; end: number; max: number }
  | { kind: "reorder"; index: number; x0: number; active: boolean }
  | { kind: "sticker"; id: string; mode: "move" | "start" | "end"; x0: number; start: number; end: number }
  | { kind: "seek" };

interface Props {
  lay: Layout;
  sources: Record<string, MediaSource>;
  thumbnails: Record<string, ThumbnailStrip>;
  stickers: Sticker[];
  selection: Selection;
  clock: Clock;
  playing: boolean;
  onSelect: (s: Selection) => void;
  onSeek: (t: number) => void;
  onClipChange: (clipId: string, patch: Partial<Clip>) => void;
  onStickerChange: (id: string, patch: Partial<Sticker>) => void;
  onMoveClip: (from: number, to: number) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}

export default function Timeline(props: Props) {
  const { lay, sources, thumbnails, stickers, selection, clock, playing } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState<number | null>(null); // pixels per second
  const [viewWidth, setViewWidth] = useState(800);
  const gesture = useRef<Gesture | null>(null);
  const [drag, setDrag] = useState<{ index: number; dx: number; target: number; markerX: number } | null>(null);
  const [trimLabel, setTrimLabel] = useState<{ x: number; text: string } | null>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitPps = Math.max(4, (viewWidth - PAD * 2) / Math.max(1, lay.total));
  const scale = pps ?? fitPps;
  const width = lay.total * scale + PAD * 2;
  const xOf = (t: number) => PAD + t * scale;
  const tOf = (clientX: number) => {
    const r = scroller.current!.getBoundingClientRect();
    return Math.min(lay.total, Math.max(0, (clientX - r.left + scroller.current!.scrollLeft - PAD) / scale));
  };

  const zoom = (factor: number) => setPps((p) => Math.min(400, Math.max(fitPps, (p ?? fitPps) * factor)));

  // Sticker lanes: greedy packing so overlapping stickers stack instead of hiding each other.
  const lanes = useMemo(() => {
    const sorted = [...stickers].sort((a, b) => a.start - b.start);
    const laneEnds: number[] = [];
    const lane: Record<string, number> = {};
    for (const s of sorted) {
      let i = laneEnds.findIndex((end) => end <= s.start + 1e-3);
      if (i < 0) {
        i = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[i] = s.end;
      lane[s.id] = i;
    }
    return { lane, count: Math.max(1, laneEnds.length) };
  }, [stickers]);

  const tickStep = TICK_STEPS.find((s) => s * scale >= 70) ?? 600;
  const ticks: number[] = [];
  for (let t = 0; t <= lay.total + 1e-6; t += tickStep) ticks.push(t);

  const startGesture = (e: React.PointerEvent, g: Gesture) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = g;
    if (g.kind === "trim" || g.kind === "sticker") props.onGestureStart();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "seek") {
      props.onSeek(tOf(e.clientX));
      return;
    }
    if (g.kind === "trim") {
      const dt = (e.clientX - g.x0) / scale;
      if (g.edge === "start") {
        const start = Math.min(g.end - MIN_CLIP_SECONDS, Math.max(0, g.start + dt));
        props.onClipChange(g.clipId, { start });
        setTrimLabel({ x: e.clientX, text: `Start ${formatTime(start, true)}` });
      } else {
        const end = Math.max(g.start + MIN_CLIP_SECONDS, Math.min(g.max, g.end + dt));
        props.onClipChange(g.clipId, { end });
        setTrimLabel({ x: e.clientX, text: `End ${formatTime(end, true)} · ${formatTime(end - g.start, true)} long` });
      }
      return;
    }
    if (g.kind === "reorder") {
      const dx = e.clientX - g.x0;
      if (!g.active && Math.abs(dx) < 6) return;
      g.active = true;
      // Target = insertion position among the *other* clips (moveClip's
      // remove-then-insert semantics); the marker sits at that gap.
      const t = tOf(e.clientX);
      const others = lay.clips.map((_, i) => i).filter((i) => i !== g.index);
      let target = 0;
      others.forEach((i, k) => {
        const span = clipVisualSpan(lay, i);
        if (t > (span.from + span.to) / 2) target = k + 1;
      });
      const markerT =
        others.length === 0
          ? 0
          : target >= others.length
            ? clipVisualSpan(lay, others[others.length - 1]).to
            : clipVisualSpan(lay, others[target]).from;
      setDrag({ index: g.index, dx, target, markerX: xOf(markerT) });
      return;
    }
    if (g.kind === "sticker") {
      const dt = (e.clientX - g.x0) / scale;
      const len = g.end - g.start;
      if (g.mode === "move") {
        const start = Math.min(Math.max(0, g.start + dt), Math.max(0, lay.total - len));
        props.onStickerChange(g.id, { start, end: start + len });
        setTrimLabel({ x: e.clientX, text: `${formatTime(start, true)} → ${formatTime(start + len, true)}` });
      } else if (g.mode === "start") {
        const start = Math.min(g.end - 0.2, Math.max(0, g.start + dt));
        props.onStickerChange(g.id, { start });
        setTrimLabel({ x: e.clientX, text: `Starts ${formatTime(start, true)}` });
      } else {
        const end = Math.max(g.start + 0.2, Math.min(lay.total, g.end + dt));
        props.onStickerChange(g.id, { end });
        setTrimLabel({ x: e.clientX, text: `Ends ${formatTime(end, true)}` });
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    setTrimLabel(null);
    if (!g) return;
    if (g.kind === "trim" || g.kind === "sticker") props.onGestureEnd();
    if (g.kind === "reorder") {
      if (g.active && drag) {
        if (drag.target !== g.index) props.onMoveClip(g.index, drag.target);
      } else {
        props.onSeek(tOf(e.clientX));
      }
      setDrag(null);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1 text-xs text-muted">
        <span className="font-mono">
          <TimeReadout clock={clock} /> / {formatTime(lay.total, true)}
        </span>
        <div className="flex items-center gap-1">
          <IconButton label="Zoom out timeline" onClick={() => zoom(1 / 1.5)}>
            <ZoomOutIcon width={16} height={16} />
          </IconButton>
          <IconButton label="Fit timeline" onClick={() => setPps(null)}>
            <span className="px-1 text-[11px] font-semibold">Fit</span>
          </IconButton>
          <IconButton label="Zoom in timeline" onClick={() => zoom(1.5)}>
            <ZoomInIcon width={16} height={16} />
          </IconButton>
        </div>
      </div>

      <div
        ref={scroller}
        className="relative overflow-x-auto overflow-y-hidden rounded-xl border border-border bg-surface-2/60 pb-2"
        onWheel={onWheel}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="relative select-none" style={{ width }}>
          {/* Ruler - click or drag to seek */}
          <div
            className="relative h-7 cursor-pointer border-b border-border/70"
            onPointerDown={(e) => {
              startGesture(e, { kind: "seek" });
              props.onSeek(tOf(e.clientX));
            }}
          >
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 h-full" style={{ left: xOf(t) }}>
                <div className="h-2 w-px bg-muted/50" />
                <span className="absolute left-1 top-1.5 whitespace-nowrap font-mono text-[10px] text-muted">
                  {formatTime(t, tickStep < 1)}
                </span>
              </div>
            ))}
          </div>

          {/* Video track */}
          <div className="relative mt-2" style={{ height: CLIP_H }}>
            {lay.clips.map((c, i) => {
              const span = clipVisualSpan(lay, i);
              const src = sources[c.clip.sourceId];
              const selected = selection?.kind === "clip" && selection.id === c.clip.id;
              const dragging = drag?.index === i;
              return (
                <div
                  key={c.clip.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Clip ${i + 1}, ${formatTime(c.clip.start, true)} to ${formatTime(c.clip.end, true)}${src?.kind === "cleaned" ? ", AI cleaned" : ""}`}
                  aria-pressed={selected}
                  className={`group absolute top-0 h-full overflow-hidden rounded-lg border-2 bg-surface-3 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-accent-2 ${
                    selected ? "z-10 border-accent-2 shadow-[0_0_0_2px_rgba(34,211,238,0.25)]" : "border-border hover:border-accent/60"
                  } ${dragging ? "z-20 cursor-grabbing opacity-80 shadow-xl" : "cursor-grab"}`}
                  style={{
                    left: xOf(span.from) + 1,
                    width: Math.max(8, (span.to - span.from) * scale - 2),
                    transform: dragging ? `translateX(${drag.dx}px)` : undefined,
                  }}
                  onPointerDown={(e) => {
                    props.onSelect({ kind: "clip", id: c.clip.id });
                    startGesture(e, { kind: "reorder", index: i, x0: e.clientX, active: false });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      props.onSelect({ kind: "clip", id: c.clip.id });
                    }
                  }}
                >
                  <ClipThumbs strip={thumbnails[c.clip.sourceId]} clip={c.clip} width={(span.to - span.from) * scale} />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1 pt-4 text-[10px] font-semibold text-white">
                    <span className="truncate">{src?.kind === "cleaned" ? "✨ AI cleaned" : `Clip ${i + 1}`}</span>
                    <span className="font-mono">{formatTime(c.duration, true)}</span>
                  </div>
                  <TrimHandle
                    side="start"
                    label={`Trim start of clip ${i + 1}`}
                    onPointerDown={(e) =>
                      startGesture(e, {
                        kind: "trim",
                        clipId: c.clip.id,
                        edge: "start",
                        x0: e.clientX,
                        start: c.clip.start,
                        end: c.clip.end,
                        max: src?.duration ?? c.clip.end,
                      })
                    }
                  />
                  <TrimHandle
                    side="end"
                    label={`Trim end of clip ${i + 1}`}
                    onPointerDown={(e) =>
                      startGesture(e, {
                        kind: "trim",
                        clipId: c.clip.id,
                        edge: "end",
                        x0: e.clientX,
                        start: c.clip.start,
                        end: c.clip.end,
                        max: src?.duration ?? c.clip.end,
                      })
                    }
                  />
                </div>
              );
            })}

            {drag && drag.target !== drag.index && (
              <div
                className="pointer-events-none absolute -top-1 z-30 h-[calc(100%+8px)] w-1 rounded bg-accent-2 shadow-[0_0_10px_rgba(34,211,238,0.8)]"
                style={{ left: drag.markerX - 2 }}
              />
            )}

            {/* Transition points between clips */}
            {lay.clips.slice(0, -1).map((c, i) => {
              const x = xOf(clipVisualSpan(lay, i).to);
              const t = c.clip.transition;
              const selected = selection?.kind === "transition" && selection.clipId === c.clip.id;
              return (
                <button
                  key={`tr-${c.clip.id}`}
                  type="button"
                  title={t ? `${TRANSITION_LABELS[t.type].label} · ${c.transitionOut.toFixed(1)}s` : "Add transition"}
                  aria-label={t ? `Transition: ${TRANSITION_LABELS[t.type].label}` : `Add transition after clip ${i + 1}`}
                  className={`absolute top-1/2 z-20 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 rotate-45 items-center justify-center rounded-md border-2 text-[10px] font-bold shadow transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
                    selected
                      ? "border-accent-2 bg-accent-2 text-black"
                      : t
                        ? "border-white bg-accent text-white"
                        : "border-border bg-surface text-muted opacity-70 hover:opacity-100"
                  }`}
                  style={{ left: x }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => props.onSelect({ kind: "transition", clipId: c.clip.id })}
                >
                  <span className="-rotate-45">{t ? "⇄" : "+"}</span>
                </button>
              );
            })}
          </div>

          {/* Sticker track */}
          <div
            className="relative mt-2 border-t border-dashed border-border/70 pt-1"
            style={{ height: lanes.count * LANE_H + 6 }}
          >
            {stickers.length === 0 && (
              <span className="sticky left-2 top-2 inline-block px-2 pt-1 text-[11px] text-muted">
                Stickers appear here
              </span>
            )}
            {stickers.map((s) => {
              const def = getStickerDef(s.stickerId);
              const selected = selection?.kind === "sticker" && selection.id === s.id;
              const thumb = def ? stickerThumbSrc(def) : null;
              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Sticker ${def?.label ?? ""}, ${formatTime(s.start, true)} to ${formatTime(s.end, true)}`}
                  aria-pressed={selected}
                  className={`absolute flex cursor-grab items-center gap-1 overflow-hidden rounded-md border px-1.5 text-[10px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
                    selected ? "z-10 border-accent-2 bg-accent-2/30 text-foreground" : "border-accent/40 bg-accent/20 text-foreground hover:border-accent"
                  }`}
                  style={{
                    left: xOf(s.start),
                    width: Math.max(10, (s.end - s.start) * scale),
                    top: 4 + lanes.lane[s.id] * LANE_H,
                    height: LANE_H - 6,
                  }}
                  onPointerDown={(e) => {
                    props.onSelect({ kind: "sticker", id: s.id });
                    const now = clock.get();
                    if (now < s.start || now >= s.end) props.onSeek(s.start);
                    startGesture(e, { kind: "sticker", id: s.id, mode: "move", x0: e.clientX, start: s.start, end: s.end });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      props.onSelect({ kind: "sticker", id: s.id });
                    }
                  }}
                >
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-4 w-4 shrink-0 object-contain" draggable={false} />
                  ) : (
                    <span className="shrink-0">{def?.kind === "emoji" ? def.char : "★"}</span>
                  )}
                  <span className="truncate">{def?.label}</span>
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-accent-2/60"
                    onPointerDown={(e) => {
                      props.onSelect({ kind: "sticker", id: s.id });
                      startGesture(e, { kind: "sticker", id: s.id, mode: "start", x0: e.clientX, start: s.start, end: s.end });
                    }}
                  />
                  <span
                    aria-hidden
                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-accent-2/60"
                    onPointerDown={(e) => {
                      props.onSelect({ kind: "sticker", id: s.id });
                      startGesture(e, { kind: "sticker", id: s.id, mode: "end", x0: e.clientX, start: s.start, end: s.end });
                    }}
                  />
                </div>
              );
            })}
          </div>

          <Playhead clock={clock} xOf={xOf} scroller={scroller} follow={playing} />
        </div>
      </div>

      {trimLabel && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 font-mono text-[11px] text-background shadow-lg"
          style={{ left: trimLabel.x, bottom: 24 }}
          role="status"
        >
          {trimLabel.text}
        </div>
      )}
    </div>
  );
}

function TrimHandle({
  side,
  label,
  onPointerDown,
}: {
  side: "start" | "end";
  label: string;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <span
      aria-hidden
      title={label}
      className={`absolute inset-y-0 ${side === "start" ? "left-0 rounded-l-md" : "right-0 rounded-r-md"} z-10 flex w-3 cursor-ew-resize touch-none items-center justify-center bg-white/0 transition group-hover:bg-white/85 group-aria-pressed:bg-accent-2`}
      onPointerDown={onPointerDown}
    >
      <span className="h-5 w-0.5 rounded bg-black/50" />
    </span>
  );
}

function ClipThumbs({ strip, clip, width }: { strip?: ThumbnailStrip; clip: Clip; width: number }) {
  if (!strip || strip.urls.length === 0) {
    return <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-surface-3 to-surface-2" />;
  }
  const tileW = 64 * (16 / 9);
  const tiles = Math.max(1, Math.ceil(width / tileW));
  const duration = clip.end - clip.start;
  return (
    <div className="pointer-events-none absolute inset-0 flex">
      {Array.from({ length: tiles }, (_, k) => {
        const t = clip.start + ((k + 0.5) / tiles) * duration;
        const idx = Math.min(strip.urls.length - 1, Math.max(0, Math.floor(t / strip.interval)));
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={k} src={strip.urls[idx]} alt="" className="h-full shrink-0 object-cover" style={{ width: tileW }} draggable={false} />
        );
      })}
    </div>
  );
}

function Playhead({
  clock,
  xOf,
  scroller,
  follow,
}: {
  clock: Clock;
  xOf: (t: number) => number;
  scroller: React.RefObject<HTMLDivElement | null>;
  follow: boolean;
}) {
  const t = useClockTime(clock);
  const x = xOf(t);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el: HTMLDivElement | null = scroller.current;
    if (!follow || !el) return;
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft) {
      el.scrollTo({ left: Math.max(0, x - 60) });
    }
  }, [x, follow, scroller]);

  return (
    <div className="pointer-events-none absolute inset-y-0 z-30 w-0" style={{ left: x }}>
      <div className="absolute -left-[6px] top-0 h-3 w-3 rotate-45 rounded-sm bg-rose-500" />
      <div className="absolute -left-px top-1 h-full w-0.5 bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)]" />
    </div>
  );
}

function TimeReadout({ clock }: { clock: Clock }) {
  const t = useClockTime(clock);
  return <>{formatTime(t, true)}</>;
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-7 min-w-7 items-center justify-center rounded-md text-muted hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
    >
      {children}
    </button>
  );
}
