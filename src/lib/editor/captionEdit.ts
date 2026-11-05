/** Hand edits to caption layers (text, timing, joining, find and replace)
 * and the text rules they share with auto captions (captions.ts): line
 * wrapping and respelling words the way the names hint spells them. Pure,
 * so it is tested without the speech model. */
import type { Overlay } from "./types.ts";

export interface HintWord {
  start: number;
  end: number;
  text: string;
}

const round = (t: number) => Math.round(t * 1000) / 1000;

/** Edit distance between two short strings (more than `limit` reads as limit + 1). */
function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** Words respelled the way the hint spells them: names and terms the model
 * heard but wrote differently ("rowan" for "Ruwan", "kandy" for "Kandy").
 * A word matches a hint word with the same first letter that's the same
 * ignoring case, or one letter off from 5 letters on, two from 8 on.
 * Punctuation around the word is kept. */
export function applyHint<T extends HintWord>(words: T[], hint: string): T[] {
  const terms = [...new Set(hint.split(/[\s,;]+/).filter((t) => [...t].length >= 2))];
  if (!terms.length) return words;
  const keyed = terms.map((t) => ({ t, k: t.toLocaleLowerCase() }));
  return words.map((w) => {
    const m = /^(\p{P}*)(.*?)(\p{P}*)$/u.exec(w.text);
    if (!m || !m[2]) return w;
    const core = m[2].toLocaleLowerCase();
    let best: string | null = null;
    let bestD = Infinity;
    for (const { t, k } of keyed) {
      if (core === k) {
        best = t;
        break;
      }
      const n = [...k].length;
      const limit = n >= 8 ? 2 : n >= 5 ? 1 : 0;
      if (!limit || core[0] !== k[0]) continue;
      const d = distance(core, k, limit);
      if (d <= limit && d < bestD) {
        best = t;
        bestD = d;
      }
    }
    return best && best !== m[2] ? { ...w, text: `${m[1]}${best}${m[3]}` } : w;
  });
}

/** Breaks text into lines of at most `chars` characters at spaces. */
export function wrap(text: string, chars: number): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > chars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

// --- Editing captions by hand -----------------------------------------------

type TextLayer = Extract<Overlay, { kind: "text" }>;

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** A caption layer with new text and/or times. Word timings (karaoke, word
 * by word) are kept while the word count stays the same and move with a new
 * start; with a different count the words are spread evenly instead. */
export function editCaption(o: TextLayer, patch: { text?: string; start?: number; end?: number }): TextLayer {
  const start = round(Math.max(0, patch.start ?? o.start));
  const end = round(Math.max(start + 0.1, patch.end ?? o.end));
  const content = patch.text ?? o.text.content;
  let words = o.words;
  if (words && wordCount(content) !== words.length) words = undefined;
  if (words && start !== o.start) {
    const shift = o.start - start;
    words = words.map((w) => ({ start: round(Math.max(0, w.start + shift)), end: round(Math.max(0, w.end + shift)) }));
  }
  if (words) words = words.map((w) => ({ start: Math.min(w.start, end - start), end: Math.min(w.end, end - start) }));
  const next: TextLayer = { ...o, start, end, text: { ...o.text, content } };
  if (words) next.words = words;
  else delete next.words;
  return next;
}

/** Two neighboring captions as one, from the first's start to the second's
 * end, the text rewrapped to `lineChars`. */
export function mergeCaptions(a: TextLayer, b: TextLayer, lineChars: number): TextLayer {
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  const content = wrap(`${first.text.content} ${second.text.content}`.replace(/\s+/g, " ").trim(), lineChars);
  const offset = second.start - first.start;
  const words =
    first.words && second.words
      ? [...first.words, ...second.words.map((w) => ({ start: round(w.start + offset), end: round(w.end + offset) }))]
      : undefined;
  const next: TextLayer = { ...first, end: Math.max(first.end, second.end), text: { ...first.text, content } };
  if (words && words.length === wordCount(content)) next.words = words;
  else delete next.words;
  return next;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `find` replaced with `replace` in every caption's text, as whole words
 * where `find` starts and ends with a letter or digit ("teh" doesn't change
 * "tehran"). Returns the layers and how many captions changed. */
export function replaceInCaptions(overlays: Overlay[], find: string, replace: string, matchCase: boolean): { overlays: Overlay[]; changed: number } {
  const needle = find.trim();
  if (!needle) return { overlays, changed: 0 };
  const lead = /^[\p{L}\p{N}]/u.test(needle) ? "(?<![\\p{L}\\p{N}])" : "";
  const tail = /[\p{L}\p{N}]$/u.test(needle) ? "(?![\\p{L}\\p{N}])" : "";
  const re = new RegExp(`${lead}${escapeRegExp(needle)}${tail}`, matchCase ? "gu" : "giu");
  let changed = 0;
  const out = overlays.map((o) => {
    if (o.kind !== "text" || !o.caption) return o;
    const content = o.text.content.replace(re, () => replace);
    if (content === o.text.content) return o;
    changed++;
    return editCaption(o, { text: content });
  });
  return { overlays: changed ? out : overlays, changed };
}
