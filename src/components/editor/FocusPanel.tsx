"use client";

import { useState, type ReactNode } from "react";
import { FOCUS_PRESETS, type FocusPreset, type FocusSettings } from "@/lib/editor/focus";
import { formatTime } from "@/lib/editor/timeline";
import { DEFAULT_POINTER, type CameraZoom, type PointerStyle, type ZoomEase } from "@/lib/editor/types";
import { ActionButton, PanelShell } from "./Inspector";
import { SliderField, type Gesture } from "./Panels";
import { TrashIcon } from "./icons";

export interface AnalysisState {
  stage: "reading" | "analyzing";
  value: number;
}

function Title({ children }: { children: ReactNode }) {
  return <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted first:mt-0">{children}</p>;
}

function Check({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={`flex items-start gap-2 text-xs ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium text-foreground">{label}</span>
        {hint && <span className="block text-[11px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs font-medium text-foreground">
      {label}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent" />
    </label>
  );
}

const EASE_LABELS: Record<ZoomEase, string> = { smooth: "Smooth", gentle: "Gentle", linear: "Linear" };

function EaseSelect({ value, onChange }: { value: ZoomEase; onChange: (v: ZoomEase) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs font-medium text-foreground">
      Easing
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ZoomEase)}
        className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
      >
        {(Object.keys(EASE_LABELS) as ZoomEase[]).map((e) => (
          <option key={e} value={e}>
            {EASE_LABELS[e]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Tool panel: analyze interactions into zoom suggestions, pointer style. */
export function FocusPanel({
  available,
  unavailableReason,
  clickCount,
  cursorAllowed,
  zooms,
  pointer,
  analysis,
  onAnalyze,
  onCancel,
  onRemoveSuggestions,
  onAddAtPlayhead,
  onSelect,
  onPointerChange,
  onClose,
  gesture,
}: {
  available: boolean;
  unavailableReason: string;
  clickCount: number;
  cursorAllowed: boolean;
  zooms: CameraZoom[];
  pointer: PointerStyle | null;
  analysis: AnalysisState | null;
  onAnalyze: (s: FocusSettings) => void;
  onCancel: () => void;
  onRemoveSuggestions: () => void;
  onAddAtPlayhead: () => void;
  onSelect: (id: string) => void;
  onPointerChange: (p: PointerStyle | null) => void;
  onClose: () => void;
  gesture: Gesture;
}) {
  const [preset, setPreset] = useState<FocusPreset>("balanced");
  const [settings, setSettings] = useState<FocusSettings>(FOCUS_PRESETS.balanced);
  const [custom, setCustom] = useState(false);
  const set = (patch: Partial<FocusSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const noGesture: Gesture = { onGestureStart: () => {}, onGestureEnd: () => {} };
  const style = pointer ?? DEFAULT_POINTER;
  const setStyle = (patch: Partial<PointerStyle>) => onPointerChange({ ...style, ...patch });
  const autoCount = zooms.filter((z) => z.auto).length;

  return (
    <PanelShell title="Focus and pointer" onClose={onClose}>
      {!available ? (
        <p className="rounded-xl border border-border bg-surface-2/60 p-3 text-xs text-muted">{unavailableReason}</p>
      ) : (
        <>
          <Title>Automatic zoom</Title>
          <p className="mb-3 text-xs text-muted">
            Suggests zooms from the {clickCount} recorded click{clickCount === 1 ? "" : "s"}, where the pointer settled, scrolling and markers. Not every click
            zooms. Suggestions are ordinary zooms you can change or delete; re-analyzing replaces only the ones you haven&apos;t edited.
          </p>
          <div className="mb-3 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Zoom preset">
            {(Object.keys(FOCUS_PRESETS) as FocusPreset[]).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={preset === p}
                onClick={() => {
                  setPreset(p);
                  setSettings(FOCUS_PRESETS[p]);
                }}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold capitalize ${preset === p ? "border-accent-2 bg-accent-2/10 text-foreground" : "border-border text-muted hover:text-foreground"}`}
              >
                {p}
              </button>
            ))}
          </div>
          <button type="button" className="mb-2 text-xs font-semibold text-accent-2 underline" onClick={() => setCustom((v) => !v)}>
            {custom ? "Hide settings" : "Customize"}
          </button>
          {custom && (
            <div className="mb-3 space-y-3 rounded-xl border border-border p-3">
              <SliderField label="Zoom" value={settings.zoom} min={1.2} max={3} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set({ zoom: v, maxZoom: Math.max(v, settings.maxZoom) })} gesture={noGesture} />
              <SliderField label="Shortest zoom" value={settings.minDuration} min={1} max={5} step={0.1} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => set({ minDuration: v, maxDuration: Math.max(v + 1, settings.maxDuration) })} gesture={noGesture} />
              <SliderField label="Longest zoom" value={settings.maxDuration} min={3} max={20} step={0.5} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => set({ maxDuration: Math.max(v, settings.minDuration + 1) })} gesture={noGesture} />
              <SliderField label="Transition" value={settings.easeIn} min={0.2} max={1.5} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => set({ easeIn: v, easeOut: v * 1.1 })} gesture={noGesture} />
              <EaseSelect value={settings.ease} onChange={(ease) => set({ ease })} />
              <SliderField
                label="Sensitivity"
                value={3 - settings.minScore}
                min={0}
                max={2.2}
                step={0.1}
                format={(v) => (v < 0.8 ? "Few" : v < 1.6 ? "Normal" : "Many")}
                onChange={(v) => set({ minScore: 3 - v })}
                gesture={noGesture}
              />
              <SliderField label="Zooms per minute (max)" value={settings.maxPerMinute} min={1} max={20} step={1} onChange={(v) => set({ maxPerMinute: v })} gesture={noGesture} />
              <Check label="Use scrolling" checked={settings.includeScroll} onChange={(v) => set({ includeScroll: v })} />
              <Check label="Always zoom at markers" checked={settings.useMarkers} onChange={(v) => set({ useMarkers: v })} />
              <Check label="Zoom in on typing" checked={settings.includeTyping} onChange={(v) => set({ includeTyping: v })} />
              <Check label="Follow the action (pan instead of zooming out)" checked={settings.follow} onChange={(v) => set({ follow: v })} />
            </div>
          )}
          {analysis ? (
            <div className="space-y-2" role="status">
              <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-accent-2 transition-[width]" style={{ width: `${Math.round((analysis.stage === "reading" ? analysis.value * 0.5 : 0.5 + analysis.value * 0.5) * 100)}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{analysis.stage === "reading" ? "Reading interactions…" : "Finding focus points…"}</span>
                <button type="button" onClick={onCancel} className="font-semibold text-foreground underline">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <ActionButton tone="accent" onClick={() => onAnalyze(settings)}>
                Analyze and suggest zooms
              </ActionButton>
              {autoCount > 0 && (
                <ActionButton onClick={onRemoveSuggestions}>
                  <TrashIcon width={14} height={14} /> Remove {autoCount} suggestion{autoCount === 1 ? "" : "s"}
                </ActionButton>
              )}
            </div>
          )}
        </>
      )}

      <Title>Manual</Title>
      <ActionButton onClick={onAddAtPlayhead}>Add zoom at playhead</ActionButton>

      {zooms.length > 0 && (
        <>
          <Title>Zooms ({zooms.length})</Title>
          <ul className="space-y-1">
            {[...zooms]
              .sort((a, b) => a.start - b.start)
              .map((z) => (
                <li key={z.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(z.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border border-border px-2 py-1.5 text-left text-xs hover:bg-surface-2 ${z.enabled ? "" : "opacity-50"}`}
                  >
                    <span className="font-mono text-muted">{formatTime(z.start)}</span>
                    <span className="min-w-0 flex-1 truncate text-foreground">{z.reason ?? "Manual"}</span>
                    <span className="font-mono text-muted">{z.zoom.toFixed(1)}×</span>
                    {z.auto && <span className="rounded bg-accent-2/15 px-1 text-[10px] font-semibold text-accent-2">auto</span>}
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}

      {available && (
        <>
          <Title>Pointer</Title>
          <div className="space-y-3">
            <Check label="Highlight clicks" checked={!!pointer?.clicks} onChange={(v) => setStyle({ clicks: v })} />
            {pointer?.clicks && (
              <>
                <Color label="Left click" value={style.leftColor} onChange={(v) => setStyle({ leftColor: v })} />
                <Color label="Right click" value={style.rightColor} onChange={(v) => setStyle({ rightColor: v })} />
                <SliderField label="Ring size" value={style.ringSize} min={0.02} max={0.12} step={0.005} format={(v) => `${Math.round(v * 1000) / 10}%`} onChange={(v) => setStyle({ ringSize: v })} gesture={gesture} />
                <SliderField label="Ring duration" value={style.ringDuration} min={0.2} max={1.5} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => setStyle({ ringDuration: v })} gesture={gesture} />
                <SliderField label="Intensity" value={style.intensity} min={0.2} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setStyle({ intensity: v })} gesture={gesture} />
              </>
            )}
            <Check
              label="Draw a smooth cursor"
              checked={!!pointer?.cursor && cursorAllowed}
              disabled={!cursorAllowed}
              onChange={(v) => setStyle({ cursor: v })}
              hint={
                cursorAllowed
                  ? "Drawn from the recorded movement, so you can resize and smooth it."
                  : "This recording already shows the system pointer, so a second one isn't added. To use a drawn cursor, record with “Leave the mouse pointer out of the video” (where the system supports it)."
              }
            />
            {pointer?.cursor && cursorAllowed && (
              <>
                <SliderField label="Cursor size" value={style.cursorSize} min={0.02} max={0.1} step={0.0025} format={(v) => `${Math.round(v * 1000) / 10}%`} onChange={(v) => setStyle({ cursorSize: v })} gesture={gesture} />
                <Color label="Cursor color" value={style.cursorColor} onChange={(v) => setStyle({ cursorColor: v })} />
                <SliderField label="Smoothing" value={style.smoothing} min={0} max={1} step={0.05} format={(v) => (v === 0 ? "Off" : `${Math.round(v * 100)}%`)} onChange={(v) => setStyle({ smoothing: v })} gesture={gesture} />
                <p className="text-[11px] text-muted">Clicks always stay exactly where they happened.</p>
              </>
            )}
          </div>
        </>
      )}
    </PanelShell>
  );
}

/** Inspector for one selected zoom. */
export function ZoomPanel({
  zoom,
  timelineStart,
  onChange,
  onCenterOnPointer,
  canCenterOnPointer,
  onSplit,
  onDelete,
  onClose,
  gesture,
}: {
  zoom: CameraZoom;
  timelineStart: number | null;
  onChange: (patch: Partial<CameraZoom>) => void;
  onCenterOnPointer: () => void;
  canCenterOnPointer: boolean;
  onSplit: () => void;
  onDelete: () => void;
  onClose: () => void;
  gesture: Gesture;
}) {
  const dur = zoom.end - zoom.start;
  return (
    <PanelShell title="Zoom" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-muted">
          {timelineStart !== null ? `At ${formatTime(timelineStart, true)}` : "Not on the timeline (its part of the recording was trimmed away)"}
          {zoom.reason ? ` · ${zoom.auto ? "Suggested" : "Based on"}: ${zoom.reason}` : ""}
        </p>
        <Check label="Enabled" checked={zoom.enabled} onChange={(v) => onChange({ enabled: v })} />
        <SliderField label="Strength" value={zoom.zoom} min={1.1} max={3.5} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => onChange({ zoom: v })} gesture={gesture} />
        <SliderField
          label="Duration"
          value={dur}
          min={0.8}
          max={20}
          step={0.1}
          format={(v) => `${v.toFixed(1)} s`}
          onChange={(v) => onChange({ end: zoom.start + v })}
          gesture={gesture}
        />
        <SliderField label="Zoom in" value={zoom.easeIn} min={0.15} max={Math.max(0.2, Math.min(2, dur / 2))} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => onChange({ easeIn: v })} gesture={gesture} />
        <SliderField label="Zoom out" value={zoom.easeOut} min={0.15} max={Math.max(0.2, Math.min(2, dur / 2))} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => onChange({ easeOut: v })} gesture={gesture} />
        <EaseSelect value={zoom.ease} onChange={(ease) => onChange({ ease })} />
        <SliderField label="Focus left/right" value={zoom.x} min={0} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onChange({ x: v })} gesture={gesture} />
        <SliderField label="Focus up/down" value={zoom.y} min={0} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onChange({ y: v })} gesture={gesture} />
        {zoom.path?.length ? (
          <p className="text-[11px] text-muted">
            Follows the action: pans {zoom.path.length} time{zoom.path.length === 1 ? "" : "s"} while zoomed in. Moving the focus by hand stops following.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-1">
          <ActionButton onClick={onCenterOnPointer} disabled={!canCenterOnPointer} title="Focus where the pointer is at the playhead">
            Focus on pointer
          </ActionButton>
          <ActionButton onClick={onSplit}>Split at playhead</ActionButton>
          <ActionButton tone="danger" onClick={onDelete}>
            <TrashIcon width={14} height={14} /> Delete
          </ActionButton>
        </div>
      </div>
    </PanelShell>
  );
}
