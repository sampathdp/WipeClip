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
from math import ceil
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


# --- NVIDIA graphics cards ---------------------------------------------------
#
# CTranslate2's Windows build runs Whisper on an NVIDIA card (CUDA 12) once it
# can load cuBLAS - and only cuBLAS: no cuDNN or CUDA runtime is needed
# (tried). The two DLLs come from NVIDIA's own pinned PyPI package, downloaded
# on request: they're 770 MB, too big for the installer. Only those two
# members are read out of the 553 MB wheel, with HTTP range requests; each
# one's CRC is checked as it's unpacked. Measured on a GTX 1650 (4 GB): a
# 2-minute Sinhala test in 8 s, against 84 s on the laptop's 6-core CPU, with
# the same transcript.

_CUBLAS_WHEEL = (
    "https://files.pythonhosted.org/packages/45/a1/a17fade6567c57452cfc8f967a40d1035bb9301db52f27808167fbb2be2f/"
    "nvidia_cublas_cu12-12.9.1.4-py3-none-win_amd64.whl"
)
_CUBLAS_FILES = {"cublas64_12.dll": 78_836_264, "cublasLt64_12.dll": 474_117_864}  # compressed bytes
GPU_DOWNLOAD_MB = round(sum(_CUBLAS_FILES.values()) / 1e6)

# Set once a GPU run failed (an old driver, too little graphics memory): the
# engine then stays on the CPU until it restarts.
_gpu_failed = False


def _cuda_dir() -> Path:
    return models_dir() / "cuda"


def gpu_status() -> dict:
    """Whether this machine has an NVIDIA card CTranslate2 can use, and
    whether the libraries for it are downloaded yet."""
    available = False
    if sys.platform == "win32" and not _gpu_failed:
        try:
            import ctranslate2

            available = ctranslate2.get_cuda_device_count() > 0
        except Exception:  # noqa: BLE001 - no driver, or no CUDA build
            available = False
    return {"available": available, "ready": (_cuda_dir() / "ready").is_file(), "sizeMb": GPU_DOWNLOAD_MB}


def _http_range(url: str, start: int, end: int):
    req = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}", "User-Agent": "WipeClip-desktop"})
    return urllib.request.urlopen(req, timeout=60)


def _zip_members(url: str) -> dict[str, tuple[int, int, int, int]]:
    """The wheel's (zip's) members: name -> (local header offset, compressed
    size, method, crc32), read from its central directory at the end."""
    import struct

    head = urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers={"User-Agent": "WipeClip-desktop"}), timeout=60)
    size = int(head.headers["Content-Length"])
    with _http_range(url, max(0, size - 65_536), size - 1) as res:
        tail = res.read()
    eocd = tail.rfind(b"PK\x05\x06")
    if eocd < 0:
        raise OSError("Not a zip file")
    cd_size, cd_offset = struct.unpack_from("<II", tail, eocd + 12)
    with _http_range(url, cd_offset, cd_offset + cd_size - 1) as res:
        cd = res.read()
    out = {}
    at = 0
    while at + 46 <= len(cd) and cd[at : at + 4] == b"PK\x01\x02":
        method, _, _, crc, csize, _, n, e, c = struct.unpack_from("<HHHIIIHHH", cd, at + 10)
        (offset,) = struct.unpack_from("<I", cd, at + 42)
        name = cd[at + 46 : at + 46 + n].decode("utf-8")
        out[name.rsplit("/", 1)[-1]] = (offset, csize, method, crc)
        at += 46 + n + e + c
    return out


def _fetch_member(url: str, info: tuple[int, int, int, int], dest: Path, on_bytes: Callable[[int], None]) -> None:
    """One zip member, streamed in a single range request and inflated as
    it arrives."""
    import struct
    import zlib

    offset, csize, method, crc = info
    with _http_range(url, offset, offset + 29) as res:
        n, e = struct.unpack_from("<HH", res.read(), 26)
    start = offset + 30 + n + e
    inflate = zlib.decompressobj(-15) if method == 8 else None
    check = 0
    part = dest.with_name(dest.name + ".part")
    with _http_range(url, start, start + csize - 1) as res, open(part, "wb") as out:
        while chunk := res.read(1 << 20):
            on_bytes(len(chunk))
            data = inflate.decompress(chunk) if inflate else chunk
            check = zlib.crc32(data, check)
            out.write(data)
        if inflate:
            data = inflate.flush()
            check = zlib.crc32(data, check)
            out.write(data)
    if check != crc:
        part.unlink(missing_ok=True)
        raise OSError(f"{dest.name} arrived damaged")
    os.replace(part, dest)


def ensure_gpu(progress: Progress) -> Path:
    """The folder with the cuBLAS DLLs, downloading them first if needed."""
    path = _cuda_dir()
    if not (path / "ready").is_file():
        path.mkdir(parents=True, exist_ok=True)
        members = _zip_members(_CUBLAS_WHEEL)
        total = sum(_CUBLAS_FILES.values())
        done = 0

        def on_bytes(n: int) -> None:
            nonlocal done
            done += n
            progress("download", min(1.0, done / total))

        for name in _CUBLAS_FILES:
            if not (path / name).is_file():
                _fetch_member(_CUBLAS_WHEEL, members[name], path / name, on_bytes)
        (path / "ready").write_text("1")
    # CTranslate2 loads cuBLAS by name on its first GPU call, from PATH.
    if str(path) not in os.environ.get("PATH", "").split(os.pathsep):
        os.environ["PATH"] = str(path) + os.pathsep + os.environ.get("PATH", "")
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


class ModelNeeded(Exception):
    """The audio is in a language whose model isn't downloaded, and the
    user hasn't agreed to download it ("auto" detecting Sinhala)."""

    def __init__(self, language: str, model: SpeechModel) -> None:
        super().__init__(language)
        self.language = language
        self.model = model


def _whisper(model: SpeechModel, progress: Progress, gpu: bool):
    from faster_whisper import WhisperModel

    device = "cuda" if gpu else "cpu"
    with _load_lock:
        hit = _loaded.get((model.key, device))
        if hit is None:
            path = ensure_model(model, progress)
            progress("prepare", 0.0)
            # One model in memory at a time (turbo alone is ~1 GB in int8).
            _loaded.clear()
            if gpu:
                # 8-bit weights, 16-bit math: what a GTX 1650 (compute 7.5) runs best.
                hit = WhisperModel(str(path), device="cuda", compute_type="int8_float16")
            else:
                hit = WhisperModel(str(path), device="cpu", compute_type="int8", cpu_threads=_cpu_threads())
            _loaded[(model.key, device)] = hit
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


# Whisper large-v3-turbo can't recognize Sinhala: on Sinhala speech it
# guesses a neighbouring language with little confidence. Measured on three
# clips each: Sinhala "ta" at 0.16-0.46; Tamil itself 0.69-0.85, Hindi
# 0.92-0.96 (FLEURS). So a weak guess among these, averaged over up to three
# clips, is taken for Sinhala. Kannada (0.27-0.58, also guessed "ta") falls
# under it too; Whisper can't transcribe it either.
_LIKE_SINHALA = {"ta", "kn", "te", "ml", "gu", "bo", "mr", "bn", "ne", "sa", "th", "hi", "si"}
_SURE = 0.6


def detect_language(model, audio: np.ndarray, clips: list[tuple[int, int]]) -> str:
    """The language of up to the first three clips, by the general model's
    averaged scores (fewer when it's sure), with Sinhala recognized as above."""
    scores: dict[str, float] = {}
    sample = clips[:3]
    for k, (a, b) in enumerate(sample, 1):
        _, _, probs = model.detect_language(audio=audio[a:b])
        for code, p in probs:
            scores[code] = scores.get(code, 0.0) + p
        language, total = max(scores.items(), key=lambda kv: kv[1])
        # A clear answer needs no more clips: each costs an encoder pass
        # (16 s on a 6-core CPU).
        if total / k >= 0.8:
            break
    p = total / k
    if language in _LIKE_SINHALA and p < _SURE:
        return "si"
    return language


def transcribe(audio: np.ndarray, language: str, progress: Progress, gpu: bool = False) -> dict:
    """Word-timed transcript of 16 kHz mono float32 `audio`. `language` is
    a Whisper code or "auto" (detected by the general model; Sinhala then
    switches to the Sinhala model, if it's downloaded - else ModelNeeded).
    `gpu`: use the NVIDIA card, downloading its libraries if needed; any
    failure there falls back to the CPU. Returns {language, words: [{start,
    end, text}]}, times in seconds within `audio`."""
    global _gpu_failed
    use_gpu = gpu and gpu_status()["available"]
    if use_gpu:
        ensure_gpu(progress)
    try:
        return _transcribe(audio, language, progress, use_gpu)
    except RuntimeError as exc:  # what CTranslate2 raises for CUDA errors
        if not use_gpu:
            raise
        print(f"speech: the graphics card failed, using the CPU: {exc}", file=sys.stderr)
        _gpu_failed = True
        with _load_lock:
            _loaded.clear()
        return _transcribe(audio, language, progress, False)


def _decode(model, audio: np.ndarray, language: str, clips: list[tuple[int, int]], batch: int):
    """The clips' segments (a generator), decoded `batch` at a time.

    Several clips side by side are about 15% faster than one by one on the
    CPU, and each is decoded once. Text only, timed by aligning it to the
    audio: the Sinhala model was fine-tuned without timestamp tokens and
    decodes far worse when asked for them.

    The encoder gets a window 1 s longer than the longest clip instead of
    Whisper's padded 30 s - CTranslate2 takes the shorter input as is. With
    the Sinhala model's 12 s clips, on the 2-minute test (i7-9750H, GTX
    1650), it took 30 s instead of 84 s on the CPU and 7 s instead of 9 s on
    the GPU, at the same accuracy (character error rate 4.4-4.6%) once
    early-ended clips are decoded again (see unfinished). faster-whisper
    pads to 30 s with its module-level pad_or_trim while preparing the
    batch, before returning the generator, so it's swapped only for that
    call (transcriptions run one at a time: main.py _speech_lock)."""
    import faster_whisper.transcribe as fw
    from faster_whisper import BatchedInferencePipeline

    longest = max(b - a for a, b in clips) / RATE
    frames = min(3000, 100 * ceil(longest) + 100)  # 100 frames a second
    full = fw.pad_or_trim
    fw.pad_or_trim = lambda array, length=3000, **kw: full(array, frames, **kw)
    try:
        segments, _ = BatchedInferencePipeline(model).transcribe(
            audio,
            language=language,
            task="transcribe",
            clip_timestamps=[{"start": a / RATE, "end": b / RATE} for a, b in clips],
            batch_size=batch,
            beam_size=1,
            word_timestamps=True,
            without_timestamps=True,
        )
    finally:
        fw.pad_or_trim = full
    return segments


def _transcribe(audio: np.ndarray, language: str, progress: Progress, gpu: bool) -> dict:
    total = len(audio) / RATE
    if language == "auto":
        first = speech_clips(audio, _CLIP_SECONDS["general"] * RATE)
        if not first:
            return {"language": "en", "words": []}
        general = _whisper(MODELS["general"], progress, gpu)
        progress("transcribe", 0.0)
        language = detect_language(general, audio, first)
        # Only the model the user agreed to (the general one, for "auto") is
        # downloaded unasked; another is asked for first.
        if model_for(language).key != "general" and not is_ready(model_for(language)):
            raise ModelNeeded(language, model_for(language))
    spec = model_for(language)
    clips = speech_clips(audio, _CLIP_SECONDS[spec.key] * RATE)
    if not clips:
        return {"language": language, "words": []}
    model = _whisper(spec, progress, gpu)
    progress("transcribe", 0.0)
    batch = _BATCH[spec.key]
    words = _words(_decode(model, audio, language, clips, batch), total, lambda t: progress("transcribe", min(0.95, t / total)))
    # Greedy decoding sometimes ends a clip early (one of eleven in the
    # 2-minute test: 6 of its 17 words, more often with the short encoder
    # window). Speech left after a clip's last word is decoded again.
    rest = unfinished(audio, clips, words)
    if rest:
        # Only confident words: what's left may be a breath or noise.
        words += _words(_decode(model, audio, language, rest, batch), total, lambda t: None, min_probability=0.4)
        words.sort(key=lambda w: w["start"])
    progress("transcribe", 1.0)
    return {"language": language, "words": drop_loops(words)}


def _words(segments, total: float, on_time: Callable[[float], None], min_probability: float = 0.0) -> list[dict]:
    words = []
    for seg in segments:  # a generator: each batch is decoded as it's read
        for wd in seg.words or []:
            text = wd.word.strip()
            if not text or wd.probability < min_probability:
                continue
            start = max(0.0, float(wd.start))
            end = min(total, float(wd.end), start + _max_word_seconds(text))
            if end <= start:
                end = min(total, start + 0.1)
            words.append({"start": round(start, 3), "end": round(end, 3), "text": text})
        on_time(seg.end)
    return words


_MIN_REST = int(1.5 * RATE)


def _loud_seconds(a: np.ndarray) -> float:
    return sum(_rms(a[i : i + _FRAME]) >= _SILENCE_RMS for i in range(0, len(a), _FRAME)) * _FRAME / RATE


def unfinished(audio: np.ndarray, clips: list[tuple[int, int]], words: list[dict]) -> list[tuple[int, int]]:
    """The part of each clip after its last recognized word, when it's at
    least 1.5 s long with 1 s of sound in it (not just a word's tail before
    a pause). Clips with no words at all are left out: that's sound Whisper
    didn't take for speech (music, noise)."""
    out = []
    for a, b in clips:
        ends = [w["end"] for w in words if a / RATE <= w["start"] < b / RATE]
        start = max(a, int((max(ends) + 0.1) * RATE)) if ends else a
        if ends and b - start >= _MIN_REST and _loud_seconds(audio[start:b]) >= 1.0:
            out.append((start, b))
    return out
