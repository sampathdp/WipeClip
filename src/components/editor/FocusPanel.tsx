"use client";

import { useState, type ReactNode } from "react";
import { DEFAULT_SESSION, FOCUS_PRESETS, FOCUS_PROFILES, focusSettings, type FocusPreset, type FocusProfile, type FocusSettings } from "@/lib/editor/focus";
import { formatTime } from "@/lib/editor/timeline";
import { MAX_INTENSITY, MIN_INTENSITY } from "@/lib/editor/focusPrefs";
import { DEFAULT_POINTER, type CameraZoom, type FocusPrefs, type PointerStyle, type ZoomEase } from "@/lib/editor/types";
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

const EASE_LABELS: Record<ZoomEase, string> = { natural: "Natural", smooth: "Smooth", gentle: "Gentle", linear: "Linear" };

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
  nativeCursorSize,
  zooms,
  pointer,
  analysis,
  onAnalyze,
  onCancel,
  onRemoveSuggestions,
  onAddAtPlayhead,
  onSelect,
  onPointerChange,
  focus,
  onFocusChange,
  comparing,
  onCompare,
  onExcludeAtPlayhead,
  onRemoveExclusion,
  onIgnoreClickAtPlayhead,
  onRestoreClick,
  onSeek,
  onClose,
  gesture,
}: {
  available: boolean;
  unavailableReason: string;
  clickCount: number;
  cursorAllowed: boolean;
  /** The recording's own cursor height (fraction of its frame height,
   * from the display's DPI), or null when the display is unknown. */
  nativeCursorSize: number | null;
  zooms: CameraZoom[];
  pointer: PointerStyle | null;
  analysis: AnalysisState | null;
  onAnalyze: (s: FocusSettings) => void;
  onCancel: () => void;
  onRemoveSuggestions: () => void;
  onAddAtPlayhead: () => void;
  onSelect: (id: string) => void;
  onPointerChange: (p: PointerStyle | null) => void;
  focus: FocusPrefs;
  onFocusChange: (patch: Partial<Pick<FocusPrefs, "intensity" | "bypass">>) => void;
  /** Preview-only comparison with the unzoomed recording. */
  comparing: boolean;
  onCompare: (on: boolean) => void;
  onExcludeAtPlayhead: () => void;
  onRemoveExclusion: (id: string) => void;
  onIgnoreClickAtPlayhead: () => void;
  onRestoreClick: (t: number) => void;
  /** Moves the playhead to a source time of the recording. */
  onSeek: (sourceTime: number) => void;
  onClose: () => void;
  gesture: Gesture;
}) {
  const [preset, setPreset] = useState<FocusPreset>("balanced");
  const [profile, setProfile] = useState<FocusProfile>("tutorial");
  const [settings, setSettings] = useState<FocusSettings>(() => focusSettings("balanced", "tutorial"));
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
          <p className="mb-1 text-[11px] font-medium text-muted">Recording type</p>
          <div className="mb-1 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Recording type">
            {(Object.keys(FOCUS_PROFILES) as FocusProfile[]).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={profile === p}
                title={FOCUS_PROFILES[p].hint}
                onClick={() => {
                  setProfile(p);
                  setSettings(focusSettings(preset, p));
                }}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold ${profile === p ? "border-accent-2 bg-accent-2/10 text-foreground" : "border-border text-muted hover:text-foreground"}`}
              >
                {FOCUS_PROFILES[p].label}
              </button>
            ))}
          </div>
          <p className="mb-3 text-[11px] text-muted">{FOCUS_PROFILES[profile].hint}.</p>
          <p className="mb-1 text-[11px] font-medium text-muted">Strength</p>
          <div className="mb-3 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Zoom preset">
            {(Object.keys(FOCUS_PRESETS) as FocusPreset[]).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={preset === p}
                onClick={() => {
                  setPreset(p);
                  setSettings(focusSettings(p, profile));
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
              <SliderField
                label="Stay zoomed between actions"
                value={settings.sessionGap ?? DEFAULT_SESSION.sessionGap}
                min={0}
                max={10}
                step={0.5}
                format={(v) => (v === 0 ? "Off" : `up to ${v.toFixed(1)} s`)}
                onChange={(v) => set({ sessionGap: v, cooldown: Math.max(v, settings.cooldown ?? DEFAULT_SESSION.cooldown) })}
                gesture={noGesture}
              />
              <SliderField
                label="Rest between zooms (min)"
                value={settings.cooldown ?? DEFAULT_SESSION.cooldown}
                min={0}
                max={12}
                step={0.5}
                format={(v) => (v === 0 ? "Off" : `${v.toFixed(1)} s`)}
                onChange={(v) => set({ cooldown: v, sessionGap: Math.min(v, settings.sessionGap ?? DEFAULT_SESSION.sessionGap) })}
                gesture={noGesture}
              />
              <p className="-mt-2 text-[11px] text-muted">
                Actions a short pause apart stay in one zoom (the camera pans between areas instead of zooming out and back in). A shorter rest than the minimum
                keeps only the more important zoom.
              </p>
              <Check label="Use scrolling" checked={settings.includeScroll} onChange={(v) => set({ includeScroll: v })} />
              <Check label="Always zoom at markers" checked={settings.useMarkers} onChange={(v) => set({ useMarkers: v })} />
              <Check label="Zoom in on typing" checked={settings.includeTyping} onChange={(v) => set({ includeTyping: v })} />
              <Check label="Use shortcuts" checked={settings.includeShortcuts !== false} onChange={(v) => set({ includeShortcuts: v })} />
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
          <Title>View</Title>
          <div className="space-y-3">
            <button
              type="button"
              aria-pressed={comparing}
              disabled={focus.bypass}
              onClick={() => onCompare(!comparing)}
              className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50 ${comparing ? "border-accent bg-accent/15 text-accent" : "border-border bg-surface text-foreground hover:border-accent/50"}`}
            >
              {comparing ? "Showing original - click to show zooms" : "Compare with original"}
            </button>
            <p className="-mt-2 text-[11px] text-muted">Preview only: the recording without zooms, to check what they add. Not saved; the export is unchanged.</p>
            <Check
              label="Original view"
              checked={focus.bypass}
              onChange={(v) => onFocusChange({ bypass: v })}
              hint="Shows and exports the recording without zooms. Your zooms are kept; turn this off to bring them back."
            />
            <SliderField
              label="Zoom intensity"
              value={focus.intensity}
              min={MIN_INTENSITY}
              max={MAX_INTENSITY}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => onFocusChange({ intensity: v })}
              gesture={gesture}
            />
            <p className="text-[11px] text-muted">Scales every zoom at once without changing them; 100% shows each zoom as set.</p>
          </div>
        </>
      )}

      {available && (
        <>
          <Title>Leave out</Title>
          <p className="mb-2 text-xs text-muted">Parts of the recording where no zooms are suggested, and clicks to ignore (no ring, no zoom).</p>
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={onExcludeAtPlayhead} title="No zoom suggestions for the 10 seconds from the playhead">
              No zooms for 10 s from playhead
            </ActionButton>
            <ActionButton onClick={onIgnoreClickAtPlayhead} title="Ignore the recorded click nearest the playhead">
              Ignore click at playhead
            </ActionButton>
          </div>
          {(focus.excluded.length > 0 || focus.ignoredClicks.length > 0) && (
            <ul className="mt-2 space-y-1">
              {[...focus.excluded]
                .sort((a, b) => a.start - b.start)
                .map((r) => (
                  <li key={r.id} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1 text-xs">
                    <button type="button" className="min-w-0 flex-1 truncate text-left text-foreground hover:underline" onClick={() => onSeek(r.start)}>
                      No zooms {formatTime(r.start)}–{formatTime(r.end)}
                    </button>
                    <button type="button" className="font-semibold text-accent-2 underline" onClick={() => onRemoveExclusion(r.id)}>
                      Allow
                    </button>
                  </li>
                ))}
              {[...focus.ignoredClicks]
                .sort((a, b) => a.t - b.t)
                .map((c) => (
                  <li key={`${c.sourceId}-${c.t}`} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1 text-xs">
                    <button type="button" className="min-w-0 flex-1 truncate text-left text-foreground hover:underline" onClick={() => onSeek(c.t)}>
                      Ignored click at {formatTime(c.t)}
                    </button>
                    <button type="button" className="font-semibold text-accent-2 underline" onClick={() => onRestoreClick(c.t)}>
                      Restore
                    </button>
                  </li>
                ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-muted">Your own zooms are never removed. Analyze again to apply these to new suggestions.</p>
        </>
      )}

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
                <SliderField
                  label={style.sizeBase === "recording" ? "Cursor size (of the recording)" : "Cursor size"}
                  value={style.cursorSize}
                  min={0.01}
                  max={0.1}
                  step={0.0025}
                  format={(v) => `${Math.round(v * 1000) / 10}%`}
                  onChange={(v) => setStyle({ cursorSize: v })}
                  gesture={gesture}
                />
                {nativeCursorSize !== null && (
                  <ActionButton
                    onClick={() => setStyle({ cursorSize: nativeCursorSize, sizeBase: "recording" })}
                    title="The size the system pointer had on the recorded display, whatever its resolution and scaling"
                  >
                    Match recording size
                  </ActionButton>
                )}
                {style.sizeBase === "recording" && (
                  <Check
                    label="Size relative to the recording"
                    checked
                    onChange={() => setStyle({ sizeBase: "canvas" })}
                    hint="The cursor keeps its size next to the recorded screen whatever the canvas shape. Untick to size it by the canvas instead."
                  />
                )}
                <Color label="Cursor color" value={style.cursorColor} onChange={(v) => setStyle({ cursorColor: v })} />
                <SliderField label="Smoothing" value={style.smoothing} min={0} max={1} step={0.05} format={(v) => (v === 0 ? "Off" : `${Math.round(v * 100)}%`)} onChange={(v) => setStyle({ smoothing: v })} gesture={gesture} />
                <p className="text-[11px] text-muted">Clicks always stay exactly where they happened.</p>
              </>
            )}
            {((pointer?.cursor && cursorAllowed) || pointer?.clicks) && (
              <Check
                label="Grow with the zoom"
                checked={style.scaleWithZoom !== false}
                onChange={(v) => setStyle({ scaleWithZoom: v })}
                hint="The cursor and click rings are magnified with the screen, so they keep their size next to what they point at."
              />
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
  onNeverHere,
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
  /** Deletes this zoom and keeps suggestions out of its range. */
  onNeverHere: () => void;
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
          <ActionButton onClick={onNeverHere} title="Delete this zoom and don't suggest zooms here again">
            No zooms here
          </ActionButton>
          <ActionButton tone="danger" onClick={onDelete}>
            <TrashIcon width={14} height={14} /> Delete
          </ActionButton>
        </div>
      </div>
    </PanelShell>
  );
}
