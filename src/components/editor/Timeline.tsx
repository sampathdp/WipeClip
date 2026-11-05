"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useClockTime, type Clock } from "@/lib/editor/clock";
import type { ThumbnailStrip, Waveform } from "@/lib/editor/media";
import {
  MAX_FREEZE_SECONDS,
  MAX_REVERSE_SECONDS,
  MIN_CLIP_SECONDS,
  TRANSITION_LABELS,
  clipVisualSpan,
  formatTime,
  type Layout,
} from "@/lib/editor/timeline";
import type { Clip, MediaSource, Selection } from "@/lib/editor/types";
import { ZoomInIcon, ZoomOutIcon } from "./icons";
import { effectiveSpeed } from "@/lib/editor/speed";

const PAD = 16; // px before t=0 so the first trim handle is reachable
const GUTTER = 120; // sticky label column on the left of every row
const CLIP_H = 64;
const LANE_H = 30;
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
const SNAP_PX = 8; // edges within this many pixels of a target stick to it

type Gesture =
  | {
      kind: "trim";
      clipId: string;
      edge: "start" | "end";
      x0: number;
      start: number;
      end: number;
      min: number; // bounds for source start / end
      max: number;
      tlStart: number; // timeline time the clip starts
      speed: number;
      reverse: boolean;
      targets: number[];
    }
  | { kind: "reorder"; index: number; x0: number; active: boolean }
  | { kind: "item"; track: string; id: string; mode: ItemMode; x0: number; start: number; end: number; targets: number[] }
  | { kind: "seek" };

export type ItemMode = "move" | "start" | "end";

/** Which part of a source's audio an item plays, for drawing its waveform. */
export interface WaveSlice {
  sourceId: string;
  offset: number; // source seconds
  duration: number;
  gain: number; // volume, 0 = muted
}

export interface TrackItem {
  id: string;
  start: number;
  end: number;
  label: string;
  thumb?: string | null;
  glyph?: string;
  wave?: WaveSlice;
  hidden?: boolean;
  locked?: boolean;
  selected: boolean;
  sel: Selection;
}

/** Content-pixel range worth drawing: the visible part of the timeline
 * plus a viewport of margin each side. Thumbnails and waveforms outside it
 * are skipped so zooming far in stays cheap. */
interface ViewRange {
  from: number;
  to: number;
}

/** A whole-track switch in the row header; `on` = every item has it. */
export interface TrackToggle {
  /** group: show a track's many items (auto captions) as one block. */
  kind: "hide" | "lock" | "mute" | "group";
  on: boolean;
}

/** A layer track (text, elements, audio, effects) - same lanes, bars and
 * drag/trim gestures for every kind of timed item. */
export interface TimelineTrack {
  key: string;
  label: string;
  tone: string; // bar color classes
  items: TrackItem[];
  /** Thin markers drawn behind the items (e.g. recorded clicks); `snap`
   * ones (music beats) are also snap targets. */
  ticks?: { t: number; className: string; title?: string; snap?: boolean }[];
  toggles?: TrackToggle[];
  /** Shows a delete-track button in the row header (onTrackDelete). */
  deletable?: boolean;
}

// Layer item widths in pixels (TrackRow).
const MIN_ITEM_W = 4;
const COMPACT_ITEM_W = 40;
const TINY_ITEM_W = 16;

/** Greedy lane packing so overlapping items stack instead of hiding each other. */
function laneLayout(items: TrackItem[]) {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const laneEnds: number[] = [];
  const lane: Record<string, number> = {};
  for (const it of sorted) {
    let i = laneEnds.findIndex((end) => end <= it.start + 1e-3);
    if (i < 0) {
      i = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[i] = it.end;
    lane[it.id] = i;
  }
  return { lane, count: Math.max(1, laneEnds.length) };
}

interface Props {
  lay: Layout;
  sources: Record<string, MediaSource>;
  thumbnails: Record<string, ThumbnailStrip>;
  waveforms: Record<string, Waveform>;
  tracks: TimelineTrack[];
  selection: Selection;
  clock: Clock;
  playing: boolean;
  onSelect: (s: Selection) => void;
  onSeek: (t: number) => void;
  onClipChange: (clipId: string, patch: Partial<Clip>) => void;
  /** New [start, end] for a dragged/trimmed item; the editor maps it onto the item. */
  onItemChange: (track: string, id: string, mode: ItemMode, start: number, end: number) => void;
  onMoveClip: (from: number, to: number) => void;
  onTrackToggle?: (track: string, kind: TrackToggle["kind"]) => void;
  /** Removes every item on a track. */
  onTrackDelete?: (track: string) => void;
  /** Edit buttons shown in the header row in place of the time readout. */
  actions?: React.ReactNode;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}

export default function Timeline(props: Props) {
  const { lay, sources, thumbnails, waveforms, selection, clock, playing } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState<number | null>(null); // pixels per second
  const [viewWidth, setViewWidth] = useState(800);
  const [view, setView] = useState<ViewRange>({ from: -800, to: 2400 });
  const gesture = useRef<Gesture | null>(null);
  const [drag, setDrag] = useState<{ index: number; dx: number; target: number; markerX: number } | null>(null);
  const [trimLabel, setTrimLabel] = useState<{ x: number; text: string } | null>(null);
  const [snapOn, setSnapOn] = useState(true);
  const [snapAt, setSnapAt] = useState<number | null>(null); // timeline time of the active snap guide

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Snapped to half-viewport steps so scrolling only re-renders when the
    // drawn range has to move.
    const update = () => {
      const w = el.clientWidth;
      const q = Math.max(200, Math.round(w / 2));
      const left = Math.floor(el.scrollLeft / q) * q;
      const from = left - w;
      const to = left + 2 * w + q;
      setView((v) => (v.from === from && v.to === to ? v : { from, to }));
    };
    const ro = new ResizeObserver(() => {
      setViewWidth(el.clientWidth);
      update();
    });
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, []);

  // Mark the items under the playhead. Done on the DOM from the clock so
  // playback doesn't re-render the timeline every frame; re-run after each
  // render to pick up added or moved items.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const mark = () => {
      const t = clock.get();
      el.querySelectorAll<HTMLElement>("[data-span]").forEach((n) => {
        const [s, e] = n.dataset.span!.split(" ").map(Number);
        n.toggleAttribute("data-live", t >= s && t < e);
      });
    };
    mark();
    return clock.subscribe(mark);
  });

  const fitPps = Math.max(4, (viewWidth - GUTTER - PAD * 2) / Math.max(1, lay.total));
  const scale = pps ?? fitPps;
  const width = GUTTER + lay.total * scale + PAD * 2;
  const xOf = (t: number) => GUTTER + PAD + t * scale;
  const tOf = (clientX: number) => {
    const r = scroller.current!.getBoundingClientRect();
    return Math.min(lay.total, Math.max(0, (clientX - r.left + scroller.current!.scrollLeft - GUTTER - PAD) / scale));
  };

  // Time that stays put on screen across a zoom: under the cursor for the
  // wheel, else the playhead when it's in view, else the middle of the view.
  const zoomAnchor = useRef<{ t: number; px: number } | null>(null);
  const zoom = (factor: number, clientX?: number) => {
    const el = scroller.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const head = xOf(clock.get()) - el.scrollLeft;
      const px = clientX !== undefined ? clientX - r.left : head >= GUTTER && head <= el.clientWidth ? head : (GUTTER + el.clientWidth) / 2;
      zoomAnchor.current = { t: tOf(r.left + px), px };
    }
    setPps((p) => Math.min(400, Math.max(fitPps, (p ?? fitPps) * factor)));
  };
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const el = scroller.current;
    zoomAnchor.current = null;
    if (a && el) el.scrollLeft = Math.max(0, GUTTER + PAD + a.t * scale - a.px);
  }, [scale]);

  const tickStep = TICK_STEPS.find((s) => s * scale >= 70) ?? 600;
  const ticks: number[] = [];
  for (let t = 0; t <= lay.total + 1e-6; t += tickStep) ticks.push(t);

  /** Times an edge can snap to: playhead, timeline ends, clip boundaries
   * and every layer item except the one being dragged. `clipsBefore` keeps
   * only boundaries up to that clip's start - a trim ripples everything after it.
   */
  const snapTargets = (exclude?: string, clipsBefore = lay.clips.length) => {
    const ts = [0, clock.get()];
    if (clipsBefore === lay.clips.length) ts.push(lay.total);
    for (let i = 0; i < clipsBefore; i++) {
      const span = clipVisualSpan(lay, i);
      ts.push(span.from, span.to);
    }
    if (clipsBefore < lay.clips.length) ts.push(clipVisualSpan(lay, clipsBefore).from);
    for (const track of props.tracks) for (const it of track.items) if (it.id !== exclude) ts.push(it.start, it.end);
    for (const track of props.tracks) for (const tk of track.ticks ?? []) if (tk.snap) ts.push(tk.t);
    return ts;
  };

  /** Closest target within SNAP_PX of any of `edges`, as the shift to apply
   * (none while Alt is held or snapping is off). Also moves the snap guide. */
  const snapShift = (e: React.PointerEvent, targets: number[], edges: number[]) => {
    let best: { d: number; at: number } | null = null;
    if (snapOn && !e.altKey) {
      for (const edge of edges)
        for (const t of targets) {
          const d = t - edge;
          if (Math.abs(d) * scale <= SNAP_PX && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
        }
    }
    setSnapAt(best?.at ?? null);
    return best?.d ?? 0;
  };

  const startGesture = (e: React.PointerEvent, g: Gesture) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = g;
    if (g.kind === "trim" || g.kind === "item") props.onGestureStart();
  };

  const rowHandlers = {
    rowDown: (e: React.PointerEvent) => {
      startGesture(e, { kind: "seek" });
      props.onSeek(tOf(e.clientX));
    },
    itemDown: (e: React.PointerEvent, track: string, it: TrackItem, mode: ItemMode) => {
      props.onSelect(it.sel);
      if (mode === "move") {
        const now = clock.get();
        if (now < it.start || now >= it.end) props.onSeek(it.start);
        if (it.locked) {
          e.stopPropagation();
          return;
        }
      }
      startGesture(e, { kind: "item", track, id: it.id, mode, x0: e.clientX, start: it.start, end: it.end, targets: snapTargets(it.id) });
    },
    select: (s: Selection) => props.onSelect(s),
    toggle: (track: string, kind: TrackToggle["kind"]) => props.onTrackToggle?.(track, kind),
    remove: (track: string) => props.onTrackDelete?.(track),
  };
  const handlers = useRef(rowHandlers);
  useLayoutEffect(() => {
    handlers.current = rowHandlers;
  });
  const rowApi = useMemo<RowApi>(
    () => ({
      rowDown: (e) => handlers.current.rowDown(e),
      itemDown: (e, track, it, mode) => handlers.current.itemDown(e, track, it, mode),
      select: (s) => handlers.current.select(s),
      toggle: (track, kind) => handlers.current.toggle(track, kind),
      remove: (track) => handlers.current.remove(track),
    }),
    []
  );

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "seek") {
      props.onSeek(tOf(e.clientX));
      return;
    }
    if (g.kind === "trim") {
      const dt = (e.clientX - g.x0) / scale;
      // A reversed clip plays its range backwards: its left handle trims the
      // source end and its right handle the source start.
      const setStart = (start: number) => {
        start = Math.min(g.end - MIN_CLIP_SECONDS, Math.max(g.min, start));
        props.onClipChange(g.clipId, { start });
        return start;
      };
      const setEnd = (end: number) => {
        end = Math.max(g.start + MIN_CLIP_SECONDS, Math.min(g.max, end));
        props.onClipChange(g.clipId, { end });
        return end;
      };
      if (g.edge === "start") {
        const v = g.reverse ? setEnd(g.end - dt) : setStart(g.start + dt);
        setTrimLabel({ x: e.clientX, text: `${g.reverse ? "End" : "Start"} ${formatTime(v, true)}` });
      } else {
        let len = g.end - g.start + dt;
        // Snap the clip's timeline end; source time moves `speed`x as fast.
        len += snapShift(e, g.targets, [g.tlStart + len / g.speed]) * g.speed;
        const v = g.reverse ? setStart(g.end - len) : setEnd(g.start + len);
        const kept = g.reverse ? g.end - v : v - g.start;
        setTrimLabel({ x: e.clientX, text: `${g.reverse ? "Start" : "End"} ${formatTime(v, true)} · ${formatTime(kept, true)} long` });
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
    if (g.kind === "item") {
      const dt = (e.clientX - g.x0) / scale;
      const len = g.end - g.start;
      if (g.mode === "move") {
        let start = g.start + dt;
        start += snapShift(e, g.targets, [start, start + len]);
        start = Math.min(Math.max(0, start), Math.max(0, lay.total - len));
        props.onItemChange(g.track, g.id, "move", start, start + len);
        setTrimLabel({ x: e.clientX, text: `${formatTime(start, true)} → ${formatTime(start + len, true)}` });
      } else if (g.mode === "start") {
        let start = g.start + dt;
        start += snapShift(e, g.targets, [start]);
        start = Math.min(g.end - 0.2, Math.max(0, start));
        props.onItemChange(g.track, g.id, "start", start, g.end);
        setTrimLabel({ x: e.clientX, text: `Starts ${formatTime(start, true)}` });
      } else {
        let end = g.end + dt;
        end += snapShift(e, g.targets, [end]);
        end = Math.max(g.start + 0.2, Math.min(lay.total, end));
        props.onItemChange(g.track, g.id, "end", g.start, end);
        setTrimLabel({ x: e.clientX, text: `Ends ${formatTime(end, true)}` });
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    setTrimLabel(null);
    setSnapAt(null);
    if (!g) return;
    if (g.kind === "trim" || g.kind === "item") props.onGestureEnd();
    if (g.kind === "reorder") {
      if (g.active && drag) {
        if (drag.target !== g.index) props.onMoveClip(g.index, drag.target);
      } else {
        props.onSeek(tOf(e.clientX));
      }
      setDrag(null);
    }
  };

  // Ctrl/Cmd+wheel zooms the timeline. React's wheel listener is passive and
  // can't stop the browser's page zoom, so listen natively (re-bound each
  // render so it always sees the current scale).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted">
        {props.actions ?? (
          <span className="font-mono">
            <TimeReadout clock={clock} /> / {formatTime(lay.total, true)}
          </span>
        )}
        <div className="flex items-center gap-1">
          <IconButton
            label={snapOn ? "Snapping on (hold Alt to bypass)" : "Snapping off"}
            pressed={snapOn}
            onClick={() => setSnapOn((v) => !v)}
          >
            <span className="px-1 text-[11px] font-semibold">Snap</span>
          </IconButton>
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
            <RowGutter label="" />
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 h-full" style={{ left: xOf(t) }}>
                <div className="h-2 w-px bg-muted/50" />
                <span className="absolute left-1 top-1.5 whitespace-nowrap font-mono text-[10px] text-muted">
                  {formatTime(t, tickStep < 1)}
                </span>
              </div>
            ))}
          </div>

          {/* Video track - empty space seeks like the ruler */}
          <div
            className="relative border-b border-border/50"
            style={{ height: CLIP_H + 12 }}
            onPointerDown={(e) => {
              startGesture(e, { kind: "seek" });
              props.onSeek(tOf(e.clientX));
            }}
          >
            <RowGutter label="Video" />
            {lay.clips.map((c, i) => {
              const span = clipVisualSpan(lay, i);
              const src = sources[c.clip.sourceId];
              const selected = selection?.kind === "clip" && selection.id === c.clip.id;
              const dragging = drag?.index === i;
              const frozen = c.clip.freeze !== null;
              // Source bounds a trim may reach: a freeze holds up to
              // MAX_FREEZE_SECONDS; a reversed range is capped in length.
              const srcDur = src?.duration ?? c.clip.end;
              const bounds = frozen
                ? { min: 0, max: c.clip.start + MAX_FREEZE_SECONDS }
                : c.clip.reverse
                  ? { min: Math.max(0, c.clip.end - MAX_REVERSE_SECONDS), max: Math.min(srcDur, c.clip.start + MAX_REVERSE_SECONDS) }
                  : { min: 0, max: srcDur };
              const badges = `${frozen ? " · Freeze" : ""}${c.clip.reverse ? " · Reversed" : ""}`;
              return (
                <div
                  key={c.clip.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Clip ${i + 1}${badges}, ${formatTime(c.clip.start, true)} to ${formatTime(c.clip.end, true)}${src?.kind === "cleaned" ? ", AI cleaned" : ""}`}
                  aria-pressed={selected}
                  className={`group absolute top-1.5 overflow-hidden rounded-lg border-2 bg-surface-3 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-accent-2 ${
                    selected ? "z-10 border-accent-2 shadow-[0_0_0_2px_rgba(34,211,238,0.25)]" : "border-border hover:border-accent/60"
                  } ${dragging ? "z-20 cursor-grabbing opacity-80 shadow-xl" : "cursor-grab"}`}
                  style={{
                    left: xOf(span.from) + 1,
                    width: Math.max(8, (span.to - span.from) * scale - 2),
                    height: CLIP_H,
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
                  <ClipThumbs strip={thumbnails[c.clip.sourceId]} clip={c.clip} width={(span.to - span.from) * scale} x={xOf(span.from) + 1} view={view} />
                  {waveforms[c.clip.sourceId] && !frozen && (
                    <WaveCanvas
                      wave={waveforms[c.clip.sourceId]}
                      offset={c.clip.start}
                      duration={c.clip.end - c.clip.start}
                      gain={c.clip.volume}
                      width={(span.to - span.from) * scale}
                      x={xOf(span.from) + 1}
                      view={view}
                      height={20}
                      mirror={c.clip.reverse}
                      className="bottom-0 text-white/60"
                    />
                  )}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1 pt-4 text-[10px] font-semibold text-white">
                    <span className="truncate">
                      {src?.kind === "cleaned" ? "✨ AI cleaned" : `Clip ${i + 1}`}
                      {badges}
                    </span>
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
                        ...bounds,
                        tlStart: c.start,
                        speed: effectiveSpeed(c.clip),
                        reverse: c.clip.reverse,
                        targets: snapTargets(undefined, i),
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
                        ...bounds,
                        tlStart: c.start,
                        speed: effectiveSpeed(c.clip),
                        reverse: c.clip.reverse,
                        targets: snapTargets(undefined, i),
                      })
                    }
                  />
                </div>
              );
            })}

            {drag && drag.target !== drag.index && (
              <div
                className="pointer-events-none absolute inset-y-0 z-30 w-1 rounded bg-accent-2 shadow-[0_0_10px_rgba(34,211,238,0.8)]"
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

          {/* Layer tracks: text, elements, audio, effects - only those with items */}
          {props.tracks
            .filter((track) => track.items.length > 0)
            .map((track) => (
              <TrackRow key={track.key} track={track} scale={scale} view={view} waveforms={waveforms} api={rowApi} />
            ))}

          {snapAt !== null && (
            <div
              className="pointer-events-none absolute inset-y-0 z-30 w-px bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]"
              style={{ left: xOf(snapAt) }}
            />
          )}

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

/** Row header pinned to the left while the timeline scrolls; covers the
 * playhead and items that scroll under it. */
function RowGutter({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div
      className="sticky left-0 z-40 flex h-full items-center gap-1 border-r border-border/70 bg-surface-2 px-2"
      style={{ width: GUTTER }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="min-w-0 flex-1 truncate text-[9px] font-bold uppercase tracking-wider text-muted" title={label}>
        {label}
      </span>
      {children}
    </div>
  );
}

interface RowApi {
  rowDown: (e: React.PointerEvent) => void;
  itemDown: (e: React.PointerEvent, track: string, it: TrackItem, mode: ItemMode) => void;
  select: (s: Selection) => void;
  toggle: (track: string, kind: TrackToggle["kind"]) => void;
  remove: (track: string) => void;
}

/** One layer track. Memoized: dragging an item on one track doesn't
 * re-render the others. */
const TrackRow = memo(function TrackRow({
  track,
  scale,
  view,
  waveforms,
  api,
}: {
  track: TimelineTrack;
  scale: number;
  view: ViewRange;
  waveforms: Record<string, Waveform>;
  api: RowApi;
}) {
  const xOf = (t: number) => GUTTER + PAD + t * scale;
  const lanes = laneLayout(track.items);
  return (
    <div className="relative border-b border-border/50" style={{ height: lanes.count * LANE_H + 6 }} onPointerDown={api.rowDown}>
      <RowGutter label={track.label}>
        {track.toggles?.map((tg) => (
          <TrackToggleButton key={tg.kind} toggle={tg} track={track.label} onClick={() => api.toggle(track.key, tg.kind)} />
        ))}
        {track.deletable && (
          <button
            type="button"
            title={`Delete all ${track.label.toLowerCase()}`}
            aria-label={`Delete all ${track.label.toLowerCase()}`}
            onClick={() => api.remove(track.key)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] leading-none text-muted opacity-70 hover:bg-red-500/15 hover:text-red-400 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
          >
            ✕
          </button>
        )}
      </RowGutter>
      {track.ticks?.map((tk, i) => (
        <span
          key={i}
          title={tk.title}
          aria-hidden
          className={`pointer-events-none absolute inset-y-1 w-px ${tk.className}`}
          style={{ left: xOf(tk.t) }}
        />
      ))}
      {track.items.map((it) => {
        // Short items (a caption is a second or two) get no icon and less
        // padding, so back-to-back ones read as a row of text, not a pile
        // of overlapping icons; the tiniest also drop their trim handles,
        // which would cover the whole item (zoom in to trim those).
        const w = Math.max(MIN_ITEM_W, (it.end - it.start) * scale);
        const compact = w < COMPACT_ITEM_W;
        const tiny = w < TINY_ITEM_W;
        return (
          <div
            key={it.id}
            role="button"
            tabIndex={0}
            aria-label={`${track.label}: ${it.label}, ${formatTime(it.start, true)} to ${formatTime(it.end, true)}${it.locked ? ", locked" : ""}${it.hidden ? ", hidden" : ""}`}
            aria-pressed={it.selected}
            data-span={`${it.start} ${it.end}`}
            className={`absolute flex items-center gap-1 overflow-hidden border text-[10px] ${compact ? "rounded-sm px-0.5" : "rounded-md px-1.5"} font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
              it.selected ? "z-10 border-accent-2 ring-1 ring-accent-2 text-foreground" : `${track.tone} text-foreground`
            } ${it.hidden ? "opacity-40" : ""} ${it.locked ? "cursor-not-allowed" : "cursor-grab"} data-live:brightness-125 data-live:saturate-150`}
            style={{
              left: xOf(it.start),
              width: w,
              top: 3 + lanes.lane[it.id] * LANE_H,
              height: LANE_H - 6,
            }}
            onPointerDown={(e) => api.itemDown(e, track.key, it, "move")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                api.select(it.sel);
              }
            }}
          >
            {it.wave && waveforms[it.wave.sourceId] && (
              <WaveCanvas
                wave={waveforms[it.wave.sourceId]}
                offset={it.wave.offset}
                duration={it.wave.duration}
                gain={it.wave.gain}
                width={w}
                x={xOf(it.start)}
                view={view}
                height={LANE_H - 8}
                className="top-0 text-foreground/25"
              />
            )}
            {compact ? null : it.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.thumb} alt="" className="h-4 w-4 shrink-0 object-contain" draggable={false} />
            ) : (
              it.glyph && <span className="relative shrink-0">{it.glyph}</span>
            )}
            {!tiny && <span className="relative truncate">{it.label}</span>}
            {it.locked && !compact && (
              <span className="shrink-0" aria-hidden>
                🔒
              </span>
            )}
            {!it.locked && !tiny && (
              <>
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-accent-2/60"
                  onPointerDown={(e) => api.itemDown(e, track.key, it, "start")}
                />
                <span
                  aria-hidden
                  className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-accent-2/60"
                  onPointerDown={(e) => api.itemDown(e, track.key, it, "end")}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
});

const TOGGLE_TEXT = {
  hide: { on: "◌", off: "◉", label: ["Show", "Hide"] },
  lock: { on: "🔒", off: "🔓", label: ["Unlock", "Lock"] },
  mute: { on: "🔇", off: "🔊", label: ["Unmute", "Mute"] },
  group: { on: "▭", off: "⧉", label: ["Show captions separately", "Combine captions into one block"] },
} as const;

function TrackToggleButton({ toggle, track, onClick }: { toggle: TrackToggle; track: string; onClick: () => void }) {
  const t = TOGGLE_TEXT[toggle.kind];
  const label =
    toggle.kind === "group" ? t.label[toggle.on ? 0 : 1] : `${t.label[toggle.on ? 0 : 1]} all ${track.toLowerCase()}`;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={toggle.on}
      onClick={onClick}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] leading-none hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
        toggle.on ? "text-accent-2" : "text-muted opacity-70 hover:opacity-100"
      }`}
    >
      {toggle.on ? t.on : t.off}
    </button>
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

function ClipThumbs({ strip, clip, width, x, view }: { strip?: ThumbnailStrip; clip: Clip; width: number; x: number; view: ViewRange }) {
  if (!strip || strip.urls.length === 0) {
    return <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-surface-3 to-surface-2" />;
  }
  const tileW = 64 * (16 / 9);
  const tiles = Math.max(1, Math.ceil(width / tileW));
  const duration = clip.end - clip.start;
  const k0 = Math.max(0, Math.floor((view.from - x) / tileW));
  const k1 = Math.min(tiles, Math.ceil((view.to - x) / tileW));
  return (
    <div className="pointer-events-none absolute inset-0">
      {Array.from({ length: Math.max(0, k1 - k0) }, (_, j) => {
        const k = k0 + j;
        const f = (k + 0.5) / tiles;
        const t = clip.freeze ?? (clip.reverse ? clip.end - f * duration : clip.start + f * duration);
        const idx = Math.min(strip.urls.length - 1, Math.max(0, Math.floor(t / strip.interval)));
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={k} src={strip.urls[idx]} alt="" className="absolute top-0 h-full object-cover" style={{ left: k * tileW, width: tileW }} draggable={false} />
        );
      })}
    </div>
  );
}

const MAX_WAVE_CANVAS = 8192; // backing pixels; wider clips stretch the bitmap

/** Peak bars for one slice of a source's audio, in the text color of
 * `className`. Bar height follows the item's volume (capped at full). */
function WaveCanvas({
  wave,
  offset,
  duration,
  gain,
  width: fullWidth,
  x,
  view,
  height,
  mirror = false,
  className,
}: {
  wave: Waveform;
  offset: number;
  duration: number;
  gain: number;
  width: number;
  /** Content x of the item's left edge, to clip drawing to `view`. */
  x: number;
  view: ViewRange;
  height: number;
  /** Draw right-to-left (reversed clips). */
  mirror?: boolean;
  className: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Visible slice [a, b) in item pixels and the source range it shows; a
  // mirrored item reads its source right to left.
  const a = Math.max(0, view.from - x);
  const b = Math.min(fullWidth, view.to - x);
  const width = Math.max(0, b - a);
  const f0 = mirror ? 1 - b / fullWidth : a / fullWidth;
  const sliceOffset = offset + f0 * duration;
  const sliceDuration = (width / fullWidth) * duration;
  const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.max(1, Math.min(MAX_WAVE_CANVAS, Math.round(width * dpr)));
  const ph = Math.max(1, Math.round(height * dpr));

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    cv.width = pw;
    cv.height = ph;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, pw, ph);
    ctx.fillStyle = getComputedStyle(cv).color;
    const { peaks, rate } = wave;
    for (let x = 0; x < pw; x++) {
      const i0 = Math.floor((sliceOffset + (x / pw) * sliceDuration) * rate);
      const i1 = Math.max(i0 + 1, Math.ceil((sliceOffset + ((x + 1) / pw) * sliceDuration) * rate));
      let m = 0;
      for (let i = Math.max(0, i0); i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      const h = Math.min(1, m * gain) * ph;
      if (h > 0) ctx.fillRect(x, (ph - h) / 2, 1, Math.max(1, h));
    }
  }, [wave, sliceOffset, sliceDuration, gain, pw, ph]);

  if (width <= 0) return null;

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute ${className}`}
      style={{ left: a, width, height, transform: mirror ? "scaleX(-1)" : undefined }}
    />
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
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + GUTTER) {
      el.scrollTo({ left: Math.max(0, x - GUTTER - 60) });
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

function IconButton({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
        pressed ? "bg-accent-2/15 text-accent-2" : "text-muted"
      }`}
    >
      {children}
    </button>
  );
}
