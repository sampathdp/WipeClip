/// <reference lib="webworker" />
/** Speech-to-text for auto captions, run in the browser (Whisper via
 * transformers.js) so it costs no server time. One worker holds one loaded
 * model; captions.ts runs a small pool of them, since WebAssembly is
 * single-threaded here (the site isn't cross-origin isolated) and the pool
 * is how several cores get used. Model files are downloaded once and kept
 * in the browser's cache.
 *
 * In:  { type: "init", device: "webgpu" | "wasm" }  "webgpu" = encoder on the GPU, decoder on the CPU
 *      { type: "detect", samples }                  - 16 kHz mono, up to 30 s
 *      { type: "transcribe", id, samples, language } - one segment, up to 30 s
 * Out: { type: "progress", stage: "download" | "prepare", value: 0..1 }
 *      { type: "ready", device }
 *      { type: "language", language }
 *      { type: "words", id, words: [{ start, end, text }] }  times within the segment
 *      { type: "error", message }
 */
import { env, pipeline, Tensor, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

const MODEL = "onnx-community/whisper-base_timestamped"; // word-level timestamps need the "_timestamped" export

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

/** Encoder precision for WebGPU, or null without a usable adapter. Half
 * precision where the GPU supports it: half the download, and faster. */
async function gpuEncoderDtype(): Promise<"fp16" | "fp32" | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  const adapter = await gpu?.requestAdapter().catch(() => null);
  if (!adapter) return null;
  return adapter.features.has("shader-f16") ? "fp16" : "fp32";
}

async function load(device: Device): Promise<Device> {
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
    asr = (await pipeline("automatic-speech-recognition", MODEL, {
      device: { encoder_model: "webgpu", decoder_model_merged: "wasm" },
      dtype: { encoder_model: encoder, decoder_model_merged: "q8" },
      progress_callback,
    })) as AutomaticSpeechRecognitionPipeline;
    return "webgpu";
  }
  asr = (await pipeline("automatic-speech-recognition", MODEL, {
    device: "wasm",
    dtype: "q8",
    progress_callback,
  })) as AutomaticSpeechRecognitionPipeline;
  return "wasm";
}

/** Whisper's own language guess: the most likely language token right after
 * <|startoftranscript|>. */
async function detectLanguage(model: AutomaticSpeechRecognitionPipeline, audio: Float32Array): Promise<string> {
  const { input_features } = await model.processor(audio);
  const sot = model.tokenizer.convert_tokens_to_ids("<|startoftranscript|>");
  const out = await model.model({
    input_features,
    decoder_input_ids: new Tensor("int64", BigInt64Array.from([BigInt(sot)]), [1, 1]),
  });
  const logits = (await out.logits.getData?.()) ?? out.logits.data;
  const vocab = out.logits.dims[out.logits.dims.length - 1];
  const last = logits.length - vocab;
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

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      if (!asr) loadedOn = await load(m.device);
      post({ type: "ready", device: loadedOn });
    } else if (m.type === "detect") {
      post({ type: "language", language: await detectLanguage(asr!, m.samples) });
    } else if (m.type === "transcribe") {
      const samples: Float32Array = m.samples;
      const length = samples.length / 16000;
      const res = (await asr!(samples, {
        language: m.language,
        task: "transcribe",
        return_timestamps: "word",
      })) as { chunks?: { text: string; timestamp: [number, number | null] }[] };
      const words: { start: number; end: number; text: string }[] = [];
      for (const c of res.chunks ?? []) {
        const text = c.text.trim();
        const start = c.timestamp[0];
        const end = Math.min(length, c.timestamp[1] ?? start + 0.3);
        if (text && end > start) words.push({ start: round(start), end: round(end), text });
      }
      post({ type: "words", id: m.id, words });
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
