"""Speech recognition for the desktop app's captions and transcript, run in
the engine on the user's own machine with faster-whisper (CTranslate2, MIT).
Native code on every core is several times faster than the editor's
in-browser Whisper (captions.worker.ts), which the website still uses.

Models, downloaded from Hugging Face on first use (after the editor asks)
and kept in WIPECLIP_MODELS_DIR:

- general: Whisper large-v3-turbo (MIT), for most languages.
- si: SinhaSpeech's Whisper-small fine-tuned on Sinhala (Apache-2.0; 15.5%
  word error rate on its speaker-disjoint test set, where stock Whisper mostly
  produces nonsense or loops).
- kn, ta, te, hi: IIT Madras SPRING Lab's Whisper-small fine-tuned per
  language (Apache-2.0); a third to a fifth of turbo's character errors.

The small ones are published as Transformers checkpoints, so they're
converted to CTranslate2 here, with numpy only (convert_whisper): the
converter CTranslate2 ships needs PyTorch, far too big to bundle.

Audio never leaves the machine; only the model files are downloaded.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
import threading
import urllib.error
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
    size: int  # bytes, for progress before the server says (exact when a hash is given)
    sha256: str = ""  # a Git LFS file's hash at that revision: checked after download
    git_oid: str = ""  # a small (non-LFS) file's git blob id: checked after download


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

# Whisper-small fine-tuned per Indian language by IIT Madras's SPRING Lab
# (Apache-2.0; trained on public Indian speech corpora and FLEURS train).
# On FLEURS test sentences these beat large-v3-turbo by far: see SPEECH.md.
_VISTAAR = {
    "kn": ("vasista22/whisper-kannada-small", "6f8e7b770513d941e4713b20adde26af32b2970b"),
    "ta": ("vasista22/whisper-tamil-small", "ac0d71cd70d4c66aec7126996cd9e56e97e698b7"),
    "hi": ("vasista22/whisper-hindi-small", "fb4a24afc20c42906deed31c3689e4be31da41fe"),
    "te": ("vasista22/whisper-telugu-small", "717212f9c4c16a78a86ddcb98f93c7f73ef8a5cc"),
}


def _vistaar(language: str, repo: str, revision: str) -> SpeechModel:
    # Published with an older tokenizer layout and a generation config
    # without languages or alignment heads: whisper-small's are used (the
    # same tokens, by id).
    return SpeechModel(
        language,
        (
            Download(repo, revision, "pytorch_model.bin", 967_099_139),
            Download(repo, revision, "config.json", 1_300),
            Download(repo, revision, "preprocessor_config.json", 185_000),
            Download(*_SMALL, "generation_config.json", 4_000),
            Download(*_SMALL, "tokenizer.json", 2_500_000),
        ),
        converted=True,
    )


# European languages: NVIDIA's Parakeet TDT 0.6B v3 (CC-BY-4.0), Ilya
# Stupakov's ONNX export, 8-bit encoder (parakeet.py). On FLEURS test clips
# through this pipeline it beat large-v3-turbo in each of these, at about a
# fifth of the time (0.11x real time against 0.46-0.60x): word errors French
# 7.4% / 8.6%, German 7.3% / 8.2%, Spanish 4.4% / 5.6%, Italian 3.5% / 6.1%
# (SPEECH.md). 671 MB, against turbo's 1.6 GB.
_PARAKEET = ("istupakov/parakeet-tdt-0.6b-v3-onnx", "8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce")
EUROPE = SpeechModel(
    "europe",
    (
        Download(*_PARAKEET, "config.json", 97, git_oid="02a773005666393de591dfd55230b778da1653d8"),
        Download(*_PARAKEET, "vocab.txt", 93_939, git_oid="fc43e1c723e262df60b70e1919614417162d1fe2"),
        Download(*_PARAKEET, "nemo128.onnx", 139_764, sha256="a9fde1486ebfcc08f328d75ad4610c67835fea58c73ba57e3209a6f6cf019e9f"),
        Download(*_PARAKEET, "decoder_joint-model.int8.onnx", 18_202_004, sha256="eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70"),
        Download(*_PARAKEET, "encoder-model.int8.onnx", 652_183_999, sha256="6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09"),
    ),
    converted=False,
)
# The languages it transcribes (it tells them apart itself). Not English:
# 9.4% against turbo's 8.2%, mostly British spellings and numbers in words,
# and English users have turbo already.
EUROPEAN = {"fr", "de", "es", "it"}

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
    **{lang: _vistaar(lang, *repo) for lang, repo in _VISTAAR.items()},
}

LANGUAGE_NAMES = {"si": "Sinhala", "kn": "Kannada", "ta": "Tamil", "hi": "Hindi", "te": "Telugu"}


def model_for(language: str) -> SpeechModel:
    if language in EUROPEAN:
        return EUROPE
    return MODELS.get(language) or MODELS["general"]


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
    """Downloaded (and converted) completely: the marker is written last.
    A model used as downloaded also needs each of its files there at its
    published size (a file deleted or cut short since doesn't count)."""
    path = _model_path(model)
    if not (path / "ready").is_file():
        return False
    if model.converted:
        return True
    for f in model.files:
        try:
            size = (path / f.name).stat().st_size
        except OSError:
            return False
        if (f.sha256 or f.git_oid) and size != f.size:
            return False
    return True


class NotEnoughSpace(OSError):
    """Too little free disk space for a model download."""


class DownloadDamaged(OSError):
    """A downloaded file isn't what the pinned revision published."""


def _check_file(d: Download, path: Path) -> None:
    """Raises DownloadDamaged (and deletes the file) unless `path` is the
    file the pinned revision published: its size, and its sha256 or git
    blob id, when known."""
    if not (d.sha256 or d.git_oid):
        return
    size = path.stat().st_size
    if size == d.size:
        h = hashlib.sha256() if d.sha256 else hashlib.sha1(b"blob %d\0" % size)
        with open(path, "rb") as f:
            while chunk := f.read(1 << 22):
                h.update(chunk)
        if h.hexdigest() == (d.sha256 or d.git_oid):
            return
    path.unlink(missing_ok=True)
    raise DownloadDamaged(f"The download of {Path(d.name).name} was damaged. Try again.")


_SPACE_MARGIN = 500_000_000  # bytes left free after a download


Progress = Callable[[str, float], None]  # (stage, 0..1); raises to cancel


def _fetch(d: Download, dest: Path, on_bytes: Callable[[int], None]) -> None:
    """One file, carried on from an earlier interrupted download's .part.
    A connection that drops can end the response early without an error
    (seen with a 1 GB model), so the length is checked, and a short read
    is carried on a few times before giving up."""
    url = f"https://huggingface.co/{d.repo}/resolve/{d.revision}/{d.name}"
    part = dest.with_name(dest.name + ".part")
    have = part.stat().st_size if part.is_file() else 0
    if have:
        on_bytes(have)
    for _ in range(5):
        headers = {"User-Agent": "WipeClip-desktop"}
        if have:
            headers["Range"] = f"bytes={have}-"
        try:
            res = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60)
        except urllib.error.HTTPError as exc:
            if exc.code != 416:  # 416: the .part is already whole
                raise
            _check_file(d, part)
            os.replace(part, dest)
            return
        with res:
            if res.status == 200 and have:  # the server ignored the range: start over
                have = 0
            total = res.headers.get("Content-Range", "").rpartition("/")[2] or res.headers.get("Content-Length")
            with open(part, "ab" if have else "wb") as out:
                while chunk := res.read(1 << 20):
                    out.write(chunk)
                    have += len(chunk)
                    on_bytes(len(chunk))
        if total is None or have >= int(total):
            _check_file(d, part)
            os.replace(part, dest)
            return
    raise OSError(f"The download of {d.name} keeps breaking off. Check your connection and try again.")


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
    need = 0
    for f in model.files:
        dest = raw / f.name
        if not dest.is_file():
            part = dest.with_name(dest.name + ".part")
            need += max(0, f.size - (part.stat().st_size if part.is_file() else 0))
    free = shutil.disk_usage(raw).free
    if need and free < need + _SPACE_MARGIN:
        raise NotEnoughSpace(
            f"There isn't enough free disk space for the download: it needs {ceil((need + _SPACE_MARGIN) / 1e9)} GB and {free / 1e9:.1f} GB is free."
        )

    def on_bytes(n: int) -> None:
        nonlocal done
        done += n
        progress("download", min(1.0, done / total))

    for f in model.files:
        dest = raw / f.name  # may be in a subfolder ("onnx/...")
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.is_file() and (not (f.sha256 or f.git_oid) or dest.stat().st_size == f.size):  # kept from an earlier, interrupted run
            on_bytes(f.size)
            continue
        dest.unlink(missing_ok=True)
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


def _load_pytorch(path: Path) -> dict[str, np.ndarray]:
    """Every tensor of a PyTorch checkpoint (pytorch_model.bin), without
    PyTorch. It's a zip with a pickle that names each tensor's storage; the
    pickle is read with only the few constructors a state dict uses
    allowed, so it can't run anything else."""
    import collections
    import pickle
    import zipfile

    dtypes = {"FloatStorage": "<f4", "HalfStorage": "<f2", "LongStorage": "<i8", "IntStorage": "<i4", "BoolStorage": "?"}
    archive = zipfile.ZipFile(path)
    root = next(n for n in archive.namelist() if n.endswith("data.pkl"))[: -len("data.pkl")]

    def tensor(storage, offset, size, stride, *_):
        item = storage.itemsize
        view = np.lib.stride_tricks.as_strided(storage[offset:], tuple(size), tuple(s * item for s in stride))
        return np.ascontiguousarray(view)

    class Unpickler(pickle.Unpickler):
        def find_class(self, module, name):
            if (module, name) == ("torch._utils", "_rebuild_tensor_v2"):
                return tensor
            if (module, name) == ("collections", "OrderedDict"):
                return collections.OrderedDict
            if module == "torch" and name in dtypes:
                return dtypes[name]
            raise pickle.UnpicklingError(f"{module}.{name} isn't allowed in a checkpoint")

        def persistent_load(self, pid):
            _, dtype, key, _, numel = pid
            # Writable: quantizing scales the weights in place.
            return np.frombuffer(bytearray(archive.read(f"{root}data/{key}")), dtype=dtype, count=numel)

    with archive, archive.open(root + "data.pkl") as f:  # closed, or Windows can't delete it after
        state = Unpickler(f).load()
    return {k: v.astype(np.float32) if v.dtype == np.float16 else v for k, v in state.items()}


def convert_whisper(src: Path, out: Path) -> None:
    """A Transformers Whisper checkpoint (model.safetensors or
    pytorch_model.bin, config.json, generation_config.json, tokenizer.json)
    as a CTranslate2 model with int8 weights: the same layout CTranslate2's
    own converter writes (ctranslate2/converters/transformers.py
    WhisperLoader), without PyTorch."""
    from ctranslate2.converters.utils import fuse_linear
    from ctranslate2.specs import common_spec, whisper_spec

    cfg = json.loads((src / "config.json").read_text(encoding="utf-8"))
    gen = json.loads((src / "generation_config.json").read_text(encoding="utf-8"))
    if (src / "model.safetensors").is_file():
        w = _load_safetensors(src / "model.safetensors")
    else:
        w = _load_pytorch(src / "pytorch_model.bin")
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


# Clips of at most 12 s, for every model. The small fine-tuned ones were
# trained on short utterances (the Sinhala one left out a quarter of the
# words on 28 s clips). Turbo, decoding text without timestamps, often stops
# early in a long clip: on 40 English test sentences it left out 21% of the
# words on 28 s clips (word error rate 26%), 2% on 12 s clips (7%), and Hindi
# and Tamil did best at 12 s too. With the short encoder window (_decode) the
# shorter clips cost no more time.
_CLIP_SECONDS = 12
# The European model reads whole sentences better: French word errors were
# 8.0% on 12 s clips, 7.4% on 30 s (the same as each test clip whole).
_EUROPE_CLIP_SECONDS = 30
_EUROPE_LEVEL = 0.1  # RMS each clip is brought to
_EUROPE_MAX_GAIN = 1000.0
_BATCH = {"general": 4}  # the small models: 8
_SEARCH = 6 * RATE  # look this far back from a clip's end for a quiet spot
_FRAME = RATE // 10  # 100 ms loudness frames
_SILENCE_RMS = 0.004  # clips quieter than this are skipped (Whisper invents text in silence)...
# ...unless they're quiet speech: a peak this loud, well above the clip's own
# background. Some recordings are that quiet (an English test set had
# sentences peaking at 0.0007); skipping them lost a third of the words.
_QUIET_PEAK = 0.0003
_CONTRAST = 8
_LOOP = re.compile(r"(.{1,6}?)\1{5,}")


def _rms(a: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(a, dtype=np.float64)))) if len(a) else 0.0


def _frame_levels(a: np.ndarray) -> np.ndarray:
    """RMS of each 100 ms frame (the last one may be shorter)."""
    if not len(a):
        return np.zeros(0)
    pad = -len(a) % _FRAME
    sq = np.square(np.pad(a, (0, pad)), dtype=np.float64).reshape(-1, _FRAME).sum(1)
    sizes = np.full(len(sq), _FRAME)
    sizes[-1] -= pad
    return np.sqrt(sq / sizes)


def _sound_level(a: np.ndarray) -> float | None:
    """The loudness a frame of `a` needs to count as sound, or None when `a`
    is silence or a steady hum."""
    levels = _frame_levels(a)
    if not len(levels):
        return None
    if _rms(a) >= _SILENCE_RMS:
        return _SILENCE_RMS
    peak = float(levels.max())
    if peak >= _QUIET_PEAK and peak >= _CONTRAST * float(np.percentile(levels, 10)):
        return peak / _CONTRAST
    return None


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
        if _sound_level(audio[start:end]) is not None:
            out.append((start, end))
        start = end
    return out


def drop_loops(words: list[dict]) -> list[dict]:
    """What's left of a decoding stuck in a loop, taken out: words that are
    a short piece repeated over and over or far too long for one word, and
    the same word, or phrase of up to four words, more than three times in a
    row (kept three times). Loops are caught earlier by their compression
    ratio (_words); this is what gets past that."""
    out: list[dict] = []
    for w in words:
        if _LOOP.search(w["text"]) or len(w["text"]) > 40:
            continue
        out.append(w)
        for n in range(1, 5):
            if len(out) >= 4 * n and all(
                out[-1 - i]["text"].lower() == out[-1 - i - k * n]["text"].lower() for i in range(n) for k in (1, 2, 3)
            ):
                del out[-n:]
                break
    return out


# Whisper large-v3-turbo can't recognize Sinhala, and can't tell Kannada or
# Telugu from Tamil: on all of them it guesses Tamil, mostly unsure (0.24-0.42
# averaged over three clips) but not always (0.89 on one Sinhala clip). So a
# guess among these languages, or any unsure guess, is settled by the
# languages' own models: each is far more confident on its own language than
# any other model is. Average log-probability per token, 12 s clips:
# Sinhala model on Sinhala (a test set and a news report) -0.013 and -0.024,
# on Kannada -0.049; Kannada model on Kannada -0.014; Telugu on Telugu
# -0.014; Hindi on Hindi -0.033; Tamil on Tamil -0.047 (turbo is sure of
# Tamil itself). Every other pairing -0.049 or lower.
_LIKE_INDIC = {"ta", "kn", "te", "ml", "gu", "bo", "mr", "bn", "ne", "sa", "th", "hi", "si"}
_SURE = 0.6
_OWN_LOGPROB = -0.035


class LanguageUnclear(Exception):
    """Speech in a language that can't be told apart (see above) without
    the models to check it with."""


def language_scores(model, audio: np.ndarray, clips: list[tuple[int, int]]) -> list[tuple[str, float]]:
    """The general model's language scores, averaged over up to the first
    three clips (fewer when it's sure), best first."""
    scores: dict[str, float] = {}
    for k, (a, b) in enumerate(clips[:3], 1):
        _, _, probs = model.detect_language(audio=audio[a:b])
        for code, p in probs:
            scores[code] = scores.get(code, 0.0) + p
        # A clear answer needs no more clips: each costs an encoder pass.
        if max(scores.values()) / k >= 0.8:
            break
    return sorted(((code, p / k) for code, p in scores.items()), key=lambda kv: -kv[1])


def _confidence(model, audio: np.ndarray, clips: list[tuple[int, int]], language: str) -> float:
    """Average log-probability per token of decoding the clips in `language`."""
    found = [seg.avg_logprob for seg in _decode(model, audio, language, clips, len(clips), words=False)]
    return float(np.mean(found)) if found else -10.0


def detect_language(audio: np.ndarray, clips: list[tuple[int, int]], progress: Progress, gpu: bool) -> str:
    """The language of the speech in `clips`: the general model's guess,
    checked as above with the language models that are downloaded."""
    ranked = language_scores(_whisper(MODELS["general"], progress, gpu), audio, clips)
    language, p = ranked[0]
    if language not in _LIKE_INDIC and p >= _SURE:
        return language
    # Sinhala first (turbo never names it), then by turbo's scores; the
    # first confident one is it - no other model came near that on another
    # language. Each check loads a model and decodes two clips (on a 6-core
    # CPU about 8 s).
    rank = {code: i for i, (code, _) in enumerate(ranked)}
    own = sorted(
        (key for key, model in MODELS.items() if key != "general" and is_ready(model)),
        key=lambda key: (key != "si", rank.get(key, len(rank))),
    )
    for key in own:
        if _confidence(_whisper(MODELS[key], progress, gpu), audio, clips[:2], key) >= _OWN_LOGPROB:
            return key
    if p >= _SURE:
        return language
    if "si" not in own and language in _LIKE_INDIC:
        return "si"  # the likeliest; the editor asks for the Sinhala model, then it's checked
    raise LanguageUnclear(language)


def transcribe(audio: np.ndarray, language: str, progress: Progress, gpu: bool = False, hint: str = "", accurate: bool = False) -> dict:
    """Word-timed transcript of 16 kHz mono float32 `audio`. `language` is
    a Whisper code or "auto" (detected by the general model; Sinhala then
    switches to the Sinhala model, if it's downloaded - else ModelNeeded).
    `gpu`: use the NVIDIA card, downloading its libraries if needed; any
    failure there falls back to the CPU. Returns {language, words: [{start,
    end, text}]}, times in seconds within `audio`. `hint`: names and words
    the speech is likely to contain (given to the general model as its
    prompt, so it spells them that way). `accurate`: beam search instead of
    greedy decoding - fewer wrong words, slower."""
    global _gpu_failed
    use_gpu = gpu and gpu_status()["available"]
    if use_gpu:
        ensure_gpu(progress)
    try:
        return _transcribe(audio, language, progress, use_gpu, hint, accurate)
    except RuntimeError as exc:  # what CTranslate2 raises for CUDA errors
        if not use_gpu:
            raise
        print(f"speech: the graphics card failed, using the CPU: {exc}", file=sys.stderr)
        _gpu_failed = True
        with _load_lock:
            _loaded.clear()
        return _transcribe(audio, language, progress, False, hint, accurate)


def _decode(model, audio: np.ndarray, language: str, clips: list[tuple[int, int]], batch: int, words: bool = True, opts: Optional[dict] = None):
    """The clips' segments (a generator), decoded `batch` at a time, with
    word timings unless `words` is false.

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
    call (transcriptions run one at a time: main.py _speech_lock).
    `opts`: extra decoding options (_decoding)."""
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
            word_timestamps=words,
            without_timestamps=True,
            **{"beam_size": 1, **(opts or {})},
        )
    finally:
        fw.pad_or_trim = full
    return segments


# Beam width for `accurate`: Whisper's own default.
_BEAM = 5
# Longest prompt kept: Whisper takes up to 223 prompt tokens, and a long
# one costs decoding time on every clip.
_MAX_HINT_CHARS = 400


def _decoding(spec: SpeechModel, hint: str, accurate: bool, gpu: bool = False) -> dict:
    """Decoding options for the user's settings. The prompt goes to the
    general model only: the languages' own models were fine-tuned without
    one and may echo it back. On the graphics card the languages' own
    (small) models always use beam search: on a code-mixed Sinhala voice
    note it got the names right where greedy didn't ("නිව්සිලන්වල අනර්කා
    ආයුරේදික්" for New Zealand's Anarka Ayurvedic, not "New seal වල අනර්
    ආයුර් දෙක") in the same time (41 s of audio, GTX 1650: 16.3 s vs
    15.8 s). On the CPU it took 1.7 times as long (31.5 s vs 18.8 s) for
    less gain, so there it's left to `accurate`."""
    opts: dict = {}
    if accurate or (gpu and spec.key != "general"):
        opts["beam_size"] = _BEAM
    hint = " ".join(hint.split())[:_MAX_HINT_CHARS]
    if hint and spec.key == "general":
        opts["initial_prompt"] = hint
    return opts


def _transcribe(audio: np.ndarray, language: str, progress: Progress, gpu: bool, hint: str = "", accurate: bool = False) -> dict:
    total = len(audio) / RATE
    if language == "auto":
        first = speech_clips(audio, _CLIP_SECONDS * RATE)
        if not first:
            return {"language": "en", "words": []}
        progress("transcribe", 0.0)
        language = detect_language(audio, first, progress, gpu)
        # Only the model the user agreed to (the general one, for "auto") is
        # downloaded unasked; a language's own model is asked for first.
        if model_for(language).key != "general" and not is_ready(model_for(language)):
            raise ModelNeeded(language, model_for(language))
    spec = model_for(language)
    clips = speech_clips(audio, (_EUROPE_CLIP_SECONDS if spec is EUROPE else _CLIP_SECONDS) * RATE)
    if not clips:
        return {"language": language, "words": []}
    if spec is EUROPE:
        return {"language": language, "words": _parakeet_words(audio, clips, progress)}
    model = _whisper(spec, progress, gpu)
    progress("transcribe", 0.0)
    batch = _BATCH.get(spec.key, 8)
    opts = _decoding(spec, hint, accurate, gpu)
    looped: list[tuple[int, int]] = []
    words = _words(_decode(model, audio, language, clips, batch, opts=opts), total, lambda t: progress("transcribe", min(0.95, t / total)), looped=looped)
    words += _retry(model, audio, language, looped, total, opts=opts)
    # Greedy decoding sometimes ends a clip early (one of eleven in the
    # 2-minute test: 6 of its 17 words, more often with the short encoder
    # window). Speech left after a clip's last word is decoded again.
    rest = unfinished(audio, clips, words)
    if rest:
        # Only confident words: what's left may be a breath or noise.
        looped = []
        words += _words(_decode(model, audio, language, rest, batch, opts=opts), total, lambda t: None, min_probability=0.4, looped=looped)
        words += _retry(model, audio, language, looped, total, min_probability=0.4, opts=opts)
    words.sort(key=lambda w: w["start"])
    progress("transcribe", 1.0)
    return {"language": language, "words": drop_loops(words)}


def _parakeet(progress: Progress):
    from .parakeet import Parakeet

    with _load_lock:
        hit = _loaded.get(("europe", "cpu"))
        if hit is None:
            path = ensure_model(EUROPE, progress)
            progress("prepare", 0.0)
            _loaded.clear()  # one model in memory at a time
            hit = Parakeet(path, _cpu_threads())
            _loaded[("europe", "cpu")] = hit
        return hit


def _parakeet_words(audio: np.ndarray, clips: list[tuple[int, int]], progress: Progress) -> list[dict]:
    """The words of each clip (speech_clips), by the European model, in
    audio time. It decodes without loops or early stops (a transducer reads
    every frame), so nothing is decoded again."""
    model = _parakeet(progress)
    progress("transcribe", 0.0)
    total = len(audio) / RATE
    words: list[dict] = []
    for a, b in clips:
        clip = audio[a:b]
        level = float(np.sqrt(np.mean(clip**2))) if len(clip) else 0.0
        if level > 0:
            # It drops quiet speech: French test clips turned down to RMS
            # 0.0009 had 21% word errors; brought to 0.1, 6.5% (7.2% as
            # recorded, at about 0.04).
            clip = clip * min(_EUROPE_MAX_GAIN, _EUROPE_LEVEL / level)
        for w in model.words(clip):
            start = max(0.0, a / RATE + w["start"])
            end = min(total, a / RATE + w["end"], start + _max_word_seconds(w["text"]))
            words.append({"start": round(start, 3), "end": round(max(end, start + 0.05), 3), "text": w["text"]})
        progress("transcribe", min(0.95, b / len(audio)))
    progress("transcribe", 1.0)
    return words


# Whisper's own sign of a decoding stuck in a loop: its text compresses
# this much (zlib). Seen on a 5 s English clip: "For example," 75 times.
_LOOP_RATIO = 2.4


def _retry(
    model, audio: np.ndarray, language: str, clips: list[tuple[int, int]], total: float, min_probability: float = 0.0, opts: Optional[dict] = None
) -> list[dict]:
    """Clips whose greedy decoding looped, decoded again one at a time with
    Whisper's fallback: sampling at rising temperatures until the text
    stops looping. What still loops is left out."""
    words = []
    for a, b in clips:
        segments, _ = model.transcribe(
            audio[a:b],
            language=language,
            initial_prompt=(opts or {}).get("initial_prompt"),
            beam_size=1,
            temperature=[0.2, 0.4, 0.6, 0.8],
            compression_ratio_threshold=_LOOP_RATIO,
            condition_on_previous_text=False,
            without_timestamps=True,
            word_timestamps=True,
        )
        for w in _words(segments, total - a / RATE, lambda t: None, min_probability, looped=[]):
            words.append({**w, "start": round(w["start"] + a / RATE, 3), "end": round(w["end"] + a / RATE, 3)})
    return words


def _words(
    segments, total: float, on_time: Callable[[float], None], min_probability: float = 0.0, looped: Optional[list] = None
) -> list[dict]:
    """The segments' words, clamped to the audio. A segment stuck in a loop
    is left out, and its time range added to `looped`."""
    words = []
    for seg in segments:  # a generator: each batch is decoded as it's read
        if seg.compression_ratio > _LOOP_RATIO:
            if looped is not None:
                looped.append((int(seg.start * RATE), int(seg.end * RATE)))
            on_time(seg.end)
            continue
        for wd in seg.words or []:
            # A word cut inside a character (Sinhala "ව�") keeps what's whole.
            text = wd.word.replace("�", "").strip()
            if len(text) < 2 and wd.word.strip() != text:
                continue
            if not text or wd.probability < min_probability:
                continue
            start = max(0.0, float(wd.start))
            end = min(total, float(wd.end), start + _max_word_seconds(text))
            if end <= start:
                end = min(total, start + 0.1)
            words.append({"start": round(start, 3), "end": round(end, 3), "text": text})
        on_time(seg.end)
    return words


# Shorter remainders were mostly a pause and the start of the next sentence,
# which the small fine-tuned models fill with stock phrases: on 30 Kannada
# test sentences re-decoding from 1.5 s took the character error rate from
# 9.7% to 21.7%; from 3 s it's 6.8%, and Sinhala keeps its gain (12.1% to 4.4%).
_MIN_REST = 3 * RATE


def _loud_seconds(a: np.ndarray, level: float) -> float:
    return float(np.count_nonzero(_frame_levels(a) >= level)) * _FRAME / RATE


def unfinished(audio: np.ndarray, clips: list[tuple[int, int]], words: list[dict]) -> list[tuple[int, int]]:
    """The stretches of each clip with no recognized word - after its last
    word, before its first, or between two - when one is at least 3 s long
    with 1 s of sound in it (not just a word's tail before a pause). Greedy
    decoding mostly ends a clip early, but it also skips a sentence in the
    middle or at the start (seen on a code-mixed Sinhala voice note). Clips
    with no words at all are left out: that's sound Whisper didn't take for
    speech (music, noise)."""
    out = []
    for a, b in clips:
        inside = sorted((w["start"], w["end"]) for w in words if a / RATE <= w["start"] < b / RATE)
        if not inside:
            continue
        level = _sound_level(audio[a:b])  # as loud as the clip's own speech
        if level is None:
            continue
        # Gaps: clip start to first word, between words, last word to clip end.
        edges = [(a, int((inside[0][0] - 0.1) * RATE))]
        edges += [(int((e + 0.1) * RATE), int((s - 0.1) * RATE)) for (_, e), (s, _) in zip(inside, inside[1:])]
        edges.append((int((max(e for _, e in inside) + 0.1) * RATE), b))
        for start, end in edges:
            start, end = max(a, start), min(b, end)
            if end - start >= _MIN_REST and _loud_seconds(audio[start:end], level) >= 1.0:
                out.append((start, end))
    return out
