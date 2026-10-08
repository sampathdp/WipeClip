"use client";

import { useRef, type ReactNode } from "react";
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
  type Canvas,
  type Clip,
  type Crop,
  type EffectClip,
  type EffectType,
  type Look,
  type MediaSource,
  type Overlay,
  type TextStyle,
} from "@/lib/editor/types";
import { CAPTION_POSITIONS, CAPTION_STYLES, type CaptionStyleId } from "@/lib/editor/captions";
import { isPremiumEffect, isPremiumFilter } from "@/lib/entitlements";
import GradeFilter from "./GradeFilter";
import PremiumBadge from "./PremiumBadge";
import { ActionButton, Field, PanelShell, SecondsInput, StickerLibrary } from "./Inspector";
import { TrashIcon } from "./icons";

/** Brackets a continuous control (slider drag, color picker) as one undo step. */
export interface Gesture {
  onGestureStart: () => void;
  onGestureEnd: () => void;
}

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-2/40";

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
  onOpenLook,
  gesture,
}: {
  clip: Clip;
  source: MediaSource;
  onChange: (patch: Partial<Clip>) => void;
  onExtractAudio: () => void;
  onOpenLook: () => void;
  gesture: Gesture;
}) {
  const t = clip.transform;
  const frozen = clip.freeze !== null;
  const tooLongToReverse = clip.end - clip.start > MAX_REVERSE_SECONDS + 1e-6;
  return (
    <div className="space-y-4">
      {!frozen && (
        <>
          <div>
            <SectionTitle>Speed</SectionTitle>
            <Chips label="Speed" value={clip.speed} onChange={(speed) => onChange({ speed })} options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))} />
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
      <CropSection crop={clip.crop} source={source} onChange={(crop) => onChange({ crop })} gesture={gesture} />
      <div>
        <SectionTitle>Position &amp; size</SectionTitle>
        <div className="space-y-3">
          <SliderField label="X" value={Math.round(t.x * 100)} min={-50} max={150} neutral={50} format={(v) => `${v}%`} onChange={(v) => onChange({ transform: { ...t, x: v / 100 } })} gesture={gesture} />
          <SliderField label="Y" value={Math.round(t.y * 100)} min={-50} max={150} neutral={50} format={(v) => `${v}%`} onChange={(v) => onChange({ transform: { ...t, y: v / 100 } })} gesture={gesture} />
          <SliderField label="Scale" value={Math.round(t.scale * 100)} min={10} max={300} neutral={100} format={(v) => `${v}%`} onChange={(v) => onChange({ transform: { ...t, scale: v / 100 } })} gesture={gesture} />
          <SliderField label="Rotation" value={Math.round(t.rotation)} min={-180} max={180} neutral={0} format={(v) => `${v}°`} onChange={(v) => onChange({ transform: { ...t, rotation: v } })} gesture={gesture} />
        </div>
      </div>
      <ActionButton onClick={onOpenLook}>Filters &amp; adjustments…</ActionButton>
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
}: {
  mode: "filters" | "adjust";
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
          <ActionButton onClick={() => onChange({ ...look, adjust: NEUTRAL_ADJUST })}>Reset all</ActionButton>
        </div>
      )}
      <div className="mt-5 border-t border-border pt-4">
        <ActionButton onClick={onApplyAll}>Apply to all clips</ActionButton>
        <p className="mt-2 text-[11px] text-muted">Changes apply to the selected clip (or the clip under the playhead).</p>
      </div>
    </PanelShell>
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

export function CaptionsPanel({
  options,
  onOptions,
  count,
  busy,
  onGenerate,
  onRestyle,
  onRemoveAll,
  onClose,
}: {
  options: CaptionOptions;
  onOptions: (o: CaptionOptions) => void;
  /** Caption layers already on the timeline. */
  count: number;
  busy: boolean;
  onGenerate: () => void;
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
  return (
    <PanelShell title="Auto captions" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Turns the speech in your clips into timed text layers. Music tracks are ignored. Edit any caption afterwards like normal text. Runs on your device; the first time downloads a speech model (about 80 MB).
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
        <ActionButton onClick={onGenerate} disabled={busy} tone="accent">
          {busy ? "Generating…" : `${count > 0 ? "Regenerate" : "Generate"} captions · free`}
        </ActionButton>
        {count > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs text-muted">
              {count} caption{count === 1 ? "" : "s"} on the Text track. Style and position changes apply to all of them; regenerating replaces them.
            </p>
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
}: {
  overlay: Overlay;
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
  const title =
    o.kind === "text" ? "Text" : o.kind === "image" ? "Image" : o.kind === "video" ? "Video layer" : `Sticker · ${getStickerDef(o.stickerId)?.label ?? ""}`;
  const setText = (patch: Partial<TextStyle>) => o.kind === "text" && onChange({ text: { ...o.text, ...patch } } as Partial<Overlay>);

  return (
    <PanelShell title={title} onClose={onClose}>
      <div className="space-y-4">
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
                </select>
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

        <div className="space-y-3">
          <SectionTitle>Transform</SectionTitle>
          <SliderField label="X" value={Math.round(o.x * 100)} min={-30} max={130} neutral={50} format={(v) => `${v}%`} onChange={(v) => onChange({ x: v / 100 })} gesture={gesture} />
          <SliderField label="Y" value={Math.round(o.y * 100)} min={-30} max={130} neutral={50} format={(v) => `${v}%`} onChange={(v) => onChange({ y: v / 100 })} gesture={gesture} />
          {o.kind !== "text" && (
            <SliderField label="Size" value={Math.round(o.width * 100)} min={3} max={200} format={(v) => `${v}%`} onChange={(v) => onChange({ width: v / 100 })} gesture={gesture} />
          )}
          <SliderField label="Rotation" value={Math.round(o.rotation)} min={-180} max={180} neutral={0} format={(v) => `${v}°`} onChange={(v) => onChange({ rotation: v })} gesture={gesture} />
          <SliderField label="Opacity" value={Math.round(o.opacity * 100)} min={0} max={100} neutral={100} format={(v) => `${v}%`} onChange={(v) => onChange({ opacity: v / 100 })} gesture={gesture} />
        </div>

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
          <ActionButton onClick={onDuplicate} title="Duplicate (Ctrl+D)">
            Duplicate
          </ActionButton>
          <ActionButton onClick={onDelete} tone="danger">
            <TrashIcon width={14} height={14} /> Delete
          </ActionButton>
        </div>
      </div>
    </PanelShell>
  );
}

// --- Audio --------------------------------------------------------------------

export function AudioAddPanel({
  audio,
  onUpload,
  onSelect,
  onClose,
}: {
  audio: AudioClip[];
  onUpload: (file: File) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <PanelShell title="Audio" onClose={onClose}>
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
}: {
  clip: AudioClip;
  sourceDuration: number;
  total: number;
  onChange: (patch: Partial<AudioClip>) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
  gesture: Gesture;
}) {
  const a = clip;
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
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <ActionButton onClick={() => onChange({ muted: !a.muted })}>{a.muted ? "Unmute" : "Mute"}</ActionButton>
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
}: {
  canvas: Canvas;
  onChange: (c: Canvas) => void;
  onUploadBackground: (file: File) => void;
  onClose: () => void;
  gesture: Gesture;
}) {
  const input = useRef<HTMLInputElement>(null);
  const bg = canvas.background;
  return (
    <PanelShell title="Canvas" onClose={onClose}>
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
    </PanelShell>
  );
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
                : (sources[o.sourceId]?.file.name ?? (o.kind === "video" ? "Video" : "Image"));
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
