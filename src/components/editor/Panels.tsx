"use client";

import { useShortcutKeys } from "@/lib/platform/keys";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CREATOR_PRESETS, type CreatorPresetId } from "@/lib/editor/creatorPresets";
import { useClockTime, type Clock } from "@/lib/editor/clock";
import { voiceoverSupported } from "@/lib/editor/voiceover";
import { DEFAULT_KEY } from "@/lib/editor/chromaKey";
import { EASE_LABELS, KEYFRAME_SNAP, clipTransformAt, keyframeAt, overlayValues, upsertKeyframe, type KeyValues } from "@/lib/editor/keyframes";
import { FILTERS, FILTER_ORDER } from "@/lib/editor/look";
import { getStickerDef, stickerThumbSrc } from "@/lib/editor/stickers";
import { TEXT_FONTS, TEXT_TEMPLATES } from "@/lib/editor/textRaster";
import {
  ANIM_IN_LABELS,
  ANIM_OUT_LABELS,
  CANVAS_PRESETS,
  EFFECT_LABELS,
  MAX_REVERSE_SECONDS,
  SPEEDS,
  formatTime,
} from "@/lib/editor/timeline";
import {
  FULL_CROP,
  NEUTRAL_ADJUST,
  type Adjustments,
  type AnimIn,
  type AnimOut,
  type AudioClip,
  type BlendMode,
  type CamLayout,
  type Canvas,
  type CanvasFrame,
  type Clip,
  type Crop,
  type Curves,
  type EffectClip,
  type EffectType,
  type Keyframe,
  type KeyframeEase,
  type Look,
  type MediaSource,
  type Overlay,
  type ShapeMask,
  type ShapeStyle,
  type TextAnim,
  type TextStyle,
  type VoiceFx,
} from "@/lib/editor/types";
import { TEXT_ANIM_LABELS } from "@/lib/editor/textAnim";
import { DEFAULT_DUCK_AMOUNT } from "@/lib/editor/ducking";
import { VOICE_FX_LABELS } from "@/lib/editor/voiceFx";
import { SFX, type SfxDef } from "@/lib/editor/sfx";
import { DEFAULT_MASK, MASK_LABELS } from "@/lib/editor/shapeMask";
import { CAM_CORNER_LABELS, CAM_SHAPE_LABELS, DEFAULT_CAM_LAYOUT } from "@/lib/editor/webcamLayout";
import { DEFAULT_CURVES, IDENTITY_CURVE, curveFn, isIdentityCurve } from "@/lib/editor/curves";
import { MAX_RAMP_SPEED, MIN_RAMP_SPEED, RAMP_PRESETS, clipTimelineLength } from "@/lib/editor/speed";
import { CAPTION_POSITIONS, CAPTION_STYLES, type CaptionStyleId } from "@/lib/editor/captions";
import { SHAPE_LABELS } from "@/lib/editor/shapes";
import { isPremiumEffect, isPremiumFilter } from "@/lib/entitlements";
import GradeFilter from "./GradeFilter";
import PremiumBadge from "./PremiumBadge";
import { ActionButton, Field, PanelShell, SecondsInput, StickerLibrary } from "./Inspector";
import { TrashIcon } from "./icons";
import { sourceName } from "@/lib/editor/sourceFile";

/** Brackets a continuous control (slider drag, color picker) as one undo step. */
export interface Gesture {
  onGestureStart: () => void;
  onGestureEnd: () => void;
}

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-2/40";

/** Whether the user's plan leaves out premium tools - set by the editor
 * around its panel, read by the premium markers below. */
export const PremiumLocked = createContext(false);

/** Crown after a premium tool's title, for plans that don't include it. */
function ProTag() {
  return useContext(PremiumLocked) ? <PremiumBadge className="ml-1.5 inline-flex align-middle" /> : null;
}

/** A label marked premium (for <option>s and plain-text labels). */
function useProLabel() {
  const locked = useContext(PremiumLocked);
  return (label: string, premium = true) => (locked && premium ? `${label} · Premium` : label);
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="mb-2 mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</p>;
}

/** One-line explainer under a premium item the user's plan doesn't include. */
export function PremiumNote() {
  return (
    <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
      <PremiumBadge className="shrink-0" />
      <span>
        Premium items are free to try. Export them with{" "}
        <a href="/pricing" target="_blank" rel="noopener" className="font-semibold text-accent underline">
          any paid plan
        </a>
        .
      </span>
    </p>
  );
}

export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  neutral,
  format = (v) => String(Math.round(v)),
  onChange,
  gesture,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  neutral?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  gesture: Gesture;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-muted">{format(value)}</span>
          {neutral !== undefined && value !== neutral && (
            <button
              type="button"
              onClick={() => onChange(neutral)}
              className="rounded px-1 text-[10px] font-semibold text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
              aria-label={`Reset ${label}`}
            >
              Reset
            </button>
          )}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={gesture.onGestureStart}
        onPointerUp={gesture.onGestureEnd}
        onPointerCancel={gesture.onGestureEnd}
        className="w-full accent-[var(--accent)]"
      />
    </div>
  );
}

function ColorField({ label, value, onChange, gesture }: { label: string; value: string; onChange: (v: string) => void; gesture: Gesture }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs font-medium text-foreground">
      {label}
      <input
        type="color"
        value={value}
        onFocus={gesture.onGestureStart}
        onBlur={gesture.onGestureEnd}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-12 cursor-pointer rounded border border-border bg-surface"
      />
    </label>
  );
}

function Chips<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
            o.value === value ? "border-accent-2 bg-accent-2 text-black" : "border-border bg-surface text-foreground hover:border-accent/50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// --- Clip: speed, volume, reverse, crop, transform, look shortcut ----------

const CROP_RATIOS: { key: string; label: string; ar: number | null }[] = [
  { key: "none", label: "None", ar: null },
  { key: "1:1", label: "1:1", ar: 1 },
  { key: "9:16", label: "9:16", ar: 9 / 16 },
  { key: "16:9", label: "16:9", ar: 16 / 9 },
  { key: "4:5", label: "4:5", ar: 4 / 5 },
  { key: "4:3", label: "4:3", ar: 4 / 3 },
];
const MIN_CROP = 0.1; // smallest kept fraction of either side

/** Largest centered crop of a `srcAr` frame with aspect `ar`. */
function centerCrop(srcAr: number, ar: number | null): Crop {
  if (ar === null) return FULL_CROP;
  const w = ar < srcAr ? ar / srcAr : 1;
  const h = ar < srcAr ? 1 : srcAr / ar;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

const sameCrop = (a: Crop, b: Crop) =>
  Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3 && Math.abs(a.w - b.w) < 1e-3 && Math.abs(a.h - b.h) < 1e-3;

function CropSection({ crop, source, onChange, gesture }: { crop: Crop; source: MediaSource; onChange: (c: Crop) => void; gesture: Gesture }) {
  const srcAr = source.width / Math.max(1, source.height);
  const preset = CROP_RATIOS.find((r) => sameCrop(crop, centerCrop(srcAr, r.ar)))?.key ?? "custom";
  const right = 1 - crop.x - crop.w;
  const bottom = 1 - crop.y - crop.h;
  const pct = (v: number) => `${v}%`;
  const sides: { label: string; value: number; set: (v: number) => Crop }[] = [
    { label: "Left", value: crop.x, set: (v) => ({ ...crop, x: Math.min(v, 1 - right - MIN_CROP), w: 1 - Math.min(v, 1 - right - MIN_CROP) - right }) },
    { label: "Right", value: right, set: (v) => ({ ...crop, w: 1 - crop.x - Math.min(v, 1 - crop.x - MIN_CROP) }) },
    { label: "Top", value: crop.y, set: (v) => ({ ...crop, y: Math.min(v, 1 - bottom - MIN_CROP), h: 1 - Math.min(v, 1 - bottom - MIN_CROP) - bottom }) },
    { label: "Bottom", value: bottom, set: (v) => ({ ...crop, h: 1 - crop.y - Math.min(v, 1 - crop.y - MIN_CROP) }) },
  ];
  return (
    <div>
      <SectionTitle>Crop</SectionTitle>
      <Chips
        label="Crop ratio"
        value={preset}
        onChange={(key) => onChange(centerCrop(srcAr, CROP_RATIOS.find((r) => r.key === key)?.ar ?? null))}
        options={[...CROP_RATIOS.map((r) => ({ value: r.key, label: r.label })), ...(preset === "custom" ? [{ value: "custom", label: "Custom" }] : [])]}
      />
      <div className="mt-3 space-y-3">
        {sides.map((s) => (
          <SliderField
            key={s.label}
            label={s.label}
            value={Math.round(s.value * 100)}
            min={0}
            max={90}
            neutral={0}
            format={pct}
            onChange={(v) => onChange(s.set(v / 100))}
            gesture={gesture}
          />
        ))}
      </div>
    </div>
  );
}

export function ClipExtras({
  clip,
  source,
  onChange,
  onExtractAudio,
  onCleanAudio,
  onOpenLook,
  gesture,
  keys,
  attrs,
}: {
  /** Copy this clip's look and settings / paste copied ones here or on every clip. */
  attrs: { onCopy: () => void; onPaste?: () => void; onPasteAll?: () => void };
  clip: Clip;
  source: MediaSource;
  onChange: (patch: Partial<Clip>) => void;
  onExtractAudio: () => void;
  /** Desktop only: noise reduction and levelling on the local engine. */
  onCleanAudio?: () => void;
  onOpenLook: () => void;
  gesture: Gesture;
  keys: KeyframeControls;
}) {
  const frozen = clip.freeze !== null;
  const tooLongToReverse = clip.end - clip.start > MAX_REVERSE_SECONDS + 1e-6;
  return (
    <div className="space-y-4">
      {!frozen && (
        <>
          <div>
            <SectionTitle>Speed</SectionTitle>
            {!clip.ramp && (
              <Chips label="Speed" value={clip.speed} onChange={(speed) => onChange({ speed })} options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))} />
            )}
            <SpeedCurve clip={clip} onChange={onChange} gesture={gesture} />
          </div>
          <SliderField
            label="Volume"
            value={Math.round(clip.volume * 100)}
            min={0}
            max={200}
            neutral={100}
            format={(v) => `${v}%`}
            onChange={(v) => onChange({ volume: v / 100 })}
            gesture={gesture}
          />
          {source.hasAudio && !clip.reverse && (
            <ActionButton onClick={onExtractAudio} title="Move this clip's sound to its own audio track">
              Extract audio
            </ActionButton>
          )}
          {onCleanAudio && source.hasAudio && !clip.reverse && clip.freeze === null && (
            <ActionButton onClick={onCleanAudio} title="Reduce background noise (fan, hum, hiss) and even out the loudness, on this computer">
              Clean up audio
            </ActionButton>
          )}
          <div>
            <SectionTitle>Reverse</SectionTitle>
            <Chips
              label="Reverse"
              value={clip.reverse ? "on" : "off"}
              onChange={(v) => onChange({ reverse: v === "on" })}
              options={[
                { value: "off", label: "Forward" },
                ...(tooLongToReverse && !clip.reverse ? [] : [{ value: "on", label: "Reverse" }]),
              ]}
            />
            <p className="mt-1.5 text-[11px] text-muted">
              {tooLongToReverse && !clip.reverse
                ? `Clips up to ${MAX_REVERSE_SECONDS}s can be reversed. Split this one into a shorter part first.`
                : "Plays picture and sound backwards. The preview may look choppy and plays it silent; the export is smooth."}
            </p>
          </div>
        </>
      )}
      {!frozen && (
        <div className="space-y-2">
          <SectionTitle>
            Stabilize
            <ProTag />
          </SectionTitle>
          <label className="flex items-center justify-between text-xs font-medium text-foreground">
            Smooth out camera shake
            <input type="checkbox" checked={!!clip.stabilize} onChange={(e) => onChange({ stabilize: e.target.checked ? 50 : undefined })} />
          </label>
          {!!clip.stabilize && (
            <>
              <SliderField label="Strength" value={clip.stabilize} min={1} max={100} neutral={50} format={(v) => `${v}%`} onChange={(stabilize) => onChange({ stabilize })} gesture={gesture} />
              <p className="text-[11px] text-muted">Applied when you export (the preview shows the original). Zooms in slightly to hide the moving edges.</p>
            </>
          )}
        </div>
      )}
      <CropSection crop={clip.crop} source={source} onChange={(crop) => onChange({ crop })} gesture={gesture} />
      <ClipTransformFields clip={clip} onChange={onChange} gesture={gesture} keys={keys} />
      <MaskSection mask={clip.mask} onChange={(mask) => onChange({ mask })} gesture={gesture} />
      <ActionButton onClick={onOpenLook}>Filters &amp; adjustments…</ActionButton>
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <ActionButton onClick={attrs.onCopy} title="Copy this clip's filters, adjustments, LUT, curves, position, mask, speed and volume">
          Copy attributes
        </ActionButton>
        {attrs.onPaste && <ActionButton onClick={attrs.onPaste}>Paste attributes</ActionButton>}
        {attrs.onPasteAll && <ActionButton onClick={attrs.onPasteAll}>Paste to all clips</ActionButton>}
      </div>
    </div>
  );
}

function ClipTransformFields({ clip, onChange, gesture, keys }: { clip: Clip; onChange: (patch: Partial<Clip>) => void; gesture: Gesture; keys: KeyframeControls }) {
  const time = useClockTime(keys.clock);
  const t = clip.keyframes?.length ? clipTransformAt(clip, keys.keyTime(time)) : clip.transform;
  return (
    <div>
      <SectionTitle>Position &amp; size</SectionTitle>
      <div className="space-y-3">
        <SliderField label="X" value={Math.round(t.x * 100)} min={-50} max={150} neutral={50} format={(v) => `${v}%`} onChange={(v) => onChange({ transform: { ...t, x: v / 100 } })} gesture={gesture} />
        <SliderField label="Y" value={Math.round(t.y * 100)} min={-50} max={150} neutral={50} format={(v) => `${v}%`} onChange={(v) => onChange({ transform: { ...t, y: v / 100 } })} gesture={gesture} />
        <SliderField label="Scale" value={Math.round(t.scale * 100)} min={10} max={300} neutral={100} format={(v) => `${v}%`} onChange={(v) => onChange({ transform: { ...t, scale: v / 100 } })} gesture={gesture} />
        <SliderField label="Rotation" value={Math.round(t.rotation)} min={-180} max={180} neutral={0} format={(v) => `${v}°`} onChange={(v) => onChange({ transform: { ...t, rotation: v } })} gesture={gesture} />
      </div>
      <KeyframeBar time={time} keys={keys} />
    </div>
  );
}

// --- Speed curve ------------------------------------------------------------------

const RAMP_LOG = Math.log10(MAX_RAMP_SPEED);

/** Speed ramp presets plus a curve whose points drag up and down
 * (log scale, 0.1x..10x). */
function SpeedCurve({ clip, onChange, gesture }: { clip: Clip; onChange: (patch: Partial<Clip>) => void; gesture: Gesture }) {
  const proLabel = useProLabel();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const points = clip.ramp;
  const W = 240;
  const H = 96;
  const yOf = (s: number) => H / 2 - (Math.log10(s) / RAMP_LOG) * (H / 2 - 6);
  const sOf = (y: number) => {
    const v = Math.pow(10, ((H / 2 - y) / (H / 2 - 6)) * RAMP_LOG);
    return Math.round(Math.min(MAX_RAMP_SPEED, Math.max(MIN_RAMP_SPEED, v)) * 100) / 100;
  };
  const xOf = (i: number, n: number) => 8 + (i / (n - 1)) * (W - 16);
  const move = (e: React.PointerEvent) => {
    if (drag.current === null || !points || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const y = ((e.clientY - r.top) / r.height) * H;
    onChange({ ramp: points.map((p, i) => (i === drag.current ? sOf(y) : p)) });
  };
  if (clip.reverse) return <p className="mt-2 text-[11px] text-muted">Speed curves don&apos;t apply to reversed clips.</p>;
  return (
    <div className="mt-3 space-y-2">
      <Field label={proLabel("Speed curve")}>
        <select
          className={inputCls}
          value={points ? (RAMP_PRESETS.find((p) => p.points.join() === points.join())?.id ?? "custom") : "none"}
          onChange={(e) => {
            const preset = RAMP_PRESETS.find((p) => p.id === e.target.value);
            onChange({ ramp: preset ? preset.points : undefined });
          }}
        >
          <option value="none">None (constant speed)</option>
          {RAMP_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {points && !RAMP_PRESETS.some((p) => p.points.join() === points.join()) && <option value="custom">Custom</option>}
        </select>
      </Field>
      {points && (
        <>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full touch-none select-none rounded-lg border border-border bg-surface"
            onPointerMove={move}
            onPointerUp={() => {
              if (drag.current !== null) gesture.onGestureEnd();
              drag.current = null;
            }}
            role="img"
            aria-label="Speed curve: drag the points up to speed up, down to slow down"
          >
            {[10, 1, 0.1].map((s) => (
              <g key={s}>
                <line x1={0} x2={W} y1={yOf(s)} y2={yOf(s)} stroke="currentColor" className="text-border" strokeDasharray={s === 1 ? undefined : "3 3"} />
                <text x={W - 4} y={yOf(s) + (s === 10 ? 10 : -3)} textAnchor="end" fontSize="9" className="fill-current text-muted">
                  {s}×
                </text>
              </g>
            ))}
            <polyline points={points.map((p, i) => `${xOf(i, points.length)},${yOf(p)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth={2} className="text-accent-2" />
            {points.map((p, i) => (
              <circle
                key={i}
                cx={xOf(i, points.length)}
                cy={yOf(p)}
                r={6}
                className="cursor-ns-resize fill-white stroke-accent-2"
                strokeWidth={2}
                onPointerDown={(e) => {
                  (e.currentTarget.ownerSVGElement ?? e.currentTarget).setPointerCapture(e.pointerId);
                  drag.current = i;
                  gesture.onGestureStart();
                }}
              >
                <title>{`${p}×`}</title>
              </circle>
            ))}
          </svg>
          <p className="text-[11px] text-muted">
            Drag a point up to speed up, down to slow down. Plays for {clipTimelineLength(clip).toFixed(1)}s.
          </p>
        </>
      )}
    </div>
  );
}

// --- Keyframes ---------------------------------------------------------------------

/** What the keyframe controls need from the editor for one clip or layer. */
export interface KeyframeControls {
  clock: Clock;
  keyframes: Keyframe[] | undefined;
  /** Keyframe time at timeline time `t`. */
  keyTime: (t: number) => number;
  /** Moves the playhead to keyframe time `k`. */
  seekKey: (k: number) => void;
  /** Current (unanimated or animated) values at keyframe time `k`. */
  valuesAt: (k: number) => KeyValues;
  /** Keyframe times outside [min, max] can't be added (off the item). */
  range: [number, number];
  onChange: (keyframes: Keyframe[] | undefined) => void;
}

function KeyframeBar({ time, keys }: { time: number; keys: KeyframeControls }) {
  const kfs = keys.keyframes ?? [];
  const k = keys.keyTime(time);
  const here = keyframeAt(kfs, k);
  const inRange = k >= keys.range[0] - KEYFRAME_SNAP && k <= keys.range[1] + KEYFRAME_SNAP;
  const prev = [...kfs].reverse().find((f) => f.t < k - KEYFRAME_SNAP);
  const next = kfs.find((f) => f.t > k + KEYFRAME_SNAP);
  const navCls = "h-8 w-8 rounded-lg border border-border text-xs text-foreground disabled:opacity-40 hover:border-accent-2";
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-center gap-2">
        <button type="button" className={navCls} disabled={!prev} onClick={() => prev && keys.seekKey(prev.t)} title="Previous keyframe" aria-label="Previous keyframe">
          ◀
        </button>
        <button
          type="button"
          disabled={!here && !inRange}
          onClick={() => keys.onChange(here ? kfs.filter((f) => f !== here) : upsertKeyframe(kfs, k, keys.valuesAt(k)))}
          className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold disabled:opacity-40 ${here ? "border-accent-2 bg-accent-2/10 text-foreground" : "border-border text-foreground hover:border-accent-2"}`}
        >
          {here ? "◆ Remove keyframe" : "◇ Add keyframe"}
        </button>
        <button type="button" className={navCls} disabled={!next} onClick={() => next && keys.seekKey(next.t)} title="Next keyframe" aria-label="Next keyframe">
          ▶
        </button>
      </div>
      {here && (
        <Field label="Curve to the next keyframe">
          <select
            className={inputCls}
            value={here.ease}
            onChange={(e) => keys.onChange(kfs.map((f) => (f === here ? { ...f, ease: e.target.value as KeyframeEase } : f)))}
          >
            {(Object.keys(EASE_LABELS) as KeyframeEase[]).map((ek) => (
              <option key={ek} value={ek}>
                {EASE_LABELS[ek]}
              </option>
            ))}
          </select>
        </Field>
      )}
      <p className="text-[11px] text-muted">
        {kfs.length === 0
          ? "Add a keyframe, move the playhead, then change the values above: each change makes a new keyframe and the motion is animated between them."
          : `${kfs.length} keyframe${kfs.length === 1 ? "" : "s"}. Changes at the playhead update or add a keyframe.`}
        {kfs.length > 0 && (
          <>
            {" "}
            <button type="button" className="font-semibold text-accent-2 hover:underline" onClick={() => keys.onChange(undefined)}>
              Remove animation
            </button>
          </>
        )}
      </p>
    </div>
  );
}

// --- Look: filters + adjustments --------------------------------------------

const ADJUST_FIELDS: { key: keyof Adjustments; label: string; min: number; max: number; neutral: number }[] = [
  { key: "brightness", label: "Brightness", min: -100, max: 100, neutral: 0 },
  { key: "contrast", label: "Contrast", min: -100, max: 100, neutral: 0 },
  { key: "saturation", label: "Saturation", min: -100, max: 100, neutral: 0 },
  { key: "exposure", label: "Exposure", min: -100, max: 100, neutral: 0 },
  { key: "temperature", label: "Temperature", min: -100, max: 100, neutral: 0 },
  { key: "tint", label: "Tint", min: -100, max: 100, neutral: 0 },
  { key: "highlights", label: "Highlights", min: -100, max: 100, neutral: 0 },
  { key: "shadows", label: "Shadows", min: -100, max: 100, neutral: 0 },
  { key: "sharpness", label: "Sharpness", min: 0, max: 100, neutral: 0 },
  { key: "blur", label: "Blur", min: 0, max: 100, neutral: 0 },
  { key: "opacity", label: "Opacity", min: 0, max: 100, neutral: 100 },
];

export function LookPanel({
  mode,
  look,
  clipLabel,
  thumb,
  onChange,
  onApplyAll,
  onClose,
  gesture,
  premiumLocked = false,
  onImportLut,
}: {
  mode: "filters" | "adjust";
  /** Imports a .cube file as this clip's LUT. */
  onImportLut: (file: File) => void;
  look: Look;
  clipLabel: string;
  thumb?: string;
  onChange: (look: Look) => void;
  onApplyAll: () => void;
  onClose: () => void;
  gesture: Gesture;
  /** Mark premium filters (the user's plan doesn't include them). */
  premiumLocked?: boolean;
}) {
  return (
    <PanelShell title={`${mode === "filters" ? "Filters" : "Adjust"} · ${clipLabel}`} onClose={onClose}>
      {mode === "filters" ? (
        <>
          <svg width="0" height="0" className="absolute" aria-hidden>
            <defs>
              {FILTER_ORDER.map((f) => (
                <GradeFilter key={f} id={`swatch-${f}`} look={{ filter: f, intensity: 100, adjust: NEUTRAL_ADJUST }} />
              ))}
            </defs>
          </svg>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Filter">
            {FILTER_ORDER.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={look.filter === f}
                onClick={() => onChange({ ...look, filter: f, intensity: look.filter === f ? look.intensity : 70 })}
                className={`relative overflow-hidden rounded-xl border text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
                  look.filter === f ? "border-accent-2 ring-1 ring-accent-2" : "border-border hover:border-accent/50"
                }`}
              >
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="aspect-video w-full object-cover" style={{ filter: `url(#swatch-${f})` }} />
                ) : (
                  <div className="aspect-video w-full bg-gradient-to-br from-accent to-accent-2" style={{ filter: `url(#swatch-${f})` }} />
                )}
                <span className="block px-1 py-1.5 text-foreground">{FILTERS[f].label}</span>
                {premiumLocked && isPremiumFilter(f) && <PremiumBadge />}
              </button>
            ))}
          </div>
          {premiumLocked && isPremiumFilter(look.filter) && <PremiumNote />}
          {look.filter !== "original" && (
            <div className="mt-4">
              <SliderField label="Intensity" value={look.intensity} min={0} max={100} neutral={100} format={(v) => `${v}%`} onChange={(intensity) => onChange({ ...look, intensity })} gesture={gesture} />
            </div>
          )}
          <LutSection look={look} onChange={onChange} onImport={onImportLut} gesture={gesture} />
        </>
      ) : (
        <div className="space-y-3.5">
          {ADJUST_FIELDS.map((f) => (
            <SliderField
              key={f.key}
              label={f.label}
              value={look.adjust[f.key]}
              min={f.min}
              max={f.max}
              neutral={f.neutral}
              onChange={(v) => onChange({ ...look, adjust: { ...look.adjust, [f.key]: v } })}
              gesture={gesture}
            />
          ))}
          <CurvesEditor curves={look.curves ?? DEFAULT_CURVES} onChange={(curves) => onChange({ ...look, curves })} gesture={gesture} />
          <ActionButton onClick={() => onChange({ ...look, adjust: NEUTRAL_ADJUST, curves: undefined })}>Reset all</ActionButton>
        </div>
      )}
      <div className="mt-5 border-t border-border pt-4">
        <ActionButton onClick={onApplyAll}>Apply to all clips</ActionButton>
        <p className="mt-2 text-[11px] text-muted">Changes apply to the selected clip (or the clip under the playhead).</p>
      </div>
    </PanelShell>
  );
}

function LutSection({ look, onChange, onImport, gesture }: { look: Look; onChange: (look: Look) => void; onImport: (file: File) => void; gesture: Gesture }) {
  const input = useRef<HTMLInputElement>(null);
  const lut = look.lut;
  return (
    <div className="mt-5 space-y-3 border-t border-border pt-4">
      <SectionTitle>
        LUT
        <ProTag />
      </SectionTitle>
      <input
        ref={input}
        type="file"
        accept=".cube"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = "";
        }}
      />
      {lut ? (
        <>
          <p className="truncate text-xs font-semibold text-foreground" title={lut.name}>
            {lut.name}
          </p>
          <SliderField label="LUT strength" value={lut.intensity} min={0} max={100} neutral={100} format={(v) => `${v}%`} onChange={(intensity) => onChange({ ...look, lut: { ...lut, intensity } })} gesture={gesture} />
          <div className="flex gap-2">
            <ActionButton onClick={() => input.current?.click()}>Replace…</ActionButton>
            <ActionButton onClick={() => onChange({ ...look, lut: null })} tone="danger">
              Remove
            </ActionButton>
          </div>
        </>
      ) : (
        <>
          <ActionButton onClick={() => input.current?.click()}>Import a LUT (.cube)…</ActionButton>
          <p className="text-[11px] text-muted">A 3D color LUT from a camera maker or color tool. It runs before the filter and adjustments.</p>
        </>
      )}
    </div>
  );
}

const CURVE_CHANNELS: { key: keyof Curves; label: string; color: string }[] = [
  { key: "rgb", label: "RGB", color: "currentColor" },
  { key: "r", label: "Red", color: "#ef4444" },
  { key: "g", label: "Green", color: "#22c55e" },
  { key: "b", label: "Blue", color: "#3b82f6" },
];

/** Tone curve editor: drag points, click the curve's area to add one,
 * double-click a point to remove it. */
function CurvesEditor({ curves, onChange, gesture }: { curves: Curves; onChange: (c: Curves) => void; gesture: Gesture }) {
  const [channel, setChannel] = useState<keyof Curves>("rgb");
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const S = 200;
  const pts = curves[channel];
  const color = CURVE_CHANNELS.find((c) => c.key === channel)!.color;
  const fn = curveFn(pts);
  const path = Array.from({ length: 51 }, (_, i) => `${(i / 50) * S},${(1 - fn(i / 50)) * S}`).join(" ");
  const toPoint = (e: React.PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
  };
  const setPts = (next: [number, number][]) => onChange({ ...curves, [channel]: next });
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <SectionTitle>
          Curves
          <ProTag />
        </SectionTitle>
        <div className="flex gap-1" role="tablist" aria-label="Curve channel">
          {CURVE_CHANNELS.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={channel === c.key}
              onClick={() => setChannel(c.key)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${channel === c.key ? "bg-accent-2/20 text-foreground" : "text-muted hover:text-foreground"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${S} ${S}`}
        className="aspect-square w-full touch-none select-none rounded-lg border border-border bg-surface"
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return;
          const p = toPoint(e);
          const next = [...pts, p].sort((a, b) => a[0] - b[0]);
          drag.current = next.indexOf(p);
          e.currentTarget.setPointerCapture(e.pointerId);
          gesture.onGestureStart();
          setPts(next);
        }}
        onPointerMove={(e) => {
          const i = drag.current;
          if (i === null) return;
          const [px, y] = toPoint(e);
          // End points keep their x; inner points stay between neighbors.
          const x = i === 0 || i === pts.length - 1 ? pts[i][0] : Math.min(pts[i + 1][0] - 0.01, Math.max(pts[i - 1][0] + 0.01, px));
          setPts(pts.map((p, k) => (k === i ? [x, y] : p)));
        }}
        onPointerUp={() => {
          if (drag.current !== null) gesture.onGestureEnd();
          drag.current = null;
        }}
        role="img"
        aria-label={`${channel} curve`}
      >
        {[0.25, 0.5, 0.75].map((v) => (
          <g key={v} className="text-border" stroke="currentColor" strokeWidth={0.5}>
            <line x1={v * S} x2={v * S} y1={0} y2={S} />
            <line y1={v * S} y2={v * S} x1={0} x2={S} />
          </g>
        ))}
        <line x1={0} y1={S} x2={S} y2={0} stroke="currentColor" className="text-border" strokeDasharray="3 3" />
        <polyline points={path} fill="none" stroke={color} strokeWidth={2} className="pointer-events-none text-foreground" />
        {pts.map(([x, y], i) => (
          <circle
            key={i}
            cx={x * S}
            cy={(1 - y) * S}
            r={5}
            fill="white"
            stroke={color === "currentColor" ? "#888" : color}
            strokeWidth={2}
            className="cursor-move"
            onPointerDown={(e) => {
              e.stopPropagation();
              svgRef.current!.setPointerCapture(e.pointerId);
              drag.current = i;
              gesture.onGestureStart();
            }}
            onDoubleClick={() => i > 0 && i < pts.length - 1 && setPts(pts.filter((_, k) => k !== i))}
          />
        ))}
      </svg>
      <p className="text-[11px] text-muted">
        Click to add a point, drag to shape, double-click a point to remove it.{" "}
        {!isIdentityCurve(pts) && (
          <button type="button" className="font-semibold text-accent-2 hover:underline" onClick={() => setPts(IDENTITY_CURVE)}>
            Reset {CURVE_CHANNELS.find((c) => c.key === channel)!.label}
          </button>
        )}
      </p>
    </div>
  );
}

// --- Text: add + templates --------------------------------------------------

export function TextAddPanel({ onAdd, onClose }: { onAdd: (style: Partial<TextStyle>, y: number) => void; onClose: () => void }) {
  return (
    <PanelShell title="Text" onClose={onClose}>
      <button type="button" onClick={() => onAdd({}, 0.5)} className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold">
        + Add text
      </button>
      <SectionTitle>
        <span className="mt-4 block">Templates</span>
      </SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {TEXT_TEMPLATES.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => onAdd(t.style, t.y)}
            className="flex h-16 items-center justify-center rounded-xl border border-border bg-gradient-to-br from-slate-800 to-slate-950 px-2 text-center transition hover:border-accent-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
            title={`Add ${t.label}`}
          >
            <span
              className="truncate"
              style={{
                fontFamily: TEXT_FONTS[t.style.font ?? "jakarta"]?.css,
                fontWeight: t.style.weight ?? 900,
                color: t.style.color ?? "#fff",
                fontSize: 14,
                background: t.style.backgroundOpacity ? t.style.background : undefined,
                padding: t.style.backgroundOpacity ? "2px 6px" : undefined,
                borderRadius: 4,
                WebkitTextStroke: t.style.strokeWidth ? `1px ${t.style.strokeColor}` : undefined,
              }}
            >
              {t.label}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-muted">Text is added at the playhead for 3 seconds. Double-click text on the video to edit it.</p>
    </PanelShell>
  );
}

// --- Elements: stickers + uploaded images -----------------------------------

export function ElementsPanel({
  onAddSticker,
  onUploadImage,
  onUploadVideo,
  onClose,
}: {
  onAddSticker: (id: string) => void;
  onUploadImage: (file: File) => void;
  onUploadVideo: (file: File) => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  return (
    <PanelShell title="Elements" onClose={onClose}>
      <input
        ref={videoInput}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadVideo(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => videoInput.current?.click()}
        className="mb-2 w-full rounded-xl border-2 border-dashed border-border py-3 text-sm font-semibold text-foreground transition hover:border-accent-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
      >
        Add video layer (picture-in-picture)
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadImage(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="mb-4 w-full rounded-xl border-2 border-dashed border-border py-3 text-sm font-semibold text-foreground transition hover:border-accent-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
      >
        Upload image (PNG, JPG, WebP)
      </button>
      <StickerLibrary onAdd={onAddSticker} />
    </PanelShell>
  );
}

// --- Auto captions ----------------------------------------------------------

export const CAPTION_LANGUAGES: { code: string; label: string }[] = [
  { code: "auto", label: "Detect automatically" },
  { code: "en", label: "English" },
  { code: "si", label: "Sinhala" },
  { code: "ta", label: "Tamil" },
  { code: "hi", label: "Hindi" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "pl", label: "Polish" },
  { code: "tr", label: "Turkish" },
  { code: "ar", label: "Arabic" },
  { code: "bn", label: "Bengali" },
  { code: "ur", label: "Urdu" },
  { code: "id", label: "Indonesian" },
  { code: "ms", label: "Malay" },
  { code: "th", label: "Thai" },
  { code: "vi", label: "Vietnamese" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];

export interface CaptionOptions {
  language: string;
  maxWords: number;
  style: CaptionStyleId;
  y: number;
}

/** Asks before the speech model's first download, with its size and what
 * transcribing costs on this device (captions.ts speechModel). Shared by
 * auto captions and the transcript. */
export function SpeechModelNotice({
  model,
  busy,
  onConsent,
}: {
  model?: { sizeMb: number; gpu: boolean; engine?: boolean; sinhala?: boolean } | null;
  busy: boolean;
  onConsent: () => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-2/60 p-3 text-xs text-muted">
      <p className="font-semibold text-foreground">Speech model needed (one time)</p>
      <p>
        {model?.sinhala
          ? `Sinhala speech model, about ${model.sizeMb} MB to download, prepared once on this computer (about 250 MB kept). Transcribing uses the processor and around 1 GB of memory.`
          : model?.engine
            ? `High-accuracy speech model, about ${model.sizeMb} MB, downloaded once and kept on this computer. Transcribing uses the processor and around 2 GB of memory.`
            : model?.gpu
              ? `High-accuracy speech model, about ${model.sizeMb} MB, downloaded once and kept on this device. Transcribing runs on your graphics card and uses around 2 GB of memory; a 10-minute recording takes about 3 minutes.`
              : `Speech model, about ${model?.sizeMb ?? 250} MB, downloaded once and kept on this device. Transcribing uses the CPU and around 1.5 GB of memory; a 10-minute recording takes several minutes.`}{" "}
        Your audio never leaves this device.
      </p>
      <ActionButton tone="accent" onClick={onConsent} disabled={busy}>
        Download model ({model?.sizeMb ?? 250} MB)
      </ActionButton>
    </div>
  );
}

export function CaptionsPanel({
  options,
  onOptions,
  count,
  busy,
  onGenerate,
  onCancel,
  onRestyle,
  onRemoveAll,
  onClose,
  modelCached = true,
  model,
  hidden = false,
  onToggleHidden,
  onResize,
  onAlign,
  onExport,
}: {
  /** null = still checking. When false, generating asks to download the model first. */
  modelCached?: boolean | null;
  /** The speech model this device will download (captions.ts speechModel). */
  model?: { sizeMb: number; gpu: boolean; engine?: boolean; sinhala?: boolean } | null;
  /** Every caption is hidden (toggled off). */
  hidden?: boolean;
  onToggleHidden?: () => void;
  onResize?: (size: number) => void;
  onAlign?: (align: "left" | "center" | "right") => void;
  onExport?: (format: "srt" | "vtt" | "txt") => void;
  options: CaptionOptions;
  onOptions: (o: CaptionOptions) => void;
  /** Caption layers already on the timeline. */
  count: number;
  busy: boolean;
  onGenerate: () => void;
  /** Stops the model download or transcription in progress. */
  onCancel?: () => void;
  /** Applies the current style/position to the existing captions. */
  onRestyle: (o: CaptionOptions) => void;
  onRemoveAll: () => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<CaptionOptions>, restyle = false) => {
    const next = { ...options, ...patch };
    onOptions(next);
    if (restyle && count > 0) onRestyle(next);
  };
  const [consent, setConsent] = useState(false);
  const needsModel = modelCached === false && !consent;
  return (
    <PanelShell title="Auto captions" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Turns the speech in your clips, a screen recording&apos;s microphone and added voiceovers into timed text layers. Added audio is
          checked on your device and music is left out - set a track to Voice or Music in its panel if it&apos;s taken wrong. Edit any
          caption&apos;s text and timing afterwards like normal text. Speech recognition runs on your device - your audio is not uploaded.
        </p>
        <Field label="Language">
          <select className={inputCls} value={options.language} onChange={(e) => set({ language: e.target.value })}>
            {CAPTION_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <SectionTitle>Words per caption</SectionTitle>
          <Chips
            label="Words per caption"
            value={options.maxWords}
            onChange={(maxWords) => set({ maxWords })}
            options={[
              { value: 1, label: "1 word" },
              { value: 3, label: "Short" },
              { value: 8, label: "Phrase" },
            ]}
          />
        </div>
        <div>
          <SectionTitle>Style</SectionTitle>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Caption style">
            {(Object.keys(CAPTION_STYLES) as CaptionStyleId[]).map((id) => {
              const s = CAPTION_STYLES[id].style;
              const active = options.style === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => set({ style: id }, true)}
                  className={`flex h-14 items-center justify-center rounded-xl border bg-neutral-700 px-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
                    active ? "border-accent-2 ring-1 ring-accent-2" : "border-border hover:border-accent/50"
                  }`}
                >
                  <span
                    className="rounded px-1.5 py-0.5 text-sm"
                    style={{
                      color: s.color ?? "#ffffff",
                      fontWeight: s.weight ?? 700,
                      background: s.backgroundOpacity ? `rgba(0,0,0,${s.backgroundOpacity})` : undefined,
                      WebkitTextStroke: s.strokeWidth ? `1px ${s.strokeColor}` : undefined,
                      textShadow: s.shadow ? "0 1px 3px rgba(0,0,0,0.8)" : undefined,
                      textTransform: CAPTION_STYLES[id].upper ? "uppercase" : undefined,
                    }}
                  >
                    {CAPTION_STYLES[id].label}
                    {id === "karaoke" && <ProTag />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <SectionTitle>Position</SectionTitle>
          <Chips
            label="Caption position"
            value={options.y}
            onChange={(y) => set({ y }, true)}
            options={CAPTION_POSITIONS.map((p) => ({ value: p.y, label: p.label }))}
          />
        </div>
        {needsModel ? (
          <SpeechModelNotice model={model} busy={busy} onConsent={() => setConsent(true)} />
        ) : busy && onCancel ? (
          <ActionButton onClick={onCancel}>Cancel</ActionButton>
        ) : (
          <ActionButton onClick={onGenerate} disabled={busy || modelCached === null} tone="accent">
            {busy ? "Generating…" : `${count > 0 ? "Regenerate" : "Generate"} captions · free`}
          </ActionButton>
        )}
        {count > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs text-muted">
              {count} caption{count === 1 ? "" : "s"} on the Text track. Style and position changes apply to all of them; regenerating replaces them.
            </p>
            {onToggleHidden && (
              <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                <input type="checkbox" className="accent-[var(--accent)]" checked={!hidden} onChange={onToggleHidden} />
                Show captions (in the preview and the export)
              </label>
            )}
            {onResize && (
              <div>
                <SectionTitle>Size</SectionTitle>
                <Chips
                  label="Caption size"
                  value={0}
                  onChange={(v) => v && onResize(v)}
                  options={[
                    { value: 0.04, label: "Small" },
                    { value: 0.055, label: "Medium" },
                    { value: 0.075, label: "Large" },
                  ]}
                />
              </div>
            )}
            {onAlign && (
              <div>
                <SectionTitle>Alignment</SectionTitle>
                <Chips
                  label="Caption alignment"
                  value={""}
                  onChange={(v) => v && onAlign(v as "left" | "center" | "right")}
                  options={[
                    { value: "left", label: "Left" },
                    { value: "center", label: "Center" },
                    { value: "right", label: "Right" },
                  ]}
                />
              </div>
            )}
            {onExport && (
              <div>
                <SectionTitle>Export</SectionTitle>
                <div className="flex flex-wrap gap-2">
                  <ActionButton onClick={() => onExport("srt")}>SRT</ActionButton>
                  <ActionButton onClick={() => onExport("vtt")}>WebVTT</ActionButton>
                  <ActionButton onClick={() => onExport("txt")}>Transcript (.txt)</ActionButton>
                </div>
                <p className="mt-1 text-[11px] text-muted">Subtitle files use your corrected text and timings. Visible captions are also burned into the video export.</p>
              </div>
            )}
            <ActionButton onClick={onRemoveAll} tone="danger">
              <TrashIcon width={14} height={14} /> Remove all captions
            </ActionButton>
          </div>
        )}
      </div>
    </PanelShell>
  );
}

// --- Overlay inspector (text / sticker / image) ------------------------------

export function OverlayPanel({
  overlay,
  total,
  sourceDuration,
  onChange,
  onDuplicate,
  onDelete,
  onRestack,
  onClose,
  gesture,
  textAreaRef,
  keys,
  style,
  fonts,
  onCamLayout,
}: {
  overlay: Overlay;
  /** Video layers: place as a webcam (webcamLayout.ts); null = by hand. */
  onCamLayout?: (layout: CamLayout | null) => void;
  keys: KeyframeControls;
  /** Uploaded fonts to offer, and uploading another. */
  fonts: { custom: { key: string; label: string }[]; onUpload: (file: File) => void };
  /** Copy this layer's style / paste a copied one here. */
  style: { onCopy: () => void; onPaste?: () => void };
  total: number;
  /** Length of a video layer's source, to cap its end. */
  sourceDuration?: number;
  onChange: (patch: Partial<Overlay>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRestack: (dir: 1 | -1) => void;
  onClose: () => void;
  gesture: Gesture;
  textAreaRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const o = overlay;
  const proLabel = useProLabel();
  const shortcutKeys = useShortcutKeys();
  const title =
    o.kind === "text"
      ? o.keystroke
        ? "Shortcut"
        : "Text"
      : o.kind === "image"
        ? "Image"
        : o.kind === "video"
          ? "Video layer"
          : o.kind === "shape"
            ? SHAPE_LABELS[o.shape.type]
            : `Sticker · ${getStickerDef(o.stickerId)?.label ?? ""}`;
  const setShape = (patch: Partial<ShapeStyle>) => o.kind === "shape" && onChange({ shape: { ...o.shape, ...patch } } as Partial<Overlay>);
  const setText = (patch: Partial<TextStyle>) => o.kind === "text" && onChange({ text: { ...o.text, ...patch } } as Partial<Overlay>);

  return (
    <PanelShell title={title} onClose={onClose}>
      <div className="space-y-4">
        {o.kind === "shape" && (
          <div className="mb-4 space-y-3">
            <ColorField label="Color" value={o.shape.color} onChange={(color) => setShape({ color })} gesture={gesture} />
            {o.shape.type !== "outline" && (
              <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                <input type="checkbox" className="accent-[var(--accent)]" checked={o.shape.filled} onChange={(e) => setShape({ filled: e.target.checked })} />
                {o.shape.type === "circle" || o.shape.type === "rect" ? "Tinted fill" : "Filled"}
              </label>
            )}
            {o.shape.type !== "step" && (
              <SliderField
                label="Proportions"
                value={o.shape.aspect}
                min={o.shape.type === "arrow" ? 1.5 : 0.3}
                max={o.shape.type === "arrow" ? 6 : 4}
                step={0.05}
                format={(v) => `${v.toFixed(2)} : 1`}
                onChange={(aspect) => setShape({ aspect })}
                gesture={gesture}
              />
            )}
            {(o.shape.type === "circle" || o.shape.type === "rect" || o.shape.type === "outline" || !o.shape.filled) && (
              <SliderField label="Line width" value={o.shape.stroke} min={0.02} max={0.2} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(stroke) => setShape({ stroke })} gesture={gesture} />
            )}
            {o.shape.type === "step" && (
              <SliderField label="Number" value={o.shape.number} min={1} max={99} step={1} onChange={(number) => setShape({ number })} gesture={gesture} />
            )}
            {o.shape.type === "callout" && (
              <Field label="Callout text">
                <textarea value={o.shape.text} rows={2} maxLength={120} onChange={(e) => setShape({ text: e.target.value })} className={inputCls} />
              </Field>
            )}
            {o.shape.type === "arrow" && <p className="text-[11px] text-muted">Rotate the layer (handle on the preview, or Rotation below) to aim the arrow.</p>}
          </div>
        )}
        {o.kind === "text" && (
          <>
            <textarea
              ref={textAreaRef}
              value={o.text.content}
              rows={3}
              onFocus={gesture.onGestureStart}
              onBlur={gesture.onGestureEnd}
              onChange={(e) => setText({ content: e.target.value })}
              aria-label="Text content"
              className={`${inputCls} resize-y`}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Font">
                <select className={inputCls} value={o.text.font} onChange={(e) => setText({ font: e.target.value })}>
                  {Object.entries(TEXT_FONTS).map(([k, f]) => (
                    <option key={k} value={k}>
                      {f.label}
                    </option>
                  ))}
                  {fonts.custom.length > 0 && (
                    <optgroup label="Your fonts">
                      {fonts.custom.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <FontUpload onUpload={fonts.onUpload} />
              </Field>
              <Field label="Weight">
                <select className={inputCls} value={o.text.weight} onChange={(e) => setText({ weight: Number(e.target.value) as TextStyle["weight"] })}>
                  <option value={400}>Regular</option>
                  <option value={700}>Bold</option>
                  <option value={900}>Black</option>
                </select>
              </Field>
            </div>
            <SliderField label="Size" value={Math.round(o.text.size * 1000) / 10} min={1.5} max={30} step={0.5} format={(v) => `${v}`} onChange={(v) => setText({ size: v / 100 })} gesture={gesture} />
            <div className="flex flex-wrap items-center gap-2">
              <Chips
                label="Alignment"
                value={o.text.align}
                onChange={(align) => setText({ align })}
                options={[
                  { value: "left", label: "Left" },
                  { value: "center", label: "Center" },
                  { value: "right", label: "Right" },
                ]}
              />
              <button
                type="button"
                aria-pressed={o.text.italic}
                onClick={() => setText({ italic: !o.text.italic })}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold italic ${o.text.italic ? "border-accent-2 bg-accent-2 text-black" : "border-border bg-surface text-foreground"}`}
              >
                Italic
              </button>
              <button
                type="button"
                aria-pressed={o.text.shadow}
                onClick={() => setText({ shadow: !o.text.shadow })}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${o.text.shadow ? "border-accent-2 bg-accent-2 text-black" : "border-border bg-surface text-foreground"}`}
              >
                Shadow
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ColorField label="Text" value={o.text.color} onChange={(color) => setText({ color })} gesture={gesture} />
              <ColorField label="Outline" value={o.text.strokeColor} onChange={(strokeColor) => setText({ strokeColor })} gesture={gesture} />
              <ColorField label="Background" value={o.text.background} onChange={(background) => setText({ background })} gesture={gesture} />
            </div>
            <Field label="Text animation">
              <select className={inputCls} value={o.text.anim ?? "none"} onChange={(e) => setText({ anim: e.target.value as TextAnim })}>
                {(Object.keys(TEXT_ANIM_LABELS) as TextAnim[]).map((k) => (
                  <option key={k} value={k}>
                    {proLabel(TEXT_ANIM_LABELS[k], k === "karaoke")}
                  </option>
                ))}
              </select>
            </Field>
            {o.text.anim === "karaoke" && (
              <ColorField label="Highlight" value={o.text.highlight ?? "#facc15"} onChange={(highlight) => setText({ highlight })} gesture={gesture} />
            )}
            {o.text.anim && o.text.anim !== "none" && o.text.anim !== "typewriter" && (
              <p className="text-[11px] text-muted">
                {o.words?.length ? "Follows when each word is spoken." : "Words are spread evenly over the layer's time. Auto captions follow the speech."}
              </p>
            )}
            <SliderField label="Outline width" value={Math.round(o.text.strokeWidth * 100)} min={0} max={15} neutral={0} onChange={(v) => setText({ strokeWidth: v / 100 })} gesture={gesture} />
            <SliderField label="Background opacity" value={Math.round(o.text.backgroundOpacity * 100)} min={0} max={100} neutral={0} format={(v) => `${v}%`} onChange={(v) => setText({ backgroundOpacity: v / 100 })} gesture={gesture} />
            <SliderField label="Letter spacing" value={Math.round(o.text.letterSpacing * 100)} min={-10} max={50} neutral={0} onChange={(v) => setText({ letterSpacing: v / 100 })} gesture={gesture} />
            <SliderField label="Line spacing" value={Math.round(o.text.lineHeight * 100)} min={80} max={250} neutral={115} format={(v) => `${(v / 100).toFixed(2)}`} onChange={(v) => setText({ lineHeight: v / 100 })} gesture={gesture} />
          </>
        )}

        <div>
          <SectionTitle>Timing</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Appears at">
              <SecondsInput value={o.start} min={0} max={o.end - 0.2} onCommit={(start) => onChange({ start })} />
            </Field>
            <Field label="Disappears at">
              <SecondsInput
                value={o.end}
                min={o.start + 0.2}
                max={Math.max(o.start + 0.2, o.kind === "video" && sourceDuration ? Math.min(total, o.start + sourceDuration - o.offset) : total)}
                onCommit={(end) => onChange({ end })}
              />
            </Field>
          </div>
        </div>

        {o.kind === "video" && (
          <div className="space-y-3">
            <SectionTitle>Video</SectionTitle>
            <SliderField
              label="Volume"
              value={Math.round(o.volume * 100)}
              min={0}
              max={200}
              neutral={100}
              format={(v) => `${v}%`}
              onChange={(v) => onChange({ volume: v / 100 } as Partial<Overlay>)}
              gesture={gesture}
            />
            <p className="text-[11px] text-muted">
              Plays from {formatTime(o.offset, true)} of its video. Drag the layer&apos;s left edge on the timeline to start later in the video.
            </p>
          </div>
        )}
        {o.kind === "video" && onCamLayout && <CamLayoutSection layout={o.camLayout} onChange={onCamLayout} />}

        <OverlayTransformFields overlay={o} onChange={onChange} gesture={gesture} keys={keys} />

        <div className="space-y-3">
          <SectionTitle>
            Blend
            <ProTag />
          </SectionTitle>
          <Field label="Blend mode">
            <select className={inputCls} value={o.blend ?? "normal"} onChange={(e) => onChange({ blend: e.target.value as BlendMode })}>
              {(Object.keys(BLEND_LABELS) as BlendMode[]).map((k) => (
                <option key={k} value={k}>
                  {BLEND_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
          {(o.kind === "image" || o.kind === "video") && <ChromaKeySection overlay={o} onChange={onChange} gesture={gesture} />}
        </div>
        <MaskSection mask={o.mask} onChange={(mask) => onChange({ mask })} gesture={gesture} />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Entrance">
            <select className={inputCls} value={o.animIn} onChange={(e) => onChange({ animIn: e.target.value as AnimIn })}>
              {(Object.keys(ANIM_IN_LABELS) as AnimIn[]).map((k) => (
                <option key={k} value={k}>
                  {ANIM_IN_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Exit">
            <select className={inputCls} value={o.animOut} onChange={(e) => onChange({ animOut: e.target.value as AnimOut })}>
              {(Object.keys(ANIM_OUT_LABELS) as AnimOut[]).map((k) => (
                <option key={k} value={k}>
                  {ANIM_OUT_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <ActionButton onClick={() => onRestack(1)} title="Bring forward">
            Forward
          </ActionButton>
          <ActionButton onClick={() => onRestack(-1)} title="Send backward">
            Backward
          </ActionButton>
          <ActionButton onClick={() => onChange({ hidden: !o.hidden })}>{o.hidden ? "Show" : "Hide"}</ActionButton>
          <ActionButton onClick={() => onChange({ locked: !o.locked })}>{o.locked ? "Unlock" : "Lock"}</ActionButton>
          <ActionButton onClick={onDuplicate} title={`Duplicate (${shortcutKeys.mod}+D)`}>
            Duplicate
          </ActionButton>
          <ActionButton onClick={style.onCopy} title="Copy the look, animation, mask and blend of this layer">
            Copy style
          </ActionButton>
          {style.onPaste && <ActionButton onClick={style.onPaste}>Paste style</ActionButton>}
          <ActionButton onClick={onDelete} tone="danger">
            <TrashIcon width={14} height={14} /> Delete
          </ActionButton>
        </div>
      </div>
    </PanelShell>
  );
}

function OverlayTransformFields({ overlay: o, onChange, gesture, keys }: { overlay: Overlay; onChange: (patch: Partial<Overlay>) => void; gesture: Gesture; keys: KeyframeControls }) {
  const time = useClockTime(keys.clock);
  const v = overlayValues(o, time);
  return (
    <div className="space-y-3">
      <SectionTitle>Transform</SectionTitle>
      <SliderField label="X" value={Math.round(v.x * 100)} min={-30} max={130} neutral={50} format={(n) => `${n}%`} onChange={(n) => onChange({ x: n / 100 })} gesture={gesture} />
      <SliderField label="Y" value={Math.round(v.y * 100)} min={-30} max={130} neutral={50} format={(n) => `${n}%`} onChange={(n) => onChange({ y: n / 100 })} gesture={gesture} />
      {o.kind !== "text" ? (
        <SliderField label="Size" value={Math.round(o.width * v.scale * 100)} min={3} max={200} format={(n) => `${n}%`} onChange={(n) => onChange({ width: n / 100 })} gesture={gesture} />
      ) : (
        o.keyframes?.length ? (
          <SliderField label="Scale" value={Math.round(v.scale * 100)} min={5} max={400} neutral={100} format={(n) => `${n}%`} onChange={(n) => onChange({ text: { ...o.text, size: (o.text.size * n) / 100 } } as Partial<Overlay>)} gesture={gesture} />
        ) : null
      )}
      <SliderField label="Rotation" value={Math.round(v.rotation)} min={-180} max={180} neutral={0} format={(n) => `${n}°`} onChange={(n) => onChange({ rotation: n })} gesture={gesture} />
      <SliderField label="Opacity" value={Math.round(v.opacity * 100)} min={0} max={100} neutral={100} format={(n) => `${n}%`} onChange={(n) => onChange({ opacity: n / 100 })} gesture={gesture} />
      <KeyframeBar time={time} keys={keys} />
    </div>
  );
}

/** Shape mask controls, shared by clips and layers. */
function MaskSection({ mask, onChange, gesture }: { mask: ShapeMask | null | undefined; onChange: (mask: ShapeMask | null) => void; gesture: Gesture }) {
  const proLabel = useProLabel();
  const m = mask;
  const set = (patch: Partial<ShapeMask>) => m && onChange({ ...m, ...patch });
  const pct = (v: number) => `${v}%`;
  return (
    <div className="space-y-3">
      <SectionTitle>Mask</SectionTitle>
      <Field label="Shape">
        <select
          className={inputCls}
          value={m?.shape ?? "none"}
          onChange={(e) => {
            const shape = e.target.value as ShapeMask["shape"] | "none";
            onChange(shape === "none" ? null : { ...(m ?? DEFAULT_MASK), shape, ...(shape === "linear" || shape === "mirror" ? { h: m?.h ?? 0.4 } : {}) });
          }}
        >
          <option value="none">None</option>
          {(Object.keys(MASK_LABELS) as ShapeMask["shape"][]).map((k) => (
            <option key={k} value={k}>
              {proLabel(MASK_LABELS[k], k === "linear" || k === "mirror")}
            </option>
          ))}
        </select>
      </Field>
      {m && (
        <>
          <SliderField label="Center X" value={Math.round(m.x * 100)} min={0} max={100} neutral={50} format={pct} onChange={(v) => set({ x: v / 100 })} gesture={gesture} />
          <SliderField label="Center Y" value={Math.round(m.y * 100)} min={0} max={100} neutral={50} format={pct} onChange={(v) => set({ y: v / 100 })} gesture={gesture} />
          {(m.shape === "circle" || m.shape === "rect") && (
            <SliderField label="Width" value={Math.round(m.w * 100)} min={2} max={200} neutral={60} format={pct} onChange={(v) => set({ w: v / 100 })} gesture={gesture} />
          )}
          {m.shape !== "linear" && (
            <SliderField label={m.shape === "mirror" ? "Band height" : "Height"} value={Math.round(m.h * 100)} min={2} max={200} neutral={60} format={pct} onChange={(v) => set({ h: v / 100 })} gesture={gesture} />
          )}
          <SliderField label="Rotation" value={Math.round(m.rotation)} min={-180} max={180} neutral={0} format={(v) => `${v}°`} onChange={(v) => set({ rotation: v })} gesture={gesture} />
          <SliderField label="Feather" value={Math.round(m.feather * 100)} min={0} max={100} neutral={10} format={pct} onChange={(v) => set({ feather: v / 100 })} gesture={gesture} />
          {m.shape === "rect" && (
            <SliderField label="Corner radius" value={Math.round((m.radius ?? 0) * 100)} min={0} max={100} neutral={0} format={pct} onChange={(v) => set({ radius: v / 100 })} gesture={gesture} />
          )}
          <label className="flex items-center justify-between text-xs font-medium text-foreground">
            <span>
              Invert (show the outside)
              <ProTag />
            </span>
            <input type="checkbox" checked={m.invert} onChange={(e) => set({ invert: e.target.checked })} />
          </label>
        </>
      )}
    </div>
  );
}

function FontUpload({ onUpload }: { onUpload: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
      />
      <button type="button" className="mt-1 text-[11px] font-semibold text-accent-2 hover:underline" onClick={() => input.current?.click()}>
        Upload a font…
        <ProTag />
      </button>
    </>
  );
}

const BLEND_LABELS: Record<BlendMode, string> = {
  normal: "Normal",
  multiply: "Multiply",
  screen: "Screen",
  overlay: "Overlay",
  darken: "Darken",
  lighten: "Lighten",
  add: "Add",
  difference: "Difference",
};

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

function ChromaKeySection({ overlay: o, onChange, gesture }: { overlay: Overlay; onChange: (patch: Partial<Overlay>) => void; gesture: Gesture }) {
  const key = o.key;
  const dropper = typeof window !== "undefined" ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper : undefined;
  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <label className="flex items-center justify-between text-xs font-semibold text-foreground">
        <span>
          Remove a color (green screen)
          <ProTag />
        </span>
        <input type="checkbox" checked={!!key} onChange={(e) => onChange({ key: e.target.checked ? DEFAULT_KEY : null })} />
      </label>
      {key && (
        <>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <ColorField label="Key color" value={key.color} onChange={(color) => onChange({ key: { ...key, color } })} gesture={gesture} />
            </div>
            {dropper && (
              <button
                type="button"
                title="Pick the color from the screen"
                className="h-8 rounded border border-border px-2 text-xs text-foreground hover:border-accent-2"
                onClick={() =>
                  new dropper()
                    .open()
                    .then((r) => onChange({ key: { ...key, color: r.sRGBHex.slice(0, 7) } }))
                    .catch(() => {})
                }
              >
                Pick
              </button>
            )}
          </div>
          <SliderField label="Strength" value={key.similarity} min={1} max={100} neutral={DEFAULT_KEY.similarity} onChange={(similarity) => onChange({ key: { ...key, similarity } })} gesture={gesture} />
          <SliderField label="Edge softness" value={key.smoothness} min={0} max={100} neutral={DEFAULT_KEY.smoothness} onChange={(smoothness) => onChange({ key: { ...key, smoothness } })} gesture={gesture} />
        </>
      )}
    </div>
  );
}

// --- Audio --------------------------------------------------------------------

export interface VoiceoverControls {
  /** Timeline time the take started at; null when not recording. */
  recordingFrom: number | null;
  clock: Clock;
  level: () => number;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
}

export function AudioAddPanel({
  audio,
  onUpload,
  onSelect,
  onClose,
  voiceover,
  onAddSfx,
  mixer,
}: {
  /** The mix (MixerPanel), shown first. */
  mixer?: ReactNode;
  audio: AudioClip[];
  onUpload: (file: File) => void;
  onAddSfx: (def: SfxDef) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
  voiceover: VoiceoverControls;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <PanelShell title="Audio" onClose={onClose}>
      {mixer && <div className="mb-5">{mixer}</div>}
      <input
        ref={input}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
      />
      <button type="button" onClick={() => input.current?.click()} className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold">
        + Upload music or audio
      </button>
      <p className="mt-2 text-[11px] text-muted">MP3, WAV, M4A, AAC or OGG, up to 50MB. Added at the playhead.</p>
      <VoiceoverRecorder controls={voiceover} />
      <SectionTitle>
        <span className="mt-5 block">Sound effects</span>
      </SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        {SFX.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onAddSfx(s)}
            title={`Add ${s.label} at the playhead`}
            className="flex flex-col items-center gap-1 rounded-xl border border-border bg-surface p-2.5 text-[11px] font-semibold text-foreground transition hover:border-accent-2"
          >
            <span className="text-lg leading-none" aria-hidden>
              {s.icon}
            </span>
            {s.label}
          </button>
        ))}
      </div>
      <SectionTitle>
        <span className="mt-5 block">Tracks</span>
      </SectionTitle>
      {audio.length === 0 ? (
        <p className="text-xs text-muted">No audio tracks yet. Upload music, or select a clip and use “Extract audio”.</p>
      ) : (
        <ul className="space-y-1.5">
          {audio.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onSelect(a.id)}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-left text-xs hover:border-accent/50"
              >
                <span className="truncate font-semibold text-foreground">♪ {a.label}</span>
                <span className="font-mono text-muted">
                  {formatTime(a.start, true)} · {formatTime(a.duration, true)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}

function VoiceoverRecorder({ controls }: { controls: VoiceoverControls }) {
  const { recordingFrom, clock, level, onStart, onStop, onCancel } = controls;
  const time = useClockTime(clock);
  const [meter, setMeter] = useState(0);
  useEffect(() => {
    if (recordingFrom === null) return;
    const id = window.setInterval(() => setMeter(level()), 80);
    return () => window.clearInterval(id);
  }, [recordingFrom, level]);

  if (!voiceoverSupported()) return null;
  if (recordingFrom === null) {
    return (
      <>
        <button
          type="button"
          onClick={onStart}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface py-2.5 text-sm font-semibold text-foreground transition hover:border-accent-2"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden /> Record voiceover
        </button>
        <p className="mt-2 text-[11px] text-muted">
          Plays the video from the playhead while you talk. Pause or press Stop to finish. Use headphones so the video&apos;s sound isn&apos;t recorded too.
        </p>
      </>
    );
  }
  return (
    <div className="mt-3 rounded-xl border border-red-500/50 bg-red-500/10 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" aria-hidden />
        Recording · <span className="font-mono">{formatTime(Math.max(0, time - recordingFrom), true)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
        <div className="h-full bg-red-500 transition-[width] duration-75" style={{ width: `${Math.round(meter * 100)}%` }} />
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onStop} className="btn-primary flex-1 rounded-lg py-2 text-xs font-semibold">
          ■ Stop and add
        </button>
        <button type="button" onClick={onCancel} className="flex-1 rounded-lg border border-border py-2 text-xs font-semibold text-muted hover:text-foreground">
          Discard
        </button>
      </div>
    </div>
  );
}

/** Webcam layouts for a video layer: shape, size and corner, or side by
 * side with the screen. Placed again when the canvas size changes. */
function CamLayoutSection({ layout, onChange }: { layout?: CamLayout; onChange: (l: CamLayout | null) => void }) {
  const l = layout ?? DEFAULT_CAM_LAYOUT;
  const set = (patch: Partial<CamLayout>) => onChange({ ...l, ...patch });
  return (
    <div className="space-y-3">
      <SectionTitle>Webcam layout</SectionTitle>
      <Chips
        label="Webcam shape"
        value={layout ? (layout.split ? "split" : layout.shape) : "free"}
        onChange={(v) => (v === "free" ? onChange(null) : v === "split" ? set({ split: true }) : set({ shape: v as CamLayout["shape"], split: false }))}
        options={[
          ...(Object.keys(CAM_SHAPE_LABELS) as CamLayout["shape"][]).map((k) => ({ value: k as string, label: CAM_SHAPE_LABELS[k] })),
          { value: "split", label: "Side by side" },
          ...(layout ? [{ value: "free", label: "Free" }] : []),
        ]}
      />
      {layout && !layout.split && (
        <>
          <Chips label="Webcam size" value={l.size} onChange={(size) => set({ size })} options={[{ value: "small", label: "S" }, { value: "medium", label: "M" }, { value: "large", label: "L" }]} />
          <Chips
            label="Webcam corner"
            value={l.corner}
            onChange={(corner) => set({ corner })}
            options={(Object.keys(CAM_CORNER_LABELS) as CamLayout["corner"][]).map((k) => ({ value: k, label: CAM_CORNER_LABELS[k] }))}
          />
        </>
      )}
      <p className="text-[11px] text-muted">
        {layout?.split
          ? "The screen takes the rest of the frame: beside the webcam in a landscape video, above it in a vertical one."
          : layout
            ? "Kept in place when you change the canvas size. Dragging the layer switches to free placement."
            : "Pick a shape to place this video as a webcam bubble."}
      </p>
    </div>
  );
}

/** Noise reduction strengths (audio_clean.py: 6..40 dB of reduction). */
const NOISE_STRENGTHS = [
  { value: 0.25, label: "Light" },
  { value: 0.5, label: "Medium" },
  { value: 0.8, label: "Strong" },
];

export function AudioPanel({
  clip,
  sourceDuration,
  total,
  onChange,
  onSplit,
  onDuplicate,
  onDelete,
  onClose,
  gesture,
  onDuck,
  onBeats,
  onCleanup,
  cleaning,
  soloed,
  onSolo,
}: {
  clip: AudioClip;
  sourceDuration: number;
  total: number;
  /** Makes the noise-reduced copy at a strength 0..1; absent = no local
   * engine (the browser version), so the section explains instead. */
  onCleanup?: (strength: number) => void;
  /** A copy is being made for this track. */
  cleaning?: boolean;
  /** Solo for listening (preview only). */
  soloed: boolean;
  onSolo: () => void;
  /** Finds the speech to duck under and turns ducking on. */
  onDuck: () => void;
  /** Detects the track's beats (timeline markers to snap to). */
  onBeats: () => void;
  onChange: (patch: Partial<AudioClip>) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
  gesture: Gesture;
}) {
  const a = clip;
  const [strength, setStrength] = useState(a.clean?.strength ?? 0.5);
  return (
    <PanelShell title={`Audio · ${a.label}`} onClose={onClose}>
      <div className="space-y-4">
        <SliderField label="Volume" value={Math.round(a.volume * 100)} min={0} max={200} neutral={100} format={(v) => `${v}%`} onChange={(v) => onChange({ volume: v / 100 })} gesture={gesture} />
        <SliderField label="Fade in" value={a.fadeIn} min={0} max={Math.min(5, a.duration / 2)} step={0.1} neutral={0} format={(v) => `${v.toFixed(1)}s`} onChange={(fadeIn) => onChange({ fadeIn })} gesture={gesture} />
        <SliderField label="Fade out" value={a.fadeOut} min={0} max={Math.min(5, a.duration / 2)} step={0.1} neutral={0} format={(v) => `${v.toFixed(1)}s`} onChange={(fadeOut) => onChange({ fadeOut })} gesture={gesture} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts at">
            <SecondsInput value={a.start} min={0} max={Math.max(0, total - 0.2)} onCommit={(start) => onChange({ start })} />
          </Field>
          <Field label="Length">
            <SecondsInput value={a.duration} min={0.2} max={sourceDuration - a.offset} onCommit={(duration) => onChange({ duration })} />
          </Field>
          <Field label="From (in file)">
            <SecondsInput
              value={a.offset}
              min={0}
              max={Math.max(0, sourceDuration - 0.2)}
              onCommit={(offset) => onChange({ offset, duration: Math.min(a.duration, sourceDuration - offset) })}
            />
          </Field>
        </div>
        <div>
          <SectionTitle>Auto captions</SectionTitle>
          <Chips
            label="Auto captions"
            value={a.captions ?? "auto"}
            onChange={(captions) => onChange({ captions })}
            options={[
              { value: "auto", label: "Detect" },
              { value: "speech", label: "Voice" },
              { value: "music", label: "Music" },
            ]}
          />
          <p className="mt-1.5 text-[11px] text-muted">Voice is captioned, music is not. Detect tells them apart from the sound.</p>
        </div>
        <div className="space-y-3">
          <SectionTitle>
            Lower under speech
            <ProTag />
          </SectionTitle>
          {a.duck ? (
            <>
              <SliderField
                label="Lower by"
                value={Math.round(a.duck.amount * 100)}
                min={10}
                max={100}
                neutral={Math.round(DEFAULT_DUCK_AMOUNT * 100)}
                format={(v) => `${v}%`}
                onChange={(v) => onChange({ duck: { ...a.duck!, amount: v / 100 } })}
                gesture={gesture}
              />
              <p className="text-[11px] text-muted">
                Lowered during {a.duck.regions.length} stretch{a.duck.regions.length === 1 ? "" : "es"} of speech.{" "}
                <button type="button" className="font-semibold text-accent-2 hover:underline" onClick={onDuck}>
                  Find speech again
                </button>{" "}
                ·{" "}
                <button type="button" className="font-semibold text-accent-2 hover:underline" onClick={() => onChange({ duck: undefined })}>
                  Turn off
                </button>
              </p>
            </>
          ) : (
            <>
              <ActionButton onClick={onDuck} title="Turn this track down automatically whenever someone speaks in the video or a voiceover">
                Lower this track when someone speaks
              </ActionButton>
              <p className="text-[11px] text-muted">For background music under talking. Run it again after editing the speech.</p>
            </>
          )}
        </div>
        <div className="space-y-2">
          <SectionTitle>Noise reduction</SectionTitle>
          {onCleanup ? (
            <>
              <Chips
                label="Noise reduction strength"
                value={strength}
                onChange={setStrength}
                options={NOISE_STRENGTHS.map((s) => ({ value: s.value, label: s.label }))}
              />
              {a.clean && (
                <Chips
                  label="Compare"
                  value={a.clean.bypass ? "original" : "cleaned"}
                  onChange={(v) => onChange({ clean: { ...a.clean!, bypass: v === "original" } })}
                  options={[
                    { value: "cleaned", label: "Cleaned" },
                    { value: "original", label: "Original" },
                  ]}
                />
              )}
              <div className="flex flex-wrap items-center gap-2">
                {(!a.clean || a.clean.strength !== strength) && (
                  <ActionButton onClick={() => onCleanup(strength)} disabled={cleaning} title="Reduce steady background noise on this computer">
                    {cleaning ? "Reducing noise…" : a.clean ? "Apply this strength" : "Reduce background noise"}
                  </ActionButton>
                )}
                {a.clean && !cleaning && (
                  <button type="button" className="text-[11px] font-semibold text-accent-2 hover:underline" onClick={() => onChange({ clean: undefined })}>
                    Remove
                  </button>
                )}
              </div>
              <p className="text-[11px] text-muted">
                {a.clean
                  ? `${a.clean.bypass ? "Playing and exporting the original." : "Playing and exporting the cleaned copy."} Switch to compare while it plays.`
                  : "For steady noise: fans, hum, hiss, room tone. Clicks and other voices stay."}{" "}
                Made on this computer; the original file isn&apos;t changed.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted">Noise reduction runs on your computer in the WipeClip desktop app, so the recording never leaves it.</p>
          )}
        </div>
        <div>
          <SectionTitle>Beats</SectionTitle>
          {a.beats ? (
            <p className="text-[11px] text-muted">
              {Math.round(a.beats.bpm)} BPM · {a.beats.times.length} beats marked on the timeline; clips and layers snap to them.{" "}
              <button type="button" className="font-semibold text-accent-2 hover:underline" onClick={() => onChange({ beats: undefined })}>
                Remove
              </button>
            </p>
          ) : (
            <ActionButton onClick={onBeats} title="Mark the music's beats on the timeline so cuts and layers snap to them">
              Find the beat
            </ActionButton>
          )}
        </div>
        <div>
          <SectionTitle>
            Voice effect
            <ProTag />
          </SectionTitle>
          <select className={inputCls} value={a.voice ?? "none"} onChange={(e) => onChange({ voice: e.target.value as VoiceFx })} aria-label="Voice effect">
            {(Object.keys(VOICE_FX_LABELS) as VoiceFx[]).map((k) => (
              <option key={k} value={k}>
                {VOICE_FX_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <ActionButton onClick={() => onChange({ muted: !a.muted })}>{a.muted ? "Unmute" : "Mute"}</ActionButton>
          <ActionButton onClick={onSolo} title="Hear only this track (preview only; the export includes every unmuted track)">
            {soloed ? "Unsolo" : "Solo"}
          </ActionButton>
          <ActionButton onClick={onSplit} title="Split at the playhead (S)">
            Split
          </ActionButton>
          <ActionButton onClick={onDuplicate}>Duplicate</ActionButton>
          <ActionButton onClick={onDelete} tone="danger">
            <TrashIcon width={14} height={14} /> Delete
          </ActionButton>
        </div>
      </div>
    </PanelShell>
  );
}

// --- Effects -----------------------------------------------------------------

const EFFECT_ICONS: Record<EffectType, string> = {
  blur: "◌",
  motionblur: "≋",
  glitch: "▚",
  vhs: "📼",
  grain: "░",
  noise: "▒",
  pixelate: "▦",
  rgbsplit: "◐",
  flash: "✦",
  shake: "〰",
  zoom: "⤢",
  bw: "◑",
  sepia: "☕",
  invert: "◩",
  hue: "🌈",
  vignette: "◉",
  letterbox: "▭",
  strobe: "⚡",
  mirror: "⇋",
};

export function EffectsAddPanel({
  onAdd,
  onClose,
  premiumLocked = false,
}: {
  onAdd: (type: EffectType) => void;
  onClose: () => void;
  premiumLocked?: boolean;
}) {
  return (
    <PanelShell title="Effects" onClose={onClose}>
      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(EFFECT_LABELS) as EffectType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onAdd(t)}
            title={`Add ${EFFECT_LABELS[t]}`}
            className="relative flex flex-col items-center gap-1 rounded-xl border border-border bg-surface p-3 text-[11px] font-semibold text-foreground transition hover:border-accent-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
          >
            <span className="text-xl leading-none" aria-hidden>
              {EFFECT_ICONS[t]}
            </span>
            {EFFECT_LABELS[t]}
            {premiumLocked && isPremiumEffect(t) && <PremiumBadge />}
          </button>
        ))}
      </div>
      {premiumLocked && <PremiumNote />}
      <p className="mt-4 text-[11px] text-muted">Effects are added at the playhead for 2 seconds and only apply during their time on the effects track.</p>
    </PanelShell>
  );
}

export { EFFECT_ICONS };

export function EffectPanel({
  effect,
  total,
  onChange,
  onDuplicate,
  onDelete,
  onClose,
  gesture,
  premiumLocked = false,
}: {
  effect: EffectClip;
  total: number;
  onChange: (patch: Partial<EffectClip>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
  gesture: Gesture;
  premiumLocked?: boolean;
}) {
  const e = effect;
  return (
    <PanelShell title={`Effect · ${EFFECT_LABELS[e.type]}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Effect">
          <select className={inputCls} value={e.type} onChange={(ev) => onChange({ type: ev.target.value as EffectType })}>
            {(Object.keys(EFFECT_LABELS) as EffectType[]).map((t) => (
              <option key={t} value={t}>
                {EFFECT_LABELS[t]}
                {premiumLocked && isPremiumEffect(t) ? " (Premium)" : ""}
              </option>
            ))}
          </select>
        </Field>
        {premiumLocked && isPremiumEffect(e.type) && <PremiumNote />}
        <SliderField label="Intensity" value={e.intensity} min={0} max={100} neutral={50} format={(v) => `${v}%`} onChange={(intensity) => onChange({ intensity })} gesture={gesture} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts at">
            <SecondsInput value={e.start} min={0} max={e.end - 0.1} onCommit={(start) => onChange({ start })} />
          </Field>
          <Field label="Ends at">
            <SecondsInput value={e.end} min={e.start + 0.1} max={Math.max(total, e.start + 0.1)} onCommit={(end) => onChange({ end })} />
          </Field>
        </div>
        <div className="flex gap-2 border-t border-border pt-4">
          <ActionButton onClick={onDuplicate}>Duplicate</ActionButton>
          <ActionButton onClick={onDelete} tone="danger">
            <TrashIcon width={14} height={14} /> Delete
          </ActionButton>
        </div>
      </div>
    </PanelShell>
  );
}

// --- Canvas --------------------------------------------------------------------

export function CanvasPanel({
  canvas,
  onChange,
  onUploadBackground,
  onClose,
  gesture,
  onPreset,
}: {
  canvas: Canvas;
  onChange: (c: Canvas) => void;
  onUploadBackground: (file: File) => void;
  onClose: () => void;
  gesture: Gesture;
  /** Creator presets (creatorPresets.ts); absent = not offered. */
  onPreset?: (id: CreatorPresetId) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const bg = canvas.background;
  return (
    <PanelShell title="Canvas" onClose={onClose}>
      {onPreset && (
        <>
          <SectionTitle>Made for</SectionTitle>
          <div className="mb-1 grid grid-cols-2 gap-2">
            {CREATOR_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPreset(p.id)}
                className="rounded-xl border border-border bg-surface px-3 py-2 text-left transition hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
              >
                <span className="block text-sm font-semibold text-foreground">{p.label}</span>
                <span className="block text-[11px] text-muted">{p.hint}</span>
              </button>
            ))}
          </div>
          <p className="mb-4 text-[11px] text-muted">Sets the options below (one undo step); change any of them afterwards.</p>
        </>
      )}
      <SectionTitle>Size</SectionTitle>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Canvas size">
        {CANVAS_PRESETS.map((p) => (
          <button
            key={p.aspect}
            type="button"
            role="radio"
            aria-checked={canvas.aspect === p.aspect}
            onClick={() => onChange({ ...canvas, aspect: p.aspect })}
            className={`rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
              canvas.aspect === p.aspect ? "border-accent-2 bg-accent-2/10" : "border-border bg-surface hover:border-accent/50"
            }`}
          >
            <span className="block text-sm font-semibold text-foreground">{p.label}</span>
            <span className="block text-[11px] text-muted">{p.hint}</span>
          </button>
        ))}
      </div>

      <SectionTitle>
        <span className="mt-5 block">Video in canvas</span>
      </SectionTitle>
      <Chips
        label="Fit mode"
        value={canvas.fit}
        onChange={(fit) => onChange({ ...canvas, fit })}
        options={[
          { value: "fit", label: "Fit (show all)" },
          { value: "fill", label: "Fill (crop edges)" },
        ]}
      />

      <SectionTitle>
        <span className="mt-5 block">Background</span>
      </SectionTitle>
      <Chips
        label="Background"
        value={bg.type}
        onChange={(type) => {
          if (type === "color") onChange({ ...canvas, background: { type, color: "color" in bg ? bg.color : "#000000" } });
          if (type === "gradient") onChange({ ...canvas, background: { type, color: "#7c5cff", color2: "#22d3ee" } });
          if (type === "blur") onChange({ ...canvas, background: { type } });
          if (type === "image") input.current?.click();
        }}
        options={[
          { value: "color", label: "Color" },
          { value: "gradient", label: "Gradient" },
          { value: "blur", label: "Blur" },
          { value: "image", label: "Image" },
        ]}
      />
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadBackground(f);
          e.target.value = "";
        }}
      />
      <div className="mt-3 space-y-2">
        {bg.type === "color" && <ColorField label="Color" value={bg.color} onChange={(color) => onChange({ ...canvas, background: { type: "color", color } })} gesture={gesture} />}
        {bg.type === "gradient" && (
          <>
            <ColorField label="Top" value={bg.color} onChange={(color) => onChange({ ...canvas, background: { ...bg, color } })} gesture={gesture} />
            <ColorField label="Bottom" value={bg.color2} onChange={(color2) => onChange({ ...canvas, background: { ...bg, color2 } })} gesture={gesture} />
          </>
        )}
        {bg.type === "image" && <ActionButton onClick={() => input.current?.click()}>Change image…</ActionButton>}
      </div>
      <p className="mt-4 text-[11px] text-muted">The background shows wherever the video doesn&apos;t cover the canvas.</p>

      <SectionTitle>
        <span className="mt-5 block">Frame</span>
      </SectionTitle>
      <Chips
        label="Frame"
        value={framePreset(canvas.frame)}
        onChange={(preset) => {
          if (preset === "custom") return;
          const next: Canvas = { ...canvas, frame: preset === "none" ? undefined : FRAME_PRESETS[preset] };
          if (!next.frame) delete next.frame;
          onChange(next);
        }}
        options={[
          { value: "none", label: "None" },
          { value: "subtle", label: "Subtle" },
          { value: "card", label: "Card" },
          { value: "floating", label: "Floating" },
          ...(framePreset(canvas.frame) === "custom" ? [{ value: "custom" as const, label: "Custom" }] : []),
        ]}
      />
      {canvas.frame && (
        <div className="mt-3 space-y-2">
          <SliderField
            label="Padding"
            value={Math.round(canvas.frame.padding * 100)}
            min={0}
            max={20}
            neutral={0}
            format={(v) => `${v}%`}
            onChange={(v) => onChange({ ...canvas, frame: { ...canvas.frame!, padding: v / 100 } })}
            gesture={gesture}
          />
          <SliderField
            label="Corners"
            value={Math.round(canvas.frame.radius * 1000)}
            min={0}
            max={100}
            neutral={0}
            format={(v) => `${v}`}
            onChange={(v) => onChange({ ...canvas, frame: { ...canvas.frame!, radius: v / 1000 } })}
            gesture={gesture}
          />
          <SliderField
            label="Shadow"
            value={Math.round(canvas.frame.shadow * 100)}
            min={0}
            max={100}
            neutral={0}
            format={(v) => `${v}%`}
            onChange={(v) => onChange({ ...canvas, frame: { ...canvas.frame!, shadow: v / 100 } })}
            gesture={gesture}
          />
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted">Shows the video as a card on the background - great for screen recordings with a gradient or image behind them.</p>
    </PanelShell>
  );
}

const FRAME_PRESETS = {
  subtle: { padding: 0.05, radius: 0.02, shadow: 0.4 },
  card: { padding: 0.08, radius: 0.035, shadow: 0.7 },
  floating: { padding: 0.12, radius: 0.05, shadow: 1 },
} satisfies Record<string, CanvasFrame>;

function framePreset(f: CanvasFrame | undefined): "none" | "custom" | keyof typeof FRAME_PRESETS {
  if (!f || (f.padding === 0 && f.radius === 0 && f.shadow === 0)) return "none";
  const hit = (Object.keys(FRAME_PRESETS) as (keyof typeof FRAME_PRESETS)[]).find((k) => {
    const p = FRAME_PRESETS[k];
    return p.padding === f.padding && p.radius === f.radius && p.shadow === f.shadow;
  });
  return hit ?? "custom";
}

// --- Layers ---------------------------------------------------------------------

export function LayersPanel({
  overlays,
  selectedId,
  sources,
  onSelect,
  onChange,
  onRestack,
  onDelete,
  onClose,
}: {
  overlays: Overlay[];
  selectedId: string | null;
  sources: Record<string, MediaSource>;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<Overlay>) => void;
  onRestack: (id: string, dir: 1 | -1) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const topFirst = [...overlays].reverse();
  const btn = "rounded p-1 text-xs text-muted hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2";
  return (
    <PanelShell title="Layers" onClose={onClose}>
      <p className="mb-3 text-[11px] text-muted">Top of the list is drawn on top. Video and background are always underneath.</p>
      {topFirst.length === 0 && <p className="text-xs text-muted">No layers yet. Add text, stickers or images.</p>}
      <ul className="space-y-1.5">
        {topFirst.map((o, i) => {
          const name =
            o.kind === "text"
              ? `“${o.text.content.split("\n")[0].slice(0, 24) || "Text"}”`
              : o.kind === "sticker"
                ? (getStickerDef(o.stickerId)?.label ?? "Sticker")
                : o.kind === "shape"
                  ? SHAPE_LABELS[o.shape.type]
                  : ((sources[o.sourceId] ? sourceName(sources[o.sourceId]) : undefined) ?? (o.kind === "video" ? "Video" : "Image"));
          const thumb = o.kind === "sticker" ? stickerThumbSrc(getStickerDef(o.stickerId)!) : o.kind === "image" ? sources[o.sourceId]?.url : null;
          return (
            <li
              key={o.id}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${o.id === selectedId ? "border-accent-2 bg-accent-2/10" : "border-border bg-surface"}`}
            >
              <button type="button" onClick={() => onSelect(o.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-3 text-xs font-bold">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-full w-full object-contain" />
                  ) : o.kind === "sticker" ? (
                    getStickerDef(o.stickerId)?.kind === "emoji" ? (getStickerDef(o.stickerId) as { char: string }).char : "★"
                  ) : o.kind === "video" ? (
                    "▶"
                  ) : (
                    "T"
                  )}
                </span>
                <span className={`truncate text-xs font-semibold ${o.hidden ? "text-muted line-through" : "text-foreground"}`}>{name}</span>
              </button>
              <button type="button" className={btn} title="Bring forward" aria-label="Bring forward" disabled={i === 0} onClick={() => onRestack(o.id, 1)}>
                ↑
              </button>
              <button type="button" className={btn} title="Send backward" aria-label="Send backward" disabled={i === topFirst.length - 1} onClick={() => onRestack(o.id, -1)}>
                ↓
              </button>
              <button type="button" className={btn} title={o.hidden ? "Show" : "Hide"} aria-label={o.hidden ? "Show layer" : "Hide layer"} onClick={() => onChange(o.id, { hidden: !o.hidden })}>
                {o.hidden ? "◌" : "◉"}
              </button>
              <button type="button" className={btn} title={o.locked ? "Unlock" : "Lock"} aria-label={o.locked ? "Unlock layer" : "Lock layer"} onClick={() => onChange(o.id, { locked: !o.locked })}>
                {o.locked ? "🔒" : "🔓"}
              </button>
              <button type="button" className={btn} title="Delete" aria-label="Delete layer" onClick={() => onDelete(o.id)}>
                <TrashIcon width={13} height={13} />
              </button>
            </li>
          );
        })}
      </ul>
    </PanelShell>
  );
}
