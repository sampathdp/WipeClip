/** Auto captions, browser side: mixes the timeline's speech down to the
 * WAV the backend transcribes (backend/app/pipeline/captions.py), and
 * turns the word timings it returns into caption text layers.
 */
import { DEFAULT_TEXT } from "./textRaster";
import { newId, type Layout } from "./timeline";
import type { AnimIn, MediaSource, Overlay, Project, TextStyle } from "./types";

const RATE = 16000; // what Whisper works at - no point sending more
const MAX_DECODE_BYTES = 400 * 1024 * 1024; // decodeAudioData holds the whole file

export interface CaptionWord {
  start: number;
  end: number;
  text: string;
}

/** The timeline's own speech, in timeline time, as a 16 kHz mono 16-bit
 * WAV: every clip's sound at its speed and position, plus audio extracted
 * from videos. Uploaded music is left out (it only confuses
 * transcription), as are freeze frames and reversed clips. Null when
 * nothing on the timeline has sound.
 */
export async function buildSpeechWav(lay: Layout, project: Project, sources: Record<string, MediaSource>): Promise<Blob | null> {
  if (lay.total <= 0) return null;
  const ctx = new OfflineAudioContext(1, Math.ceil(lay.total * RATE), RATE);
  const decoded = new Map<string, Promise<AudioBuffer | null>>();
  const decode = (src: MediaSource) => {
    let p = decoded.get(src.id);
    if (!p) {
      p =
        src.file.size > MAX_DECODE_BYTES
          ? Promise.resolve(null)
          : src.file
              .arrayBuffer()
              .then((bytes) => new OfflineAudioContext(1, 1, RATE).decodeAudioData(bytes))
              .catch(() => null);
      decoded.set(src.id, p);
    }
    return p;
  };

  let scheduled = 0;
  const play = (buf: AudioBuffer, when: number, offset: number, duration: number, rate: number, gain: number) => {
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    node.connect(g).connect(ctx.destination);
    // offset/duration are in buffer (source) time.
    node.start(when, offset, duration);
    scheduled++;
  };

  for (const lc of lay.clips) {
    const c = lc.clip;
    const src = sources[c.sourceId];
    if (c.freeze !== null || c.reverse || c.volume === 0 || !src?.hasAudio) continue;
    const buf = await decode(src);
    if (buf) play(buf, lc.start, c.start, c.end - c.start, c.speed, Math.min(1, c.volume));
  }
  for (const a of project.audio) {
    const src = sources[a.sourceId];
    if (a.muted || a.volume === 0 || !src || src.kind === "audio") continue;
    const buf = await decode(src);
    if (buf) play(buf, a.start, a.offset, a.duration, 1, Math.min(1, a.volume));
  }
  if (scheduled === 0) return null;
  const mixed = await ctx.startRendering();
  return encodeWav(mixed.getChannelData(0), RATE);
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) => [...s].forEach((ch, i) => out.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  out.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  out.setUint32(16, 16, true); // PCM header size
  out.setUint16(20, 1, true); // PCM
  out.setUint16(22, 1, true); // mono
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true); // byte rate
  out.setUint16(32, 2, true); // block align
  out.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  out.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}

// --- Grouping words into captions ------------------------------------------

export interface CaptionChunk {
  start: number;
  end: number;
  text: string; // may contain one line break
}

const MAX_GAP = 0.6; // a pause this long starts a new caption
const MAX_CAPTION_SECONDS = 3.5;
const MIN_CAPTION_SECONDS = 0.4;

/** Groups words into captions of at most `maxWords` words and two lines of
 * `lineChars` characters, breaking early at pauses, long captions and
 * sentence ends. Each caption stays up until the next one starts (or a
 * pause), so the text doesn't flicker between words. */
export function groupWords(words: CaptionWord[], maxWords: number, lineChars: number, total: number): CaptionChunk[] {
  const groups: CaptionWord[][] = [];
  let cur: CaptionWord[] = [];
  for (const w of words) {
    if (w.start >= total) break;
    const prev = cur[cur.length - 1];
    const tooLong =
      cur.length >= maxWords ||
      (prev && w.start - prev.end > MAX_GAP) ||
      (cur.length > 0 && w.end - cur[0].start > MAX_CAPTION_SECONDS) ||
      (prev && /[.!?。！？]$/.test(prev.text)) ||
      wrap([...cur, w].map((x) => x.text).join(" "), lineChars).split("\n").length > 2;
    if (cur.length && tooLong) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);

  return groups.map((g, i) => {
    const start = g[0].start;
    const next = groups[i + 1]?.[0].start ?? total;
    let end = g[g.length - 1].end;
    // Bridge short gaps to the next caption; keep a minimum on screen.
    if (next - end < MAX_GAP) end = next;
    end = Math.min(next, total, Math.max(end, start + MIN_CAPTION_SECONDS));
    const ms = (t: number) => Math.round(t * 1000) / 1000;
    return { start: ms(start), end: ms(end), text: wrap(g.map((w) => w.text).join(" "), lineChars) };
  });
}

/** Breaks text into lines of at most `chars` characters at spaces. */
function wrap(text: string, chars: number): string {
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

// --- Styles and layers ------------------------------------------------------

export type CaptionStyleId = "clean" | "boxed" | "bold" | "yellow";

export const CAPTION_STYLES: Record<CaptionStyleId, { label: string; style: Partial<TextStyle>; upper?: boolean; animIn: AnimIn }> = {
  clean: { label: "Clean", style: { font: "inter", weight: 700, size: 0.05, shadow: true }, animIn: "none" },
  boxed: {
    label: "Boxed",
    style: { font: "inter", weight: 700, size: 0.045, background: "#000000", backgroundOpacity: 0.6, shadow: false },
    animIn: "none",
  },
  bold: {
    label: "Bold",
    style: { font: "impact", weight: 900, size: 0.065, strokeColor: "#000000", strokeWidth: 0.08, shadow: false },
    upper: true,
    animIn: "pop",
  },
  yellow: {
    label: "Yellow",
    style: { font: "jakarta", weight: 900, size: 0.055, color: "#facc15", strokeColor: "#000000", strokeWidth: 0.06, shadow: true },
    animIn: "pop",
  },
};

export const CAPTION_POSITIONS = [
  { label: "Bottom", y: 0.82 },
  { label: "Middle", y: 0.5 },
  { label: "Top", y: 0.16 },
] as const;

/** Characters per caption line for a canvas shape - narrower on portrait. */
export function lineCharsFor(canvas: { width: number; height: number }): number {
  return canvas.width >= canvas.height ? 36 : 18;
}

export function captionText(content: string, styleId: CaptionStyleId): TextStyle {
  const s = CAPTION_STYLES[styleId];
  return { ...DEFAULT_TEXT, ...s.style, content: s.upper ? content.toUpperCase() : content };
}

export function captionOverlays(chunks: CaptionChunk[], styleId: CaptionStyleId, y: number): Overlay[] {
  return chunks.map((c) => ({
    id: newId("cap"),
    kind: "text" as const,
    caption: true,
    start: c.start,
    end: c.end,
    x: 0.5,
    y,
    width: 0.25,
    rotation: 0,
    opacity: 1,
    animIn: CAPTION_STYLES[styleId].animIn,
    animOut: "none" as const,
    hidden: false,
    locked: false,
    text: captionText(c.text, styleId),
  }));
}
