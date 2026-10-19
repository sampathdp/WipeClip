/** Chapter suggestions from markers, app switches, long pauses and caption
 * gaps. Pure - see tests/desktop/tutorial.test.ts.
 *
 * These are boundaries where *something changed* (the user marked it, a
 * different app came to the front, the speaker paused), not an
 * understanding of the content; titles come from the marker, the app name
 * or the first words spoken after the boundary, and users rename freely.
 */
import type { AudioReport } from "./audioAnalysis.ts";
import type { Act } from "./insights.ts";
import type { Cue } from "./transcript.ts";
import type { Chapter } from "./types.ts";

export interface ChapterSettings {
  /** Chapters closer than this merge (the stronger boundary wins). */
  minLength: number;
  /** Pause length that counts as a section break. */
  pause: number;
}

export const DEFAULT_CHAPTERS: ChapterSettings = { minLength: 20, pause: 2.5 };

type Strength = 3 | 2 | 1; // marker, app switch, pause

interface Candidate {
  t: number;
  strength: Strength;
  title: string | null;
}

function firstWords(cues: Cue[], t: number): string | null {
  const cue = cues.find((c) => c.start >= t - 0.3 && c.start <= t + 10);
  if (!cue) return null;
  const words = cue.text.replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

export function suggestChapters(input: { acts: Act[] | null; cues: Cue[]; audio: AudioReport | null; total: number }, s: ChapterSettings, ids: () => string): Chapter[] {
  const { acts, cues, audio, total } = input;
  const cands: Candidate[] = [{ t: 0, strength: 1, title: null }];
  for (const a of acts ?? []) {
    if (a.kind === "marker") cands.push({ t: a.t, strength: 3, title: a.label || null });
  }
  // App switches that stick for a while (not alt-tabbing back and forth).
  const windows = (acts ?? []).filter((a) => a.kind === "window" && a.label);
  for (let i = 0; i < windows.length; i++) {
    const next = windows[i + 1]?.t ?? total;
    const prevApp = windows[i - 1]?.label;
    if (next - windows[i].t >= 8 && windows[i].label !== prevApp) cands.push({ t: windows[i].t, strength: 2, title: windows[i].label! });
  }
  for (const sil of audio?.silences ?? []) {
    if (sil.end - sil.start >= s.pause && sil.end < total - 5) cands.push({ t: sil.end, strength: 1, title: null });
  }
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].start - cues[i - 1].end >= s.pause) cands.push({ t: cues[i].start, strength: 1, title: null });
  }
  cands.sort((a, b) => a.t - b.t || b.strength - a.strength);

  const kept: Candidate[] = [];
  for (const c of cands) {
    const last = kept[kept.length - 1];
    if (last && c.t - last.t < s.minLength) {
      // Keep the stronger boundary; never move the first chapter off 0.
      if (c.strength > last.strength && kept.length > 1) kept[kept.length - 1] = c;
      else if (c.strength > last.strength && kept.length === 1 && c.t < 3) kept[0] = { ...c, t: 0 };
      continue;
    }
    kept.push(c);
  }
  // Too close to the end to be useful.
  while (kept.length > 1 && total - kept[kept.length - 1].t < s.minLength / 2 && kept[kept.length - 1].strength < 3) kept.pop();

  return kept.map((c, i) => ({
    id: ids(),
    t: Math.round(c.t * 100) / 100,
    title: c.title ?? firstWords(cues, c.t) ?? (i === 0 ? "Introduction" : `Part ${i + 1}`),
    auto: true,
  }));
}
