"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Clock } from "@/lib/editor/clock";
import { gradeOf, isNeutralColor } from "@/lib/editor/look";
import { DIP_AUDIO, locate, sourceTimeAt, videoBox, type Layout } from "@/lib/editor/timeline";
import type { AudioClip, Canvas, Clip, Crop, EffectClip, MediaSource } from "@/lib/editor/types";
import GradeFilter from "./GradeFilter";

interface Need {
  index: number;
  time: number;
  role: "primary" | "incoming";
}

/** Freeze and reversed clips can't use native playback: their slot stays
 * paused and is seeked to each frame instead, with the wall clock driving
 * time. Reversed playback is silent in the preview (the export reverses the
 * sound too). */
const seekDriven = (clip: Clip) => clip.freeze !== null || clip.reverse;

/** Plays the timeline, not a file. Two <video> elements take turns: clip i
 * always plays in slot i % 2, so while one clip plays the other slot is
 * already parked on the next clip's first frame (instant cut), and during a
 * transition both slots are on screen and composited with the same
 * geometry/opacity curve the export's xfade uses.
 *
 * Each slot is placed on the canvas like the export places it (fit/fill
 * box, clip position/scale/rotation/opacity) over the canvas background,
 * graded with an SVG filter built from the same color math the export
 * bakes into its LUT (look.ts), and timed effects are applied to the
 * whole video layer. Added/extracted audio plays from pooled <audio>
 * elements kept in sync with the playhead.
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
  canvas,
  canvasSize,
  effects,
  audio,
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
  canvas: Canvas;
  canvasSize: { width: number; height: number };
  effects: EffectClip[];
  audio: AudioClip[];
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
  const fxRef = useRef<HTMLDivElement>(null);
  const blurBgRef = useRef<HTMLCanvasElement>(null);
  const pixelRef = useRef<HTMLCanvasElement>(null);
  const noiseRef = useRef<HTMLCanvasElement>(null);
  const scanRef = useRef<HTMLDivElement>(null);
  const rgbOffsets = useRef<{ r: SVGFEOffsetElement | null; b: SVGFEOffsetElement | null; g: SVGFEOffsetElement | null }>({ r: null, b: null, g: null });
  const flashRef = useRef<SVGFEComponentTransferElement | null>(null);
  const state = useRef({ lay, sources, canvas, canvasSize, effects, audio, playing, rate, volume, muted, onEnded });
  const playPending = useRef([false, false]);
  const audioPool = useRef(new Map<string, HTMLAudioElement>());
  const outerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    state.current = { lay, sources, canvas, canvasSize, effects, audio, playing, rate, volume, muted, onEnded };
  }, [lay, sources, canvas, canvasSize, effects, audio, playing, rate, volume, muted, onEnded]);

  // Letterbox the stage into whatever space the layout gives the preview,
  // keeping the canvas's exact aspect ratio (9:16, 1:1, 16:9, ...).
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ar = canvasSize.width / canvasSize.height;
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
  }, [canvasSize.width, canvasSize.height]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const pool = audioPool.current;

    const ensureSrc = (el: HTMLMediaElement, url: string) => {
      if (el.dataset.src !== url) {
        el.dataset.src = url;
        el.src = url;
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const { lay, sources, canvas, canvasSize, effects, audio, playing, rate, volume, muted, onEnded } = state.current;
      const els = [slotA.current, slotB.current];
      const stage = fxRef.current;
      if (!els[0] || !els[1] || !stage || lay.clips.length === 0) {
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
        if (need) {
          const clip = lay.clips[need.index].clip;
          const src = sources[clip.sourceId];
          if (!src) continue;
          el.playbackRate = rate * clip.speed;
          ensureSrc(el, src.url);
          const drift = Math.abs(el.currentTime - need.time);
          const driven = seekDriven(clip);
          // The primary drives the clock while playing, so it's only
          // re-seeked on a real jump (scrub, clip switch); the incoming
          // clip is kept within a quarter second of it. Seek-driven slots
          // follow every frame.
          const tolerance = driven ? 0.02 : playing ? (need.role === "primary" ? 0.5 : 0.25) : 0.03;
          if (el.readyState >= 1 && !el.seeking && drift > tolerance && (driven || !el.ended)) {
            el.currentTime = need.time;
          }
          // A seek-driven slot is always mid-seek while playing; holding the
          // playhead for it would freeze playback.
          if (playing && !driven && !el.ended && (el.seeking || el.readyState < 3)) stalled = true;
        } else {
          if (!el.paused) el.pause();
          // Park on the next clip's first frame so the cut is instant.
          const nextIndex = loc && !loc.incoming ? loc.primary.index + 1 : -1;
          const next = nextIndex >= 0 && nextIndex % 2 === slot ? lay.clips[nextIndex] : undefined;
          const nextSrc = next ? sources[next.clip.sourceId] : undefined;
          if (next && nextSrc) {
            ensureSrc(el, nextSrc.url);
            const first = sourceTimeAt(next, next.start);
            if (el.readyState >= 1 && !el.seeking && Math.abs(el.currentTime - first) > 0.03) {
              el.currentTime = first;
            }
          }
        }
      }

      if (playing && !stalled && loc) {
        const primaryEl = els[loc.primary.index % 2]!;
        const clipLay = lay.clips[loc.primary.index];
        const wall = t + dt * rate;
        const fromElement = clipLay.start + (primaryEl.currentTime - clipLay.clip.start) / clipLay.clip.speed;
        const elementUsable = !seekDriven(clipLay.clip) && !primaryEl.paused && !primaryEl.seeking && !primaryEl.ended;
        t = elementUsable && Math.abs(fromElement - wall) < 0.3 ? Math.max(t, fromElement) : wall;
        if (t >= lay.total) {
          t = lay.total;
          onEnded();
        }
      }

      for (let slot = 0; slot < 2; slot++) {
        const el = els[slot]!;
        const need = needs[slot];
        if (need && playing && !stalled && !el.ended && !seekDriven(lay.clips[need.index].clip)) {
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

      const stageW = stage.clientWidth;
      const stageH = stage.clientHeight;
      applyComposite(els as HTMLVideoElement[], needs, loc, lay, sources, canvas, canvasSize, stageW, stageH, dipRef.current, volume, muted);
      drawBlurBackground(
        blurBgRef.current,
        canvas,
        loc ? els[loc.primary.index % 2]! : null,
        loc ? lay.clips[loc.primary.index].clip.crop : null
      );
      applyEffects(effects, t, stage, stageW, stageH, {
        rgb: rgbOffsets.current,
        flash: flashRef.current,
        pixel: pixelRef.current,
        noise: noiseRef.current,
        scan: scanRef.current,
        source: loc ? els[loc.primary.index % 2]! : null,
      });
      syncAudio(pool, audio, sources, t, playing && !stalled, rate, volume, muted, ensureSrc);

      clock.set(t);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      pool.forEach((a) => a.pause());
    };
  }, [clock]);

  useEffect(() => {
    const els = [slotA.current, slotB.current];
    const pool = audioPool.current;
    return () => {
      for (const el of els) {
        if (!el) continue;
        el.pause();
        el.removeAttribute("src");
        el.load();
      }
      pool.forEach((a) => {
        a.pause();
        a.removeAttribute("src");
      });
      pool.clear();
    };
  }, []);

  // One SVG grade filter per graded clip; slots point at the right one.
  const lookFilters = useMemo(() => {
    const seen = new Set<string>();
    return lay.clips
      .map((c) => c.clip)
      .filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return !isNeutralColor(c.look) || c.look.adjust.sharpness > 0;
      });
  }, [lay.clips]);

  const bg = canvas.background;
  const bgImage = bg.type === "image" ? sources[bg.sourceId] : undefined;

  return (
    <div ref={outerRef} className="flex h-full w-full items-center justify-center">
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          {lookFilters.map((c) => (
            <GradeFilter key={c.id} id={`look-${c.id}`} look={c.look} />
          ))}
          <filter id="fx-rgb" colorInterpolationFilters="sRGB" x="-5%" y="-5%" width="110%" height="110%">
            <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r0" />
            <feOffset in="r0" ref={(n) => { rgbOffsets.current.r = n; }} dx="0" dy="0" result="r" />
            <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g0" />
            <feOffset in="g0" ref={(n) => { rgbOffsets.current.g = n; }} dx="0" dy="0" result="g" />
            <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b0" />
            <feOffset in="b0" ref={(n) => { rgbOffsets.current.b = n; }} dx="0" dy="0" result="b" />
            <feBlend in="r" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="b" mode="screen" />
          </filter>
          <filter id="fx-flash" colorInterpolationFilters="sRGB">
            <feComponentTransfer ref={(n) => { flashRef.current = n; }}>
              <feFuncR type="linear" slope="1" intercept="0" />
              <feFuncG type="linear" slope="1" intercept="0" />
              <feFuncB type="linear" slope="1" intercept="0" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
      <div
        ref={stageRef}
        className="relative overflow-hidden rounded-xl bg-black shadow-lg ring-1 ring-border"
        style={box ?? { width: 0, height: 0 }}
      >
        <div ref={fxRef} className="absolute inset-0 overflow-hidden" style={{ transformOrigin: "50% 50%" }}>
          {/* Canvas background */}
          {bg.type === "color" && <div className="absolute inset-0" style={{ background: bg.color }} />}
          {bg.type === "gradient" && (
            <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, ${bg.color}, ${bg.color2})` }} />
          )}
          {bg.type === "blur" && <canvas ref={blurBgRef} width={64} height={64} className="absolute inset-0 h-full w-full scale-110 blur-md" />}
          {bgImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bgImage.url} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
          )}
          <video ref={slotA} playsInline preload="auto" className="pointer-events-none absolute" style={{ visibility: "hidden" }} aria-hidden />
          <video ref={slotB} playsInline preload="auto" className="pointer-events-none absolute" style={{ visibility: "hidden" }} aria-hidden />
          <div ref={dipRef} className="pointer-events-none absolute inset-0" style={{ opacity: 0 }} />
          <canvas ref={pixelRef} className="pointer-events-none absolute inset-0 h-full w-full" style={{ display: "none", imageRendering: "pixelated", zIndex: 4 }} />
          <canvas ref={noiseRef} width={160} height={90} className="pointer-events-none absolute inset-0 h-full w-full" style={{ display: "none", zIndex: 5, mixBlendMode: "overlay" }} />
          <div
            ref={scanRef}
            className="pointer-events-none absolute inset-0"
            style={{ display: "none", zIndex: 6, backgroundImage: "repeating-linear-gradient(to bottom, rgba(0,0,0,0.6) 0 1px, transparent 1px 4px)" }}
          />
        </div>
        {children}
      </div>
    </div>
  );
}

function applyComposite(
  els: HTMLVideoElement[],
  needs: (Need | null)[],
  loc: ReturnType<typeof locate>,
  lay: Layout,
  sources: Record<string, MediaSource>,
  canvas: Canvas,
  canvasSize: { width: number; height: number },
  W: number,
  H: number,
  dip: HTMLDivElement | null,
  volume: number,
  muted: boolean
) {
  const smooth = (p: number) => p * p * (3 - 2 * p);
  const extra: { transform: string; opacity: number; filter: string; visible: boolean; vol: number }[] = [
    { transform: "", opacity: 1, filter: "", visible: true, vol: 1 },
    { transform: "", opacity: 1, filter: "", visible: true, vol: 1 },
  ];
  if (dip) dip.style.opacity = "0";

  if (loc?.incoming) {
    const o = loc.primary.index % 2;
    const n = loc.incoming.index % 2;
    const p = Math.min(1, Math.max(0, loc.incoming.progress));
    const dipAudio = DIP_AUDIO.has(loc.incoming.type);
    extra[o].vol = dipAudio ? Math.max(0, 1 - 2 * p) : 1 - p;
    extra[n].vol = dipAudio ? Math.max(0, 2 * p - 1) : p;
    switch (loc.incoming.type) {
      case "fade":
      case "crossfade":
        extra[n].opacity = p;
        break;
      case "dipblack":
      case "dipwhite":
        // Out to the color over the first half, in from it over the second.
        if (dip) {
          dip.style.background = loc.incoming.type === "dipblack" ? "#000" : "#fff";
          dip.style.opacity = String(1 - Math.abs(1 - 2 * p));
          dip.style.zIndex = "3";
        }
        extra[p < 0.5 ? n : o].visible = false;
        break;
      case "slideleft":
        extra[o].transform = `translateX(${-p * W}px)`;
        extra[n].transform = `translateX(${(1 - p) * W}px)`;
        break;
      case "slideright":
        extra[o].transform = `translateX(${p * W}px)`;
        extra[n].transform = `translateX(${-(1 - p) * W}px)`;
        break;
      case "zoom":
        extra[o].transform = `scale(${1 + p})`;
        extra[n].opacity = smooth(p);
        break;
      case "blur": {
        const b = `blur(${(Math.sin(p * Math.PI) * 10).toFixed(2)}px)`;
        extra[o].filter = b;
        extra[n].filter = b;
        extra[n].opacity = p;
        break;
      }
    }
  }

  for (let slot = 0; slot < 2; slot++) {
    const el = els[slot];
    const need = needs[slot];
    if (!need) {
      el.style.visibility = "hidden";
      continue;
    }
    const clip = lay.clips[need.index].clip;
    const src = sources[clip.sourceId];
    const b = src ? videoBox(clip, src, canvasSize, canvas.fit) : { w: 1, h: 1 };
    const g = gradeOf(clip.look);
    const bw = b.w * W;
    const bh = b.h * H;
    // Crop: the element is the whole frame, sized so the kept part fills the
    // box, then clipped to that part and rotated around its center.
    const c = clip.crop;
    const fw = bw / c.w;
    const fh = bh / c.h;
    el.style.width = `${fw}px`;
    el.style.height = `${fh}px`;
    el.style.left = `${clip.transform.x * W - bw / 2 - c.x * fw}px`;
    el.style.top = `${clip.transform.y * H - bh / 2 - c.y * fh}px`;
    const cropped = c.x > 0 || c.y > 0 || c.w < 1 || c.h < 1;
    const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
    el.style.clipPath = cropped ? `inset(${pct(c.y)} ${pct(1 - c.x - c.w)} ${pct(1 - c.y - c.h)} ${pct(c.x)})` : "";
    el.style.transformOrigin = `${pct(c.x + c.w / 2)} ${pct(c.y + c.h / 2)}`;
    el.style.objectFit = "fill";
    el.style.visibility = extra[slot].visible ? "visible" : "hidden";
    el.style.zIndex = need.role === "incoming" ? "2" : "1";
    el.style.transform = `${extra[slot].transform} rotate(${clip.transform.rotation}deg)`;
    el.style.opacity = String(extra[slot].opacity * g.opacity);
    const filters: string[] = [];
    if (!isNeutralColor(clip.look) || g.sharpness > 0) filters.push(`url(#look-${clip.id})`);
    if (g.blur > 0) filters.push(`blur(${(g.blur * H).toFixed(2)}px)`);
    if (extra[slot].filter) filters.push(extra[slot].filter);
    el.style.filter = filters.join(" ");
    el.muted = muted;
    // HTML media volume can't exceed 1, so >100% clip volume previews at 100%.
    el.volume = Math.min(1, Math.max(0, volume * clip.volume * extra[slot].vol));
  }
}

function drawBlurBackground(c: HTMLCanvasElement | null, canvas: Canvas, src: HTMLVideoElement | null, crop: Crop | null) {
  if (!c || canvas.background.type !== "blur" || !src || src.readyState < 2) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const ar = c.clientWidth / Math.max(1, c.clientHeight) || 1;
  c.width = 64;
  c.height = Math.max(1, Math.round(64 / ar));
  // The clip's cropped frame, cover-fit like the export's scale+crop
  // before its gaussian blur.
  const k = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const sw = src.videoWidth * k.w;
  const sh = src.videoHeight * k.h;
  const vr = sw / Math.max(1, sh);
  const cr = c.width / c.height;
  const w = vr > cr ? c.height * vr : c.width;
  const h = vr > cr ? c.height : c.width / vr;
  ctx.drawImage(src, src.videoWidth * k.x, src.videoHeight * k.y, sw, sh, (c.width - w) / 2, (c.height - h) / 2, w, h);
}

/** Preview counterparts of _effect_filters() in editor.py. Blur, flash,
 * RGB split, shake, zoom and pixelate follow the export's math; grain,
 * noise, VHS and glitch noise are visual approximations of ffmpeg's noise. */
function applyEffects(
  effects: EffectClip[],
  t: number,
  stage: HTMLDivElement,
  W: number,
  H: number,
  nodes: {
    rgb: { r: SVGFEOffsetElement | null; g: SVGFEOffsetElement | null; b: SVGFEOffsetElement | null };
    flash: SVGFEComponentTransferElement | null;
    pixel: HTMLCanvasElement | null;
    noise: HTMLCanvasElement | null;
    scan: HTMLDivElement | null;
    source: HTMLVideoElement | null;
  }
) {
  const filters: string[] = [];
  const transforms: string[] = [];
  let rgb = 0;
  let rgbV = 0;
  let noise = 0;
  let scan = 0;
  let pixel = 0;
  let flash = 0;
  for (const e of effects) {
    if (t < e.start || t >= e.end) continue;
    const k = Math.max(0, Math.min(1, e.intensity / 100));
    switch (e.type) {
      case "blur":
        filters.push(`blur(${(H * (0.004 + 0.02 * k)).toFixed(2)}px)`);
        break;
      case "motionblur":
        filters.push(`blur(${(H * 0.004 * (1 + 2 * k)).toFixed(2)}px)`);
        break;
      case "glitch":
        rgb = Math.max(rgb, 0.006 + 0.02 * k);
        rgbV = Math.max(rgbV, (0.006 + 0.02 * k) / 2);
        noise = Math.max(noise, 0.25 + 0.4 * k);
        break;
      case "vhs":
        rgb = Math.max(rgb, 0.003 + 0.006 * k);
        noise = Math.max(noise, 0.2 + 0.25 * k);
        scan = Math.max(scan, 0.15 + 0.25 * k);
        filters.push(`saturate(${1 + 0.3 * k})`);
        break;
      case "grain":
        noise = Math.max(noise, 0.12 + 0.3 * k);
        break;
      case "noise":
        noise = Math.max(noise, 0.3 + 0.5 * k);
        break;
      case "pixelate":
        pixel = Math.max(pixel, 0.01 + 0.05 * k);
        break;
      case "rgbsplit":
        rgb = Math.max(rgb, 0.004 + 0.016 * k);
        break;
      case "flash": {
        const mid = (e.start + e.end) / 2;
        const half = Math.max(0.01, (e.end - e.start) / 2);
        flash = Math.max(flash, (0.3 + 0.6 * k) * Math.max(0, 1 - Math.abs(t - mid) / half));
        break;
      }
      case "shake": {
        const a = H * (0.008 + 0.03 * k);
        transforms.push(`translate(${(a * Math.sin(t * 41)).toFixed(1)}px, ${(a * Math.cos(t * 37)).toFixed(1)}px)`);
        break;
      }
      case "zoom": {
        const z = 0.1 + 0.4 * k;
        transforms.push(`scale(${1 + z * Math.sin((Math.PI * (t - e.start)) / Math.max(0.01, e.end - e.start))})`);
        break;
      }
    }
  }
  if (rgb > 0) {
    const s = (rgb * H).toFixed(1);
    nodes.rgb.r?.setAttribute("dx", s);
    nodes.rgb.b?.setAttribute("dx", `-${s}`);
    nodes.rgb.g?.setAttribute("dy", (rgbV * H).toFixed(1));
    filters.push("url(#fx-rgb)");
  }
  if (flash > 0) {
    nodes.flash?.querySelectorAll("feFuncR,feFuncG,feFuncB").forEach((f) => f.setAttribute("intercept", flash.toFixed(3)));
    filters.push("url(#fx-flash)");
  }
  stage.style.filter = filters.join(" ");
  stage.style.transform = transforms.join(" ");

  if (nodes.scan) {
    nodes.scan.style.display = scan > 0 ? "block" : "none";
    nodes.scan.style.opacity = String(scan * 1.6);
  }
  const nc = nodes.noise;
  if (nc) {
    nc.style.display = noise > 0 ? "block" : "none";
    if (noise > 0) {
      const ctx = nc.getContext("2d")!;
      const img = ctx.createImageData(nc.width, nc.height);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      nc.style.opacity = String(Math.min(1, noise));
    }
  }
  const pc = nodes.pixel;
  if (pc) {
    const src = nodes.source;
    const on = pixel > 0 && src && src.readyState >= 2;
    pc.style.display = on ? "block" : "none";
    if (on) {
      // Draw the stage's video at 1/p resolution and let CSS scale it up
      // with nearest-neighbour, like ffmpeg's pixelize blocks.
      const p = Math.max(2, pixel * H);
      pc.width = Math.max(1, Math.round(W / p));
      pc.height = Math.max(1, Math.round(H / p));
      const ctx = pc.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      const r = src.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      ctx.clearRect(0, 0, pc.width, pc.height);
      ctx.drawImage(src, ((r.left - s.left) / W) * pc.width, ((r.top - s.top) / H) * pc.height, (r.width / W) * pc.width, (r.height / H) * pc.height);
    }
  }
}

function syncAudio(
  pool: Map<string, HTMLAudioElement>,
  audio: AudioClip[],
  sources: Record<string, MediaSource>,
  t: number,
  playing: boolean,
  rate: number,
  volume: number,
  muted: boolean,
  ensureSrc: (el: HTMLMediaElement, url: string) => void
) {
  const live = new Set<string>();
  for (const a of audio) {
    live.add(a.id);
    const src = sources[a.sourceId];
    if (!src) continue;
    let el = pool.get(a.id);
    if (!el) {
      el = document.createElement("audio");
      el.preload = "auto";
      pool.set(a.id, el);
    }
    ensureSrc(el, src.url);
    const local = t - a.start;
    const inside = local >= 0 && local < a.duration;
    if (!inside) {
      if (!el.paused) el.pause();
      // Pre-seek so it starts on time.
      if (local < 0 && el.readyState >= 1 && !el.seeking && Math.abs(el.currentTime - a.offset) > 0.05) el.currentTime = a.offset;
      continue;
    }
    const want = a.offset + local;
    if (el.readyState >= 1 && !el.seeking && Math.abs(el.currentTime - want) > (playing ? 0.25 : 0.05)) el.currentTime = want;
    const fadeIn = a.fadeIn > 0 ? Math.min(1, local / a.fadeIn) : 1;
    const fadeOut = a.fadeOut > 0 ? Math.min(1, (a.duration - local) / a.fadeOut) : 1;
    el.muted = muted || a.muted;
    el.volume = Math.min(1, Math.max(0, volume * a.volume * fadeIn * fadeOut));
    el.playbackRate = rate;
    if (playing && el.paused) el.play().catch(() => {});
    if (!playing && !el.paused) el.pause();
  }
  for (const [id, el] of pool) {
    if (live.has(id)) continue;
    el.pause();
    el.removeAttribute("src");
    pool.delete(id);
  }
}
