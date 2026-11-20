/** Voice translation (desktop app): the timeline's speech said again in
 * another language (DUB_TO), in the speaker's own voice, over the video's
 * own background.
 *
 * 1. The transcript's words are grouped into sentences (dubSentences).
 * 2. The engine translates their text, takes the voice out of the speech
 *    mix, says each translated sentence in the speaker's voice and
 *    fits it into the original's time (backend/app/pipeline/dub.py). All of
 *    it on this computer: nothing goes online, the text included.
 * The editor then adds the translated voice and the background as two audio
 * tracks and mutes the original speech, as one undo step (VideoEditor).
 */
import { ApiError, engineDub, type DubStage, type DubVoice } from "@/lib/toolsApi";
import { buildSpeechMix } from "./captions";
import type { Layout } from "./timeline";
import { dubSentences, encodePcm, type DubReport } from "./dubPlan.ts";

export { dubReportMessage } from "./dubPlan.ts";
import type { MediaSource, Project, Transcript } from "./types";

export const DUB_RATE = 44100;
/** Languages the voice can be translated from (the engine's FROM_LANGUAGES). */
export const DUB_FROM = new Set(["si", "ta", "hi", "kn", "te", "en", "fr", "de", "es", "it"]);
/** Languages it can be said in (the engine's TO_LANGUAGES). */
export const DUB_TO: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
];

export function dubLanguageLabel(code: string): string {
  return DUB_TO.find((l) => l.code === code)?.label ?? code;
}

const TARGET_KEY = "wipeclip.dubTarget";

/** The language to say a transcript in `source` in: the one picked last on
 * this device, unless that's the source itself; else English, or French
 * for English speech. */
export function dubTargetFor(source: string): string {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(TARGET_KEY);
  } catch {
    saved = null;
  }
  if (saved && saved !== source && DUB_TO.some((l) => l.code === saved)) return saved;
  return source === "en" ? "fr" : "en";
}

export function setDubTargetWanted(target: string): void {
  try {
    localStorage.setItem(TARGET_KEY, target);
  } catch {
    // Not remembered: the default is offered again next time.
  }
}

const VOICE_KEY = "wipeclip.dubVoice";

/** The voice the user picked on this device, or null (then the engine's
 * recommendation for this computer is used). */
export function dubVoiceWanted(): DubVoice | null {
  try {
    const v = localStorage.getItem(VOICE_KEY);
    return v === "fast" || v === "accurate" ? v : null;
  } catch {
    return null;
  }
}

export function setDubVoiceWanted(voice: DubVoice): void {
  try {
    localStorage.setItem(VOICE_KEY, voice);
  } catch {
    // Not remembered: the recommendation is offered again next time.
  }
}

export interface DubResult {
  /** The translated voice, mono WAV, timeline time from 0. */
  voice: File;
  /** The original speech mix without the voice, stereo WAV. */
  background: File;
  /** The audio tracks that were mixed in as speech (to mute). */
  tracks: string[];
  /** What the engine found (null from an engine without reports). */
  report: DubReport | null;
}

export type DubProgress = { stage: "prepare" | "mix" | "add" } | { stage: DubStage; value: number };

/** Runs the whole voice translation for the timeline. */
export async function dubTimeline(
  lay: Layout,
  project: Project,
  sources: Record<string, MediaSource>,
  transcript: Transcript,
  onProgress: (p: DubProgress) => void,
  signal: AbortSignal,
  speaker?: DubVoice,
  target = "en"
): Promise<DubResult> {
  onProgress({ stage: "prepare" });
  const sentences = dubSentences(transcript.words).filter((s) => s.text.trim());
  if (sentences.length === 0) throw new ApiError("There's no speech in the transcript to translate.");
  if (!DUB_FROM.has(transcript.language))
    throw new ApiError("Voice translation works from English, French, German, Spanish, Italian, Sinhala, Tamil, Hindi, Kannada or Telugu.");
  if (transcript.language === target) throw new ApiError(`The video is already in ${dubLanguageLabel(target)}.`);
  onProgress({ stage: "mix" });
  const mix = await buildSpeechMix(lay, project, sources, { rate: DUB_RATE, channels: 2, signal });
  if (!mix.channels) throw new ApiError("There's no sound on the timeline to translate.");
  const { wav, report } = await engineDub(mix.channels, sentences, transcript.language, (stage, value) => onProgress({ stage, value }), signal, speaker, target);
  onProgress({ stage: "add" });
  const buffer = await new OfflineAudioContext(1, 1, DUB_RATE).decodeAudioData(await wav.arrayBuffer());
  if (buffer.numberOfChannels < 3) throw new ApiError("The translated audio came back incomplete. Try again.");
  const voice = encodePcm([buffer.getChannelData(0)], DUB_RATE);
  const background = encodePcm([buffer.getChannelData(1), buffer.getChannelData(2)], DUB_RATE);
  return {
    voice: new File([voice], `${dubLanguageLabel(target)} voice.wav`, { type: "audio/wav" }),
    background: new File([background], "Background.wav", { type: "audio/wav" }),
    tracks: mix.tracks,
    report,
  };
}
