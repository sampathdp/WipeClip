"""Local NSFW image classifier for moderation.screen_frames_local().

Model: Marqo/nsfw-image-detection-384 (Apache-2.0), a timm ViT-Tiny
(patch 16, 384x384 input, 12 blocks, width 192) fine-tuned into two classes,
NSFW and SFW. 22 MB of float32 weights in a .safetensors file.

The forward pass is written out in numpy below rather than run through
torch or onnxruntime: no model conversion step, and the desktop engine
needs no inference runtime. It matches timm's output to within 2e-6
(checked against timm 1.0.30 on video frames, a logo and noise; the
tests pin those scores). Speed: about 0.3-0.6 s per frame on a 12-thread
desktop CPU, several frames in parallel.

Weights are pinned to one Hugging Face revision and verified by SHA-256.
They are found at NSFW_MODEL_PATH if set, else app/models/ (bundled there in
the desktop engine by desktop.spec, downloaded there at Docker build time),
and downloaded into app/models/ on first use otherwise.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image

from app.config import JOB_THREADS

MODEL_REVISION = "0c26ec22111b83f106d72a55f611ec35962bcb65"
MODEL_URL = f"https://huggingface.co/Marqo/nsfw-image-detection-384/resolve/{MODEL_REVISION}/model.safetensors"
MODEL_SHA256 = "6bf2e0f64a1d20169736c2836e3a787b12379fdc08ba87f7d94a7a3d58eeefce"
MODEL_FILE = "nsfw-image-detection-384.safetensors"
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

INPUT_SIZE = 384
PATCH = 16
HEADS = 3
LN_EPS = 1e-6
NSFW_CLASS = 0  # label_names: ["NSFW", "SFW"]


def model_path() -> Path:
    env = os.environ.get("NSFW_MODEL_PATH")
    return Path(env) if env else MODELS_DIR / MODEL_FILE


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_model() -> Path:
    """Path to verified weights, downloading them first if missing.

    Raises:
        RuntimeError: if the file on disk or the download doesn't match
            MODEL_SHA256.
    """
    path = model_path()
    if path.exists():
        if _sha256(path) != MODEL_SHA256:
            raise RuntimeError(f"{path} doesn't match the pinned NSFW model checksum - delete it to re-download")
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".part")
    try:
        with os.fdopen(fd, "wb") as out, urllib.request.urlopen(MODEL_URL, timeout=120) as resp:  # noqa: S310 - fixed https URL
            while chunk := resp.read(1 << 20):
                out.write(chunk)
        if _sha256(Path(tmp)) != MODEL_SHA256:
            raise RuntimeError("Downloaded NSFW model doesn't match the pinned checksum")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return path


def _load_safetensors(path: Path) -> dict[str, np.ndarray]:
    data = path.read_bytes()
    header_len = int.from_bytes(data[:8], "little")
    header = json.loads(data[8 : 8 + header_len])
    base = 8 + header_len
    tensors = {}
    for name, info in header.items():
        if name == "__metadata__":
            continue
        if info["dtype"] != "F32":
            raise ValueError(f"Unexpected dtype {info['dtype']} for {name}")
        start, end = info["data_offsets"]
        tensors[name] = np.frombuffer(data, dtype="<f4", count=(end - start) // 4, offset=base + start).reshape(info["shape"])
    return tensors


@lru_cache(maxsize=1)
def _weights() -> dict[str, np.ndarray]:
    w = _load_safetensors(ensure_model())
    # Pre-transposed for x @ W, and the patch conv as a matrix over
    # flattened (channel, row, column) patches.
    out = {k: v for k, v in w.items()}
    for k, v in w.items():
        if k.endswith(".weight") and v.ndim == 2:
            out[k] = np.ascontiguousarray(v.T)
    out["patch_embed.proj.weight"] = np.ascontiguousarray(w["patch_embed.proj.weight"].reshape(w["patch_embed.proj.weight"].shape[0], -1).T)
    out["depth"] = np.array(1 + max(int(k.split(".")[1]) for k in w if k.startswith("blocks.")))
    return out


def preprocess(bgr: np.ndarray) -> np.ndarray:
    """timm's eval transform for this model: shorter side to 384 (PIL
    bicubic, as timm uses - OpenCV's bicubic doesn't antialias and shifts
    scores by several points), center crop 384, RGB, (x - 0.5) / 0.5.
    Returns CHW float32."""
    h, w = bgr.shape[:2]
    scale = INPUT_SIZE / min(h, w)
    nh, nw = max(INPUT_SIZE, int(h * scale)), max(INPUT_SIZE, int(w * scale))
    resized = Image.fromarray(np.ascontiguousarray(bgr[..., ::-1])).resize((nw, nh), Image.Resampling.BICUBIC)
    top, left = round((nh - INPUT_SIZE) / 2), round((nw - INPUT_SIZE) / 2)
    crop = np.asarray(resized)[top : top + INPUT_SIZE, left : left + INPUT_SIZE]
    x = crop.astype(np.float32) / 255.0
    return ((x - 0.5) / 0.5).transpose(2, 0, 1)


def _layer_norm(x: np.ndarray, w: np.ndarray, b: np.ndarray) -> np.ndarray:
    mean = x.mean(-1, keepdims=True)
    var = x.var(-1, keepdims=True)
    return (x - mean) / np.sqrt(var + LN_EPS) * w + b


def _erf(x: np.ndarray) -> np.ndarray:
    # Abramowitz-Stegun 7.1.26 (max error 1.5e-7): numpy has no erf, and
    # timm's GELU is the exact (erf) form, not the tanh approximation.
    # In place on two buffers - this runs on 2M+ values per block and the
    # temporaries of the plain expression cost more than the arithmetic.
    a = np.abs(x)
    t = np.multiply(a, 0.3275911)
    t += 1.0
    np.reciprocal(t, out=t)
    poly = np.multiply(t, 1.061405429)
    for c in (-1.453152027, 1.421413741, -0.284496736, 0.254829592):
        poly += c
        poly *= t
    np.square(a, out=a)
    np.negative(a, out=a)
    np.exp(a, out=a)
    poly *= a
    np.subtract(1.0, poly, out=poly)
    return np.copysign(poly, x, out=poly)


def _gelu(x: np.ndarray) -> np.ndarray:
    y = _erf(x * (1.0 / math.sqrt(2.0)))
    y += 1.0
    y *= x
    y *= 0.5
    return y


def _softmax(x: np.ndarray) -> np.ndarray:
    x = x - x.max(-1, keepdims=True)
    np.exp(x, out=x)
    x /= x.sum(-1, keepdims=True)
    return x


def _linear(x: np.ndarray, w: np.ndarray, b: np.ndarray) -> np.ndarray:
    # As one 2-D product: numpy hands that to BLAS in a single call.
    return (x.reshape(-1, x.shape[-1]) @ w + b).reshape(*x.shape[:-1], w.shape[1])


def nsfw_probabilities(frames: list[np.ndarray]) -> list[float]:
    """NSFW probability (0..1) for each BGR uint8 frame.

    One frame per thread: numpy's element-wise steps (GELU, softmax) run on
    a single core but release the GIL, so frames in parallel finish about
    twice as fast as one batch."""
    if not frames:
        return []
    w = _weights()
    if len(frames) == 1:
        return [_forward(w, frames[0])]
    with ThreadPoolExecutor(max_workers=min(len(frames), JOB_THREADS)) as pool:
        return list(pool.map(lambda f: _forward(w, f), frames))


def _forward(w: dict[str, np.ndarray], frame: np.ndarray) -> float:
    x = preprocess(frame)[None]  # (1, 3, 384, 384)
    n, c = x.shape[:2]
    g = INPUT_SIZE // PATCH
    patches = x.reshape(n, c, g, PATCH, g, PATCH).transpose(0, 2, 4, 1, 3, 5).reshape(n, g * g, c * PATCH * PATCH)
    t = _linear(patches, w["patch_embed.proj.weight"], w["patch_embed.proj.bias"])
    t = np.concatenate([np.broadcast_to(w["cls_token"], (n, 1, t.shape[-1])), t], axis=1) + w["pos_embed"]
    tokens, dim = t.shape[1], t.shape[2]
    head_dim = dim // HEADS
    # Python floats: a numpy float64 scalar would promote every product to float64.
    scale = 1.0 / math.sqrt(head_dim)
    for i in range(int(w["depth"])):
        p = f"blocks.{i}."
        h = _layer_norm(t, w[p + "norm1.weight"], w[p + "norm1.bias"])
        qkv = _linear(h, w[p + "attn.qkv.weight"], w[p + "attn.qkv.bias"]).reshape(n, tokens, 3, HEADS, head_dim).transpose(2, 0, 3, 1, 4)
        q, k, v = qkv[0], qkv[1], qkv[2]
        attn = _softmax((q * scale) @ k.transpose(0, 1, 3, 2))
        h = (attn @ v).transpose(0, 2, 1, 3).reshape(n, tokens, dim)
        t = t + _linear(h, w[p + "attn.proj.weight"], w[p + "attn.proj.bias"])
        h = _layer_norm(t, w[p + "norm2.weight"], w[p + "norm2.bias"])
        h = _gelu(_linear(h, w[p + "mlp.fc1.weight"], w[p + "mlp.fc1.bias"]))
        t = t + _linear(h, w[p + "mlp.fc2.weight"], w[p + "mlp.fc2.bias"])
    cls = _layer_norm(t[:, 0], w["norm.weight"], w["norm.bias"])
    logits = cls @ w["head.weight"] + w["head.bias"]
    return float(_softmax(logits)[0, NSFW_CLASS])


if __name__ == "__main__":
    # Build steps call this to fetch the weights ahead of time.
    print(ensure_model())
