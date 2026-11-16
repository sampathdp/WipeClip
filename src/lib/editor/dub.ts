/** Voice translation (desktop app): the timeline's speech said again in
 * English, in the speaker's own voice, over the video's own background.
 *
 * 1. The transcript's words are grouped into sentences (dubSentences).
 * 2. The engine translates their text to English, takes the voice out of
 *    the speech mix, says each English sentence in the speaker's voice and
 *    fits it into the original's time (backend/app/pipeline/dub.py). All of
 *    it on this computer: nothing goes online, the text included.
 * The editor then adds the English voice and the background as two audio
 * tracks and mutes the original speech, as one undo step (VideoEditor).
 */
import { ApiError, engineDub, type DubStage } from "@/lib/toolsApi";
import { buildSpeechMix } from "./captions";
import type { Layout } from "./timeline";
import { dubSentences, encodePcm, type DubReport } from "./dubPlan.ts";

export { dubReportMessage } from "./dubPlan.ts";
import type { MediaSource, Project, Transcript } from "./types";

export const DUB_RATE = 44100;
/** Languages the voice can be translated from (the engine's FROM_LANGUAGES). */
export const DUB_FROM = new Set(["si", "ta", "hi", "kn", "te"]);

export interface DubResult {
  /** The English voice, mono WAV, timeline time from 0. */
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
  signal: AbortSignal
): Promise<DubResult> {
  onProgress({ stage: "prepare" });
  const sentences = dubSentences(transcript.words).filter((s) => s.text.trim());
  if (sentences.length === 0) throw new ApiError("There's no speech in the transcript to translate.");
  if (!DUB_FROM.has(transcript.language)) throw new ApiError("Voice translation works from Sinhala, Tamil, Hindi, Kannada or Telugu.");
  onProgress({ stage: "mix" });
  const mix = await buildSpeechMix(lay, project, sources, { rate: DUB_RATE, channels: 2, signal });
  if (!mix.channels) throw new ApiError("There's no sound on the timeline to translate.");
  const { wav, report } = await engineDub(mix.channels, sentences, transcript.language, (stage, value) => onProgress({ stage, value }), signal);
  onProgress({ stage: "add" });
  const buffer = await new OfflineAudioContext(1, 1, DUB_RATE).decodeAudioData(await wav.arrayBuffer());
  if (buffer.numberOfChannels < 3) throw new ApiError("The translated audio came back incomplete. Try again.");
  const voice = encodePcm([buffer.getChannelData(0)], DUB_RATE);
  const background = encodePcm([buffer.getChannelData(1), buffer.getChannelData(2)], DUB_RATE);
  return {
    voice: new File([voice], "English voice.wav", { type: "audio/wav" }),
    background: new File([background], "Background.wav", { type: "audio/wav" }),
    tracks: mix.tracks,
    report,
  };
}
