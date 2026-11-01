"""Speech recognition for the desktop app's captions and transcript, run in
the engine on the user's own machine with faster-whisper (CTranslate2, MIT).
Native code on every core is several times faster than the editor's
in-browser Whisper (captions.worker.ts), which the website still uses.

Two models, downloaded from Hugging Face on first use (after the editor asks)
and kept in WIPECLIP_MODELS_DIR:

- general: Whisper large-v3-turbo (MIT), for every language but Sinhala.
- si: SinhaSpeech's Whisper-small fine-tuned on Sinhala (Apache-2.0; 15.5%
  word error rate on its speaker-disjoint test set, where stock Whisper mostly
  produces nonsense or loops). It's published as a Transformers checkpoint,
  so it's converted to CTranslate2 here, with numpy only (convert_whisper):
  the converter CTranslate2 ships needs PyTorch, far too big to bundle.

Audio never leaves the machine; only the model files are downloaded.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import threading
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import numpy as np

RATE = 16000


@dataclass(frozen=True)
class Download:
    repo: str
    revision: str  # pinned, so a changed upload can't change what users get
    name: str
    size: int  # bytes, for progress before the server says


@dataclass(frozen=True)
class SpeechModel:
    key: str
    files: tuple[Download, ...]
    converted: bool  # a Transformers checkpoint, converted after download

    @property
    def size_mb(self) -> int:
        return round(sum(f.size for f in self.files) / 1e6)


_TURBO = ("dropbox-dash/faster-whisper-large-v3-turbo", "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf")
_SINHALA = ("SinhaSpeech/whisper-small-sinhala-run12-best", "96eac6280bc937432db4b58c5ec2641826732552")
# Its tokenizer is word for word whisper-small's (vocab, merges and added
# tokens compared), which only publishes tokenizer.json in the base repo.
_SMALL = ("openai/whisper-small", "973afd24965f72e36ca33b3055d56a652f456b4d")

MODELS = {
    "general": SpeechModel(
        "general",
        (
            Download(*_TURBO, "model.bin", 1_617_884_929),
            Download(*_TURBO, "config.json", 2_000),
            Download(*_TURBO, "preprocessor_config.json", 400),
            Download(*_TURBO, "tokenizer.json", 2_500_000),
            Download(*_TURBO, "vocabulary.json", 1_100_000),
        ),
        converted=False,
    ),
    "si": SpeechModel(
        "si",
        (
            Download(*_SINHALA, "model.safetensors", 966_995_080),
            Download(*_SINHALA, "config.json", 2_000),
            Download(*_SINHALA, "generation_config.json", 4_000),
            Download(*_SINHALA, "preprocessor_config.json", 400),
            Download(*_SMALL, "tokenizer.json", 2_500_000),
        ),
        converted=True,
    ),
}


def model_for(language: str) -> SpeechModel:
    return MODELS["si" if language == "si" else "general"]


def models_dir() -> Path:
    """WIPECLIP_MODELS_DIR (set by the app: its local data folder), else
    a folder in the user's local app data."""
    raw = os.environ.get("WIPECLIP_MODELS_DIR")
    if raw:
        return Path(raw)
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / "co.wipeclip.desktop" / "speech-models"


def _model_path(model: SpeechModel) -> Path:
    return models_dir() / model.key


def is_ready(model: SpeechModel) -> bool:
    """Downloaded (and converted) completely: the marker is written last."""
    return (_model_path(model) / "ready").is_file()


Progress = Callable[[str, float], None]  # (stage, 0..1); raises to cancel


def _fetch(d: Download, dest: Path, on_bytes: Callable[[int], None]) -> None:
    url = f"https://huggingface.co/{d.repo}/resolve/{d.revision}/{d.name}"
    part = dest.with_name(dest.name + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "WipeClip-desktop"})
    with urllib.request.urlopen(req, timeout=60) as res, open(part, "wb") as out:
        while chunk := res.read(1 << 20):
            out.write(chunk)
            on_bytes(len(chunk))
    os.replace(part, dest)


def ensure_model(model: SpeechModel, progress: Progress) -> Path:
    """The model's folder, downloading (and converting) it first if needed.
    A cancelled or failed download leaves no "ready" marker, so the next
    run starts it again."""
    path = _model_path(model)
    if is_ready(model):
        return path
    raw = path / "download" if model.converted else path
    raw.mkdir(parents=True, exist_ok=True)
    total = sum(f.size for f in model.files)
    done = 0

    def on_bytes(n: int) -> None:
        nonlocal done
        done += n
        progress("download", min(1.0, done / total))

    for f in model.files:
        dest = raw / f.name
        if dest.is_file():  # kept from an earlier, interrupted run
            on_bytes(f.size)
            continue
        _fetch(f, dest, on_bytes)

    if model.converted:
        progress("prepare", 0.0)
        convert_whisper(raw, path)
        for name in ("tokenizer.json", "preprocessor_config.json"):
            shutil.copyfile(raw / name, path / name)
        shutil.rmtree(raw, ignore_errors=True)
    (path / "ready").write_text("1")
    return path


def _load_safetensors(path: Path) -> dict[str, np.ndarray]:
    """Every tensor of a float32 .safetensors file, memory-mapped."""
    with open(path, "rb") as f:
        header_len = int.from_bytes(f.read(8), "little")
        header = json.loads(f.read(header_len))
    # Copy-on-write: quantizing scales the weights in place.
    data = np.memmap(path, dtype=np.uint8, mode="c", offset=8 + header_len)
    out = {}
    for name, info in header.items():
        if name == "__metadata__":
            continue
        if info["dtype"] != "F32":
            raise ValueError(f"Unexpected dtype {info['dtype']} for {name}")
        start, end = info["data_offsets"]
        out[name] = data[start:end].view("<f4").reshape(info["shape"])
    return out


def convert_whisper(src: Path, out: Path) -> None:
    """A Transformers Whisper checkpoint (model.safetensors, config.json,
    generation_config.json, tokenizer.json) as a CTranslate2 model with int8
    weights: the same layout CTranslate2's own converter writes
    (ctranslate2/converters/transformers.py WhisperLoader), without PyTorch."""
    from ctranslate2.converters.utils import fuse_linear
    from ctranslate2.specs import common_spec, whisper_spec

    cfg = json.loads((src / "config.json").read_text(encoding="utf-8"))
    gen = json.loads((src / "generation_config.json").read_text(encoding="utf-8"))
    w = _load_safetensors(src / "model.safetensors")
    p = "model."
    if not any(k.startswith(p) for k in w):
        p = ""

    def get(name: str) -> Optional[np.ndarray]:
        a = w.get(p + name)
        return None if a is None else np.ascontiguousarray(a)

    def linear(spec, name: str) -> None:
        spec.weight = get(name + ".weight")
        bias = get(name + ".bias")
        if bias is not None:
            spec.bias = bias

    def norm(spec, name: str) -> None:
        spec.gamma = get(name + ".weight")
        spec.beta = get(name + ".bias")

    def attention(spec, name: str, self_attention: bool) -> None:
        q, k, v = (common_spec.LinearSpec() for _ in range(3))
        linear(q, name + ".q_proj")
        linear(k, name + ".k_proj")  # no bias in Whisper: fuse_linear pads zeros
        linear(v, name + ".v_proj")
        if self_attention:
            fuse_linear(spec.linear[0], [q, k, v])
        else:
            fuse_linear(spec.linear[0], [q])
            fuse_linear(spec.linear[1], [k, v])
        linear(spec.linear[-1], name + ".out_proj")

    spec = whisper_spec.WhisperSpec(
        cfg["encoder_layers"], cfg["encoder_attention_heads"], cfg["decoder_layers"], cfg["decoder_attention_heads"]
    )
    enc = spec.encoder
    for conv in ("conv1", "conv2"):
        linear(getattr(enc, conv), f"encoder.{conv}")
    enc.position_encodings.encodings = get("encoder.embed_positions.weight")
    norm(enc.layer_norm, "encoder.layer_norm")
    for i, layer in enumerate(enc.layer):
        n = f"encoder.layers.{i}"
        attention(layer.self_attention, n + ".self_attn", True)
        norm(layer.self_attention.layer_norm, n + ".self_attn_layer_norm")
        linear(layer.ffn.linear_0, n + ".fc1")
        linear(layer.ffn.linear_1, n + ".fc2")
        norm(layer.ffn.layer_norm, n + ".final_layer_norm")

    dec = spec.decoder
    dec.embeddings.weight = get("decoder.embed_tokens.weight")
    dec.position_encodings.encodings = get("decoder.embed_positions.weight")
    norm(dec.layer_norm, "decoder.layer_norm")
    for i, layer in enumerate(dec.layer):
        n = f"decoder.layers.{i}"
        attention(layer.self_attention, n + ".self_attn", True)
        norm(layer.self_attention.layer_norm, n + ".self_attn_layer_norm")
        attention(layer.attention, n + ".encoder_attn", False)
        norm(layer.attention.layer_norm, n + ".encoder_attn_layer_norm")
        linear(layer.ffn.linear_0, n + ".fc1")
        linear(layer.ffn.linear_1, n + ".fc2")
        norm(layer.ffn.layer_norm, n + ".final_layer_norm")
    # proj_out shares its weights with the token embeddings.
    out_proj = w.get("proj_out.weight")
    dec.projection.weight = np.ascontiguousarray(out_proj) if out_proj is not None else dec.embeddings.weight

    c = spec.config
    c.suppress_ids = gen.get("suppress_tokens") or cfg.get("suppress_tokens") or []
    c.suppress_ids_begin = gen.get("begin_suppress_tokens") or cfg.get("begin_suppress_tokens") or []
    c.lang_ids = sorted(gen["lang_to_id"].values())
    heads = gen.get("alignment_heads")
    if not heads:  # CTranslate2's default: every head of the last half of the layers
        layers, n_heads = cfg["decoder_layers"], cfg["decoder_attention_heads"]
        heads = [[a, b] for a in range(layers // 2, layers) for b in range(n_heads)]
    c.alignment_heads = [tuple(h) for h in heads]

    # Tokens by id, then the timestamp tokens up to the model's vocabulary.
    vocab = json.loads((src / "tokenizer.json").read_text(encoding="utf-8"))
    ids = dict(vocab["model"]["vocab"])
    ids.update({t["content"]: t["id"] for t in vocab.get("added_tokens", [])})
    tokens = [t for t, _ in sorted(ids.items(), key=lambda kv: kv[1])]
    tokens.extend("<|%.2f|>" % (i * 0.02) for i in range(cfg["vocab_size"] - len(tokens)))
    spec.register_vocabulary(tokens)

    spec.validate()
    spec.optimize(quantization="int8")
    out.mkdir(parents=True, exist_ok=True)
    spec.save(str(out))


# --- Transcription -----------------------------------------------------------

_loaded: dict[str, object] = {}
_load_lock = threading.Lock()


def _cpu_threads() -> int:
    # The physical cores, about half the logical ones: hyperthreads make it
    # slower, not faster (i7-9750H, a 30 s window of whisper-small: 3.2 s on
    # 6 threads, 3.4 s on 11). Never more than desktop_engine.py's
    # JOB_THREADS, which keeps one core for the app.
    physical = max(1, (os.cpu_count() or 2) // 2)
    try:
        return max(1, min(physical, int(os.environ.get("JOB_THREADS", ""))))
    except ValueError:
        return physical


def _whisper(model: SpeechModel, progress: Progress):
    from faster_whisper import WhisperModel

    with _load_lock:
        hit = _loaded.get(model.key)
        if hit is None:
            path = ensure_model(model, progress)
            progress("prepare", 0.0)
            # One model in memory at a time (turbo alone is ~1 GB in int8).
            _loaded.clear()
            hit = _loaded[model.key] = WhisperModel(str(path), device="cpu", compute_type="int8", cpu_threads=_cpu_threads())
        return hit


# The longest a word may stay on: Whisper's timings fold a following pause
# into the word before it (same rule as captions.worker.ts).
def _max_word_seconds(text: str) -> float:
    return max(1.2, 0.15 * len(text))


# Clip length per model. The Sinhala model was fine-tuned on short
# utterances: on 28 s clips it left out a quarter of the words (2-minute
# test, word error rate 49%), on 12 s clips 26%. Turbo keeps full windows:
# each window costs the same encoder pass however short it is (on an
# i7-9750H's CPU, 16 s for turbo, 3 s for whisper-small).
_CLIP_SECONDS = {"general": 28, "si": 12}
_BATCH = {"general": 4, "si": 8}
_SEARCH = 6 * RATE  # look this far back from a clip's end for a quiet spot
_FRAME = RATE // 10  # 100 ms loudness frames
_SILENCE_RMS = 0.004  # clips quieter than this are skipped (Whisper invents text in silence)
_LOOP = re.compile(r"(.{1,6}?)\1{5,}")


def _rms(a: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(a, dtype=np.float64)))) if len(a) else 0.0


def speech_clips(audio: np.ndarray, length: int) -> list[tuple[int, int]]:
    """Sample ranges of at most `length`, cut at the quietest 100 ms near
    each end so words aren't split; silent ones dropped. The same cuts as
    the browser path (captions.ts speechSegments)."""
    out = []
    start = 0
    while start < len(audio):
        end = start + length
        if end >= len(audio):
            end = len(audio)
        else:
            frames = range(end - _FRAME, max(start, end - _SEARCH) - 1, -_FRAME)
            best = min(frames, key=lambda at: _rms(audio[at : at + _FRAME]), default=end - _FRAME // 2)
            end = best + _FRAME // 2
        if _rms(audio[start:end]) >= _SILENCE_RMS:
            out.append((start, end))
        start = end
    return out


def drop_loops(words: list[dict]) -> list[dict]:
    """What's left of a decoding stuck in a loop, taken out: words that are
    a short piece repeated over and over or far too long for one word, and
    the same word more than three times in a row (the same rules as
    captions.worker.ts). Batched decoding has no per-clip retry; its length
    cap keeps a loop from costing much time, and this removes the text."""
    out = []
    for i, w in enumerate(words):
        if _LOOP.search(w["text"]) or len(w["text"]) > 40:
            continue
        if i >= 3 and all(words[i - k]["text"] == w["text"] for k in (1, 2, 3)):
            continue
        out.append(w)
    return out


def transcribe(audio: np.ndarray, language: str, progress: Progress) -> dict:
    """Word-timed transcript of 16 kHz mono float32 `audio`. `language` is
    a Whisper code or "auto" (detected by the general model; Sinhala then
    switches to the Sinhala model). Returns {language, words: [{start, end,
    text}]}, times in seconds within `audio`."""
    from faster_whisper import BatchedInferencePipeline

    total = len(audio) / RATE
    if language == "auto":
        first = speech_clips(audio, _CLIP_SECONDS["general"] * RATE)
        if not first:
            return {"language": "en", "words": []}
        general = _whisper(MODELS["general"], progress)
        progress("transcribe", 0.0)
        language, _, _ = general.detect_language(audio=audio[first[0][0] : first[0][1]])
    spec = model_for(language)
    clips = speech_clips(audio, _CLIP_SECONDS[spec.key] * RATE)
    if not clips:
        return {"language": language, "words": []}
    model = _whisper(spec, progress)
    progress("transcribe", 0.0)
    # Several clips decoded side by side (about 15% faster than one by one
    # on the CPU), each once. Text only, timed by aligning it to the audio:
    # the Sinhala model was fine-tuned without timestamp tokens and decodes
    # far worse when asked for them.
    segments, _ = BatchedInferencePipeline(model).transcribe(
        audio,
        language=language,
        task="transcribe",
        clip_timestamps=[{"start": a / RATE, "end": b / RATE} for a, b in clips],
        batch_size=_BATCH[spec.key],
        beam_size=1,
        word_timestamps=True,
        without_timestamps=True,
    )
    words = []
    for seg in segments:  # a generator: each batch is decoded as it's read
        for wd in seg.words or []:
            text = wd.word.strip()
            if not text:
                continue
            start = max(0.0, float(wd.start))
            end = min(total, float(wd.end), start + _max_word_seconds(text))
            if end <= start:
                end = min(total, start + 0.1)
            words.append({"start": round(start, 3), "end": round(end, 3), "text": text})
        progress("transcribe", min(1.0, seg.end / total) if total else 1.0)
    return {"language": language, "words": drop_loops(words)}
