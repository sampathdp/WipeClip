"use client";

import { useState, type ReactNode } from "react";
import { useShortcutKeys } from "@/lib/platform/keys";
import { STICKER_CATEGORIES, STICKERS, stickerThumbSrc, type StickerCategory } from "@/lib/editor/stickers";
import {
  MAX_FREEZE_SECONDS,
  MAX_REVERSE_SECONDS,
  MIN_CLIP_SECONDS,
  TRANSITION_DURATIONS,
  TRANSITION_LABELS,
  formatTime,
  type LaidOutClip,
} from "@/lib/editor/timeline";
import type { Clip, MediaSource, TransitionType } from "@/lib/editor/types";
import { isPremiumTransition } from "@/lib/entitlements";
import { ChevronLeftIcon, ChevronRightIcon, SparkleIcon, SplitIcon, TrashIcon } from "./icons";
import PremiumBadge from "./PremiumBadge";
import { AI_CLEANUP_ENABLED } from "@/lib/features";

export function PanelShell({ title, onClose, children }: { title: string; onClose?: () => void; children: ReactNode }) {
  return (
    <section className="flex h-full flex-col" aria-label={title}>
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs font-semibold text-muted hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
          >
            Done
          </button>
        )}
      </header>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  );
}

/** Seconds field that commits on blur/Enter, so typing "1" on the way to
 * "12.5" doesn't apply (and record in undo) every keystroke.
 */
export function SecondsInput({ value, min, max, onCommit }: { value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    setDraft(null);
    if (Number.isFinite(v)) onCommit(Math.min(max, Math.max(min, v)));
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      step={0.1}
      min={min}
      max={max}
      value={draft ?? value.toFixed(2)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-foreground focus:border-accent-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-2/40"
    />
  );
}

export function ActionButton({
  onClick,
  disabled,
  children,
  tone = "default",
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  tone?: "default" | "danger" | "accent";
  title?: string;
}) {
  const tones = {
    default: "border-border bg-surface hover:border-accent/50 text-foreground",
    danger: "border-rose-500/30 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:text-rose-400",
    accent: "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 dark:text-accent-light",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export type ClipSection = "basics" | "speed" | "frame";
const CLIP_TABS: { id: ClipSection; label: string }[] = [
  { id: "basics", label: "Basics" },
  { id: "speed", label: "Speed & sound" },
  { id: "frame", label: "Frame" },
];

/** Segmented tabs inside a panel; the tabs share the width. */
export function PanelTabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="mb-4 flex gap-0.5 rounded-lg border border-border bg-surface-2/70 p-0.5">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`min-w-0 flex-1 truncate rounded-md px-1.5 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
            value === t.id ? "bg-surface-3 text-foreground shadow-sm ring-1 ring-border" : "text-muted hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function ClipPanel({
  laid,
  count,
  source,
  playheadSourceTime,
  onChange,
  onSplit,
  onDuplicate,
  onDelete,
  onMove,
  onAiCleanup,
  onClose,
  extra,
}: {
  laid: LaidOutClip;
  count: number;
  source: MediaSource;
  /** Playhead position in this clip's source time, if the playhead is inside it. */
  playheadSourceTime: number | null;
  onChange: (patch: Partial<Clip>) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onAiCleanup: () => void;
  onClose: () => void;
  /** The rest of each tab: speed and sound, framing, look (see ClipExtras in Panels.tsx). */
  extra?: (section: ClipSection) => ReactNode;
}) {
  const [tab, setTab] = useState<ClipSection>("basics");
  const shortcutKeys = useShortcutKeys();
  const { clip, index } = laid;
  const canTrimHere = playheadSourceTime !== null;
  const p = playheadSourceTime ?? 0;
  const frozen = clip.freeze !== null;
  // A reversed range has a length cap (the export buffers it in memory).
  const cap = clip.reverse ? MAX_REVERSE_SECONDS : Infinity;
  // Trimming "before the playhead" removes the start of what plays: the
  // source start normally, the source end when reversed.
  const trimStart = clip.reverse
    ? { patch: { end: p }, blocked: clip.end - p < 0.01 || p - clip.start < MIN_CLIP_SECONDS }
    : { patch: { start: p }, blocked: p - clip.start < 0.01 || clip.end - p < MIN_CLIP_SECONDS };
  const trimEnd = clip.reverse
    ? { patch: { start: p }, blocked: clip.end - p < MIN_CLIP_SECONDS }
    : { patch: { end: p }, blocked: p - clip.start < MIN_CLIP_SECONDS };
  // A freeze frame has no speed or sound.
  const tabs = frozen ? CLIP_TABS.filter((t) => t.id !== "speed") : CLIP_TABS;
  const current = tabs.some((t) => t.id === tab) ? tab : "basics";
  return (
    <PanelShell
      title={`Clip ${index + 1}${frozen ? " · Freeze frame" : source.kind === "cleaned" ? " · AI cleaned" : ""}`}
      onClose={onClose}
    >
      <PanelTabs label="Clip settings" tabs={tabs} value={current} onChange={setTab} />
      {current !== "basics" ? (
        extra?.(current)
      ) : (
        <div className="space-y-4">
          {frozen ? (
            <>
              <Field label="Hold for (seconds)">
                <SecondsInput
                  value={clip.end - clip.start}
                  min={MIN_CLIP_SECONDS}
                  max={MAX_FREEZE_SECONDS}
                  onCommit={(hold) => onChange({ start: 0, end: hold })}
                />
              </Field>
              <p className="text-xs text-muted">
                Holds the frame at {formatTime(clip.freeze!, true)} of the video. Drag the clip&apos;s edges on the timeline to change how long.
              </p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Starts at">
                  <SecondsInput
                    value={clip.start}
                    min={Math.max(0, clip.end - cap)}
                    max={clip.end - MIN_CLIP_SECONDS}
                    onCommit={(start) => onChange({ start })}
                  />
                </Field>
                <Field label="Ends at">
                  <SecondsInput
                    value={clip.end}
                    min={clip.start + MIN_CLIP_SECONDS}
                    max={Math.min(source.duration, clip.start + cap)}
                    onCommit={(end) => onChange({ end })}
                  />
                </Field>
              </div>
              <p className="text-xs text-muted">
                Plays {formatTime(clip.end - clip.start, true)}
                {clip.reverse ? ", backwards" : ""}. Or drag the clip&apos;s edges on the timeline.
              </p>
  
              <div>
                <div className="grid grid-cols-2 gap-2">
                  <ActionButton
                    disabled={!canTrimHere || trimStart.blocked}
                    onClick={() => onChange(trimStart.patch)}
                    title="Remove everything in this clip before the playhead"
                  >
                    Trim start here
                  </ActionButton>
                  <ActionButton
                    disabled={!canTrimHere || trimEnd.blocked}
                    onClick={() => onChange(trimEnd.patch)}
                    title="Remove everything in this clip after the playhead"
                  >
                    Trim end here
                  </ActionButton>
                </div>
                {!canTrimHere && <p className="mt-1.5 text-[11px] text-muted">Move the playhead into this clip to trim or split at it.</p>}
              </div>
            </>
          )}
  
          <div className="grid grid-cols-3 gap-2 border-t border-border pt-4">
            <ActionButton onClick={onSplit} disabled={!canTrimHere}>
              <SplitIcon width={14} height={14} /> Split
            </ActionButton>
            <ActionButton onClick={onDuplicate} title={`Duplicate (${shortcutKeys.mod}+D)`}>
              Duplicate
            </ActionButton>
            <ActionButton onClick={onDelete} disabled={count <= 1} tone="danger" title={count <= 1 ? "A project needs at least one clip" : undefined}>
              <TrashIcon width={14} height={14} /> Delete
            </ActionButton>
          </div>
          <div className="-mt-2 grid grid-cols-2 gap-2">
            <ActionButton onClick={() => onMove(-1)} disabled={index === 0}>
              <ChevronLeftIcon width={14} height={14} /> Move earlier
            </ActionButton>
            <ActionButton onClick={() => onMove(1)} disabled={index === count - 1}>
              Move later <ChevronRightIcon width={14} height={14} />
            </ActionButton>
          </div>
  
          {extra?.("basics")}
  
          {AI_CLEANUP_ENABLED && !frozen && (
            <div className="rounded-xl border border-accent/25 bg-accent/5 p-3">
              <p className="text-xs font-semibold text-foreground">AI Cleanup</p>
              <p className="mt-1 text-xs text-muted">
                Remove an unwanted object from just this clip. The cleaned result replaces the clip (undo brings the original back).
              </p>
              <div className="mt-2.5">
                <ActionButton onClick={onAiCleanup} tone="accent">
                  <SparkleIcon width={14} height={14} /> Clean up this clip
                </ActionButton>
              </div>
            </div>
          )}
        </div>
      )}
    </PanelShell>
  );
}

const TRANSITION_ORDER: (TransitionType | null)[] = [
  null,
  "fade",
  "crossfade",
  "dipblack",
  "dipwhite",
  "fadegrays",
  "slideleft",
  "slideright",
  "slideup",
  "slidedown",
  "wipeleft",
  "wiperight",
  "wipeup",
  "wipedown",
  "smoothleft",
  "smoothright",
  "smoothup",
  "smoothdown",
  "vertopen",
  "horzopen",
  "diagtl",
  "diagbr",
  "radial",
  "circleopen",
  "circleclose",
  "circlecrop",
  "rectcrop",
  "zoom",
  "blur",
];

export function TransitionPanel({
  laid,
  next,
  onChange,
  onClose,
  premiumLocked = false,
}: {
  laid: LaidOutClip;
  next: LaidOutClip;
  onChange: (t: Clip["transition"]) => void;
  onClose: () => void;
  /** Mark premium transitions (the user's plan doesn't include them). */
  premiumLocked?: boolean;
}) {
  const current = laid.clip.transition;
  const maxDuration = Math.min(laid.duration, next.duration) / 2;
  return (
    <PanelShell title={`Transition · clip ${laid.index + 1} → ${next.index + 1}`} onClose={onClose}>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Transition type">
        {TRANSITION_ORDER.map((type) => {
          const active = (current?.type ?? null) === type;
          return (
            <button
              key={type ?? "none"}
              type="button"
              role="radio"
              aria-checked={active}
              title={type ? TRANSITION_LABELS[type].hint : "Straight cut, no transition"}
              onClick={() => onChange(type ? { type, duration: current?.duration ?? 0.5 } : null)}
              className={`relative flex flex-col items-center gap-1.5 rounded-xl border p-2 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
                active ? "border-accent-2 bg-accent-2/10 text-foreground" : "border-border bg-surface text-muted hover:border-accent/50 hover:text-foreground"
              }`}
            >
              <TransitionSwatch type={type} />
              {type ? TRANSITION_LABELS[type].label : "Cut"}
              {premiumLocked && type && isPremiumTransition(type) && <PremiumBadge />}
            </button>
          );
        })}
      </div>

      {current && (
        <div className="mt-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Duration</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Transition duration">
            {TRANSITION_DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={current.duration === d}
                disabled={d > maxDuration + 1e-6}
                onClick={() => onChange({ ...current, duration: d })}
                className={`rounded-full border px-3 py-1.5 font-mono text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:cursor-not-allowed disabled:opacity-30 ${
                  current.duration === d ? "border-accent-2 bg-accent-2 text-black" : "border-border bg-surface text-foreground hover:border-accent/50"
                }`}
              >
                {d}s
              </button>
            ))}
          </div>
          {laid.transitionOut + 1e-6 < current.duration && (
            <p className="mt-2 text-[11px] text-muted">
              Shortened to {laid.transitionOut.toFixed(2)}s: a transition can be at most half as long as the shorter clip.
            </p>
          )}
          <p className="mt-3 text-xs text-muted">{TRANSITION_LABELS[current.type].hint}. The two clips overlap by the transition&apos;s length.</p>
          {premiumLocked && isPremiumTransition(current.type) && (
            <p className="mt-2 text-[11px] text-muted">
              Premium transition: free to try, exports with{" "}
              <a href="/pricing" target="_blank" rel="noopener" className="font-semibold text-accent underline">
                any paid plan
              </a>
              .
            </p>
          )}
        </div>
      )}
    </PanelShell>
  );
}

function TransitionSwatch({ type }: { type: TransitionType | null }) {
  const a = "#7c5cff";
  const b = "#22d3ee";
  const common = "h-8 w-full rounded-md";
  switch (type) {
    case null:
      return <div className={common} style={{ background: `linear-gradient(90deg, ${a} 50%, ${b} 50%)` }} />;
    case "dipblack":
      return <div className={common} style={{ background: `linear-gradient(90deg, ${a}, #000, ${b})` }} />;
    case "dipwhite":
      return <div className={common} style={{ background: `linear-gradient(90deg, ${a}, #fff, ${b})` }} />;
    case "slideleft":
      return <div className={common} style={{ background: `linear-gradient(90deg, ${a} 35%, ${b} 35%)` }}>←</div>;
    case "slideright":
      return <div className={common} style={{ background: `linear-gradient(90deg, ${b} 65%, ${a} 65%)` }}>→</div>;
    case "zoom":
      return <div className={common} style={{ background: `radial-gradient(circle, ${b} 30%, ${a} 70%)` }} />;
    case "blur":
      return <div className={`${common} blur-[1.5px]`} style={{ background: `linear-gradient(90deg, ${a}, ${b})` }} />;
    case "fadegrays":
      return <div className={common} style={{ background: `linear-gradient(90deg, ${a}, #8a8a8a, ${b})` }} />;
    case "slideup":
    case "wipeup":
      return <div className={common} style={{ background: `linear-gradient(180deg, ${a} 60%, ${b} 60%)` }} />;
    case "slidedown":
    case "wipedown":
      return <div className={common} style={{ background: `linear-gradient(180deg, ${b} 40%, ${a} 40%)` }} />;
    case "wipeleft":
      return <div className={common} style={{ background: `linear-gradient(90deg, ${a} 60%, ${b} 60%)` }} />;
    case "wiperight":
      return <div className={common} style={{ background: `linear-gradient(90deg, ${b} 40%, ${a} 40%)` }} />;
    case "smoothleft":
      return <div className={common} style={{ background: `linear-gradient(90deg, ${a} 30%, ${b} 80%)` }} />;
    case "smoothright":
      return <div className={common} style={{ background: `linear-gradient(90deg, ${b} 20%, ${a} 70%)` }} />;
    case "smoothup":
      return <div className={common} style={{ background: `linear-gradient(180deg, ${a} 20%, ${b} 90%)` }} />;
    case "smoothdown":
      return <div className={common} style={{ background: `linear-gradient(180deg, ${b} 10%, ${a} 80%)` }} />;
    case "vertopen":
      return <div className={common} style={{ background: `linear-gradient(90deg, ${a} 15%, ${b} 40%, ${b} 60%, ${a} 85%)` }} />;
    case "horzopen":
      return <div className={common} style={{ background: `linear-gradient(180deg, ${a} 10%, ${b} 40%, ${b} 60%, ${a} 90%)` }} />;
    case "diagtl":
      return <div className={common} style={{ background: `linear-gradient(135deg, ${a} 45%, ${b} 85%)` }} />;
    case "diagbr":
      return <div className={common} style={{ background: `linear-gradient(135deg, ${b} 15%, ${a} 55%)` }} />;
    case "radial":
      return <div className={common} style={{ background: `conic-gradient(${b} 0 130deg, ${a} 130deg)` }} />;
    case "circleopen":
      return <div className={common} style={{ background: `radial-gradient(circle, ${b} 35%, ${a} 55%)` }} />;
    case "circleclose":
      return <div className={common} style={{ background: `radial-gradient(circle, ${a} 35%, ${b} 55%)` }} />;
    case "circlecrop":
      return <div className={common} style={{ background: `radial-gradient(circle, ${b} 30%, #000 31%)` }} />;
    case "rectcrop":
      return <div className={common} style={{ background: "#000", boxShadow: `inset 0 0 0 6px #000`, backgroundImage: `linear-gradient(${b}, ${b})`, backgroundSize: "50% 50%", backgroundPosition: "center", backgroundRepeat: "no-repeat" }} />;
    default:
      return <div className={common} style={{ background: `linear-gradient(90deg, ${a}, ${b})` }} />;
  }
}

export function StickerLibrary({ onAdd }: { onAdd: (stickerId: string) => void }) {
  const [category, setCategory] = useState<StickerCategory>("emoji");
  const items = STICKERS.filter((s) => s.category === category);
  return (
    <div>
      <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Sticker categories">
        {STICKER_CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={category === c.key}
            onClick={() => setCategory(c.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
              category === c.key ? "bg-accent text-white" : "bg-surface-3 text-muted hover:text-foreground"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-2" role="tabpanel">
        {items.map((s) => {
          const thumb = stickerThumbSrc(s);
          return (
            <button
              key={s.id}
              type="button"
              title={`Add ${s.label}`}
              aria-label={`Add ${s.label} sticker`}
              onClick={() => onAdd(s.id)}
              className="flex aspect-square items-center justify-center rounded-xl border border-border bg-surface p-2 transition hover:scale-105 hover:border-accent-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
            >
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumb} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
              ) : (
                <span className="text-3xl leading-none">{s.kind === "emoji" ? s.char : ""}</span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-[11px] text-muted">Stickers are added at the playhead for 3 seconds. Adjust timing on the sticker track.</p>
    </div>
  );
}
