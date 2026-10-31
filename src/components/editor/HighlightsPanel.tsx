"use client";

import { useShortcutKeys } from "@/lib/platform/keys";
import { WORKFLOWS, type HighlightWorkflow } from "@/lib/editor/highlights";
import { formatTime } from "@/lib/editor/timeline";
import type { Highlight } from "@/lib/editor/types";
import { ActionButton, PanelShell, SecondsInput } from "./Inspector";
import { SliderField, type Gesture } from "./Panels";
import type { HighlightsPanelProps } from "./useHighlights";

const noGesture: Gesture = { onGestureStart: () => {}, onGestureEnd: () => {} };

const CONFIDENCE: Record<Highlight["confidence"], string> = {
  high: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  low: "bg-surface-3 text-muted",
};

export function HighlightsPanel(p: HighlightsPanelProps & { onClose: () => void }) {
  const keys = useShortcutKeys();
  const s = p.settings;
  const items = p.set?.items ?? [];
  const shown = items.filter((h) => h.status !== "rejected");
  const rejected = items.length - shown.length;
  const exportable = shown.filter((h) => h.status === "kept" && !h.outdated);
  const workflow = s.workflow ?? "gameplay";
  return (
    <PanelShell title="Highlights" onClose={p.onClose}>
      <p className="mb-3 text-xs text-muted">
        Suggests moments that may be worth their own clip: where the sound jumps well above the moments before, the picture moves much more than usual,
        the footage cuts to a new scene, there&apos;s a burst of clicks or keys, or you marked a moment while recording. It measures; it doesn&apos;t
        understand what happens, and loud or busy isn&apos;t always good - each suggestion says what it&apos;s based on. Your timeline never changes:
        a highlight is exported on its own.
      </p>
      <div className="space-y-2 rounded-xl border border-border p-3">
        <label className="block text-xs font-semibold text-foreground">
          Made for
          <select
            className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
            value={workflow}
            onChange={(e) => p.onWorkflow(e.target.value as HighlightWorkflow)}
          >
            {(Object.keys(WORKFLOWS) as HighlightWorkflow[]).map((w) => (
              <option key={w} value={w}>
                {WORKFLOWS[w].label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[11px] text-muted">{WORKFLOWS[workflow].summary}</p>
        <SliderField label="Before the moment" value={s.preRoll} min={0} max={20} step={0.5} format={(v) => `${v.toFixed(1)} s`} onChange={(preRoll) => p.onSettings({ ...s, preRoll })} gesture={noGesture} />
        <SliderField label="After the moment" value={s.postRoll} min={0} max={20} step={0.5} format={(v) => `${v.toFixed(1)} s`} onChange={(postRoll) => p.onSettings({ ...s, postRoll })} gesture={noGesture} />
        <SliderField label="At most" value={s.maxCount} min={1} max={30} step={1} format={(v) => `${v} suggestions`} onChange={(maxCount) => p.onSettings({ ...s, maxCount })} gesture={noGesture} />
        <SliderField
          label="Sensitivity"
          value={s.sensitivity}
          min={0}
          max={1}
          step={0.05}
          format={(v) => (v < 0.35 ? "Only strong moments" : v < 0.7 ? "Normal" : "Also single signals")}
          onChange={(sensitivity) => p.onSettings({ ...s, sensitivity })}
          gesture={noGesture}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {p.busy ? (
          <>
            <span className="text-xs text-muted" role="status">
              {p.busy}
            </span>
            <button type="button" className="text-xs font-semibold underline" onClick={p.onCancel}>
              Cancel
            </button>
          </>
        ) : (
          <ActionButton tone="accent" onClick={p.onFind}>
            {p.set ? "Find again" : "Find highlights"}
          </ActionButton>
        )}
        <ActionButton onClick={p.onMark} title="Add a highlight around the playhead">
          Mark at playhead
        </ActionButton>
        {p.set && !p.busy && <ActionButton onClick={p.onClear}>Clear</ActionButton>}
      </div>
      {p.stale && p.outdated > 0 && (
        <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-foreground" role="alert">
          The timeline changed since these were found. {p.outdated === 1 ? "One highlight's" : `${p.outdated} highlights'`} footage was cut or changed, so
          {p.outdated === 1 ? " it is" : " they are"} marked out of date and can&apos;t be previewed or exported until you set the range again or find again. The
          others moved with their footage.
        </p>
      )}
      {p.stale && p.outdated === 0 && (
        <p className="mt-3 text-[11px] text-muted">The timeline changed since these were found; each highlight moved with its footage.</p>
      )}
      {p.set?.notes.map((n) => (
        <p key={n} className="mt-2 text-[11px] text-muted">
          {n}
        </p>
      ))}
      {shown.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-label="Highlight suggestions">
          {shown.map((h, i) => (
            <li key={h.id} className="rounded-xl border border-border p-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="font-mono text-muted">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <input
                    key={`${h.id}-${h.title ?? ""}`}
                    className="w-full rounded border border-transparent bg-transparent font-semibold text-foreground hover:border-border focus:border-accent focus:outline-none"
                    aria-label={`Name of highlight ${i + 1}`}
                    defaultValue={h.title ?? ""}
                    placeholder={`Highlight ${i + 1}`}
                    onBlur={(e) => e.target.value !== (h.title ?? "") && p.onRename(h, e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                  <p className="text-[11px] text-muted">
                    {formatTime(h.start)}–{formatTime(h.end)}
                    {h.outdated && <span className="ml-1 font-semibold text-amber-600 dark:text-amber-400">· out of date</span>}
                  </p>
                  <ul className="text-[11px] text-muted">
                    {h.reasons.map((r) => (
                      <li key={r.text}>{r.text}</li>
                    ))}
                  </ul>
                  {h.edited && <p className="text-[11px] text-muted">Range edited by you.</p>}
                </div>
                <span className={`rounded px-1 text-[10px] font-semibold ${CONFIDENCE[h.confidence]}`} title={`Score ${Math.round(h.score * 100)}`}>
                  {h.confidence}
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <label className="text-[11px] text-muted">
                  Start
                  <SecondsInput value={h.start} min={0} max={Math.max(0, h.end - 0.5)} onCommit={(v) => p.onRange(h, v, h.end)} />
                </label>
                <label className="text-[11px] text-muted">
                  End
                  <SecondsInput value={h.end} min={h.start + 0.5} max={p.total} onCommit={(v) => p.onRange(h, h.start, v)} />
                </label>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
                <button type="button" className="font-semibold text-muted underline" onClick={() => p.onRange(h, p.playhead(), h.end)}>
                  Start at playhead
                </button>
                <button type="button" className="font-semibold text-muted underline" onClick={() => p.onRange(h, h.start, p.playhead())}>
                  End at playhead
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <button type="button" disabled={h.outdated} className="rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold text-foreground disabled:opacity-40" onClick={() => p.onPreview(h)}>
                  {p.previewing === h.id ? "Playing…" : "Preview"}
                </button>
                <button
                  type="button"
                  aria-pressed={h.status === "kept"}
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${h.status === "kept" ? "border-accent-2 bg-accent-2/15 text-foreground" : "border-border text-muted"}`}
                  onClick={() => p.onStatus(h, h.status === "kept" ? "pending" : "kept")}
                >
                  {h.status === "kept" ? "Kept" : "Keep"}
                </button>
                <button type="button" className="rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold text-muted" onClick={() => p.onStatus(h, "rejected")}>
                  Reject
                </button>
                <button type="button" disabled={h.outdated} className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent disabled:opacity-40 dark:text-accent-light" onClick={() => p.onExport(h)}>
                  Export clip…
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && (
        <div className="mt-3">
          <ActionButton tone="accent" onClick={() => p.onExportBatch(exportable.map((h) => h.id))} disabled={exportable.length === 0}>
            {exportable.length ? `Export ${exportable.length} kept highlight${exportable.length === 1 ? "" : "s"}…` : "Keep highlights to export several"}
          </ActionButton>
          <p className="mt-1 text-[11px] text-muted">Each kept highlight becomes its own video file.</p>
        </div>
      )}
      {rejected > 0 && <p className="mt-2 text-[11px] text-muted">{rejected} rejected (hidden; {keys.mod}+Z brings one back).</p>}
      {p.set && (
        <p className="mt-3 text-[11px] text-muted">
          This project so far: {p.set.stats.suggested} suggested, {p.set.stats.kept} kept, {p.set.stats.edited} edited, {p.set.stats.rejected} rejected,{" "}
          {p.set.stats.exported} exported. Counted on this device only.
        </p>
      )}
    </PanelShell>
  );
}
