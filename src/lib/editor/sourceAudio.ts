/** A source's sound as an AudioBuffer, for captions, voice translation and
 * the loudness measurement. In the desktop app the engine decodes a file on
 * disk straight from there (toolsApi engineAudio): the page never reads the
 * whole file, so long videos work. Otherwise the file is read and decoded
 * here, and files over MAX_DECODE_BYTES are skipped (decodeAudioData holds
 * the whole file in memory). */
import { engineAudio } from "@/lib/toolsApi";
import { sourceFile, sourceSize } from "./sourceFile";
import type { MediaSource } from "./types";

const MAX_DECODE_BYTES = 400 * 1024 * 1024;

/** The decoded sound, null when there's none to decode, or "too_large". */
export async function decodeSourceAudio(src: MediaSource, rate: number, channels: 1 | 2 = 1): Promise<AudioBuffer | null | "too_large"> {
  if (src.disk) {
    const buf = await engineAudio(src.disk.path, rate, channels).catch(() => null);
    if (buf) return buf;
  }
  if (sourceSize(src) > MAX_DECODE_BYTES) return "too_large";
  return sourceFile(src)
    .then((f) => f.arrayBuffer())
    .then((bytes) => new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes))
    .catch(() => null);
}
