"use client";

import { useMemo, useState } from "react";
import { useClockTime, type Clock } from "@/lib/editor/clock";
import { formatTime } from "@/lib/editor/timeline";
import type { Transcript } from "@/lib/editor/types";
import { fillerIndices } from "@/lib/editor/wordEdit";
import { ActionButton, PanelShell } from "./Inspector";

/** Editing by text: the timeline's speech as words. Click a word to jump
 * there; click another with Shift held to select the words between; delete
 * the selection (or every filler word) to cut those stretches out of the
 * video - see src/lib/editor/wordEdit.ts. */
export default function TranscriptPanel({
  transcript,
  current,
  busy,
  clock,
  hasCaptions,
  onSeek,
  onTranscribe,
  onDelete,
  onClose,
}: {
  transcript: Transcript | undefined;
  /** False when the edit changed since transcribing (times no longer match). */
  current: boolean;
  busy: boolean;
  clock: Clock;
  hasCaptions: boolean;
  onSeek: (t: number) => void;
  onTranscribe: () => void;
  onDelete: (indices: number[]) => void;
  onClose: () => void;
}) {
  const words = useMemo(() => (current ? (transcript?.words ?? []) : []), [current, transcript]);
  // The selection belongs to one word list: a new transcript (or a cut)
  // means nothing is selected.
  const [sel, setSel] = useState<{ words: typeof words; anchor: number; focus: number } | null>(null);
  const anchor = sel?.words === words ? sel.anchor : null;
  const focus = sel?.words === words ? sel.focus : null;
  const t = useClockTime(clock);
  const fillers = useMemo(() => fillerIndices(words), [words]);

  const lo = anchor === null ? null : Math.min(anchor, focus ?? anchor);
  const hi = anchor === null ? null : Math.max(anchor, focus ?? anchor);
  const selected = lo === null || hi === null ? [] : Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  const playing = words.findIndex((w) => t >= w.start && t < w.end);

  const del = (indices: number[]) => {
    onDelete(indices);
    setSel(null);
  };

  return (
    <PanelShell title="Transcript" onClose={onClose}>
      {!transcript || !current ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {transcript
              ? "The edit changed since the transcript was made, so its words no longer line up. Transcribe again to edit by text."
              : "Transcribe the video's speech, then delete words to cut them out of the video - pauses, retakes and filler words included."}
          </p>
          <ActionButton onClick={onTranscribe} disabled={busy}>
            {busy ? "Transcribing…" : transcript ? "Transcribe again" : "Transcribe"}
          </ActionButton>
          <p className="text-[11px] text-muted">Runs on this device with the same speech model as auto captions.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-muted">Click a word to jump to it. Shift+click another to select the words between, then delete them to cut that part out.</p>
          <div className="max-h-[45vh] overflow-y-auto rounded-xl border border-border bg-surface/60 p-3 text-sm leading-7 text-foreground" role="listbox" aria-label="Transcript words" aria-multiselectable>
            {words.length === 0 && <span className="text-muted">No speech was found.</span>}
            {words.map((w, i) => {
              const isSel = lo !== null && hi !== null && i >= lo && i <= hi;
              return (
                <button
                  key={`${i}-${w.start}`}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  title={formatTime(w.start, true)}
                  onClick={(e) => {
                    if (e.shiftKey && anchor !== null) setSel({ words, anchor, focus: i });
                    else {
                      setSel({ words, anchor: i, focus: i });
                      onSeek(w.start);
                    }
                  }}
                  className={`mr-1 rounded px-0.5 transition ${
                    isSel ? "bg-rose-500/25 text-foreground line-through decoration-rose-500" : i === playing ? "bg-accent-2/25" : "hover:bg-surface-2"
                  } ${fillers.includes(i) && !isSel ? "text-muted italic" : ""}`}
                >
                  {w.text}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={() => del(selected)} disabled={selected.length === 0}>
              {selected.length ? `Cut ${selected.length} word${selected.length === 1 ? "" : "s"}` : "Cut selected words"}
            </ActionButton>
            <ActionButton onClick={() => del(fillers)} disabled={fillers.length === 0}>
              {fillers.length ? `Remove ${fillers.length} filler word${fillers.length === 1 ? "" : "s"}` : "No filler words"}
            </ActionButton>
          </div>
          <p className="text-[11px] text-muted">
            Each cut is one undo step.{hasCaptions ? " Captions are rebuilt from the transcript after a cut, so edits made to caption text are replaced." : ""}
          </p>
          <ActionButton onClick={onTranscribe} disabled={busy}>
            {busy ? "Transcribing…" : "Transcribe again"}
          </ActionButton>
        </div>
      )}
    </PanelShell>
  );
}
