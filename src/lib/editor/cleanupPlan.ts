/** Clean up audio (CleanupDialog): the options, their defaults, and which
 * tracks they apply to. Each option is an existing tool run for you:
 *
 *  - sound fixes on each voice track's file, as one cleaned copy made on
 *    the device (audio_clean.py): noise, clipping, mouth clicks, wind,
 *    echo (dereverb.py) and the background (the voice separator);
 *  - voice: the "Enhance voice" tone (voiceTone.ts) and the mix's loudness;
 *  - breaths turned down (breaths.ts);
 *  - cuts from Review's analysis (silences, hesitations, filler words,
 *    stutters), only those that aren't low confidence; the rest stay in
 *    Review.
 * Pure - see tests/desktop/cleanupPlan.test.ts. */
import type { AudioClip, MediaSource } from "./types.ts";

export type CleanupOption =
  | "noise"
  | "clipping"
  | "mouth"
  | "wind"
  | "echo"
  | "background"
  | "studio"
  | "normalize"
  | "breaths"
  | "silences"
  | "hesitations"
  | "fillers"
  | "stutters";

export interface CleanupOptionDef {
  id: CleanupOption;
  label: string;
  hint: string;
  group: "sound" | "voice" | "cuts";
  /** Runs in the desktop app's engine. */
  engine?: boolean;
}

export const CLEANUP_OPTIONS: CleanupOptionDef[] = [
  { id: "noise", label: "Remove noise", hint: "Steady background noise: fans, hum, hiss, room tone.", group: "sound", engine: true },
  { id: "clipping", label: "Fix clipping", hint: "Rebuilds peaks flattened when the recording was too loud.", group: "sound", engine: true },
  { id: "mouth", label: "Remove mouth sounds", hint: "Clicks and lip smacks.", group: "sound", engine: true },
  { id: "wind", label: "Remove wind noise", hint: "Wind and low rumble (also thins a very deep voice a little).", group: "sound", engine: true },
  {
    id: "echo",
    label: "Remove echo",
    hint: "Room echo and reverb, for a voice that sounds far away or in an empty room. Strongest on small and medium rooms; a very echoey hall improves less.",
    group: "sound",
    engine: true,
  },
  {
    id: "background",
    label: "Remove background audio",
    hint: "Keeps only the voice: music, TV, traffic and other sounds behind it are taken out. Slow: about 1.5 times the track's length.",
    group: "sound",
    engine: true,
  },
  { id: "studio", label: "Studio sound", hint: "Clearer, fuller voice: rumble cut, less boxiness, more clarity, softer “s”, steadier level.", group: "voice" },
  { id: "normalize", label: "Normalize", hint: "The whole video at -16 LUFS, the usual level for spoken video (or the target you chose).", group: "voice" },
  { id: "breaths", label: "Remove breaths", hint: "Breaths between phrases are turned down, not cut, so speech keeps its rhythm.", group: "voice" },
  { id: "silences", label: "Remove long silences", hint: "Pauses of 1.5 s or more, keeping a short pause on each side.", group: "cuts" },
  { id: "hesitations", label: "Eliminate hesitations", hint: "Held sounds like “aaa”, “eee”, “uhhh”, “mmm”, in any language.", group: "cuts" },
  { id: "fillers", label: "Filler words", hint: "“um”, “uh”, “er”, “hmm” in English speech (needs a transcript).", group: "cuts" },
  { id: "stutters", label: "Remove stuttering", hint: "Words said twice and sentences started again (needs a transcript).", group: "cuts" },
];

/** Echo strengths (dereverb.py STRENGTHS). */
export const ECHO_STRENGTHS = [
  { value: 1, label: "Light" },
  { value: 2, label: "Medium" },
  { value: 3, label: "Strong" },
];

export const DEFAULT_CLEANUP: CleanupOption[] = ["noise", "clipping", "mouth", "studio", "normalize", "breaths", "silences", "hesitations", "fillers"];

export const CLEANUP_GROUPS: { id: CleanupOptionDef["group"]; label: string }[] = [
  { id: "sound", label: "Clean the sound" },
  { id: "voice", label: "Voice" },
  { id: "cuts", label: "Cut out" },
];

/** What the editing step (useTutorialTools autoCleanup) does. */
export interface AutoCleanupOptions {
  silences: boolean;
  hesitations: boolean;
  fillers: boolean;
  stutters: boolean;
  breaths: boolean;
}

export interface AutoCleanupResult {
  /** Seconds cut. */
  removed: number;
  silences: number;
  hesitations: number;
  fillers: number;
  stutters: number;
  breaths: number;
  /** Cut suggestions left in Review (low confidence). */
  toReview: number;
  notes: string[];
}

export function autoCleanupOptions(chosen: ReadonlySet<CleanupOption>): AutoCleanupOptions {
  return {
    silences: chosen.has("silences"),
    hesitations: chosen.has("hesitations"),
    fillers: chosen.has("fillers"),
    stutters: chosen.has("stutters"),
    breaths: chosen.has("breaths"),
  };
}

/** The voice tracks the sound fixes and the tone apply to: microphone
 * recordings, sound taken from a video, and tracks set to Voice for
 * captions. An uploaded file left on Detect counts unless it looks like
 * music (it has beats marked, or it's lowered under speech). Muted tracks
 * and recorded computer sound are left alone. */
export function voiceTracks(audio: AudioClip[], sources: Record<string, MediaSource>): AudioClip[] {
  return audio.filter((a) => {
    const src = sources[a.sourceId];
    if (!src || a.muted || a.volume === 0) return false;
    const kind = src.recording?.trackKind;
    if (kind === "system-audio") return false;
    if (kind === "microphone" || src.kind !== "audio" || a.captions === "speech") return true;
    if (a.captions === "music") return false;
    return !a.beats && !a.duck;
  });
}

/** One summary sentence of what Clean up audio did. */
export function cleanupSummary(parts: {
  cleaned: string[];
  studio: boolean;
  lufs: number | null;
  edit: AutoCleanupResult | null;
}): string {
  const did: string[] = [];
  if (parts.cleaned.length) did.push(parts.cleaned.join(", "));
  if (parts.studio) did.push("studio sound");
  const e = parts.edit;
  if (e) {
    if (e.breaths) did.push(`${e.breaths} breath${e.breaths === 1 ? "" : "s"} turned down`);
    const cuts = [
      e.silences && `${e.silences} long silence${e.silences === 1 ? "" : "s"}`,
      e.hesitations && `${e.hesitations} hesitation${e.hesitations === 1 ? "" : "s"}`,
      e.fillers && `${e.fillers} filler word${e.fillers === 1 ? "" : "s"}`,
      e.stutters && `${e.stutters} repeat${e.stutters === 1 ? "" : "s"}`,
    ].filter(Boolean);
    if (cuts.length) did.push(`cut ${cuts.join(", ")} (${e.removed.toFixed(1)} s)`);
  }
  if (parts.lufs !== null) did.push(`the mix set to ${parts.lufs} LUFS`);
  const head = did.length ? `Cleaned up: ${did.join("; ")}.` : "Nothing needed changing.";
  const tail = e && e.toReview ? ` ${e.toReview} less certain cut${e.toReview === 1 ? " is" : "s are"} waiting in Review.` : "";
  return `${head}${tail} Undo takes it back one step at a time.`;
}
