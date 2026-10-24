/// <reference lib="webworker" />
/** Speech-to-text for auto captions, run in the browser (Whisper via
 * transformers.js) so it costs no server time. One worker holds one loaded
 * model; captions.ts runs a small pool of them, since WebAssembly is
 * single-threaded here (the site isn't cross-origin isolated) and the pool
 * is how several cores get used. Model files are downloaded once and kept
 * in the browser's cache.
 *
 * In:  { type: "init", device: "webgpu" | "wasm", model }  "webgpu" = encoder on the GPU, decoder on the CPU
 *      { type: "detect", samples }                  - 16 kHz mono, up to 30 s
 *      { type: "transcribe", id, samples, language } - one segment, up to 30 s
 *      { type: "nospeech", samples }                - 16 kHz mono, up to 30 s
 * Out: { type: "progress", stage: "download" | "prepare", value: 0..1 }
 *      { type: "ready", device }
 *      { type: "language", language }
 *      { type: "nospeech", value }                    probability there's no speech, 0..1
 *      { type: "words", id, words: [{ start, end, text }] }  times within the segment
 *      { type: "error", message }
 */
import { env, pipeline, Tensor, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

const LANGUAGES = [
  "en", "es", "fr", "de", "it", "pt", "nl", "ru", "uk", "pl", "tr", "ar", "hi", "si", "ta",
  "bn", "ur", "id", "ms", "th", "vi", "zh", "ja", "ko",
];

env.allowLocalModels = false;

type Device = "webgpu" | "wasm";

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loadedOn: Device = "wasm";

function post(msg: unknown) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

/** Encoder weights for WebGPU, or null without a usable adapter: 4-bit,
 * with half-precision math where the GPU supports it (a third of the
 * full-precision download, and word for word the same transcript). */
async function gpuEncoderDtype(): Promise<"q4f16" | "q4" | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  const adapter = await gpu?.requestAdapter().catch(() => null);
  if (!adapter) return null;
  return adapter.features.has("shader-f16") ? "q4f16" : "q4";
}

async function load(device: Device, model: string): Promise<Device> {
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    // Only the two .onnx weights matter; the small config files would make
    // the bar jump to 100% and back.
    if (p.status !== "progress" || !p.file?.endsWith(".onnx") || !p.total) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    // Building the sessions after the download takes a moment too.
    const done = files.size === 2 && loaded >= total;
    post({ type: "progress", stage: done ? "prepare" : "download", value: total ? loaded / total : 0 });
  };

  if (device === "webgpu") {
    // Only the encoder goes on the GPU: it's one big parallel pass (~5x
    // faster there), while the decoder runs token by token, where a GPU
    // round trip per token is slower than the CPU (measured on an Intel
    // iGPU: 73 vs 45 ms per token).
    //
    // No fallback in here: after a failed WebGPU session, ONNX Runtime in
    // this worker is left unusable, so captions.ts retries the CPU in a
    // fresh worker instead.
    const encoder = await gpuEncoderDtype();
    if (!encoder) throw new Error("WebGPU is not available");
    asr = (await pipeline("automatic-speech-recognition", model, {
      device: { encoder_model: "webgpu", decoder_model_merged: "wasm" },
      // 4-bit decoder: same words as 8-bit, ~40% faster per token (measured).
      dtype: { encoder_model: encoder, decoder_model_merged: "q4" },
      progress_callback,
    })) as AutomaticSpeechRecognitionPipeline;
    return "webgpu";
  }
  asr = (await pipeline("automatic-speech-recognition", model, {
    device: "wasm",
    dtype: "q8",
    progress_callback,
  })) as AutomaticSpeechRecognitionPipeline;
  return "wasm";
}

/** Whisper's scores for the token right after <|startoftranscript|>, where
 * it picks a language - or says there's no speech. */
async function firstTokenLogits(model: AutomaticSpeechRecognitionPipeline, audio: Float32Array) {
  const { input_features } = await model.processor(audio);
  const sot = model.tokenizer.convert_tokens_to_ids("<|startoftranscript|>");
  const out = await model.model({
    input_features,
    decoder_input_ids: new Tensor("int64", BigInt64Array.from([BigInt(sot)]), [1, 1]),
  });
  const logits = ((await out.logits.getData?.()) ?? out.logits.data) as Float32Array;
  const vocab = out.logits.dims[out.logits.dims.length - 1];
  return { logits, last: logits.length - vocab, vocab };
}

/** Whisper's no-speech probability for up to 30 s of audio (the measure
 * Whisper itself uses to skip silent and music-only windows). */
async function noSpeech(model: AutomaticSpeechRecognitionPipeline, audio: Float32Array): Promise<number> {
  const { logits, last, vocab } = await firstTokenLogits(model, audio);
  const token = model.tokenizer.convert_tokens_to_ids("<|nocaptions|>") ?? model.tokenizer.convert_tokens_to_ids("<|nospeech|>");
  if (token === undefined) return 0.5;
  let max = -Infinity;
  for (let i = 0; i < vocab; i++) max = Math.max(max, Number(logits[last + i]));
  let sum = 0;
  for (let i = 0; i < vocab; i++) sum += Math.exp(Number(logits[last + i]) - max);
  return Math.exp(Number(logits[last + token]) - max) / sum;
}

/** Whisper's own language guess: the most likely language token right after
 * <|startoftranscript|>. */
async function detectLanguage(model: AutomaticSpeechRecognitionPipeline, audio: Float32Array): Promise<string> {
  const { logits, last } = await firstTokenLogits(model, audio);
  let best = "en";
  let bestScore = -Infinity;
  for (const code of LANGUAGES) {
    const score = Number(logits[last + model.tokenizer.convert_tokens_to_ids(`<|${code}|>`)]);
    if (score > bestScore) {
      bestScore = score;
      best = code;
    }
  }
  return best;
}

const round = (t: number) => Math.round(t * 1000) / 1000;

/** Longest a word may stay on: Whisper's timings fold a following pause
 * into the word before it ("this." running 2.7 s into silence). */
const maxWordSeconds = (text: string) => Math.max(1.2, 0.15 * text.length);

/** The pipeline's word chunks as caption words. Punctuation the model emits
 * as a "word" of its own ("...", the "-page" of "90-page") joins the word
 * before it, zero-length words get a sliver of time instead of being
 * dropped, and no word runs on into the pause after it. */
function toWords(chunks: { text: string; timestamp: [number, number | null] }[], length: number) {
  const words: { start: number; end: number; text: string }[] = [];
  for (const c of chunks) {
    const text = c.text.trim();
    if (!text) continue;
    const prev = words[words.length - 1];
    if (prev && /^\p{P}/u.test(c.text)) {
      // A lone "..." after "this." would make "this....".
      if (/\P{P}/u.test(text) || !/\p{P}$/u.test(prev.text)) prev.text += text;
      continue;
    }
    if (/^\p{P}+$/u.test(text)) continue;
    const start = c.timestamp[0];
    if (start >= length) continue;
    let end = Math.min(length, c.timestamp[1] ?? start + 0.3, start + maxWordSeconds(text));
    if (end <= start) end = Math.min(length, start + 0.1);
    words.push({ start: round(start), end: round(end), text });
  }
  return words;
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      if (!asr) loadedOn = await load(m.device, m.model);
      post({ type: "ready", device: loadedOn });
    } else if (m.type === "detect") {
      post({ type: "language", language: await detectLanguage(asr!, m.samples) });
    } else if (m.type === "nospeech") {
      post({ type: "nospeech", value: await noSpeech(asr!, m.samples) });
    } else if (m.type === "transcribe") {
      const samples: Float32Array = m.samples;
      const length = samples.length / 16000;
      const res = (await asr!(samples, {
        language: m.language,
        task: "transcribe",
        return_timestamps: "word",
      })) as { chunks?: { text: string; timestamp: [number, number | null] }[] };
      post({ type: "words", id: m.id, words: toWords(res.chunks ?? [], length) });
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
