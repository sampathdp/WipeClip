"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Clock } from "@/lib/editor/clock";
import { DIP_AUDIO, locate, type Layout } from "@/lib/editor/timeline";
import type { MediaSource } from "@/lib/editor/types";

interface Need {
  index: number;
  time: number;
  role: "primary" | "incoming";
}

/** Plays the timeline, not a file. Two <video> elements take turns: clip i
 * always plays in slot i % 2, so while one clip plays the other slot is
 * already parked on the next clip's first frame (instant cut), and during a
 * transition both slots are on screen and composited with the same
 * geometry/opacity curve the export's xfade uses.
 *
 * Timing: while playing, the on-screen clip's own currentTime drives the
 * playhead (so picture and sound can't drift from it); time only falls back
 * to the wall clock when that element can't report (ended, seeking). If a
 * needed element is still buffering, the playhead holds instead of
 * running ahead of the picture.
 */
export default function PreviewPlayer({
  lay,
  sources,
  aspect,
  clock,
  playing,
  onEnded,
  rate,
  volume,
  muted,
  stageRef,
  children,
}: {
  lay: Layout;
  sources: Record<string, MediaSource>;
  aspect: { width: number; height: number };
  clock: Clock;
  playing: boolean;
  onEnded: () => void;
  rate: number;
  volume: number;
  muted: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  children?: ReactNode;
}) {
  const slotA = useRef<HTMLVideoElement>(null);
  const slotB = useRef<HTMLVideoElement>(null);
  const dipRef = useRef<HTMLDivElement>(null);
  const state = useRef({ lay, sources, playing, rate, volume, muted, onEnded });
  const playPending = useRef([false, false]);
  const outerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  // Letterbox the stage into whatever space the layout gives the preview,
  // keeping the source's exact aspect ratio (9:16, 1:1, 16:9, ...).
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ar = aspect.width / aspect.height;
    const fit = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (!cw || !ch) return;
      const width = Math.min(cw, ch * ar);
      setBox({ width: Math.floor(width), height: Math.floor(width / ar) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect.width, aspect.height]);

  useEffect(() => {
    state.current = { lay, sources, playing, rate, volume, muted, onEnded };
  }, [lay, sources, playing, rate, volume, muted, onEnded]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const ensureSrc = (el: HTMLVideoElement, url: string) => {
      if (el.dataset.src !== url) {
        el.dataset.src = url;
        el.src = url;
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const { lay, sources, playing, rate, volume, muted, onEnded } = state.current;
      const els = [slotA.current, slotB.current];
      if (!els[0] || !els[1] || lay.clips.length === 0) {
        raf = requestAnimationFrame(tick);
        return;
      }

      let t = clock.get();
      if (t > lay.total) t = lay.total;
      const loc = locate(lay, t);
      const needs: (Need | null)[] = [null, null];
      if (loc) {
        needs[loc.primary.index % 2] = { index: loc.primary.index, time: loc.primary.sourceTime, role: "primary" };
        if (loc.incoming) {
          needs[loc.incoming.index % 2] = { index: loc.incoming.index, time: loc.incoming.sourceTime, role: "incoming" };
        }
      }

      let stalled = false;
      for (let slot = 0; slot < 2; slot++) {
        const el = els[slot]!;
        const need = needs[slot];
        el.playbackRate = rate;
        if (need) {
          const clip = lay.clips[need.index].clip;
          const src = sources[clip.sourceId];
          if (!src) continue;
          ensureSrc(el, src.url);
          const drift = Math.abs(el.currentTime - need.time);
          // The primary drives the clock while playing, so it's only
          // re-seeked on a real jump (scrub, clip switch); the incoming
          // clip is kept within a quarter second of it.
          const tolerance = playing ? (need.role === "primary" ? 0.5 : 0.25) : 0.03;
          if (el.readyState >= 1 && !el.seeking && drift > tolerance && !el.ended) {
            el.currentTime = need.time;
          }
          if (playing && !el.ended && (el.seeking || el.readyState < 3)) stalled = true;
        } else {
          if (!el.paused) el.pause();
          // Park on the next clip's first frame so the cut is instant.
          const nextIndex = loc && !loc.incoming ? loc.primary.index + 1 : -1;
          const next = nextIndex >= 0 && nextIndex % 2 === slot ? lay.clips[nextIndex] : undefined;
          const nextSrc = next ? sources[next.clip.sourceId] : undefined;
          if (next && nextSrc) {
            ensureSrc(el, nextSrc.url);
            if (el.readyState >= 1 && !el.seeking && Math.abs(el.currentTime - next.clip.start) > 0.03) {
              el.currentTime = next.clip.start;
            }
          }
        }
      }

      if (playing && !stalled && loc) {
        const primaryEl = els[loc.primary.index % 2]!;
        const clipLay = lay.clips[loc.primary.index];
        const wall = t + dt * rate;
        const fromElement = clipLay.start + (primaryEl.currentTime - clipLay.clip.start);
        const elementUsable = !primaryEl.paused && !primaryEl.seeking && !primaryEl.ended;
        t = elementUsable && Math.abs(fromElement - wall) < 0.3 ? Math.max(t, fromElement) : wall;
        if (t >= lay.total) {
          t = lay.total;
          onEnded();
        }
      }

      for (let slot = 0; slot < 2; slot++) {
        const el = els[slot]!;
        const need = needs[slot];
        if (need && playing && !stalled && !el.ended) {
          if (el.paused && !playPending.current[slot]) {
            playPending.current[slot] = true;
            el.play()
              .catch(() => {})
              .finally(() => {
                playPending.current[slot] = false;
              });
          }
        } else if (!el.paused) {
          el.pause();
        }
      }

      applyComposite(els as HTMLVideoElement[], needs, loc, dipRef.current, volume, muted);
      clock.set(t);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clock]);

  useEffect(() => {
    const els = [slotA.current, slotB.current];
    return () => {
      for (const el of els) {
        if (!el) continue;
        el.pause();
        el.removeAttribute("src");
        el.load();
      }
    };
  }, []);

  return (
    <div ref={outerRef} className="flex h-full w-full items-center justify-center">
      <div
        ref={stageRef}
        className="relative overflow-hidden rounded-xl bg-black shadow-lg ring-1 ring-border"
        style={box ?? { width: 0, height: 0 }}
      >
        <video
          ref={slotA}
          playsInline
          preload="auto"
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          style={{ visibility: "hidden" }}
          aria-hidden
        />
        <video
          ref={slotB}
          playsInline
          preload="auto"
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          style={{ visibility: "hidden" }}
          aria-hidden
        />
        <div ref={dipRef} className="pointer-events-none absolute inset-0" style={{ opacity: 0 }} />
        {children}
      </div>
    </div>
  );
}

const smooth = (p: number) => p * p * (3 - 2 * p);

function applyComposite(
  els: HTMLVideoElement[],
  needs: (Need | null)[],
  loc: ReturnType<typeof locate>,
  dip: HTMLDivElement | null,
  volume: number,
  muted: boolean
) {
  const reset = (el: HTMLVideoElement, visible: boolean, z: number) => {
    el.style.visibility = visible ? "visible" : "hidden";
    el.style.opacity = "1";
    el.style.transform = "";
    el.style.filter = "";
    el.style.zIndex = String(z);
  };
  const setVolume = (el: HTMLVideoElement, factor: number) => {
    el.muted = muted;
    el.volume = Math.min(1, Math.max(0, volume * factor));
  };

  if (dip) dip.style.opacity = "0";
  for (let slot = 0; slot < 2; slot++) {
    reset(els[slot], needs[slot] !== null, needs[slot]?.role === "incoming" ? 2 : 1);
  }
  if (!loc) return;

  const out = els[loc.primary.index % 2];
  if (!loc.incoming) {
    setVolume(out, 1);
    return;
  }
  const inc = els[loc.incoming.index % 2];
  const p = Math.min(1, Math.max(0, loc.incoming.progress));
  const dipAudio = DIP_AUDIO.has(loc.incoming.type);
  setVolume(out, dipAudio ? Math.max(0, 1 - 2 * p) : 1 - p);
  setVolume(inc, dipAudio ? Math.max(0, 2 * p - 1) : p);

  switch (loc.incoming.type) {
    case "fade":
    case "crossfade":
      inc.style.opacity = String(p);
      break;
    case "dipblack":
    case "dipwhite":
      // Out to the color over the first half, in from it over the second.
      if (dip) {
        dip.style.background = loc.incoming.type === "dipblack" ? "#000" : "#fff";
        dip.style.opacity = String(1 - Math.abs(1 - 2 * p));
        dip.style.zIndex = "3";
      }
      (p < 0.5 ? inc : out).style.visibility = "hidden";
      break;
    case "slideleft":
      out.style.transform = `translateX(${-p * 100}%)`;
      inc.style.transform = `translateX(${(1 - p) * 100}%)`;
      break;
    case "slideright":
      out.style.transform = `translateX(${p * 100}%)`;
      inc.style.transform = `translateX(${-(1 - p) * 100}%)`;
      break;
    case "zoom":
      out.style.transform = `scale(${1 + p})`;
      inc.style.opacity = String(smooth(p));
      break;
    case "blur": {
      const blur = `blur(${(Math.sin(p * Math.PI) * 10).toFixed(2)}px)`;
      out.style.filter = blur;
      inc.style.filter = blur;
      inc.style.opacity = String(p);
      break;
    }
  }
}
