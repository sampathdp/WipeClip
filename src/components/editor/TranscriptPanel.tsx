"use client";

import { useMemo, useState } from "react";
import { useClockTime, type Clock } from "@/lib/editor/clock";
import { formatTime } from "@/lib/editor/timeline";
import type { Transcript } from "@/lib/editor/types";
import { DUB_TO, dubLanguageLabel } from "@/lib/editor/dub";
import type { DubModels, DubVoice } from "@/lib/toolsApi";
import { fillerIndices } from "@/lib/editor/wordEdit";
import { ActionButton, PanelShell } from "./Inspector";
import { SpeechGpuChoice, SpeechModelNotice } from "./Panels";

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
  onCancel,
  modelCached,
  model,
  onDelete,
  dub,
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
  /** Stops the model download or transcription in progress. */
  onCancel: () => void;
  /** null = still checking; false = the first Transcribe asks to download it. */
  modelCached: boolean | null;
  model: { sizeMb: number; gpu: boolean; engine?: boolean; language?: string; cuda?: { available: boolean; ready: boolean; sizeMb: number } } | null;
  onDelete: (indices: number[]) => void;
  /** Voice translation (desktop, a supported language); null to leave it
   * out. `models`: whether its models for `target` are downloaded (null =
   * still checking); `source`: the transcript's language; `voice`: the
   * voice picked (or recommended here). */
  dub: {
    models: DubModels | null;
    source: string;
    target: string;
    onTarget: (target: string) => void;
    voice: DubVoice | undefined;
    onVoice: (voice: DubVoice) => void;
    busy: boolean;
    onStart: () => void;
    onCancel: () => void;
  } | null;
  onClose: () => void;
}) {
  const words = useMemo(() => (current ? (transcript?.words ?? []) : []), [current, transcript]);
  // The selection belongs to one word list: a new transcript (or a cut)
  // means nothing is selected.
  const [sel, setSel] = useState<{ words: typeof words; anchor: number; focus: number } | null>(null);
  const anchor = sel?.words === words ? sel.anchor : null;
  const focus = sel?.words === words ? sel.focus : null;
  const t = useClockTime(clock);
  const [consent, setConsent] = useState(false);
  const [dubConsent, setDubConsent] = useState(false);
  const transcribeButton = (label: string) => (
    <>
      <SpeechGpuChoice gpu={model?.cuda} busy={busy} />
      {transcribeAction(label)}
    </>
  );
  const transcribeAction = (label: string) =>
    busy ? (
      <ActionButton onClick={onCancel}>Cancel transcribing</ActionButton>
    ) : modelCached === false && !consent ? (
      <SpeechModelNotice model={model} busy={busy} onConsent={() => setConsent(true)} />
    ) : (
      <ActionButton onClick={onTranscribe} disabled={modelCached === null}>
        {label}
      </ActionButton>
    );
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
          {transcribeButton(transcript ? "Transcribe again" : "Transcribe")}
          <p className="text-[11px] text-muted">Runs on this device with the same speech model as auto captions; your audio and transcript are not uploaded.</p>
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
          {transcribeButton("Transcribe again")}
          {dub && words.length > 0 && <DubSection dub={dub} busy={busy} consent={dubConsent} onConsent={() => setDubConsent(true)} />}
        </div>
      )}
    </PanelShell>
  );
}

/** "Translate voice": the language to say it in and the voice, asks before
 * the first download of the models, then runs (lib/editor/dub.ts). */
function DubSection({
  dub,
  busy,
  consent,
  onConsent,
}: {
  dub: NonNullable<Parameters<typeof TranscriptPanel>[0]["dub"]>;
  busy: boolean;
  consent: boolean;
  onConsent: () => void;
}) {
  // An engine from before the choice of voice reports one set of models.
  const models = (dub.voice && dub.models?.voices?.[dub.voice]) || dub.models;
  const needsModels = models !== null && !models.ready;
  const language = dubLanguageLabel(dub.target);
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-sm font-semibold text-foreground">Translate voice</p>
      <p className="text-[11px] text-muted">
        The speech is said again in another language in the speaker&apos;s own voice, over the video&apos;s own music and sounds. It lands as two new audio
        tracks and the original speech is muted; undo to go back. Everything happens on this computer, the translation included: nothing is uploaded.
        Use it only with voices you have the right to use.
      </p>
      <label className="flex items-center gap-2 text-xs text-muted">
        <span className="font-medium text-foreground">Into</span>
        <select
          className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-foreground"
          value={dub.target}
          disabled={busy || dub.busy}
          onChange={(e) => dub.onTarget(e.target.value)}
        >
          {DUB_TO.filter((l) => l.code !== dub.source).map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      {dub.models?.voices && dub.voice && Object.keys(dub.models.voices).length > 1 && <DubVoiceChoice dub={dub} disabled={busy || dub.busy} />}
      {dub.busy ? (
        <ActionButton onClick={dub.onCancel}>Cancel translation</ActionButton>
      ) : needsModels && !consent ? (
        <div className="space-y-2 rounded-xl border border-border bg-surface-2/60 p-3 text-xs text-muted">
          <p className="font-semibold text-foreground">Translation and voice models needed (one time)</p>
          <p>
            About {models?.sizeMb} MB, downloaded once and kept on this computer. {DUB_COST[dub.voice ?? "accurate"]}
          </p>
          <ActionButton tone="accent" onClick={onConsent} disabled={busy}>
            Download models ({models?.sizeMb} MB)
          </ActionButton>
        </div>
      ) : (
        <ActionButton tone="accent" onClick={dub.onStart} disabled={busy || dub.models === null}>
          Translate voice to {language}
        </ActionButton>
      )}
    </div>
  );
}

/** What each voice costs on the processor: measured on a 6-core laptop
 * (docs/desktop/DUB.md); slower computers take longer. */
const DUB_COST: Record<DubVoice, string> = {
  fast: "Translating takes about 2 minutes per minute of video on the processor and around 5 GB of memory.",
  accurate: "Translating takes 4-5 minutes per minute of video on the processor and around 5 GB of memory.",
};

const DUB_VOICES: { id: DubVoice; label: string; detail: string }[] = [
  { id: "fast", label: "Fast", detail: "A small voice model that runs well on any computer." },
  { id: "accurate", label: "Accurate", detail: "A larger voice model, closer to the speaker. Needs a faster computer." },
];

/** Which voice says the translation. The engine recommends one for this
 * computer (dub.py recommended_voice); the user's pick is remembered. */
function DubVoiceChoice({ dub, disabled }: { dub: NonNullable<Parameters<typeof TranscriptPanel>[0]["dub"]>; disabled: boolean }) {
  return (
    <div role="radiogroup" aria-label="Voice" className="space-y-1.5">
      {DUB_VOICES.filter((v) => dub.models?.voices?.[v.id]).map((v) => (
        <label key={v.id} className="flex items-start gap-2 text-xs text-muted">
          <input
            type="radio"
            name="dub-voice"
            className="mt-0.5 accent-[var(--accent)]"
            checked={dub.voice === v.id}
            disabled={disabled}
            onChange={() => dub.onVoice(v.id)}
          />
          <span>
            <span className="font-medium text-foreground">{v.label}</span>
            {dub.models?.recommended === v.id ? " (recommended for this computer)" : ""} - {v.detail}
            {dub.models?.voices?.[v.id]?.ready === false ? ` ${dub.models.voices[v.id]?.sizeMb} MB to download.` : ""}
          </span>
        </label>
      ))}
    </div>
  );
}
