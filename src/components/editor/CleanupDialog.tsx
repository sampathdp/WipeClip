"use client";

import { useState } from "react";
import { CLEANUP_GROUPS, CLEANUP_OPTIONS, DEFAULT_CLEANUP, ECHO_STRENGTHS, type CleanupOption } from "@/lib/editor/cleanupPlan";
import Dialog from "./Dialog";
import { ActionButton } from "./Inspector";

const STORE = "wipeclip.cleanup.options";
const ECHO_STORE = "wipeclip.cleanup.echo";

function rememberedEcho(): number {
  try {
    const v = Number(localStorage.getItem(ECHO_STORE));
    if (ECHO_STRENGTHS.some((s) => s.value === v)) return v;
  } catch {
    // the default
  }
  return 2;
}

function remembered(): Set<CleanupOption> {
  try {
    const raw = localStorage.getItem(STORE);
    const ids = raw ? (JSON.parse(raw) as string[]) : null;
    if (Array.isArray(ids)) return new Set(ids.filter((id): id is CleanupOption => CLEANUP_OPTIONS.some((o) => o.id === id)));
  } catch {
    // private window or blocked storage: the defaults
  }
  return new Set(DEFAULT_CLEANUP);
}

/** Clean up audio: pick what to fix, then one button runs it all
 * (VideoEditor runCleanup). The choice is remembered on this device. */
export default function CleanupDialog({
  tracks,
  engine,
  hasTranscript,
  busy,
  separator,
  onRun,
  onCancel,
  onClose,
}: {
  /** The voice separation model (background removal): on this machine
   * yet, and its size. null when unknown. */
  separator: { ready: boolean; sizeMb: number } | null;
  /** Stops a running clean-up (between or inside the slow stages). */
  onCancel: () => void;
  /** Names of the voice tracks the sound fixes apply to. */
  tracks: string[];
  /** The desktop engine is available (sound fixes need it). */
  engine: boolean;
  /** A transcript matching the edit (filler words and stutters need it). */
  hasTranscript: boolean;
  /** What's running now, or null. */
  busy: string | null;
  onRun: (chosen: Set<CleanupOption>, echo: number) => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<Set<CleanupOption>>(remembered);
  const [echo, setEcho] = useState(rememberedEcho);
  const pickEcho = (v: number) => {
    setEcho(v);
    try {
      localStorage.setItem(ECHO_STORE, String(v));
    } catch {
      // not remembered: fine
    }
  };
  const toggle = (id: CleanupOption) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
    try {
      localStorage.setItem(STORE, JSON.stringify([...next]));
    } catch {
      // not remembered: fine
    }
  };
  const usable = (id: CleanupOption) => {
    const o = CLEANUP_OPTIONS.find((x) => x.id === id)!;
    return !(o.engine && !engine) && !(o.group === "sound" && tracks.length === 0);
  };
  const runnable = [...chosen].filter(usable);
  return (
    <Dialog title="Clean up audio" onClose={busy ? undefined : onClose} wide>
      <div className="space-y-4 text-sm">
        <p className="text-xs text-muted">
          Pick what to fix, then press Enhance. Everything runs on this computer, your files aren&apos;t changed, and Undo takes each step back.
        </p>
        {CLEANUP_GROUPS.map((g) => (
          <div key={g.id}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.label}</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label={g.label}>
              {CLEANUP_OPTIONS.filter((o) => o.group === g.id).map((o) => {
                const on = chosen.has(o.id);
                const ok = usable(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={!ok || !!busy}
                    title={ok ? o.hint : o.engine && !engine ? "Needs the WipeClip desktop app" : "No voice track to apply it to"}
                    onClick={() => toggle(o.id)}
                    className={`rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:cursor-not-allowed disabled:opacity-40 ${
                      on && ok ? "border-accent-2 bg-accent-2 text-black shadow-sm" : "border-border bg-surface text-foreground hover:border-accent/50"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            {g.id === "sound" && chosen.has("echo") && usable("echo") && (
              <div className="mt-2 flex items-center gap-2 text-xs" role="radiogroup" aria-label="Echo removal strength">
                <span className="text-muted">Echo removal:</span>
                {ECHO_STRENGTHS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    role="radio"
                    aria-checked={echo === s.value}
                    disabled={!!busy}
                    onClick={() => pickEcho(s.value)}
                    className={`rounded-full border px-2.5 py-0.5 font-semibold ${echo === s.value ? "border-accent-2 bg-accent-2/20 text-foreground" : "border-border text-muted hover:text-foreground"}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <ul className="space-y-0.5 text-[11px] text-muted">
          {chosen.has("background") && usable("background") && (
            <li>
              Remove background audio takes about 1.5 times the track&apos;s length on this computer
              {separator && !separator.ready ? `, and downloads its voice separation model (${separator.sizeMb} MB) once` : ""}. You can cancel it.
            </li>
          )}
          {chosen.has("echo") && usable("echo") && <li>Compare Cleaned and Original after: if the voice sounds hollow, try a lighter echo removal.</li>}
          <li>
            {tracks.length
              ? `Sound fixes and studio sound apply to: ${tracks.join(", ")}.`
              : "No voice track found (a microphone recording or voiceover), so only the cuts and loudness apply."}
          </li>
          {!engine && <li>Cleaning the sound (noise, echo, background, clipping, mouth sounds, wind) needs the WipeClip desktop app.</li>}
          {!hasTranscript && (chosen.has("fillers") || chosen.has("stutters")) && (
            <li>Filler words and stutters are found from the transcript: transcribe first in the Transcript panel. Hesitations and silences work without it.</li>
          )}
          <li>Cuts that aren&apos;t certain are left in Review for you to check.</li>
        </ul>
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          {busy ? (
            <>
              <span className="text-xs text-foreground" role="status">
                {busy}
              </span>
              <button type="button" className="text-xs font-semibold text-accent-2 hover:underline" onClick={onCancel}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <ActionButton tone="accent" onClick={() => onRun(new Set(runnable), echo)} disabled={runnable.length === 0}>
                Enhance
              </ActionButton>
              <button type="button" className="text-xs font-semibold text-accent-2 hover:underline" onClick={onClose}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
