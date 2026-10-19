/** Caption files and chapter lists from project data. Pure - see
 * tests/desktop/tutorial.test.ts. Captions are the caption text layers
 * auto captions made (and the user may have corrected), in timeline time;
 * hidden captions are left out, like in the export. */
import type { Chapter, Overlay } from "./types.ts";

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export function captionCues(overlays: Overlay[]): Cue[] {
  return overlays
    .filter((o): o is Extract<Overlay, { kind: "text" }> => o.kind === "text" && !!o.caption && !o.hidden && o.text.content.trim() !== "")
    .map((o) => ({ start: o.start, end: o.end, text: o.text.content.trim() }))
    .sort((a, b) => a.start - b.start);
}

function stamp(t: number, sep: "," | "."): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const p = (v: number, n = 2) => String(v).padStart(n, "0");
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(ms % 1000, 3)}`;
}

/** Cue text can't contain a blank line (it would end the cue). */
const cueText = (t: string) => t.replace(/\r/g, "").replace(/\n{2,}/g, "\n");

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${cueText(c.text)}\n`).join("\n");
}

export function toVtt(cues: Cue[]): string {
  // "-->" inside text would be read as a timing line.
  const body = cues.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${cueText(c.text).replace(/-->/g, "->")}\n`).join("\n");
  return `WEBVTT\n\n${body}`;
}

export function toPlainTranscript(cues: Cue[]): string {
  return cues.map((c) => c.text.replace(/\n/g, " ")).join(" ").replace(/\s+/g, " ").trim() + "\n";
}

/** "0:00 Intro" lines, the format video sites read as chapters. The first
 * chapter is moved to 0:00 if needed (they require it). */
export function chapterList(chapters: Chapter[]): string {
  const sorted = [...chapters].sort((a, b) => a.t - b.t);
  const fmt = (t: number) => {
    const s = Math.floor(t);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  };
  return sorted.map((c, i) => `${fmt(i === 0 ? 0 : c.t)} ${c.title.replace(/\s+/g, " ").trim() || `Chapter ${i + 1}`}`).join("\n") + "\n";
}

/** WebVTT chapters track (for players that support it). */
export function chaptersVtt(chapters: Chapter[], total: number): string {
  const sorted = [...chapters].sort((a, b) => a.t - b.t);
  const cues = sorted.map((c, i) => ({ start: i === 0 ? 0 : c.t, end: sorted[i + 1]?.t ?? total, text: c.title || `Chapter ${i + 1}` }));
  return toVtt(cues);
}
