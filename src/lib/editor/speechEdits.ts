/** Edit suggestions from the transcript (the speech model's words and
 * their timings): filler sounds, words said twice in a row, a sentence
 * started again, and a second opinion on the level-based pauses (quiet
 * speech isn't silence; sound without words isn't a pause in speech).
 * Pure - see tests/desktop/speechEdits.test.ts.
 *
 * They are ordinary review suggestions (insights.ts): nothing is cut until
 * the user accepts one, and accepted cuts are applied together as one undo
 * step. The evidence is only what the model wrote down and when: it
 * doesn't know what was meant, so a repeat may be deliberate ("very
 * very") and every suggestion says what it is based on. */
import { cutRangesFor, fillerIndices, normalizeWord } from "./wordEdit.ts";
import type { EditSuggestion, Transcript, TranscriptWord } from "./types.ts";

/** Clear hesitation sounds (um, uhh, uhm, erm, in any length); the others
 * ("ah", "hmm", "er") are also real reactions or words often enough to be
 * only "medium". */
const SURE_FILLER = /^(?:u+m+|u+h+|u+h+m+|e+r+m+)$/;
/** Longest phrase checked for an immediate repeat. */
const MAX_REPEAT_WORDS = 8;
/** A short repeat must follow at once; a restarted sentence (4+ words)
 * may come after a breath. */
const REPEAT_GAP = 1.0;
const RESTART_GAP = 3.0;
/** Sound without recognized words for at least this long is worth a look. */
const NO_SPEECH_MIN = 4;
/** ...when level-based silence covers less than this share of it. */
const NO_SPEECH_SILENT_SHARE = 0.3;

export type SpeechNote = "no-transcript" | "stale-transcript" | "fillers-english-only";

/** Filler words are a list of English hesitation sounds. */
export function fillersSupported(language: string): boolean {
  const l = language.trim().toLowerCase();
  return l === "en" || l.startsWith("en-") || l === "english";
}

/** Word timings that can't all be right: no length, very long, or
 * overlapping the previous word. Whisper's word times are estimates. */
export function uncertainTiming(words: TranscriptWord[], i: number): boolean {
  const w = words[i];
  if (!w || !(w.end > w.start) || w.end - w.start > 2.5) return true;
  const prev = words[i - 1];
  return !!prev && w.start < prev.end - 0.05;
}

const UNCERTAIN = " The word timings here look uncertain, so play the cut before applying it.";

function quote(words: TranscriptWord[], from: number, to: number): string {
  const text = words
    .slice(from, to)
    .map((w) => w.text.trim())
    .join(" ");
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** Filler sounds and immediate repeats, as "cut" suggestions. */
export function transcriptSuggestions(t: Transcript, ids: () => string): EditSuggestion[] {
  const words = t.words;
  const out: EditSuggestion[] = [];
  const covered = new Set<number>();
  const norm = words.map((w) => normalizeWord(w.text));
  const fillers = fillersSupported(t.language) ? new Set(fillerIndices(words)) : new Set<number>();

  // Repeats first, longest phrase first, so "we can we can" isn't also
  // reported as two single-word repeats.
  for (let n = MAX_REPEAT_WORDS; n >= 1; n--) {
    for (let i = 0; i + 2 * n <= words.length; i++) {
      let same = true;
      for (let k = 0; k < n && same; k++) {
        const a = norm[i + k];
        same = a !== "" && a === norm[i + n + k] && !covered.has(i + k) && !covered.has(i + n + k);
      }
      if (!same) continue;
      // All fillers ("um um"): the filler suggestion covers it.
      if (Array.from({ length: n }, (_, k) => i + k).every((j) => fillers.has(j))) continue;
      const gap = words[i + n].start - words[i + n - 1].end;
      if (gap > (n >= 4 ? RESTART_GAP : REPEAT_GAP)) continue;
      const range = cutRangesFor(words, Array.from({ length: n }, (_, k) => i + k), t.total)[0];
      if (!range) continue;
      const shaky = Array.from({ length: 2 * n }, (_, k) => i + k).some((j) => uncertainTiming(words, j));
      const phrase = quote(words, i, i + n);
      out.push({
        id: ids(),
        kind: "repeat",
        start: range[0],
        end: range[1],
        title: n >= 4 ? `Sentence started again: "${phrase}"` : `Said twice: "${phrase}"`,
        detail:
          (n >= 4
            ? "The same words are said again right after, like a fresh start. Cutting removes the first try and keeps the second."
            : n === 1
              ? "The same word twice in a row. Sometimes that's deliberate (\"very very\"), so listen first."
              : "The same words twice in a row. Cutting removes the first and keeps the second.") + (shaky ? UNCERTAIN : ""),
        action: "cut",
        status: "pending",
        confidence: shaky || n === 1 ? "low" : n >= 3 ? "high" : "medium",
      });
      for (let k = 0; k < 2 * n; k++) covered.add(i + k);
    }
  }

  // Fillers: each run of consecutive filler words is one suggestion.
  const order = [...fillers].filter((i) => !covered.has(i)).sort((a, b) => a - b);
  for (let k = 0; k < order.length; ) {
    let j = k;
    while (j + 1 < order.length && order[j + 1] === order[j] + 1) j++;
    const run = order.slice(k, j + 1);
    const range = cutRangesFor(words, run, t.total)[0];
    k = j + 1;
    if (!range) continue;
    const shaky = run.some((i) => uncertainTiming(words, i));
    const sure = run.every((i) => SURE_FILLER.test(norm[i]));
    const text = quote(words, run[0], run[run.length - 1] + 1);
    out.push({
      id: ids(),
      kind: "filler",
      start: range[0],
      end: range[1],
      title: `Filler: "${text}"`,
      detail: (sure ? "A hesitation sound." : "Usually a hesitation sound, but it can be a real reaction - listen first.") + (shaky ? UNCERTAIN : ""),
      action: "cut",
      status: "pending",
      confidence: shaky ? "low" : sure ? "high" : "medium",
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Level-based pause suggestions checked against the transcript:
 *  - a "pause" with recognized words in it is probably quiet speech, so
 *    it becomes "review" instead of "cut";
 *  - a long stretch without words that isn't quiet (music, game audio,
 *    continuous background sound) is added as "review" - not a pause in
 *    speech, and never suggested as a cut.
 * `silences`: the level-based silent spans (audioAnalysis.ts), or null
 * when the audio wasn't analyzed. */
export function speechAwarePauses(
  list: EditSuggestion[],
  t: Transcript,
  silences: { start: number; end: number }[] | null,
  ids: () => string
): EditSuggestion[] {
  const words = t.words;
  const inside = (a: number, b: number) => words.filter((w) => (w.start + w.end) / 2 > a && (w.start + w.end) / 2 < b);
  const out = list.map((s): EditSuggestion => {
    if ((s.kind !== "silence" && s.kind !== "dead-time") || s.action !== "cut") return s;
    const heard = inside(s.start, s.end);
    if (heard.length === 0) return s;
    const text = heard
      .map((w) => w.text.trim())
      .join(" ")
      .slice(0, 60);
    return {
      ...s,
      action: "review",
      confidence: "low",
      title: `${(s.end - s.start).toFixed(1)} s that sounds quiet, but has speech`,
      detail: `The speech model heard "${text}" here, so it's probably quiet speech rather than a pause. Not suggested as a cut.`,
    };
  });
  if (!silences) return out;
  const gaps: [number, number][] = [];
  let last = 0;
  for (const w of words) {
    if (w.start - last >= NO_SPEECH_MIN) gaps.push([last, w.start]);
    last = Math.max(last, w.end);
  }
  if (t.total - last >= NO_SPEECH_MIN) gaps.push([last, t.total]);
  for (const [a, b] of gaps) {
    const silent = silences.reduce((sum, s) => sum + Math.max(0, Math.min(b, s.end) - Math.max(a, s.start)), 0);
    if (silent / (b - a) >= NO_SPEECH_SILENT_SHARE) continue;
    out.push({
      id: ids(),
      kind: "no-speech",
      start: a,
      end: b,
      title: `${(b - a).toFixed(1)} s with sound but no speech`,
      detail: "No words were recognized here, but it isn't quiet: music, game or app sound, or steady background noise. Kept unless you decide otherwise - watch it first.",
      action: "review",
      status: "pending",
      confidence: "low",
    });
  }
  return out.sort((a, b) => a.start - b.start);
}
