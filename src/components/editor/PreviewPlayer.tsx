"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Clock } from "@/lib/editor/clock";
import { gradeOf, isNeutralColor } from "@/lib/editor/look";
import { DIP_AUDIO, frameShadow, locate, sourceTimeAt, videoBox, type Layout } from "@/lib/editor/timeline";
import { CROP_TRANSITIONS, MASK_WIDTH, SOFT_TRANSITIONS, maskPixels } from "@/lib/editor/xfade";
import type { AudioClip, Canvas, Clip, Crop, EffectClip, MediaSource, Project, TransitionType, VoiceFx } from "@/lib/editor/types";
import { CameraCache, cameraCrop, clipView, evalCamera } from "@/lib/editor/camera";
import { shouldSeek } from "@/lib/editor/mediaSync";
import { appliedZooms } from "@/lib/editor/focusPrefs";
import { PointerCache, pointerScene } from "@/lib/editor/pointer";
import { drawScene } from "@/lib/editor/pointerDraw";
import { drawMasks } from "@/lib/editor/maskDraw";
import { clipKeyTime, clipTransformAt } from "@/lib/editor/keyframes";
import { sourceToLocal, speedAt } from "@/lib/editor/speed";
import { previewMixer, type PreviewMixer } from "@/lib/editor/audioMixer";
import { VIDEO_TRACK, heardWithSolo, masterGainDb, masterOf, playedSourceId, trackGainAt } from "@/lib/editor/mix";
import { dbToGain } from "@/lib/editor/loudness";
import { shapeMaskUrl } from "@/lib/editor/shapeMask";
import { LutRenderer, lutNow } from "@/lib/editor/lut";
import { sourceFile } from "@/lib/editor/sourceFile";
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
  project,
  solo,
  meters = false,
  children,
}: {
  /** Tracks soloed for listening (mix.ts); empty = all heard. */
  solo?: ReadonlySet<string>;
  /** The mixer panel is open: play through Web Audio so it can meter. */
  meters?: boolean;
  /** For focus zooms and the pointer layer (recorded sources). */
  project?: Project;
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
  /** Drop shadows under each slot's video (CanvasFrame.shadow). */
  const shadowA = useRef<HTMLDivElement>(null);
  const shadowB = useRef<HTMLDivElement>(null);
  const dipRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const blurBgRef = useRef<HTMLCanvasElement>(null);
  const pixelRef = useRef<HTMLCanvasElement>(null);
  const noiseRef = useRef<HTMLCanvasElement>(null);
  const scanRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const letterboxRef = useRef<HTMLDivElement>(null);
  const rgbOffsets = useRef<{ r: SVGFEOffsetElement | null; b: SVGFEOffsetElement | null; g: SVGFEOffsetElement | null }>({ r: null, b: null, g: null });
  const flashRef = useRef<SVGFEComponentTransferElement | null>(null);
  const pointerRef = useRef<HTMLCanvasElement>(null);
  const maskWrapRef = useRef<HTMLDivElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const caches = useRef({ camera: new CameraCache(), pointer: new PointerCache() });
  // Per slot: the WebGL canvas that stands in for the video when its clip
  // has an imported LUT (lut.ts).
  const lutRenderers = useRef<(LutRenderer | null)[]>([null, null]);
  const mix = useMemo(() => previewMix(project, audio, lay, solo, meters), [project, audio, lay, solo, meters]);
  const state = useRef({ lay, sources, canvas, canvasSize, effects, audio, playing, rate, volume, muted, onEnded, project, mix });
  const playPending = useRef([false, false]);
  const audioPool = useRef(new Map<string, HTMLAudioElement>());
  const outerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    state.current = { lay, sources, canvas, canvasSize, effects, audio, playing, rate, volume, muted, onEnded, project, mix };
  }, [lay, sources, canvas, canvasSize, effects, audio, playing, rate, volume, muted, onEnded, project, mix]);

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
    const mixer = previewMixer();
    let masterGain = 1;

    const ensureSrc = (el: HTMLMediaElement, url: string) => {
      if (el.dataset.src !== url) {
        el.dataset.src = url;
        el.src = url;
      }
    };

    const step = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const { lay, sources, canvas, canvasSize, effects, audio, playing, rate, volume, muted, onEnded, project, mix } = state.current;
      if (mix.engage && !mixer.engaged) mixer.engage();
      if (mixer.engaged && mix.masterGain !== masterGain) {
        masterGain = mix.masterGain;
        mixer.setMasterGain(masterGain);
      }
      const setLevel = (el: HTMLMediaElement, key: string, level: number, fx: VoiceFx = "none") => playLevel(mixer, el, key, level, muted, fx);
      const els = [slotA.current, slotB.current];
      const stage = fxRef.current;
      if (!els[0] || !els[1] || !stage || lay.clips.length === 0) return;

      let t = clock.get();
      if (t > lay.total) t = lay.total;
      const loc = locate(lay, t);
      // The video slots are cropped (camera window) for this time; the
      // pointer and masks sit on that picture, so they use it too. Drawing
      // them at the clock after it advanced below put the cursor a frame
      // ahead of the zoom while the camera moved.
      const frameT = t;
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
          el.playbackRate = rate * speedAt(clip, need.time - clip.start);
          ensureSrc(el, src.url);
          const driven = seekDriven(clip);
          // The primary drives the clock while playing, so it's only
          // re-seeked on a real jump (scrub, clip switch); the incoming
          // clip is kept within a quarter second of it. Seek-driven slots
          // follow every frame.
          const tolerance = driven ? 0.02 : playing ? (need.role === "primary" ? 0.5 : 0.25) : 0.03;
          // An ended element is seeked back too (mediaSync.ts): leaving it
          // alone froze the preview for good once the playhead had touched
          // the end of the recording.
          if (shouldSeek(el, need.time, tolerance, driven)) el.currentTime = need.time;
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
        const fromElement = clipLay.start + sourceToLocal(clipLay.clip, primaryEl.currentTime - clipLay.clip.start);
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
      // Focus zooms: the camera window is applied as an extra crop, the
      // same geometry the export's zoom chain produces (camera.ts).
      const crops: (Crop | null)[] = needs.map((need) => {
        if (!need) return null;
        const clip = lay.clips[need.index].clip;
        const view = clipView(clip, sources[clip.sourceId], canvasSize, canvas);
        const cam = caches.current.camera.track(project ? appliedZooms(project) : undefined, clip, view);
        return cam ? cameraCrop(clip.crop, evalCamera(cam, need.time)) : clip.crop;
      });
      applyComposite(els as HTMLVideoElement[], [shadowA.current, shadowB.current], needs, crops, loc, lay, sources, canvas, canvasSize, stageW, stageH, dipRef.current, (el, level) => setLevel(el, VIDEO_TRACK, volume * mix.video * level), t);
      for (let slot = 0; slot < 2; slot++) {
        const el = els[slot]!;
        const need = needs[slot];
        const lutRef = need ? lay.clips[need.index].clip.look.lut : undefined;
        const lutSrc = lutRef ? sources[lutRef.sourceId] : undefined;
        const lut = lutRef && lutSrc ? lutNow(lutSrc.id, () => sourceFile(lutSrc)) : null;
        let r = lutRenderers.current[slot];
        if (lut && !r) {
          r = lutRenderers.current[slot] = new LutRenderer();
          r.canvas.className = "pointer-events-none absolute";
          el.after(r.canvas);
        }
        if (r && lut && lutRef && r.render(el, lut, lutRef.intensity / 100)) {
          // Same box, transform, crop and filters as the video, which hides.
          r.canvas.style.cssText = el.style.cssText;
          el.style.opacity = "0";
        } else if (r) {
          r.canvas.style.display = "none";
        }
      }
      drawBlurBackground(blurBgRef.current, canvas, loc ? els[loc.primary.index % 2]! : null, loc ? crops[loc.primary.index % 2] : null);
      if (maskWrapRef.current && maskCanvasRef.current) {
        drawMasks(maskWrapRef.current, maskCanvasRef.current, project?.masks ?? [], frameT, lay, project ?? ({} as Project), sources, canvasSize, caches.current, loc ? els[loc.primary.index % 2]! : null);
      }
      if (pointerRef.current) {
        const scene = project ? pointerScene(lay, project, sources, canvasSize, frameT, caches.current) : { cursor: null, rings: [] };
        drawScene(pointerRef.current, scene, project?.pointer);
      }
      applyEffects(effects, t, stage, stageW, stageH, {
        rgb: rgbOffsets.current,
        flash: flashRef.current,
        pixel: pixelRef.current,
        noise: noiseRef.current,
        scan: scanRef.current,
        vignette: vignetteRef.current,
        letterbox: letterboxRef.current,
        source: loc ? els[loc.primary.index % 2]! : null,
      });
      syncAudio(pool, audio, sources, t, playing && !stalled, rate, (a) => volume * (heardWithSolo(a.id, mix.solo) ? 1 : 0), ensureSrc, setLevel);

      clock.set(t);
    };

    // One frame that throws must not stop the preview for good: the next
    // frame is always scheduled, and the error is reported once.
    let reported = false;
    const tick = (now: number) => {
      try {
        step(now);
      } catch (e) {
        if (!reported) {
          reported = true;
          console.error("[preview] a frame failed", e);
        }
      }
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
        {/* Its own stacking context, so its z-indexed layers stay inside it
            and the masks, pointer and text/stickers stack above in DOM
            order without z-indexes - which lets a layer's blend mode
            (mix-blend-mode) reach the video under it. */}
        <div ref={fxRef} className="absolute inset-0 isolate overflow-hidden" style={{ transformOrigin: "50% 50%" }}>
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
          <div ref={shadowA} className="pointer-events-none absolute" style={{ visibility: "hidden" }} aria-hidden />
          <div ref={shadowB} className="pointer-events-none absolute" style={{ visibility: "hidden" }} aria-hidden />
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
          <div ref={vignetteRef} className="pointer-events-none absolute inset-0" style={{ display: "none", zIndex: 6 }} />
          <div ref={letterboxRef} className="pointer-events-none absolute inset-0 box-border border-x-0 border-solid border-black" style={{ display: "none", zIndex: 6 }} />
        </div>
        {/* Reconstructed cursor and click rings: above the video, not
            moved by timed effects, below text/stickers - same order as the
            export (effects, pointer, overlays). */}
        {/* Privacy masks: over the video and its effects, under the pointer
            and text/stickers - the export order. */}
        <div ref={maskWrapRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <canvas ref={maskCanvasRef} className="absolute inset-0 h-full w-full" />
        </div>
        <canvas ref={pointerRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
        {children}
      </div>
    </div>
  );
}

function applyComposite(
  els: HTMLVideoElement[],
  shadows: (HTMLDivElement | null)[],
  needs: (Need | null)[],
  crops: (Crop | null)[],
  loc: ReturnType<typeof locate>,
  lay: Layout,
  sources: Record<string, MediaSource>,
  canvas: Canvas,
  canvasSize: { width: number; height: number },
  W: number,
  H: number,
  dip: HTMLDivElement | null,
  /** Sets a slot's level (the clip's volume times its transition fade). */
  setLevel: (el: HTMLMediaElement, level: number) => void,
  t: number
) {
  const smooth = (p: number) => p * p * (3 - 2 * p);
  // `mask` is a CSS mask image in stage coordinates (wipes, circles).
  const extra: { transform: string; opacity: number; filter: string; visible: boolean; vol: number; mask: string }[] = [
    { transform: "", opacity: 1, filter: "", visible: true, vol: 1, mask: "" },
    { transform: "", opacity: 1, filter: "", visible: true, vol: 1, mask: "" },
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
      case "slideup":
        extra[o].transform = `translateY(${-p * H}px)`;
        extra[n].transform = `translateY(${(1 - p) * H}px)`;
        break;
      case "slidedown":
        extra[o].transform = `translateY(${p * H}px)`;
        extra[n].transform = `translateY(${-(1 - p) * H}px)`;
        break;
      // Wipes: the hard edge of ffmpeg's xfade wipes, sweeping in the
      // named direction.
      case "wipeleft":
        extra[n].mask = `linear-gradient(to right, transparent ${(1 - p) * 100}%, #000 ${(1 - p) * 100}%)`;
        break;
      case "wiperight":
        extra[n].mask = `linear-gradient(to right, #000 ${p * 100}%, transparent ${p * 100}%)`;
        break;
      case "wipeup":
        extra[n].mask = `linear-gradient(to bottom, transparent ${(1 - p) * 100}%, #000 ${(1 - p) * 100}%)`;
        break;
      case "wipedown":
        extra[n].mask = `linear-gradient(to bottom, #000 ${p * 100}%, transparent ${p * 100}%)`;
        break;
      // xfade's circles: a soft ring one half-diagonal (z) wide, centered on
      // the canvas, that sweeps across the frame during the middle third.
      case "circleopen":
      case "circleclose": {
        const z = Math.hypot(W / 2, H / 2);
        const open = loc.incoming.type === "circleopen";
        const r0 = Math.max(0, (open ? 3 * p - 1.5 : 1.5 - 3 * p) * z);
        const r1 = Math.max(r0 + 0.01, (open ? 3 * p - 0.5 : 2.5 - 3 * p) * z);
        const [a, b] = open ? ["#000", "transparent"] : ["transparent", "#000"];
        extra[n].mask = `radial-gradient(circle at 50% 50%, ${a} ${r0.toFixed(1)}px, ${b} ${r1.toFixed(1)}px)`;
        break;
      }
      // Color drains to gray on the way out and comes back on the way in.
      case "fadegrays": {
        const s = (v: number) => {
          const k = Math.min(1, Math.max(0, v));
          return k * k * (3 - 2 * k);
        };
        extra[o].filter = `grayscale(${(1 - s((0.5 - p) * 2)).toFixed(3)})`;
        extra[n].filter = `grayscale(${(1 - s(2 - 2 * p)).toFixed(3)})`;
        extra[n].opacity = p;
        break;
      }
      default: {
        // Per-pixel transitions (xfade.ts): soft sweeps over the outgoing
        // clip; crops show one clip inside a shape, black around it.
        const type = loc.incoming.type;
        if (SOFT_TRANSITIONS.has(type)) {
          extra[n].mask = transitionMaskUrl(type, p, W, H);
        } else if (CROP_TRANSITIONS.has(type)) {
          const shown = p < 0.5 ? o : n;
          extra[shown === o ? n : o].visible = false;
          extra[shown].mask = transitionMaskUrl(type, p, W, H);
          if (dip) {
            dip.style.background = "#000";
            dip.style.opacity = "1";
            dip.style.zIndex = "0";
          }
        }
      }
    }
  }

  for (let slot = 0; slot < 2; slot++) {
    const el = els[slot];
    const sh = shadows[slot];
    const need = needs[slot];
    if (!need) {
      el.style.visibility = "hidden";
      if (sh) sh.style.visibility = "hidden";
      continue;
    }
    const laid = lay.clips[need.index];
    // Keyframed clips: this frame's transform stands in for the static one.
    const clip = laid.clip.keyframes?.length ? { ...laid.clip, transform: clipTransformAt(laid.clip, clipKeyTime(laid, t)) } : laid.clip;
    const src = sources[clip.sourceId];
    const b = src ? videoBox(clip, src, canvasSize, canvas) : { w: 1, h: 1 };
    const g = gradeOf(clip.look);
    const bw = b.w * W;
    const bh = b.h * H;
    // Crop: the element is the whole frame, sized so the kept part fills the
    // box, then clipped to that part and rotated around its center.
    const c = crops[slot] ?? clip.crop;
    const fw = bw / c.w;
    const fh = bh / c.h;
    // The element is larger than the stage whenever part of the frame is
    // cropped away (crop, recording region, focus zoom); the stylesheet's
    // video { max-width: 100% } would squash it.
    el.style.maxWidth = "none";
    el.style.maxHeight = "none";
    el.style.width = `${fw}px`;
    el.style.height = `${fh}px`;
    const left = clip.transform.x * W - bw / 2 - c.x * fw;
    const top = clip.transform.y * H - bh / 2 - c.y * fh;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    // A transition mask covers the whole stage, shifted onto the element
    // (the clip's own rotation isn't undone - close enough for a wipe).
    // The clip's shape mask covers its box: the kept part of the frame.
    const shape = clip.mask ? shapeMaskUrl(clip.mask, bw / Math.max(1, bh)) : "";
    setMask(el, extra[slot].mask, W, H, left, top, shape ? { url: shape, w: bw, h: bh, x: c.x * fw, y: c.y * fh } : null);
    const cropped = c.x > 0 || c.y > 0 || c.w < 1 || c.h < 1;
    const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
    // Canvas frame: rounded corners on the visible box (same radius as the
    // export's alpha mask, editor.py _rounded_mask).
    const radius = Math.min(0.1, Math.max(0, canvas.frame?.radius ?? 0)) * Math.min(W, H);
    const round = radius > 0 ? ` round ${radius.toFixed(2)}px` : "";
    el.style.clipPath = cropped || round ? `inset(${pct(c.y)} ${pct(1 - c.x - c.w)} ${pct(1 - c.y - c.h)} ${pct(c.x)}${round})` : "";
    el.style.transformOrigin = `${pct(c.x + c.w / 2)} ${pct(c.y + c.h / 2)}`;
    el.style.objectFit = "fill";
    el.style.visibility = extra[slot].visible ? "visible" : "hidden";
    el.style.zIndex = need.role === "incoming" ? "2" : "1";
    el.style.transform = `${extra[slot].transform} rotate(${clip.transform.rotation}deg)`;
    el.style.opacity = String(extra[slot].opacity * g.opacity);
    const shadow = frameShadow(canvas.frame);
    if (sh) {
      if (!shadow || !extra[slot].visible) {
        sh.style.visibility = "hidden";
      } else {
        // The visible box itself, under the video, moving with it.
        sh.style.visibility = "visible";
        sh.style.left = `${clip.transform.x * W - bw / 2}px`;
        sh.style.top = `${clip.transform.y * H - bh / 2}px`;
        sh.style.width = `${bw}px`;
        sh.style.height = `${bh}px`;
        sh.style.borderRadius = `${radius}px`;
        sh.style.boxShadow = `0 ${(shadow.dy * H).toFixed(2)}px ${(shadow.blur * H).toFixed(2)}px rgba(0,0,0,${shadow.alpha.toFixed(3)})`;
        sh.style.transform = el.style.transform;
        sh.style.opacity = el.style.opacity;
        sh.style.zIndex = el.style.zIndex;
        setMask(sh, extra[slot].mask, W, H, clip.transform.x * W - bw / 2, clip.transform.y * H - bh / 2, shape ? { url: shape, w: bw, h: bh, x: 0, y: 0 } : null);
      }
    }
    const filters: string[] = [];
    if (!isNeutralColor(clip.look) || g.sharpness > 0) filters.push(`url(#look-${clip.id})`);
    if (g.blur > 0) filters.push(`blur(${(g.blur * H).toFixed(2)}px)`);
    if (extra[slot].filter) filters.push(extra[slot].filter);
    el.style.filter = filters.join(" ");
    setLevel(el, Math.max(0, clip.volume * extra[slot].vol));
  }
}

let maskCanvas: HTMLCanvasElement | null = null;

/** A per-pixel transition mask (xfade.ts maskPixels) as a CSS image. */
function transitionMaskUrl(type: TransitionType, p: number, W: number, H: number): string {
  const mw = MASK_WIDTH;
  const mh = Math.max(1, Math.round((MASK_WIDTH * H) / Math.max(1, W)));
  maskCanvas ??= document.createElement("canvas");
  maskCanvas.width = mw;
  maskCanvas.height = mh;
  const ctx = maskCanvas.getContext("2d");
  if (!ctx) return "";
  ctx.putImageData(new ImageData(maskPixels(type, p, mw, mh) as Uint8ClampedArray<ArrayBuffer>, mw, mh), 0, 0);
  return `url("${maskCanvas.toDataURL()}")`;
}

/** CSS masks of a clip element: the transition's (stage-sized, shifted
 * onto the element) and/or the clip's shape mask (box-sized, at the box),
 * intersected when both apply. */
function setMask(
  el: HTMLElement,
  mask: string,
  W: number,
  H: number,
  left: number,
  top: number,
  shape: { url: string; w: number; h: number; x: number; y: number } | null
) {
  const layers: { image: string; size: string; pos: string }[] = [];
  if (mask) layers.push({ image: mask, size: `${W}px ${H}px`, pos: `${-left}px ${-top}px` });
  if (shape) layers.push({ image: `url("${shape.url}")`, size: `${shape.w}px ${shape.h}px`, pos: `${shape.x}px ${shape.y}px` });
  const s = el.style;
  const image = layers.map((l) => l.image).join(", ");
  s.maskImage = image;
  s.webkitMaskImage = image;
  if (!layers.length) return;
  s.maskSize = s.webkitMaskSize = layers.map((l) => l.size).join(", ");
  s.maskPosition = s.webkitMaskPosition = layers.map((l) => l.pos).join(", ");
  s.maskRepeat = s.webkitMaskRepeat = "no-repeat";
  s.maskComposite = "intersect";
  (s as CSSStyleDeclaration & { webkitMaskComposite: string }).webkitMaskComposite = "source-in";
}

/** ffmpeg's vignette factor cos(angle * d)^4 (d = distance from the center
 * over the half-diagonal) as a black gradient, sampled every 10%. */
function vignetteGradient(angle: number): string {
  const stops: string[] = [];
  for (let i = 0; i <= 10; i++) {
    const c = Math.cos(Math.min(Math.PI / 2, angle * (i / 10)));
    stops.push(`rgba(0,0,0,${(1 - c ** 4).toFixed(3)}) ${i * 10}%`);
  }
  return `radial-gradient(circle farthest-corner at 50% 50%, ${stops.join(", ")})`;
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

/** Effects that read as "on" by default: full strength from 50% intensity
 * (the default), half strength at 0. Same as _full_at_50 in editor.py. */
const fullAt50 = (k: number) => Math.min(1, 0.5 + k);

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
    vignette: HTMLDivElement | null;
    letterbox: HTMLDivElement | null;
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
  let vignette = 0;
  let bars = 0;
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
      case "bw":
        filters.push(`saturate(${1 - fullAt50(k)})`);
        break;
      case "sepia":
        filters.push(`sepia(${fullAt50(k)})`);
        break;
      case "invert":
        filters.push(`invert(${fullAt50(k)})`);
        break;
      case "hue":
        filters.push(`hue-rotate(${(360 * (0.25 + 1.75 * k) * (t - e.start)).toFixed(1)}deg)`);
        break;
      case "vignette":
        vignette = Math.max(vignette, 0.4 + k);
        break;
      case "letterbox":
        bars = Math.max(bars, 0.06 + 0.08 * k);
        break;
      case "strobe":
        if (Math.floor((t - e.start) * 2 * (4 + 8 * k)) % 2 === 0) flash = Math.max(flash, 0.6);
        break;
      case "mirror":
        transforms.push("scaleX(-1)");
        break;
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
  if (nodes.vignette) {
    nodes.vignette.style.display = vignette > 0 ? "block" : "none";
    if (vignette > 0) nodes.vignette.style.background = vignetteGradient(vignette);
  }
  if (nodes.letterbox) {
    nodes.letterbox.style.display = bars > 0 ? "block" : "none";
    nodes.letterbox.style.borderTopWidth = nodes.letterbox.style.borderBottomWidth = `${(bars * H).toFixed(1)}px`;
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
  /** The preview volume for a track (0 when another track is soloed). */
  volumeOf: (a: AudioClip) => number,
  ensureSrc: (el: HTMLMediaElement, url: string) => void,
  setLevel: (el: HTMLMediaElement, key: string, level: number, fx: VoiceFx) => void
) {
  const live = new Set<string>();
  for (const a of audio) {
    live.add(a.id);
    // The cleaned copy unless bypassed (it's time-aligned with the original).
    const src = sources[playedSourceId(a, sources)];
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
    setLevel(el, a.id, volumeOf(a) * trackGainAt(a, t), a.voice ?? "none");
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

/** What the preview's mix needs from the project: the video-sound level
 * (with solo), the master gain, and whether to play through the mixer -
 * needed for levels above 100%, the master gain and the meters; otherwise
 * elements play straight out, as before. */
function previewMix(project: Project | undefined, audio: AudioClip[], lay: Layout, solo: ReadonlySet<string> | undefined, meters: boolean) {
  const m = masterOf(project ?? {});
  const soloSet = solo ?? new Set<string>();
  const video = (m.videoMuted ? 0 : m.videoVolume) * (heardWithSolo(VIDEO_TRACK, soloSet) ? 1 : 0);
  const gainDb = project ? masterGainDb(project) : 0;
  const engage =
    meters ||
    Math.abs(gainDb) >= 0.05 ||
    m.videoVolume > 1 ||
    audio.some((a) => a.volume > 1) ||
    lay.clips.some((c) => c.clip.volume * m.videoVolume > 1);
  return { video, solo: soloSet, masterGain: dbToGain(gainDb), engage };
}

/** Sets an element's level: through the mixer when it's engaged (or for a
 * voice effect), where it can go above 100%, else on the element. */
function playLevel(mixer: PreviewMixer, el: HTMLMediaElement, key: string, level: number, muted: boolean, fx: VoiceFx) {
  const gain = mixer.route(el, key, fx);
  if (gain) {
    el.muted = false;
    el.volume = 1;
    gain.gain.value = muted ? 0 : level;
  } else {
    el.muted = muted;
    // HTML media volume can't exceed 1; the mixer is engaged when it would.
    el.volume = Math.min(1, Math.max(0, level));
  }
}
