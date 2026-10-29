"use client";

import { useShortcutKeys } from "@/lib/platform/keys";
import { useState, type ReactNode } from "react";
import { DEFAULT_SILENCE, type SilenceSettings } from "@/lib/editor/audioAnalysis";
import type { KeystrokeSettings } from "@/lib/editor/keystrokes";
import { displayCombo } from "@/lib/editor/keystrokes";
import { SHAPE_LABELS } from "@/lib/editor/shapes";
import { formatTime } from "@/lib/editor/timeline";
import type { FocusPreset } from "@/lib/editor/focus";
import type { Chapter, Draft, DraftItem, EditSuggestion, MaskMode, PrivacyMask, ShapeType } from "@/lib/editor/types";
import { willApply } from "@/lib/editor/draft";
import { ActionButton, PanelShell, SecondsInput } from "./Inspector";
import { SliderField, type Gesture } from "./Panels";
import { TrashIcon } from "./icons";

export type TutorialTab = "draft" | "review" | "chapters" | "shortcuts" | "privacy" | "annotate" | "retake";

/** What "Generate draft" proposes (src/lib/editor/draft.ts). */
export interface DraftSettings {
  zooms: boolean;
  preset: FocusPreset;
  highlights: boolean;
  cuts: boolean;
  review: ReviewSettings;
  chapters: boolean;
}

const TABS: { id: TutorialTab; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "review", label: "Review" },
  { id: "chapters", label: "Chapters" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "privacy", label: "Privacy" },
  { id: "annotate", label: "Annotate" },
  { id: "retake", label: "Retake" },
];

const noGesture: Gesture = { onGestureStart: () => {}, onGestureEnd: () => {} };

function Title({ children }: { children: ReactNode }) {
  return <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted first:mt-0">{children}</p>;
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-xs text-muted">{children}</p>;
}

function Check({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={`flex ${hint ? "items-start" : "items-center"} gap-2 text-xs font-medium text-foreground ${disabled ? "opacity-50" : ""}`}>
      <input type="checkbox" className={`accent-[var(--accent)] ${hint ? "mt-0.5" : ""}`} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {hint ? (
        <span>
          {label}
          <span className="block text-[11px] font-normal text-muted">{hint}</span>
        </span>
      ) : (
        label
      )}
    </label>
  );
}

const CONFIDENCE: Record<EditSuggestion["confidence"], string> = {
  high: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  low: "bg-surface-3 text-muted",
};

export interface ReviewSettings {
  silence: SilenceSettings;
  idle: number;
}

export interface TutorialPanelProps {
  tab: TutorialTab;
  onTab: (t: TutorialTab) => void;
  onClose: () => void;
  hasEvents: boolean;
  isMac: boolean;
  // review
  suggestions: EditSuggestion[];
  analysis: string | null;
  onAnalyze: (s: ReviewSettings) => void;
  onCancelAnalysis: () => void;
  onPreview: (s: EditSuggestion) => void;
  onAccept: (s: EditSuggestion) => void;
  onReject: (s: EditSuggestion) => void;
  onEditSuggestion: (id: string, patch: Partial<EditSuggestion>) => void;
  onAcceptAllHigh: () => void;
  onClearSuggestions: () => void;
  /** Playback skips the pending cuts (nothing removed). */
  previewingCuts: boolean;
  onPreviewCuts: (on: boolean) => void;
  // draft
  draft: Draft | null;
  /** The timeline changed since the draft was made. */
  draftStale: boolean;
  onGenerateDraft: (s: DraftSettings) => void;
  onDraftStatus: (status: DraftItem["status"], which: "all" | DraftItem["kind"] | string[]) => void;
  onApplyDraft: () => void;
  onDiscardDraft: () => void;
  onSeek: (t: number) => void;
  // chapters
  chapters: Chapter[];
  onSuggestChapters: () => void;
  onAddChapter: () => void;
  onChapterChange: (id: string, patch: Partial<Chapter>) => void;
  onDeleteChapter: (id: string) => void;
  onJump: (t: number) => void;
  onExportChapters: (format: "txt" | "vtt") => void;
  total: number;
  // shortcuts
  combos: { combo: string; count: number }[];
  keystrokeCount: number;
  keySettings: KeystrokeSettings;
  onKeySettings: (s: KeystrokeSettings) => void;
  onGenerateKeys: () => void;
  onRemoveKeys: () => void;
  // privacy
  masks: PrivacyMask[];
  onAddMask: (mode: MaskMode) => void;
  onSelectMask: (id: string) => void;
  // annotate
  onAddShape: (type: ShapeType) => void;
  screenshots: { path: string; tMs: number }[];
  onInsertScreenshot: (path: string) => void;
  // retake
  retakes: EditSuggestion[];
  playhead: () => number;
  onMarkRetake: (start: number, end: number, note: string) => void;
  onReplace: (mark: EditSuggestion, from: "recording" | "file") => void;
  canReplaceFromRecording: boolean;
  replaceBusy: string | null;
}

export function TutorialPanel(p: TutorialPanelProps) {
  return (
    <PanelShell title="Tutorial tools" onClose={p.onClose}>
      <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="Tutorial tools">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={p.tab === t.id}
            onClick={() => p.onTab(t.id)}
            className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${p.tab === t.id ? "border-accent-2 bg-accent-2/10 text-foreground" : "border-border text-muted hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {p.tab === "draft" && <DraftTab {...p} />}
      {p.tab === "review" && <ReviewTab {...p} />}
      {p.tab === "chapters" && <ChaptersTab {...p} />}
      {p.tab === "shortcuts" && <ShortcutsTab {...p} />}
      {p.tab === "privacy" && <PrivacyTab {...p} />}
      {p.tab === "annotate" && <AnnotateTab {...p} />}
      {p.tab === "retake" && <RetakeTab {...p} />}
    </PanelShell>
  );
}

const KIND_LABEL: Record<DraftItem["kind"], string> = { cut: "Cuts", zoom: "Zooms", highlights: "Click highlights", chapter: "Chapters", review: "Worth a look" };
const KIND_ORDER: DraftItem["kind"][] = ["cut", "zoom", "highlights", "chapter", "review"];

function DraftTab(p: TutorialPanelProps) {
  const keys = useShortcutKeys();
  const [ds, setDs] = useState<DraftSettings>({ zooms: true, preset: "balanced", highlights: true, cuts: true, review: { silence: DEFAULT_SILENCE, idle: 10 }, chapters: true });
  const d = p.draft;
  const set = (patch: Partial<DraftSettings>) => setDs((s) => ({ ...s, ...patch }));
  const accepted = d ? d.items.filter((i) => willApply(d, i)).length : 0;
  const counts = (k: DraftItem["kind"]) => (d ? d.items.filter((i) => i.kind === k) : []);
  const cutTitle = (id?: string) => {
    const c = id ? d?.items.find((i) => i.id === id) : undefined;
    return c ? formatTime(c.start) : "";
  };
  return (
    <>
      <Hint>
        Builds a first edit from the recording: zooms and click highlights from your mouse and keyboard activity, cuts for long pauses and dead time,
        chapters where something changed. It uses timing, sound levels and the recorded events only - it doesn&apos;t understand what is on screen or
        what is said. Nothing changes until you apply what you accept.
      </Hint>
      <div className="space-y-2 rounded-xl border border-border p-3">
        <Check label="Zooms" checked={ds.zooms} onChange={(zooms) => set({ zooms })} />
        {ds.zooms && (
          <div className="ml-6 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Zoom style">
            {(["subtle", "balanced", "dynamic"] as FocusPreset[]).map((pr) => (
              <button
                key={pr}
                type="button"
                role="radio"
                aria-checked={ds.preset === pr}
                onClick={() => set({ preset: pr })}
                className={`rounded-lg border px-2 py-1 text-[11px] font-semibold capitalize ${ds.preset === pr ? "border-accent-2 bg-accent-2/10 text-foreground" : "border-border text-muted hover:text-foreground"}`}
              >
                {pr}
              </button>
            ))}
          </div>
        )}
        <Check label="Click highlights" checked={ds.highlights} onChange={(highlights) => set({ highlights })} />
        <Check label="Cuts for pauses and dead time" checked={ds.cuts} onChange={(cuts) => set({ cuts })} />
        {ds.cuts && (
          <div className="ml-6 space-y-2">
            <SliderField
              label="Sensitivity"
              value={ds.review.silence.sensitivity}
              min={0}
              max={1}
              step={0.05}
              format={(v) => (v < 0.35 ? "Only clear silence" : v < 0.7 ? "Normal" : "Also quiet parts")}
              onChange={(sensitivity) => set({ review: { ...ds.review, silence: { ...ds.review.silence, sensitivity } } })}
              gesture={noGesture}
            />
            <SliderField label="Minimum pause" value={ds.review.silence.minPause} min={0.5} max={6} step={0.1} format={(v) => `${v.toFixed(1)} s`} onChange={(minPause) => set({ review: { ...ds.review, silence: { ...ds.review.silence, minPause } } })} gesture={noGesture} />
            <SliderField label="Pause to keep" value={ds.review.silence.keep} min={0} max={1.5} step={0.05} format={(v) => `${v.toFixed(2)} s each side`} onChange={(keep) => set({ review: { ...ds.review, silence: { ...ds.review.silence, keep } } })} gesture={noGesture} />
          </div>
        )}
        <Check label="Chapters" checked={ds.chapters} onChange={(chapters) => set({ chapters })} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {p.analysis ? (
          <>
            <span className="text-xs text-muted" role="status">
              {p.analysis}
            </span>
            <button type="button" className="text-xs font-semibold underline" onClick={p.onCancelAnalysis}>
              Cancel
            </button>
          </>
        ) : (
          <ActionButton tone="accent" onClick={() => p.onGenerateDraft(ds)} disabled={!ds.zooms && !ds.highlights && !ds.cuts && !ds.chapters}>
            {d && !d.appliedAt ? "Generate draft again" : "Generate draft"}
          </ActionButton>
        )}
      </div>

      {d && (
        <>
          {d.appliedAt ? (
            <p className="mt-3 rounded-xl border border-border bg-surface-2/60 p-2.5 text-xs text-muted" role="status">
              Applied. Everything is now ordinary timeline content you can edit; undo with {keys.mod}+Z.
            </p>
          ) : p.draftStale ? (
            <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-foreground" role="alert">
              The timeline changed since this draft was made, so its cuts and chapters no longer line up. Zooms and click highlights can still be applied;
              generate the draft again for the rest.
            </p>
          ) : null}
          {d.notes.map((n) => (
            <p key={n} className="mt-2 text-[11px] text-muted">
              {n}
            </p>
          ))}
          {!d.appliedAt && d.items.length > 0 && (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionButton onClick={() => p.onDraftStatus("accepted", "all")}>Accept all</ActionButton>
                <ActionButton onClick={() => p.onDraftStatus("rejected", "all")}>Reject all</ActionButton>
                <ActionButton tone="accent" onClick={p.onApplyDraft} disabled={accepted === 0}>
                  Apply {accepted} accepted
                </ActionButton>
                <ActionButton onClick={p.onDiscardDraft}>Discard draft</ActionButton>
              </div>
              {counts("cut").length > 0 && !p.draftStale && (
                <div className="mt-3">
                  <Check
                    label="Preview the result"
                    checked={p.previewingCuts}
                    onChange={p.onPreviewCuts}
                    hint="Playback skips the draft's cuts that you haven't rejected. Nothing is removed until you apply."
                  />
                </div>
              )}
            </>
          )}
          {d.items.length === 0 && <p className="mt-3 text-xs text-muted">Nothing to suggest for this recording.</p>}
          {KIND_ORDER.filter((k) => counts(k).length).map((k) => (
            <div key={k}>
              <Title>
                {KIND_LABEL[k]} ({counts(k).length})
              </Title>
              {!d.appliedAt && counts(k).length > 1 && (
                <div className="mb-2 flex gap-3 text-[11px]">
                  <button type="button" className="font-semibold text-accent-2 underline" onClick={() => p.onDraftStatus("accepted", k)}>
                    Accept all {KIND_LABEL[k].toLowerCase()}
                  </button>
                  <button type="button" className="font-semibold text-muted underline" onClick={() => p.onDraftStatus("rejected", k)}>
                    Reject all
                  </button>
                </div>
              )}
              <ul className="space-y-1.5">
                {counts(k).map((i) => (
                  <li key={i.id} className={`rounded-xl border border-border p-2 text-xs ${i.status === "rejected" ? "opacity-50" : ""}`}>
                    <div className="flex items-start gap-2">
                      <button type="button" className="font-mono text-muted hover:text-foreground" onClick={() => p.onSeek(Math.max(0, i.start - 1))} title="Go to">
                        {formatTime(i.start)}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground">{i.title}</p>
                        <p className="text-[11px] text-muted">{i.detail}</p>
                        {i.insideCut && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400">Mostly inside the cut at {cutTitle(i.insideCut)}: left out if that cut is applied.</p>
                        )}
                        {i.status === "accepted" && !willApply(d, i) && <p className="text-[11px] text-muted">Won&apos;t be applied: its cut is accepted.</p>}
                      </div>
                      <span className={`rounded px-1 text-[10px] font-semibold ${CONFIDENCE[i.confidence]}`}>{i.confidence}</span>
                    </div>
                    {!d.appliedAt && (
                      <div className="mt-1.5 flex gap-2">
                        <button
                          type="button"
                          aria-pressed={i.status === "accepted"}
                          className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${i.status === "accepted" ? "border-accent-2 bg-accent-2/15 text-foreground" : "border-border text-muted"}`}
                          onClick={() => p.onDraftStatus(i.status === "accepted" ? "pending" : "accepted", [i.id])}
                        >
                          {i.status === "accepted" ? "Accepted" : "Accept"}
                        </button>
                        <button
                          type="button"
                          aria-pressed={i.status === "rejected"}
                          className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${i.status === "rejected" ? "border-border bg-surface-3 text-foreground" : "border-border text-muted"}`}
                          onClick={() => p.onDraftStatus(i.status === "rejected" ? "pending" : "rejected", [i.id])}
                        >
                          {i.status === "rejected" ? "Rejected" : "Reject"}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function ReviewTab(p: TutorialPanelProps) {
  const [silence, setSilence] = useState<SilenceSettings>(DEFAULT_SILENCE);
  const [idle, setIdle] = useState(10);
  const [showAll, setShowAll] = useState(false);
  const pending = p.suggestions.filter((s) => s.status === "pending" && s.kind !== "retake");
  const rejected = p.suggestions.filter((s) => s.status === "rejected").length;
  const list = showAll ? p.suggestions.filter((s) => s.kind !== "retake") : pending;
  const high = pending.filter((s) => s.action === "cut" && s.confidence === "high").length;
  const pendingCuts = pending.filter((s) => s.action === "cut").length;
  return (
    <>
      <Hint>
        Finds long pauses and dead time in the audio{p.hasEvents ? ", and moments in your mouse and keyboard activity worth a look" : ""}. Nothing is
        removed until you accept a suggestion; each accepted cut is one undo step and the rest of the timeline moves up, in sync.
      </Hint>
      <div className="space-y-3 rounded-xl border border-border p-3">
        <SliderField
          label="Silence sensitivity"
          value={silence.sensitivity}
          min={0}
          max={1}
          step={0.05}
          format={(v) => (v < 0.35 ? "Only clear silence" : v < 0.7 ? "Normal" : "Also quiet parts")}
          onChange={(sensitivity) => setSilence({ ...silence, sensitivity })}
          gesture={noGesture}
        />
        <SliderField label="Minimum pause" value={silence.minPause} min={0.5} max={6} step={0.1} format={(v) => `${v.toFixed(1)} s`} onChange={(minPause) => setSilence({ ...silence, minPause })} gesture={noGesture} />
        <SliderField label="Pause to keep" value={silence.keep} min={0} max={1.5} step={0.05} format={(v) => `${v.toFixed(2)} s each side`} onChange={(keep) => setSilence({ ...silence, keep })} gesture={noGesture} />
        {p.hasEvents && <SliderField label="Flag inactivity after" value={idle} min={4} max={30} step={1} format={(v) => `${v} s`} onChange={setIdle} gesture={noGesture} />}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {p.analysis ? (
          <>
            <span className="text-xs text-muted" role="status">
              {p.analysis}
            </span>
            <button type="button" className="text-xs font-semibold underline" onClick={p.onCancelAnalysis}>
              Cancel
            </button>
          </>
        ) : (
          <ActionButton tone="accent" onClick={() => p.onAnalyze({ silence, idle })}>
            Analyze recording
          </ActionButton>
        )}
        {high > 0 && <ActionButton onClick={p.onAcceptAllHigh}>Accept {high} high-confidence cut{high === 1 ? "" : "s"}</ActionButton>}
        {p.suggestions.length > 0 && <ActionButton onClick={p.onClearSuggestions}>Clear</ActionButton>}
      </div>
      {pendingCuts > 0 && (
        <div className="mt-3">
          <Check
            label="Preview the result"
            checked={p.previewingCuts}
            onChange={p.onPreviewCuts}
            hint={`Playback skips the ${pendingCuts} suggested cut${pendingCuts === 1 ? "" : "s"} still to review, so you can hear how it would flow. Nothing is removed until you accept.`}
          />
        </div>
      )}
      {p.suggestions.length > 0 && (
        <>
          <Title>
            {pending.length} to review{rejected ? ` · ${rejected} rejected` : ""}
          </Title>
          {rejected > 0 && <Check label="Show rejected" checked={showAll} onChange={setShowAll} />}
          <ul className="mt-2 space-y-2">
            {list.map((s) => (
              <SuggestionItem key={s.id} s={s} {...p} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function SuggestionItem({ s, onPreview, onAccept, onReject, onEditSuggestion, total }: { s: EditSuggestion } & TutorialPanelProps) {
  const [editing, setEditing] = useState(false);
  return (
    <li className={`rounded-xl border border-border p-2.5 text-xs ${s.status === "rejected" ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-2">
        <button type="button" className="font-mono text-accent-2 underline" onClick={() => onPreview(s)} title="Preview">
          {formatTime(s.start)}
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">{s.title}</p>
          <p className="mt-0.5 text-muted">{s.detail}</p>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${CONFIDENCE[s.confidence]}`}>{s.confidence}</span>
      </div>
      {editing && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <SecondsInput value={s.start} min={0} max={s.end - 0.1} onCommit={(start) => onEditSuggestion(s.id, { start })} />
          <SecondsInput value={s.end} min={s.start + 0.1} max={total} onCommit={(end) => onEditSuggestion(s.id, { end })} />
        </div>
      )}
      {s.status !== "rejected" && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <ActionButton onClick={() => onPreview(s)}>Preview</ActionButton>
          {s.action === "cut" && (
            <ActionButton tone="accent" onClick={() => onAccept(s)} title={`Removes ${(s.end - s.start).toFixed(1)} s`}>
              Cut {(s.end - s.start).toFixed(1)} s
            </ActionButton>
          )}
          {s.action === "cut" && <ActionButton onClick={() => setEditing((v) => !v)}>{editing ? "Done" : "Adjust range"}</ActionButton>}
          <ActionButton onClick={() => onReject(s)}>{s.action === "cut" ? "Keep" : "Dismiss"}</ActionButton>
        </div>
      )}
    </li>
  );
}

function ChaptersTab(p: TutorialPanelProps) {
  const sorted = [...p.chapters].sort((a, b) => a.t - b.t);
  return (
    <>
      <Hint>
        Suggested from your markers{p.hasEvents ? ", app switches" : ""}, long pauses and caption gaps - places where something changed, not an
        understanding of the content. Rename and move them freely.
      </Hint>
      <div className="flex flex-wrap gap-2">
        <ActionButton tone="accent" onClick={p.onSuggestChapters}>
          Suggest chapters
        </ActionButton>
        <ActionButton onClick={p.onAddChapter}>Add at playhead</ActionButton>
      </div>
      {sorted.length > 0 && (
        <>
          <Title>Chapters ({sorted.length})</Title>
          <ul className="space-y-2">
            {sorted.map((c, i) => (
              <li key={c.id} className="flex items-center gap-1.5">
                <button type="button" onClick={() => p.onJump(c.t)} className="w-12 shrink-0 font-mono text-[11px] text-accent-2 underline" title="Jump here">
                  {formatTime(i === 0 ? 0 : c.t)}
                </button>
                <input
                  value={c.title}
                  onChange={(e) => p.onChapterChange(c.id, { title: e.target.value, auto: false })}
                  aria-label="Chapter title"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-foreground focus:border-accent-2 focus:outline-none"
                />
                <div className="w-16 shrink-0">
                  <SecondsInput value={c.t} min={0} max={p.total} onCommit={(t) => p.onChapterChange(c.id, { t, auto: false })} />
                </div>
                <button type="button" aria-label="Delete chapter" onClick={() => p.onDeleteChapter(c.id)} className="rounded p-1 text-muted hover:text-rose-500">
                  <TrashIcon width={14} height={14} />
                </button>
              </li>
            ))}
          </ul>
          <Title>Export</Title>
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={() => p.onExportChapters("txt")}>Chapter list (.txt)</ActionButton>
            <ActionButton onClick={() => p.onExportChapters("vtt")}>WebVTT chapters</ActionButton>
          </div>
          <p className="mt-1 text-[11px] text-muted">The .txt list (&quot;0:00 Intro&quot;) can be pasted into a video description; the first chapter always starts at 0:00.</p>
        </>
      )}
    </>
  );
}

function ShortcutsTab(p: TutorialPanelProps) {
  const s = p.keySettings;
  const set = (patch: Partial<KeystrokeSettings>) => p.onKeySettings({ ...s, ...patch });
  if (!p.combos.length) {
    return (
      <Hint>
        No keyboard shortcuts were recorded. Shortcut indicators use only the shortcut metadata the recorder saves when &quot;Keyboard shortcuts&quot;
        is turned on - never typed text.
      </Hint>
    );
  }
  return (
    <>
      <Hint>
        Shows the shortcuts you pressed (only key combinations were recorded - typed text and passwords never were). Untick any you don&apos;t want
        shown. Indicators are text layers: edit, move or delete them like any text.
      </Hint>
      <Title>Recorded shortcuts</Title>
      <ul className="max-h-48 space-y-1 overflow-y-auto">
        {p.combos.map((c) => (
          <li key={c.combo}>
            <Check
              label={`${displayCombo(c.combo, p.isMac)}  ·  ${c.count}×`}
              checked={!s.hidden.includes(c.combo)}
              onChange={(v) => set({ hidden: v ? s.hidden.filter((h) => h !== c.combo) : [...s.hidden, c.combo] })}
            />
          </li>
        ))}
      </ul>
      <Title>Style</Title>
      <div className="space-y-3">
        <div className="flex gap-1.5">
          {(["dark", "light", "accent"] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => set({ style: st })}
              className={`rounded-lg border px-2 py-1 text-xs capitalize ${s.style === st ? "border-accent-2 bg-accent-2/10" : "border-border text-muted"}`}
            >
              {st}
            </button>
          ))}
        </div>
        <SliderField label="Display time" value={s.duration} min={0.5} max={4} step={0.1} format={(v) => `${v.toFixed(1)} s`} onChange={(duration) => set({ duration })} gesture={noGesture} />
        <SliderField label="Size" value={s.size} min={0.025} max={0.09} step={0.005} format={(v) => `${Math.round(v * 1000) / 10}%`} onChange={(size) => set({ size })} gesture={noGesture} />
        <SliderField label="Position" value={s.y} min={0.08} max={0.95} step={0.01} format={(v) => (v < 0.3 ? "Top" : v < 0.7 ? "Middle" : "Bottom")} onChange={(y) => set({ y })} gesture={noGesture} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <ActionButton tone="accent" onClick={p.onGenerateKeys}>
          {p.keystrokeCount ? "Update indicators" : "Add shortcut indicators"}
        </ActionButton>
        {p.keystrokeCount > 0 && (
          <ActionButton onClick={p.onRemoveKeys}>
            <TrashIcon width={14} height={14} /> Remove {p.keystrokeCount}
          </ActionButton>
        )}
      </div>
      {p.keystrokeCount > 0 && <p className="mt-2 text-[11px] text-muted">Updating replaces all indicators, including ones you edited.</p>}
    </>
  );
}

function PrivacyTab(p: TutorialPanelProps) {
  return (
    <>
      <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
        Masks hide only the area and time you set; nothing is detected automatically. Play the whole video and check every mask covers what it should
        before you export - especially when windows move or scroll.
      </div>
      <div className="flex flex-wrap gap-2">
        <ActionButton tone="accent" onClick={() => p.onAddMask("blur")}>
          Blur
        </ActionButton>
        <ActionButton onClick={() => p.onAddMask("pixelate")}>Pixelate</ActionButton>
        <ActionButton onClick={() => p.onAddMask("solid")}>Solid box</ActionButton>
      </div>
      {p.masks.length > 0 && (
        <>
          <Title>Masks ({p.masks.length})</Title>
          <ul className="space-y-1">
            {[...p.masks]
              .sort((a, b) => a.start - b.start)
              .map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => p.onSelectMask(m.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border border-border px-2 py-1.5 text-left text-xs hover:bg-surface-2 ${m.enabled ? "" : "opacity-50"}`}
                  >
                    <span className="font-mono text-muted">
                      {formatTime(m.start)}–{formatTime(m.end)}
                    </span>
                    <span className="flex-1 truncate text-foreground">{m.label || { blur: "Blur", pixelate: "Pixelate", solid: "Solid box" }[m.mode]}</span>
                    <span className="text-[10px] text-muted">{m.follow === "pointer" ? "follows pointer" : m.space === "video" ? "on video" : "fixed"}</span>
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
    </>
  );
}

function AnnotateTab(p: TutorialPanelProps) {
  return (
    <>
      <Hint>Added at the playhead for 4 seconds. Move, resize and rotate them on the preview; change timing on the Elements track.</Hint>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(SHAPE_LABELS) as ShapeType[]).map((t) => (
          <ActionButton key={t} onClick={() => p.onAddShape(t)}>
            {SHAPE_LABELS[t]}
          </ActionButton>
        ))}
      </div>
      <Title>Screenshots from the recording</Title>
      {p.screenshots.length ? (
        <ul className="space-y-1">
          {p.screenshots.map((s) => (
            <li key={s.path} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted">
                {s.path.replace("screenshots/", "")} · {formatTime(s.tMs / 1000)}
              </span>
              <ActionButton onClick={() => p.onInsertScreenshot(s.path)}>Insert</ActionButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">Screenshots you take while recording (hotkey or button) appear here.</p>
      )}
    </>
  );
}

function RetakeTab(p: TutorialPanelProps) {
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [note, setNote] = useState("");
  const marks = p.retakes;
  return (
    <>
      <Hint>
        Mark a section to redo, then replace it with a new recording or video. The rest of the timeline - audio, webcam, captions - moves to fit, in
        sync. You review the change before it&apos;s applied; it&apos;s one undo step, and the original recording file is never changed.
      </Hint>
      {range ? (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label>
              From
              <SecondsInput value={range.start} min={0} max={range.end - 0.2} onCommit={(start) => setRange({ ...range, start })} />
            </label>
            <label>
              To
              <SecondsInput value={range.end} min={range.start + 0.2} max={p.total} onCommit={(end) => setRange({ ...range, end })} />
            </label>
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional), e.g. wrong menu"
            className="w-full rounded-lg border border-border bg-surface px-2 py-1 text-xs"
          />
          <div className="flex gap-2">
            <ActionButton
              tone="accent"
              onClick={() => {
                p.onMarkRetake(range.start, range.end, note);
                setRange(null);
                setNote("");
              }}
            >
              Mark for retake
            </ActionButton>
            <ActionButton onClick={() => setRange(null)}>Cancel</ActionButton>
          </div>
        </div>
      ) : (
        <ActionButton
          onClick={() => {
            const t = p.playhead();
            setRange({ start: t, end: Math.min(p.total, t + 5) });
          }}
        >
          Mark a section at the playhead
        </ActionButton>
      )}
      {marks.length > 0 && (
        <>
          <Title>Marked for retake</Title>
          <ul className="space-y-2">
            {marks.map((m) => (
              <li key={m.id} className="rounded-xl border border-border p-2.5 text-xs">
                <button type="button" className="font-mono text-accent-2 underline" onClick={() => p.onPreview(m)}>
                  {formatTime(m.start)}–{formatTime(m.end)}
                </button>
                {m.detail && <span className="ml-2 text-muted">{m.detail}</span>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.canReplaceFromRecording && (
                    <ActionButton tone="accent" disabled={!!p.replaceBusy} onClick={() => p.onReplace(m, "recording")}>
                      Replace with a recording…
                    </ActionButton>
                  )}
                  <ActionButton disabled={!!p.replaceBusy} onClick={() => p.onReplace(m, "file")}>
                    Replace with a video file…
                  </ActionButton>
                  <ActionButton onClick={() => p.onReject(m)}>Remove mark</ActionButton>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {p.replaceBusy && (
        <p className="mt-2 text-xs text-muted" role="status">
          {p.replaceBusy}
        </p>
      )}
    </>
  );
}

/** Inspector for a selected privacy mask. */
export function MaskPanel({
  mask,
  total,
  canFollow,
  canAnchor,
  onChange,
  onDelete,
  onClose,
  gesture,
}: {
  mask: PrivacyMask;
  total: number;
  canFollow: boolean;
  canAnchor: boolean;
  onChange: (patch: Partial<PrivacyMask>) => void;
  onDelete: () => void;
  onClose: () => void;
  gesture: Gesture;
}) {
  return (
    <PanelShell title="Privacy mask" onClose={onClose}>
      <div className="space-y-3">
        <p className="rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-900 dark:text-amber-100">
          Drag the dashed box on the preview to place it. Check the whole time range - the mask only covers this box.
        </p>
        <Check label="Enabled" checked={mask.enabled} onChange={(enabled) => onChange({ enabled })} />
        <div className="flex gap-1.5">
          {(["blur", "pixelate", "solid"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange({ mode: m })}
              className={`rounded-lg border px-2 py-1 text-xs capitalize ${mask.mode === m ? "border-accent-2 bg-accent-2/10" : "border-border text-muted"}`}
            >
              {m}
            </button>
          ))}
        </div>
        {mask.mode === "solid" ? (
          <label className="flex items-center justify-between text-xs font-medium">
            Color
            <input type="color" value={mask.color} onChange={(e) => onChange({ color: e.target.value })} className="h-7 w-10 rounded border border-border" />
          </label>
        ) : (
          <SliderField label="Strength" value={mask.strength} min={10} max={100} step={1} onChange={(strength) => onChange({ strength })} gesture={gesture} />
        )}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label>
            Start
            <SecondsInput value={mask.start} min={0} max={mask.end - 0.1} onCommit={(start) => onChange({ start })} />
          </label>
          <label>
            End
            <SecondsInput value={mask.end} min={mask.start + 0.1} max={total} onCommit={(end) => onChange({ end })} />
          </label>
        </div>
        <SliderField label="Width" value={mask.w} min={0.01} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(w) => onChange({ w })} gesture={gesture} />
        <SliderField label="Height" value={mask.h} min={0.01} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(h) => onChange({ h })} gesture={gesture} />
        <Check
          label="Stick to the video (moves with crops and zooms)"
          checked={mask.space === "video"}
          disabled={!canAnchor}
          onChange={(v) => onChange({ space: v ? "video" : "canvas" })}
        />
        <Check label="Follow the mouse pointer" checked={mask.follow === "pointer"} disabled={!canFollow} onChange={(v) => onChange({ follow: v ? "pointer" : "none" })} />
        {!canFollow && <p className="text-[11px] text-muted">Following needs a recording with mouse positions.</p>}
        <input
          value={mask.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Label (e.g. email address)"
          className="w-full rounded-lg border border-border bg-surface px-2 py-1 text-xs"
        />
        <ActionButton tone="danger" onClick={onDelete}>
          <TrashIcon width={14} height={14} /> Delete mask
        </ActionButton>
      </div>
    </PanelShell>
  );
}
