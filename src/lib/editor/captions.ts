/** Auto captions, all on the device: mixes the timeline's speech down to
 * 16 kHz mono, transcribes it with Whisper - in the desktop app's engine
 * (backend/app/pipeline/speech.py), else in a browser worker
 * (captions.worker.ts) - and turns the word timings into caption text layers.
 */
import { memoryBudgetGb } from "@/lib/platform";
import { engineSpeechModel, engineTranscribe, type EngineGpu } from "@/lib/toolsApi";
import { applyHint, wrap } from "./captionEdit";
import { keepEnglish } from "./englishWords";
import { DEFAULT_TEXT } from "./textRaster";
import { newId, type Layout } from "./timeline";
import type { AnimIn, AudioClip, MediaSource, Overlay, Project, TextStyle } from "./types";
import { clippedSpans, type AudioSpan } from "./audioAnalysis";
import { sourceName } from "./sourceFile";
import { decodeSourceAudio } from "./sourceAudio";
import { RAMP_SEGMENTS, activeRamp, rampSegments } from "./speed";
import { detectSpeech, probeWindows, speechVerdict } from "./speechDetect";

const RATE = 16000; // what Whisper works at

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
  /** null when nothing on the timeline has (decodable) sound. The first
   * channel when more were asked for. */
  samples: Float32Array | null;
  /** Every channel (`channels` of them), or null like `samples`. */
  channels: Float32Array[] | null;
  /** The audio tracks mixed in as speech (ids). */
  tracks: string[];
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
 * (slow) mixing step. `rate` and `channels`: the mix's format (16 kHz mono
 * unless asked; voice translation takes 44.1 kHz stereo). */
export async function buildSpeechMix(
  lay: Layout,
  project: Project,
  sources: Record<string, MediaSource>,
  opts: { withClipping?: boolean; signal?: AbortSignal; probe?: SpeechProbe; rate?: number; channels?: number } = {}
): Promise<SpeechMix> {
  if (lay.total <= 0) return { samples: null, channels: null, tracks: [], clipping: [], skipped: [] };
  const rate = opts.rate ?? RATE;
  const skipped: string[] = [];
  const decoded = new Map<string, Promise<AudioBuffer | null>>();
  const decode = (src: MediaSource) => {
    let p = decoded.get(src.id);
    if (!p) {
      p = decodeSourceAudio(src, rate, opts.channels === 2 ? 2 : 1).then((buf) => {
        if (buf !== "too_large") return buf;
        skipped.push(sourceName(src) || "a large file");
        return null;
      });
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

  const format = { ...opts, rate, channels: opts.channels ?? 1 };
  const first = await mixSpeech(lay, project, sources, format, decode, abort, speech);
  // A track taken for music is still the only voice when nothing else is
  // audible (a silent screen capture with a voiceover): use it then.
  if (undecided.length === 0 || (first.samples && !isSilent(first.samples))) return { ...first, tracks: [...speech], skipped };
  const all = new Set([...speech, ...undecided]);
  const second = await mixSpeech(lay, project, sources, format, decode, abort, all);
  return second.samples ? { ...second, tracks: [...all], skipped } : { ...first, tracks: [...speech], skipped };
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

/** Whether `samples` has no sound loud enough for speech (soundLevel). */
function isSilent(samples: Float32Array): boolean {
  return soundLevel(frameLevels(samples), 0, Math.ceil(samples.length / FRAME)) === null;
}

/** The clips' sound plus the `speech` audio tracks, mixed. */
async function mixSpeech(
  lay: Layout,
  project: Project,
  sources: Record<string, MediaSource>,
  opts: { withClipping?: boolean; rate: number; channels: number },
  decode: (src: MediaSource) => Promise<AudioBuffer | null>,
  abort: () => void,
  speech: Set<string>
): Promise<Omit<SpeechMix, "tracks">> {
  const clipping: AudioSpan[] = [];
  const ctx = new OfflineAudioContext(opts.channels, Math.ceil(lay.total * opts.rate), opts.rate);

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
  if (scheduled === 0) return { samples: null, channels: null, clipping, skipped: [] };
  const mixed = await ctx.startRendering();
  abort();
  const channels = Array.from({ length: mixed.numberOfChannels }, (_, c) => mixed.getChannelData(c));
  return { samples: channels[0], channels, clipping, skipped: [] };
}

export interface SpeechModel {
  id: string; // word-level timestamps need the "_timestamped" export
  sizeMb: number;
  /** Whether it's the model meant for a WebGPU encoder. */
  gpu: boolean;
  /** Run by the desktop app's engine (backend/app/pipeline/speech.py). */
  engine?: boolean;
  /** The engine's model of this language's own (its code): Sinhala, Tamil, ... */
  language?: string;
  /** The engine's NVIDIA graphics card support. */
  cuda?: EngineGpu;
}

/** The caption language last picked (or found: "auto" that heard Sinhala
 * switches to it), so the next run skips detecting it again - on a CPU
 * that's an encoder pass per clip. */
const LANGUAGE_KEY = "wipeclip.captionLanguage";

export function savedCaptionLanguage(): string {
  try {
    return (typeof localStorage !== "undefined" && localStorage.getItem(LANGUAGE_KEY)) || "auto";
  } catch {
    return "auto";
  }
}

export function saveCaptionLanguage(language: string): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // Not remembered: "auto" next time.
  }
}

/** The caption settings last used (style, look, words per caption, the
 * names hint...), so the next video starts from them. */
const PREFS_KEY = "wipeclip.captionPrefs";

export interface CaptionPrefs {
  maxWords?: number;
  style?: CaptionStyleId;
  y?: number;
  look?: CaptionLook;
  hint?: string;
  accurate?: boolean;
  keepEnglish?: boolean;
}

export function savedCaptionPrefs(): CaptionPrefs {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(PREFS_KEY) : null;
    const p = raw ? (JSON.parse(raw) as CaptionPrefs) : {};
    if (p.style && !(p.style in CAPTION_STYLES)) delete p.style;
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

export function saveCaptionPrefs(prefs: CaptionPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered: the defaults next time.
  }
}

/** Whether the user chose to run the engine's speech recognition on the
 * NVIDIA card (its libraries are a separate download, so it's asked). */
const CUDA_KEY = "wipeclip.speechCuda";

export function speechCudaWanted(): boolean {
  try {
    return localStorage.getItem(CUDA_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSpeechCudaWanted(on: boolean): void {
  try {
    localStorage.setItem(CUDA_KEY, on ? "1" : "0");
  } catch {
    // Not remembered: asked again next time.
  }
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

/** Set once a run found this device's GPU slower than the CPU path (see
 * GPU_FIRST_STEP_MS), so later runs go straight to the CPU model. */
const SLOW_GPU_KEY = "wipeclip.speechGpuSlow";

function gpuKnownSlow(): boolean {
  try {
    return localStorage.getItem(SLOW_GPU_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberSlowGpu(): void {
  chosen = Promise.resolve(CPU_MODEL);
  try {
    localStorage.setItem(SLOW_GPU_KEY, "1");
  } catch {
    // Not remembered: the next run times the GPU again.
  }
}

/** The model this device will use for `language`: the desktop engine's
 * (a language's own model where it has one), else in the browser turbo with a usable
 * WebGPU adapter, small otherwise. */
export async function speechModel(language = "auto"): Promise<SpeechModel> {
  const engine = await engineSpeechModel(language);
  if (engine) return { id: `engine:${language}`, sizeMb: engine.sizeMb, gpu: false, engine: true, language: engine.own ? language : undefined, cuda: engine.gpu };
  return browserModel();
}

function browserModel(): Promise<SpeechModel> {
  chosen ??= (async () => {
    if (gpuKnownSlow()) return CPU_MODEL;
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = await gpu?.requestAdapter().catch(() => null);
    return adapter ? GPU_MODEL : CPU_MODEL;
  })();
  return chosen;
}

/** Whether the model is already on this device, so the UI asks before the
 * first download instead of starting it silently. */
export async function speechModelCached(language = "auto"): Promise<boolean> {
  try {
    const engine = await engineSpeechModel(language);
    if (engine) return engine.ready;
    if (typeof caches === "undefined") return false;
    const { id } = await browserModel();
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
const SILENCE_RMS = 0.004; // segments quieter than this are skipped (Whisper invents text in silence)...
// ...unless they're quiet speech: a peak this loud, well above the segment's
// own background. Some recordings are that quiet (an English test set had
// sentences peaking at 0.0007); skipping them lost a third of the words.
// The same rule as the engine (backend/app/pipeline/speech.py _sound_level).
const QUIET_PEAK = 0.0003;
const CONTRAST = 8;
// More than two was measured slower, not faster: the workers then fight
// over cores and memory bandwidth (6-core laptop, 2-minute clip: 1 worker
// 50 s, 2 workers 37 s, 3 workers 46 s).
const MAX_CPU_WORKERS = 2;
// The first requests on a WebGPU pool (the language check, then the first
// segment) take ~2-10 s on a GPU worth using. An old integrated one (Intel
// UHD 630: 17% of a 2-minute clip after 8 minutes) is far slower than the
// CPU path, and on Windows the browser can't be asked for the faster GPU in
// a laptop (powerPreference is ignored), so past this the run moves to the
// CPU. A segment also has to transcribe faster than it plays: a GPU could
// pass the short language check and then crawl through every segment.
const GPU_FIRST_STEP_MS = 30_000;
const GPU_MIN_BUDGET_MS = 10_000;

class SlowGpuError extends Error {
  constructor() {
    super("WebGPU is slower than the CPU on this device");
  }
}

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

const frameCache = new WeakMap<Float32Array, Float32Array>();

/** RMS of each 100 ms frame of `samples`, computed once per array. */
function frameLevels(samples: Float32Array): Float32Array {
  let out = frameCache.get(samples);
  if (!out) {
    out = new Float32Array(Math.ceil(samples.length / FRAME));
    for (let i = 0; i < out.length; i++) out[i] = rms(samples, i * FRAME, Math.min(samples.length, (i + 1) * FRAME));
    frameCache.set(samples, out);
  }
  return out;
}

/** The loudness a frame in frames [from, to) needs to count as sound, or
 * null when that stretch is silence or a steady hum. */
function soundLevel(frames: Float32Array, from: number, to: number): number | null {
  const part = frames.subarray(Math.max(0, from), Math.min(frames.length, to));
  if (part.length === 0) return null;
  let sq = 0;
  let peak = 0;
  for (const v of part) {
    sq += v * v;
    peak = Math.max(peak, v);
  }
  if (Math.sqrt(sq / part.length) >= SILENCE_RMS) return SILENCE_RMS;
  const floor = Float32Array.from(part).sort()[Math.floor(0.1 * (part.length - 1))];
  return peak >= QUIET_PEAK && peak >= CONTRAST * floor ? peak / CONTRAST : null;
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
    if (soundLevel(frameLevels(samples), Math.floor(start / FRAME), Math.ceil(end / FRAME)) !== null) out.push([start, end]);
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

/** WebAssembly threads per worker. Only a cross-origin isolated page can
 * have more than one (the desktop app sends the headers for it): the
 * physical cores, about half the logical ones, shared between the workers,
 * at most 4 each (ONNX Runtime's own default cap). */
function threadsPerWorker(workers: number): number {
  if (typeof crossOriginIsolated === "undefined" || !crossOriginIsolated) return 1;
  const cores = navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(4, Math.round(cores / 2 / workers)));
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
  const count = await cpuWorkerCount();
  let threads = threadsPerWorker(count);
  let device: Device = "wasm";
  if (!forceCpu && (await browserModel()).gpu) {
    try {
      ({ device } = await first.request<{ device: Device }>({ type: "init", device: "webgpu", model: GPU_MODEL.id, threads }));
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
  if (device === "wasm") {
    try {
      await first.request({ type: "init", device: "wasm", model, threads });
    } catch (err) {
      if (isAbort(err) || threads === 1) throw err;
      // Threads that fail to start leave ONNX Runtime in that worker
      // unusable; a fresh worker with one thread still works.
      console.warn("[captions] WebAssembly threads unavailable, using one per worker", err);
      first.terminate();
      first = new ModelWorker();
      first.onProgress = onProgress;
      threads = 1;
      await first.request({ type: "init", device: "wasm", model, threads });
    }
  }
  first.onProgress = null;
  const workers = [first];
  // The decoder runs on the CPU either way, so both modes use the pool.
  {
    const extra = Array.from({ length: count - 1 }, () => new ModelWorker());
    // Extra workers only add speed: one that fails to start is dropped.
    const started = await Promise.all(
      extra.map((w) =>
        w.request({ type: "init", device, model, threads }).then(
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

/** The engine transcription in progress, for cancelSpeech. */
let engineRun: AbortController | null = null;

const isAbort = (e: unknown) => (e as Error | null)?.name === "AbortError";

/** Stops a model download or transcription in progress: every speech
 * worker is ended and the running transcribe() rejects with an AbortError.
 * Model files already downloaded stay cached; a partly downloaded file is
 * fetched again next time. The next run starts fresh workers. */
export function cancelSpeech(): void {
  engineRun?.abort();
  engineRun = null;
  pool = null;
  for (const w of [...live]) w.terminate();
}

/** A SpeechProbe on the captions model (loading it if needed, with
 * `onProgress`). Null answers - not a failed caption run - when the model
 * can't be used: the signal alone then decides. */
export function speechModelProbe(onProgress: (p: CaptionsProgress) => void): SpeechProbe {
  return async (windows) => {
    // With the desktop engine the browser model is never downloaded just
    // for this check.
    if (await engineSpeechModel("auto")) return null;
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
 * (the margin covers timings that land a little early or late). Sound is
 * judged against the 12 s around it, so a quiet recording's words stay. */
function audible(samples: Float32Array, w: CaptionWord): boolean {
  const from = Math.max(0, Math.floor((w.start - 0.15) * RATE));
  const to = Math.min(samples.length, Math.ceil((w.end + 0.15) * RATE));
  const mid = Math.floor(((w.start + w.end) / 2) * (RATE / FRAME));
  const level = soundLevel(frameLevels(samples), mid - 60, mid + 60);
  return to > from && level !== null && rms(samples, from, to) >= level;
}

async function runOnPool(
  samples: Float32Array,
  language: string,
  onProgress: (p: CaptionsProgress) => void,
  forceCpu: boolean
): Promise<{ language: string; words: CaptionWord[] }> {
  if (speechSegments(samples).length === 0) return { language: language === "auto" ? "en" : language, words: [] };

  const { device, workers } = await getPool(onProgress, forceCpu);
  // Short audio is split evenly across the workers instead of leaving some
  // idle (the cut lands up to SEARCH early, hence the half-SEARCH slack).
  const perWorker = Math.ceil(samples.length / workers.length) + SEARCH / 2;
  const segments = speechSegments(samples, Math.max(MIN_SEGMENT, Math.min(MAX_SEGMENT, perWorker)));
  onProgress({ stage: "transcribe", value: 0 });

  // On WebGPU every request is timed until a segment has come back
  // (GPU_FIRST_STEP_MS): the language check, then each worker's first
  // segment, which may take no longer than it plays.
  let onTrial = device === "webgpu";
  const ask = <T>(w: ModelWorker, msg: Record<string, unknown>, transfer?: Transferable[]): Promise<T> => {
    const audioMs = ((msg.samples as Float32Array | undefined)?.length ?? 0) / (RATE / 1000);
    const req = w.request<T>(msg, transfer);
    if (!onTrial) return req;
    const budget = msg.type === "transcribe" ? Math.min(GPU_FIRST_STEP_MS, Math.max(GPU_MIN_BUDGET_MS, audioMs)) : GPU_FIRST_STEP_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SlowGpuError()), budget);
    });
    // The losing request is rejected when the pool is replaced; nothing waits on it.
    req.catch(() => {});
    return Promise.race([req, slow])
      .then((m) => {
        if (msg.type === "transcribe") onTrial = false;
        return m;
      })
      .finally(() => clearTimeout(timer));
  };

  const lang =
    language !== "auto"
      ? language
      : (await ask<{ language: string }>(workers[0], { type: "detect", samples: samples.slice(...segments[0]) })).language;

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
        const { words } = await ask<{ words: CaptionWord[] }>(
          w,
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

/** Settings that trade speed for accuracy. */
export interface SpeechOptions {
  /** Names and words the speech is likely to contain, as they should be
   * spelled (commas or new lines between them). */
  hint?: string;
  /** Slower, more careful decoding (desktop engine: beam search). */
  accurate?: boolean;
  /** English words said in Sinhala, Tamil, Hindi... speech written in
   * English instead of that language's script (keepEnglish). On unless false. */
  keepEnglish?: boolean;
}

/** Word-timed transcript of `samples` (16 kHz mono, timeline time).
 * `language` is a code from CAPTION_LANGUAGES, or "auto" to let Whisper
 * detect it. Runs on WebGPU when available; if that fails, the run is
 * retried once on the CPU. `opts.hint` also corrects the spelling of the
 * words it lists (applyHint), and English words spelled in an Indic script
 * are written in English (keepEnglish) unless `opts.keepEnglish` is false. */
export async function transcribe(
  samples: Float32Array,
  language: string,
  onProgress: (p: CaptionsProgress) => void,
  opts: SpeechOptions = {}
): Promise<{ language: string; words: CaptionWord[] }> {
  const res = await transcribeRaw(samples, language, onProgress, opts);
  const hint = opts.hint ?? "";
  const words = opts.keepEnglish === false ? res.words : keepEnglish(res.words, hint);
  return { language: res.language, words: applyHint(words, hint) };
}

async function transcribeRaw(
  samples: Float32Array,
  language: string,
  onProgress: (p: CaptionsProgress) => void,
  opts: SpeechOptions
): Promise<{ language: string; words: CaptionWord[] }> {
  if (speechSegments(samples).length === 0) return { language: language === "auto" ? "en" : language, words: [] };
  // The desktop engine when there is one; it's never left for the browser
  // on an error (that would download a second model unasked).
  const run = new AbortController();
  engineRun = run;
  try {
    const res = await engineTranscribe(samples, language, speechCudaWanted(), (stage, value) => onProgress({ stage, value }), run.signal, opts);
    if (res) return { language: res.language, words: res.words.filter((w) => audible(samples, w)) };
  } catch (err) {
    if (run.signal.aborted) throw new DOMException("Speech recognition cancelled", "AbortError");
    throw err;
  } finally {
    if (engineRun === run) engineRun = null;
  }
  try {
    return await runOnPool(samples, language, onProgress, false);
  } catch (err) {
    if (isAbort(err) || pool?.device !== "webgpu") throw err;
    console.warn("[captions] WebGPU run failed, retrying on the CPU", err);
    if (err instanceof SlowGpuError) rememberSlowGpu();
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
      // A phrase's natural break, once the caption has a few words.
      (prev && maxWords > 3 && cur.length >= Math.ceil(maxWords / 2) && /[,;:，、；：]$/.test(prev.text)) ||
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

/** The user's changes on top of a caption style: applied to every caption
 * and kept when the style is switched. `case` absent = the style's own. */
export type CaptionLook = Partial<
  Pick<
    TextStyle,
    "font" | "weight" | "italic" | "color" | "strokeColor" | "strokeWidth" | "background" | "backgroundOpacity" | "shadow" | "highlight" | "size" | "align"
  >
> & { case?: "upper" | "normal" };

export function captionText(content: string, styleId: CaptionStyleId, look: CaptionLook = {}): TextStyle {
  const s = CAPTION_STYLES[styleId];
  const { case: letterCase, ...rest } = look;
  const upper = letterCase ? letterCase === "upper" : s.upper;
  return { ...DEFAULT_TEXT, ...s.style, ...rest, content: upper ? content.toUpperCase() : content };
}

/** The look that reproduces a caption as it is now on top of `styleId`
 * (its font, colors, size and letter case), so the Style tab opens on what
 * the captions look like rather than on the last settings used. */
export function lookFromCaption(t: TextStyle, styleId: CaptionStyleId): CaptionLook {
  const base = captionText("", styleId);
  const look: CaptionLook = {};
  const keys = ["font", "weight", "italic", "color", "strokeColor", "strokeWidth", "background", "backgroundOpacity", "shadow", "highlight", "size", "align"] as const;
  for (const k of keys) if (t[k] !== undefined && t[k] !== base[k]) (look as Record<string, unknown>)[k] = t[k];
  const letters = t.content.replace(/[^\p{L}]/gu, "");
  const upper = letters.length > 0 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  if (upper !== captionUpper(styleId)) look.case = upper ? "upper" : "normal";
  return look;
}

/** The preset a caption was most likely made with (same entrance, fewest
 * changes on top), and the look that reproduces it on that preset. Ties
 * keep `current`. */
export function captionPresetOf(t: TextStyle, animIn: AnimIn, current: CaptionStyleId): { style: CaptionStyleId; look: CaptionLook } {
  let best = { style: current, look: lookFromCaption(t, current), score: Infinity };
  const ids = [current, ...(Object.keys(CAPTION_STYLES) as CaptionStyleId[]).filter((id) => id !== current)];
  for (const id of ids) {
    const look = lookFromCaption(t, id);
    const score = Object.keys(look).length + (CAPTION_STYLES[id].animIn === animIn ? 0 : 100);
    if (score < best.score) best = { style: id, look, score };
  }
  return { style: best.style, look: best.look };
}

/** Whether a style with `look` shows its text in capitals. */
export function captionUpper(styleId: CaptionStyleId, look: CaptionLook = {}): boolean {
  return look.case ? look.case === "upper" : !!CAPTION_STYLES[styleId].upper;
}

export function captionOverlays(chunks: CaptionChunk[], styleId: CaptionStyleId, y: number, look: CaptionLook = {}): Overlay[] {
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
    text: captionText(c.text, styleId, look),
    ...(c.words ? { words: c.words.map((w) => ({ start: round(w.start - c.start), end: round(w.end - c.start) })) } : {}),
  }));
}
