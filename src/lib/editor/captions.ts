/** Auto captions, all in the browser: mixes the timeline's speech down to
 * 16 kHz mono, transcribes it with Whisper in a worker (captions.worker.ts),
 * and turns the word timings into caption text layers.
 */
import { memoryBudgetGb } from "@/lib/platform";
import { DEFAULT_TEXT } from "./textRaster";
import { newId, type Layout } from "./timeline";
import type { AnimIn, AudioClip, MediaSource, Overlay, Project, TextStyle } from "./types";
import { clippedSpans, type AudioSpan } from "./audioAnalysis";
import { sourceFile, sourceName, sourceSize } from "./sourceFile";
import { RAMP_SEGMENTS, activeRamp, rampSegments } from "./speed";
import { detectSpeech, probeWindows, speechVerdict } from "./speechDetect";

const RATE = 16000; // what Whisper works at
const MAX_DECODE_BYTES = 400 * 1024 * 1024; // decodeAudioData holds the whole file

export interface CaptionWord {
  start: number;
  end: number;
  text: string;
}

/** The timeline's own speech, in timeline time, as 16 kHz mono samples:
 * every clip's sound at its speed and position, plus audio extracted from
 * videos and the uploaded audio tracks that are speech (a voiceover, a
 * voice note). Uploaded music is left out (it only confuses transcription),
 * as are freeze frames and reversed clips. Null when nothing on the
 * timeline has sound. `probe` lets the speech model help tell voice from
 * music (speechModelProbe).
 */
export async function buildSpeechAudio(
  lay: Layout,
  project: Project,
  sources: Record<string, MediaSource>,
  probe?: SpeechProbe
): Promise<Float32Array | null> {
  return (await buildSpeechMix(lay, project, sources, { probe })).samples;
}

export interface SpeechMix {
  /** null when nothing on the timeline has (decodable) sound. */
  samples: Float32Array | null;
  /** Clipping found in each source at its own rate, in timeline time
   * (audioAnalysis.ts clippedSpans). Only when `withClipping` was asked. */
  clipping: AudioSpan[];
  /** Names of sources left out because they're too large to decode. */
  skipped: string[];
}

/** Whisper's no-speech probability for each window (speechDetect.ts
 * probeWindows), or null when the model can't be used. */
export type SpeechProbe = (windows: Float32Array[]) => Promise<number[] | null>;

/** buildSpeechAudio plus what the review needs: per-source clipping and
 * the sources that couldn't be decoded. `signal` stops before the
 * (slow) mixing step. */
export async function buildSpeechMix(
  lay: Layout,
  project: Project,
  sources: Record<string, MediaSource>,
  opts: { withClipping?: boolean; signal?: AbortSignal; probe?: SpeechProbe } = {}
): Promise<SpeechMix> {
  if (lay.total <= 0) return { samples: null, clipping: [], skipped: [] };
  const skipped: string[] = [];
  const decoded = new Map<string, Promise<AudioBuffer | null>>();
  const decode = (src: MediaSource) => {
    let p = decoded.get(src.id);
    if (!p) {
      if (sourceSize(src) > MAX_DECODE_BYTES) skipped.push(sourceName(src) || "a large file");
      p =
        sourceSize(src) > MAX_DECODE_BYTES
          ? Promise.resolve(null)
          : sourceFile(src)
              .then((f) => f.arrayBuffer())
              .then((bytes) => new OfflineAudioContext(1, 1, RATE).decodeAudioData(bytes))
              .catch(() => null);
      decoded.set(src.id, p);
    }
    return p;
  };
  const abort = () => {
    if (opts.signal?.aborted) throw new DOMException("Analysis cancelled", "AbortError");
  };

  // Which audio tracks are speech. Audio from a video or a screen
  // recording (its microphone or system sound) is the narration; an
  // uploaded file is whatever the user set, or detected from its sound.
  const speech = new Set<string>();
  const undecided: string[] = [];
  for (const a of project.audio) {
    const src = sources[a.sourceId];
    if (a.muted || a.volume === 0 || !src) continue;
    const recorded = src.recording?.trackKind === "microphone" || src.recording?.trackKind === "system-audio";
    const mode = src.kind !== "audio" || recorded ? "speech" : (a.captions ?? "auto");
    if (mode === "speech") speech.add(a.id);
    if (mode !== "auto") continue;
    const buf = await decode(src);
    abort();
    if (buf && (await isSpeechTrack(buf, a, opts.probe))) speech.add(a.id);
    else undecided.push(a.id);
    abort();
  }

  const first = await mixSpeech(lay, project, sources, opts, decode, abort, speech);
  // A track taken for music is still the only voice when nothing else is
  // audible (a silent screen capture with a voiceover): use it then.
  if (undecided.length === 0 || (first.samples && !isSilent(first.samples))) return { ...first, skipped };
  const second = await mixSpeech(lay, project, sources, opts, decode, abort, new Set([...speech, ...undecided]));
  return { ...(second.samples ? second : first), skipped };
}

/** Whether an uploaded track's part on the timeline is speech: the
 * signal's verdict, checked by the speech model when there's one
 * (speechDetect.ts speechVerdict). */
async function isSpeechTrack(buf: AudioBuffer, a: AudioClip, probe?: SpeechProbe): Promise<boolean> {
  const rate = buf.sampleRate;
  const from = Math.max(0, Math.floor(a.offset * rate));
  const to = Math.min(buf.length, Math.ceil((a.offset + a.duration) * rate));
  if (to <= from) return false;
  const mono = new Float32Array(to - from);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += data[from + i] / buf.numberOfChannels;
  }
  const signal = detectSpeech(mono);
  // A clear voice needs no second opinion; anything else might be a voice
  // under a music bed, which the model hears and the signal can't.
  if (signal.score >= 0.75 || !probe) return speechVerdict(signal, null);
  const windows = probeWindows(mono);
  return speechVerdict(signal, windows.length ? await probe(windows) : null);
}

/** Whether no 100 ms frame of `samples` reaches speech loudness. */
function isSilent(samples: Float32Array): boolean {
  for (let at = 0; at < samples.length; at += FRAME) {
    if (rms(samples, at, Math.min(samples.length, at + FRAME)) >= SILENCE_RMS) return false;
  }
  return true;
}

/** The clips' sound plus the `speech` audio tracks, mixed. */
async function mixSpeech(
  lay: Layout,
  project: Project,
  sources: Record<string, MediaSource>,
  opts: { withClipping?: boolean },
  decode: (src: MediaSource) => Promise<AudioBuffer | null>,
  abort: () => void,
  speech: Set<string>
): Promise<SpeechMix> {
  const clipping: AudioSpan[] = [];
  const ctx = new OfflineAudioContext(1, Math.ceil(lay.total * RATE), RATE);

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
    if (opts.withClipping) {
      const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      for (const c of clippedSpans(channels, buf.sampleRate, offset, offset + duration)) {
        clipping.push({ start: when + (c.start - offset) / rate, end: when + (Math.min(c.end, offset + duration) - offset) / rate });
      }
    }
  };

  for (const lc of lay.clips) {
    const c = lc.clip;
    const src = sources[c.sourceId];
    if (c.freeze !== null || c.reverse || c.volume === 0 || !src?.hasAudio) continue;
    const buf = await decode(src);
    abort();
    const ramp = activeRamp(c);
    if (buf && ramp) {
      // A speed curve plays as its constant-speed pieces (speed.ts).
      const piece = (c.end - c.start) / RAMP_SEGMENTS;
      let when = lc.start;
      for (const [k, s] of rampSegments(ramp).entries()) {
        play(buf, when, c.start + k * piece, piece, s, Math.min(1, c.volume));
        when += piece / s;
      }
    } else if (buf) play(buf, lc.start, c.start, c.end - c.start, c.speed, Math.min(1, c.volume));
  }
  for (const a of project.audio) {
    const src = sources[a.sourceId];
    if (!src || !speech.has(a.id)) continue;
    const buf = await decode(src);
    abort();
    if (buf) play(buf, a.start, a.offset, a.duration, 1, Math.min(1, a.volume));
  }
  if (scheduled === 0) return { samples: null, clipping, skipped: [] };
  const mixed = await ctx.startRendering();
  abort();
  return { samples: mixed.getChannelData(0), clipping, skipped: [] };
}

export interface SpeechModel {
  id: string; // word-level timestamps need the "_timestamped" export
  sizeMb: number;
  /** Whether it's the model meant for a WebGPU encoder. */
  gpu: boolean;
}

/** The speech models, downloaded from Hugging Face on first use and kept in
 * the browser/app cache. Audio never leaves the device - only the model
 * files are downloaded. Measured on a 60 s talk: base (the model used
 * before) got about one word in twelve wrong and invented text at a cut;
 * small fixes most of that; large-v3-turbo was word-perfect with tighter
 * timings, and with the encoder on the GPU it transcribes 60 s in ~20 s.
 * On the CPU alone turbo took longer than the audio, so the CPU gets small. */
const GPU_MODEL: SpeechModel = { id: "onnx-community/whisper-large-v3-turbo_timestamped", sizeMb: 700, gpu: true };
const CPU_MODEL: SpeechModel = { id: "onnx-community/whisper-small_timestamped", sizeMb: 250, gpu: false };

let chosen: Promise<SpeechModel> | null = null;

/** The model this device will use: turbo with a usable WebGPU adapter,
 * small otherwise. */
export function speechModel(): Promise<SpeechModel> {
  chosen ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = await gpu?.requestAdapter().catch(() => null);
    return adapter ? GPU_MODEL : CPU_MODEL;
  })();
  return chosen;
}

/** Whether the model is already on this device, so the UI asks before the
 * first download instead of starting it silently. */
export async function speechModelCached(): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    const { id } = await speechModel();
    const cache = await caches.open("transformers-cache");
    const keys = await cache.keys();
    return keys.some((k) => k.url.includes(id) && /\.onnx/.test(k.url));
  } catch {
    return false;
  }
}

export interface CaptionsProgress {
  stage: "download" | "prepare" | "transcribe";
  value: number; // 0..1
}

// --- Transcription (captions.worker.ts) --------------------------------------

const MAX_SEGMENT = 28 * RATE; // Whisper's window is 30 s; leave room so no word is cut off
const MIN_SEGMENT = 10 * RATE;
const SEARCH = 6 * RATE; // look this far back from a segment's end for a quiet spot to cut at
const FRAME = RATE / 10; // 100 ms loudness frames
const SILENCE_RMS = 0.004; // segments quieter than this are skipped (Whisper invents text in silence)
// More than two was measured slower, not faster: the workers then fight
// over cores and memory bandwidth (6-core laptop, 2-minute clip: 1 worker
// 50 s, 2 workers 37 s, 3 workers 46 s).
const MAX_CPU_WORKERS = 2;

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** Splits audio into segments of at most `length` samples, cut at the
 * quietest 100 ms near each segment's end so words aren't split. Silent
 * segments are dropped. */
function speechSegments(samples: Float32Array, length = MAX_SEGMENT): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  while (start < samples.length) {
    let end = start + length;
    if (end >= samples.length) {
      end = samples.length;
    } else {
      let best = end;
      let bestRms = Infinity;
      for (let at = end - FRAME; at >= end - SEARCH; at -= FRAME) {
        const level = rms(samples, at, at + FRAME);
        if (level < bestRms) {
          bestRms = level;
          best = at + FRAME / 2;
        }
      }
      end = best;
    }
    if (rms(samples, start, end) >= SILENCE_RMS) out.push([start, end]);
    start = end;
  }
  return out;
}

/** Workers to run side by side. Each holds its own model (about 1.5 GB of
 * memory while transcribing), so this is bounded by cores and by the memory
 * the machine can spare (memoryBudgetGb). */
async function cpuWorkerCount(): Promise<number> {
  const cores = navigator.hardwareConcurrency || 2;
  const budgetGb = (await memoryBudgetGb()) ?? 2;
  return Math.max(1, Math.min(MAX_CPU_WORKERS, cores - 1, Math.floor(budgetGb / 1.5)));
}

/** Every worker not yet terminated, including ones still loading the
 * model (not yet in the pool), so cancelSpeech can stop them all. */
const live = new Set<ModelWorker>();

/** A captions.worker.ts instance with promise-based requests on top of
 * postMessage; one request in flight at a time. */
class ModelWorker {
  private readonly w = new Worker(new URL("./captions.worker.ts", import.meta.url), { type: "module" });
  private pending: { resolve: (m: unknown) => void; reject: (e: Error) => void } | null = null;
  onProgress: ((p: CaptionsProgress) => void) | null = null;
  dead = false;

  constructor() {
    live.add(this);
    this.w.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") {
        this.onProgress?.(m);
        return;
      }
      const p = this.pending;
      this.pending = null;
      if (m.type === "error") p?.reject(new Error(m.message || "Captioning failed"));
      else p?.resolve(m);
    };
    this.w.onerror = (e) => {
      // A crashed worker (e.g. out of memory) can't be reused.
      this.terminate(new Error(e.message || "Captioning failed"));
    };
  }

  request<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending = { resolve: resolve as (m: unknown) => void, reject };
      this.w.postMessage(msg, transfer);
    });
  }

  /** Stops the worker; a request in flight fails with `reason` (an
   * AbortError by default) instead of never settling. */
  terminate(reason: Error = new DOMException("Speech recognition cancelled", "AbortError")) {
    this.dead = true;
    live.delete(this);
    this.w.terminate();
    this.pending?.reject(reason);
    this.pending = null;
  }
}

type Device = "webgpu" | "wasm";
let pool: { device: Device; workers: ModelWorker[] } | null = null;

/** The worker pool, kept between runs: cpuWorkerCount() workers, with the
 * encoder on WebGPU when the browser has it (speechModel). The first worker
 * loads (and caches) the model before the others start, so it's downloaded
 * only once. */
async function getPool(onProgress: (p: CaptionsProgress) => void, forceCpu: boolean) {
  if (pool && pool.workers.every((w) => !w.dead) && !(forceCpu && pool.device === "webgpu")) return pool;
  pool?.workers.forEach((w) => w.terminate());
  pool = null;

  let first = new ModelWorker();
  first.onProgress = onProgress;
  let device: Device = "wasm";
  if (!forceCpu && (await speechModel()).gpu) {
    try {
      ({ device } = await first.request<{ device: Device }>({ type: "init", device: "webgpu", model: GPU_MODEL.id }));
    } catch (err) {
      if (isAbort(err)) throw err;
      // A browser can list a GPU and still fail to use it (drivers,
      // blocklists); the CPU path then starts in a fresh worker.
      console.warn("[captions] WebGPU unavailable, using the CPU", err);
      first.terminate();
      first = new ModelWorker();
      first.onProgress = onProgress;
    }
  }
  const model = device === "webgpu" ? GPU_MODEL.id : CPU_MODEL.id;
  if (device === "wasm") await first.request({ type: "init", device: "wasm", model });
  first.onProgress = null;
  const workers = [first];
  // The decoder runs on the CPU either way, so both modes use the pool.
  {
    const extra = Array.from({ length: (await cpuWorkerCount()) - 1 }, () => new ModelWorker());
    // Extra workers only add speed: one that fails to start is dropped.
    const started = await Promise.all(
      extra.map((w) =>
        w.request({ type: "init", device, model }).then(
          () => w,
          () => {
            w.terminate();
            return null;
          }
        )
      )
    );
    workers.push(...started.filter((w): w is ModelWorker => w !== null));
  }
  pool = { device, workers };
  return pool;
}

const isAbort = (e: unknown) => (e as Error | null)?.name === "AbortError";

/** Stops a model download or transcription in progress: every speech
 * worker is ended and the running transcribe() rejects with an AbortError.
 * Model files already downloaded stay cached; a partly downloaded file is
 * fetched again next time. The next run starts fresh workers. */
export function cancelSpeech(): void {
  pool = null;
  for (const w of [...live]) w.terminate();
}

/** A SpeechProbe on the captions model (loading it if needed, with
 * `onProgress`). Null answers - not a failed caption run - when the model
 * can't be used: the signal alone then decides. */
export function speechModelProbe(onProgress: (p: CaptionsProgress) => void): SpeechProbe {
  return async (windows) => {
    try {
      const { workers } = await getPool(onProgress, false);
      const out: number[] = [];
      for (const w of windows) {
        const part = w.slice();
        out.push((await workers[0].request<{ value: number }>({ type: "nospeech", samples: part }, [part.buffer])).value);
      }
      return out;
    } catch (err) {
      console.warn("[captions] speech check unavailable, judging tracks by their sound", err);
      return null;
    }
  };
}

const round = (t: number) => Math.round(t * 1000) / 1000;

/** Whether there's sound around a word. Whisper invents words over silence
 * ("Thank you." at the end of a segment); a real word is never silent
 * (the margin covers timings that land a little early or late). */
function audible(samples: Float32Array, w: CaptionWord): boolean {
  const from = Math.max(0, Math.floor((w.start - 0.15) * RATE));
  const to = Math.min(samples.length, Math.ceil((w.end + 0.15) * RATE));
  return to > from && rms(samples, from, to) >= SILENCE_RMS;
}

async function runOnPool(
  samples: Float32Array,
  language: string,
  onProgress: (p: CaptionsProgress) => void,
  forceCpu: boolean
): Promise<{ language: string; words: CaptionWord[] }> {
  if (speechSegments(samples).length === 0) return { language: language === "auto" ? "en" : language, words: [] };

  const { workers } = await getPool(onProgress, forceCpu);
  // Short audio is split evenly across the workers instead of leaving some
  // idle (the cut lands up to SEARCH early, hence the half-SEARCH slack).
  const perWorker = Math.ceil(samples.length / workers.length) + SEARCH / 2;
  const segments = speechSegments(samples, Math.max(MIN_SEGMENT, Math.min(MAX_SEGMENT, perWorker)));
  onProgress({ stage: "transcribe", value: 0 });
  const lang =
    language !== "auto"
      ? language
      : (await workers[0].request<{ language: string }>({ type: "detect", samples: samples.slice(...segments[0]) })).language;

  // Each worker takes the next segment as soon as it's free.
  const results: CaptionWord[][] = new Array(segments.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    workers.map(async (w) => {
      while (next < segments.length) {
        const i = next++;
        const [s, t] = segments[i];
        const part = samples.slice(s, t);
        const { words } = await w.request<{ words: CaptionWord[] }>(
          { type: "transcribe", id: i, samples: part, language: lang },
          [part.buffer]
        );
        const offset = s / RATE;
        results[i] = words
          .map((x) => ({ ...x, start: round(x.start + offset), end: round(x.end + offset) }))
          .filter((x) => audible(samples, x));
        onProgress({ stage: "transcribe", value: ++done / segments.length });
      }
    })
  );
  return { language: lang, words: results.flat() };
}

/** Word-timed transcript of `samples` (16 kHz mono, timeline time).
 * `language` is a code from CAPTION_LANGUAGES, or "auto" to let Whisper
 * detect it. Runs on WebGPU when available; if that fails, the run is
 * retried once on the CPU. */
export async function transcribe(
  samples: Float32Array,
  language: string,
  onProgress: (p: CaptionsProgress) => void
): Promise<{ language: string; words: CaptionWord[] }> {
  try {
    return await runOnPool(samples, language, onProgress, false);
  } catch (err) {
    if (isAbort(err) || pool?.device !== "webgpu") throw err;
    console.warn("[captions] WebGPU run failed, retrying on the CPU", err);
    return runOnPool(samples, language, onProgress, true);
  }
}

// --- Grouping words into captions ------------------------------------------

export interface CaptionChunk {
  start: number;
  end: number;
  text: string; // may contain one line break
  /** When each word of `text` is spoken, timeline seconds. */
  words?: { start: number; end: number }[];
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
    return {
      start: ms(start),
      end: ms(end),
      text: wrap(g.map((w) => w.text).join(" "), lineChars),
      words: g.map((w) => ({ start: ms(w.start), end: ms(w.end) })),
    };
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

export type CaptionStyleId = "clean" | "boxed" | "bold" | "yellow" | "karaoke" | "words";

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
  // Follow the speech word by word (textAnim.ts, timed by the layer's words).
  karaoke: {
    label: "Karaoke",
    style: { font: "jakarta", weight: 900, size: 0.055, strokeColor: "#000000", strokeWidth: 0.06, shadow: true, anim: "karaoke", highlight: "#facc15" },
    upper: true,
    animIn: "none",
  },
  words: {
    label: "Word by word",
    style: { font: "impact", weight: 900, size: 0.065, strokeColor: "#000000", strokeWidth: 0.08, shadow: false, anim: "words" },
    upper: true,
    animIn: "none",
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
    ...(c.words ? { words: c.words.map((w) => ({ start: round(w.start - c.start), end: round(w.end - c.start) })) } : {}),
  }));
}
