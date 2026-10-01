"use client";

import { useState, type ReactNode } from "react";
import { STICKER_CATEGORIES, STICKERS, stickerThumbSrc, type StickerCategory } from "@/lib/editor/stickers";
import {
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

export function ClipPanel({
  laid,
  count,
  source,
  playheadSourceTime,
  onChange,
  onSplit,
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
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onAiCleanup: () => void;
  onClose: () => void;
  /** Speed, volume, transform and look sections (see Panels.tsx). */
  extra?: ReactNode;
}) {
  const { clip, index } = laid;
  const canTrimHere = playheadSourceTime !== null;
  return (
    <PanelShell title={`Clip ${index + 1}${source.kind === "cleaned" ? " · AI cleaned" : ""}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts at">
            <SecondsInput value={clip.start} min={0} max={clip.end - MIN_CLIP_SECONDS} onCommit={(start) => onChange({ start })} />
          </Field>
          <Field label="Ends at">
            <SecondsInput
              value={clip.end}
              min={clip.start + MIN_CLIP_SECONDS}
              max={source.duration}
              onCommit={(end) => onChange({ end })}
            />
          </Field>
        </div>
        <p className="text-xs text-muted">
          Plays {formatTime(clip.end - clip.start, true)} of the {source.kind === "cleaned" ? "cleaned segment" : "original video"}.
          Drag the clip&apos;s edges on the timeline to trim.
        </p>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Trim</p>
          <div className="grid grid-cols-2 gap-2">
            <ActionButton
              disabled={!canTrimHere || playheadSourceTime! - clip.start < 0.01 || clip.end - playheadSourceTime! < MIN_CLIP_SECONDS}
              onClick={() => onChange({ start: playheadSourceTime! })}
              title="Remove everything in this clip before the playhead"
            >
              Trim start here
            </ActionButton>
            <ActionButton
              disabled={!canTrimHere || playheadSourceTime! - clip.start < MIN_CLIP_SECONDS}
              onClick={() => onChange({ end: playheadSourceTime! })}
              title="Remove everything in this clip after the playhead"
            >
              Trim end here
            </ActionButton>
          </div>
          {!canTrimHere && <p className="mt-1.5 text-[11px] text-muted">Move the playhead into this clip to trim at it.</p>}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ActionButton onClick={onSplit} disabled={!canTrimHere}>
            <SplitIcon width={14} height={14} /> Split
          </ActionButton>
          <ActionButton onClick={onDelete} disabled={count <= 1} tone="danger" title={count <= 1 ? "A project needs at least one clip" : undefined}>
            <TrashIcon width={14} height={14} /> Delete
          </ActionButton>
          <ActionButton onClick={() => onMove(-1)} disabled={index === 0}>
            <ChevronLeftIcon width={14} height={14} /> Move earlier
          </ActionButton>
          <ActionButton onClick={() => onMove(1)} disabled={index === count - 1}>
            Move later <ChevronRightIcon width={14} height={14} />
          </ActionButton>
        </div>

        {extra}

        <div className="rounded-xl border border-accent/25 bg-accent/5 p-3">
          <p className="text-xs font-semibold text-foreground">AI Cleanup</p>
          <p className="mt-1 text-xs text-muted">
            Remove a logo, caption, or overlay from just this clip. The cleaned result replaces the clip (undo brings the original back).
          </p>
          <div className="mt-2.5">
            <ActionButton onClick={onAiCleanup} tone="accent">
              <SparkleIcon width={14} height={14} /> Clean up this clip
            </ActionButton>
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-muted">
          Tip: to cut out a section, split at its start and end, then delete the middle clip. The rest joins up automatically.
        </p>
      </div>
    </PanelShell>
  );
}

const TRANSITION_ORDER: (TransitionType | null)[] = [null, "fade", "crossfade", "dipblack", "dipwhite", "slideleft", "slideright", "zoom", "blur"];

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
