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

/** What the engine found while translating (its X-Dub-Report header):
 * what the editor tells the user beside the new tracks. Sentence numbers
 * count from 0, in the order sent. */
export interface DubReport {
  /** Sentences sent. */
  sentences: number;
  /** Sentences that got English speech. */
  spoken: number;
  /** Sentences whose translation came out empty, even after a retry. */
  empty: number[];
  /** Sentences whose translation still looks wrong after a retry, and why
   * ("short", "long", "repeated", "untranslated", "number", "term",
   * "encoding", "glossary"). */
  flagged: { index: number; flags: string[] }[];
  /** Sentences whose English speech came out much shorter than its text,
   * even after a retry (words may be missing). */
  shortSpeech: number[];
  /** Sentences sped up to fit. */
  spedUp: number;
  /** Seconds of English that still don't fit before the end of the video,
   * after moving the last sentences earlier into silence. */
  overflowSeconds: number;
  /** Seconds of the speaker used to learn the voice. */
  sampleSeconds: number;
}

/** A sentence or a few for the user about what the report found, or ""
 * when nothing needs saying. Sentence numbers are shown from 1. */
export function dubReportMessage(report: DubReport | null): string {
  if (!report) return "";
  const list = (xs: number[]) => {
    const shown = xs.slice(0, 5).map((i) => i + 1);
    return shown.join(", ") + (xs.length > shown.length ? ` and ${xs.length - shown.length} more` : "");
  };
  const s = (xs: number[]) => (xs.length > 1 ? "s" : "");
  const parts: string[] = [];
  const unsure = [...new Set([...report.flagged.map((f) => f.index), ...report.shortSpeech])].sort((a, b) => a - b);
  if (report.empty.length) parts.push(`Sentence${s(report.empty)} ${list(report.empty)} couldn't be translated and stay${report.empty.length > 1 ? "" : "s"} silent.`);
  if (unsure.length) parts.push(`Check sentence${s(unsure)} ${list(unsure)}: the translation may have missing or wrong words.`);
  if (report.overflowSeconds >= 0.1)
    parts.push(`The last ${report.overflowSeconds.toFixed(1)} s of the translation runs past the end of the video and isn't heard.`);
  if (report.sampleSeconds > 0 && report.sampleSeconds < 3) parts.push("There was little clear speech to learn the voice from, so it may sound less like the speaker.");
  return parts.join(" ");
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
