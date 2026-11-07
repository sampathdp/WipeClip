/** Editing by text: deleting words from the transcript cuts their stretch
 * out of the timeline (ripple cut, so everything after moves up), as one
 * undo step. Pure - see tests/desktop/wordEdit.test.ts.
 */
import { rippleCut } from "./ripple.ts";
import { layout, type Layout } from "./timeline.ts";
import type { Project, Transcript, TranscriptWord } from "./types.ts";

/** Filler sounds, compared without case and punctuation, in any length
 * ("um", "ummm", "uhhh", "aaah", "eee", "hmmm", "mhm"). Not "a" or "e" on
 * their own: those are words. */
const FILLER = /^(?:u+[hm]+|u{2,}|e+r+m*|a+h+|a{2,}|e+h+|e{2,}|h+m+|m{2,}|m+h+m+)$/;

export const isFillerWord = (norm: string): boolean => FILLER.test(norm);

export const normalizeWord = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "");

export function fillerIndices(words: TranscriptWord[]): number[] {
  return words.flatMap((w, i) => (isFillerWord(normalizeWord(w.text)) ? [i] : []));
}

/** Whether the transcript still matches the timeline: only ripple cuts and
 * inserts keep it in sync; any other change of length means its times
 * can't be trusted. */
export function transcriptCurrent(t: Transcript | undefined, lay: Layout): boolean {
  return !!t && Math.abs(t.total - lay.total) < 0.02;
}

/** Timeline ranges that remove the given words: each run of consecutive
 * words from its first word's start to where the next word begins (so the
 * pause after it goes too, and the cut lands right before the next word),
 * or a little after the last word at the end of the transcript. */
export function cutRangesFor(words: TranscriptWord[], indices: Iterable<number>, total: number): [number, number][] {
  const sorted = [...new Set(indices)].filter((i) => i >= 0 && i < words.length).sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  for (let k = 0; k < sorted.length; ) {
    let j = k;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    const first = words[sorted[k]];
    const next = words[sorted[j] + 1];
    const to = next ? next.start : Math.min(total, words[sorted[j]].end + 0.15);
    if (to > first.start) ranges.push([first.start, to]);
    k = j + 1;
  }
  return ranges;
}

export type WordCutResult = { ok: true; project: Project; removed: number } | { ok: false; error: string };

/** Cuts the words' stretches out, last first (so earlier times stay valid). */
export function cutWords(project: Project, fps: number, indices: Iterable<number>): WordCutResult {
  const t = project.transcript;
  if (!t) return { ok: false, error: "Transcribe the video first." };
  let p = project;
  let removed = 0;
  const ranges = cutRangesFor(t.words, indices, t.total).reverse();
  if (ranges.length === 0) return { ok: false, error: "Select some words first." };
  for (const [a, b] of ranges) {
    const res = rippleCut(p, layout(p, fps), a, b);
    if (!res.ok) return res;
    p = res.project;
    removed += res.removed;
  }
  return { ok: true, project: p, removed };
}
