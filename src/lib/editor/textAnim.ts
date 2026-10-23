import type { RasterSticker } from "./stickers";
import { drawTextCanvas, rasterizeText, type TextState } from "./textRaster";
import type { Overlay, TextAnim } from "./types";

/** Text animations - typewriter, word by word, karaoke highlight - as a
 * sprite sheet: every state of the text (so many letters shown, this word
 * highlighted) drawn by the same rasterizer into one PNG grid, with the
 * time each state starts. The preview shows the current cell; the export
 * picks the same cell per frame with a crop (editor.py _overlay_filters),
 * so both show identical pixels.
 */

export const TEXT_ANIM_LABELS: Record<TextAnim, string> = {
  none: "None",
  typewriter: "Typewriter",
  words: "Word by word",
  karaoke: "Karaoke highlight",
};

/** Must fit the export's image limit (EDITOR_MAX_STICKER_DIMENSION). */
const SHEET_MAX = 2048;
const MAX_STATES = 64;
/** Typewriter speed, and the part of the layer the reveal may take. */
const CHARS_PER_SECOND = 20;
const WORDS_PER_SECOND = 3;
const REVEAL_SHARE = 0.8;

export interface SpriteInfo {
  cols: number;
  rows: number;
  /** Seconds from the layer's start at which each state begins. */
  times: number[];
}

export type SpriteRaster = RasterSticker & { sprite: SpriteInfo };

export function isAnimatedText(o: Overlay): boolean {
  return o.kind === "text" && !!o.text.anim && o.text.anim !== "none" && !!o.text.content.trim();
}

/** Each state and when it starts. */
export function textStates(o: Extract<Overlay, { kind: "text" }>): { states: TextState[]; times: number[] } {
  const dur = Math.max(0.1, o.end - o.start);
  const content = o.text.content;
  const wordCount = content.match(/\S+/g)?.length ?? 0;
  // Spoken word times (captions), when they still match the text.
  const words = o.words && o.words.length === wordCount ? o.words : null;
  const states: TextState[] = [];
  const times: number[] = [];

  if (o.text.anim === "typewriter") {
    const chars = Array.from(content.replace(/\n/g, "")).length;
    const reveal = Math.min(dur * REVEAL_SHARE, chars / CHARS_PER_SECOND);
    const n = Math.min(chars, MAX_STATES - 1);
    for (let k = 0; k <= n; k++) {
      states.push({ chars: Math.round((k * chars) / n) });
      times.push((k / n) * reveal);
    }
  } else if (o.text.anim === "words") {
    const n = Math.min(wordCount, MAX_STATES);
    const step = Math.min(1 / WORDS_PER_SECOND, (dur * REVEAL_SHARE) / Math.max(1, n));
    for (let k = 1; k <= n; k++) {
      // Word k (rounded when there are more words than states) and the
      // characters up to its end.
      const w = Math.round((k * wordCount) / n);
      states.push({ chars: charsThroughWord(content, w) });
      times.push(k === 1 ? 0 : words ? Math.max(0, words[w - 1].start) : (k - 1) * step);
    }
  } else {
    const n = Math.min(wordCount, MAX_STATES);
    for (let k = 0; k < n; k++) {
      states.push({ highlight: k });
      times.push(k === 0 ? 0 : words ? Math.max(0, words[k].start) : (k / n) * dur);
    }
  }
  // Keep times increasing (word times can tie).
  for (let i = 1; i < times.length; i++) times[i] = Math.max(times[i], times[i - 1]);
  return { states, times: times.map((t) => Math.round(t * 1000) / 1000) };
}

/** Characters (without line breaks) up to the end of word number `w` (1-based). */
function charsThroughWord(content: string, w: number): number {
  let seen = 0;
  for (const m of content.matchAll(/\S+/g)) {
    if (++seen === w) return Array.from(content.slice(0, m.index! + m[0].length).replace(/\n/g, "")).length;
  }
  return Array.from(content.replace(/\n/g, "")).length;
}

/** Cache key part for the timing (it depends on the layer's length and
 * word times, not just its style). */
export function textAnimKey(o: Extract<Overlay, { kind: "text" }>): string {
  return textStates(o).times.join(",");
}

const cache = new Map<string, Promise<SpriteRaster>>();

export function rasterizeAnimatedText(o: Extract<Overlay, { kind: "text" }>, key: string): Promise<SpriteRaster> {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = drawSheet(o);
  cache.set(key, p);
  if (cache.size > 30) {
    const first = cache.keys().next().value;
    if (first !== undefined) {
      cache.get(first)?.then((r) => URL.revokeObjectURL(r.url)).catch(() => {});
      cache.delete(first);
    }
  }
  p.catch(() => cache.delete(key));
  return p;
}

async function drawSheet(o: Extract<Overlay, { kind: "text" }>): Promise<SpriteRaster> {
  const { states, times } = textStates(o);
  if (states.length === 0) {
    const plain = await rasterizeText(o.text);
    return { ...plain, sprite: { cols: 1, rows: 1, times: [0] } };
  }
  const cells = await Promise.all(states.map((st) => drawTextCanvas(o.text, st)));
  const w = cells[0].width;
  const h = cells[0].height;
  // The grid shape that allows the largest cells inside SHEET_MAX.
  let best = { cols: 1, rows: states.length, f: 0 };
  for (let cols = 1; cols <= states.length; cols++) {
    const rows = Math.ceil(states.length / cols);
    const f = Math.min(1, SHEET_MAX / (cols * w), SHEET_MAX / (rows * h));
    if (f > best.f) best = { cols, rows, f };
  }
  const cw = Math.max(1, Math.floor(w * best.f));
  const ch = Math.max(1, Math.floor(h * best.f));
  const sheet = document.createElement("canvas");
  sheet.width = cw * best.cols;
  sheet.height = ch * best.rows;
  const ctx = sheet.getContext("2d")!;
  cells.forEach((c, i) => ctx.drawImage(c, (i % best.cols) * cw, Math.floor(i / best.cols) * ch, cw, ch));
  const blob = await new Promise<Blob>((resolve, reject) =>
    sheet.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not render text"))), "image/png")
  );
  // width/height are one cell at full raster size, so the layer sizes
  // itself exactly like the plain text (overlayWidth).
  return { blob, url: URL.createObjectURL(blob), width: w, height: h, sprite: { cols: best.cols, rows: best.rows, times } };
}

/** The state shown at `t` seconds into the layer. */
export function spriteIndex(times: number[], t: number): number {
  let i = 0;
  while (i + 1 < times.length && times[i + 1] <= t) i++;
  return i;
}
