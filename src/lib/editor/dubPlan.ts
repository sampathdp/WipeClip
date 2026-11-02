/** The pure parts of voice translation (dub.ts): the transcript as
 * sentences, and the WAV files the result is kept as. */
import type { TranscriptWord } from "./types.ts";

export interface DubSentence {
  start: number;
  end: number;
  text: string;
}

const PAUSE = 0.7; // a silence this long ends a sentence
const MAX_SENTENCE = 15; // seconds
const END = /[.!?।]["')\]]*$/;

/** The transcript as sentences: ended by punctuation, a pause of 0.7 s or
 * more, or 15 s of speech. Each keeps its first word's start and last
 * word's end. */
export function dubSentences(words: TranscriptWord[]): DubSentence[] {
  const out: DubSentence[] = [];
  let cur: TranscriptWord[] = [];
  const flush = () => {
    if (cur.length) out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(" ") });
    cur = [];
  };
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (last && (w.start - last.end >= PAUSE || w.end - cur[0].start > MAX_SENTENCE)) flush();
    cur.push(w);
    if (END.test(w.text)) flush();
  }
  flush();
  return out;
}

/** 16-bit PCM WAV of the given channels (all the same length). */
export function encodePcm(channels: Float32Array[], rate: number): Blob {
  const n = channels[0].length;
  const k = channels.length;
  const out = new DataView(new ArrayBuffer(44 + n * k * 2));
  const text = (at: number, s: string) => [...s].forEach((ch, i) => out.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  out.setUint32(4, 36 + n * k * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); // PCM
  out.setUint16(22, k, true);
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * k * 2, true);
  out.setUint16(32, k * 2, true);
  out.setUint16(34, 16, true);
  text(36, "data");
  out.setUint32(40, n * k * 2, true);
  for (let i = 0, at = 44; i < n; i++) {
    for (let c = 0; c < k; c++, at += 2) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      out.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}
