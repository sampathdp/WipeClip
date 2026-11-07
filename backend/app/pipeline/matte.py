"""Webcam background removal for the desktop app, without a green screen.

A webcam video is turned once into a *matted* video: each frame's picture on
the left half and the person's mask (white = person) on the right half, the
same size, in one H.264 file. The editor's preview and the export both read
that one file (src/lib/editor/matte.ts, editor.py _matte_head), so they show
the same frames with the same mask: picture and mask can't drift apart, and
nothing about the background is worked out twice. The file is a derived
cache, kept outside the project (WIPECLIP_MATTE_DIR) and made again when it's
missing.

The model is Google's MediaPipe selfie segmenter (Apache-2.0; landscape 256x144
and square 256x256, about 250 KB each), run by OpenCV's DNN module, which the
engine already ships: no new runtime. On an i7-9750H it takes about 12.5 ms a
frame (landscape) on the CPU. Its mask is coarse (256x144), so it's refined
here: smoothed over time where the picture holds still (less shimmer, no
trails on movement), then fitted to the frame's own edges with a guided filter
(hair and shoulders follow the picture, not the model's blocks).

Nothing leaves the machine. The model files are bundled with the engine
(desktop.spec, fetched by `python -m app.pipeline.matte`), or downloaded once
from Google's model storage and checked against pinned SHA-256 sums.
"""

from __future__ import annotations

import hashlib
import os
import queue
from collections import deque
import subprocess
import tempfile
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from app.pipeline import speech
from app.pipeline.video import get_ffmpeg_path

# Bump when the matted file's contents change (model, refinement, layout):
# cached files of an older version are then made again.
PIPELINE_VERSION = 2

_STORE = "https://storage.googleapis.com/mediapipe-models/image_segmenter"


@dataclass(frozen=True)
class SegModel:
    file: str
    url: str
    sha256: str
    size: tuple[int, int]  # model input, (width, height)


LANDSCAPE = SegModel(
    "selfie_segmenter_landscape.tflite",
    f"{_STORE}/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite",
    "490e9ea734313e0de10fa0cd9e3c6133e36ea4db2b7a49bde9ef019f72796b8e",
    (256, 144),
)
SQUARE = SegModel(
    "selfie_segmenter.tflite",
    f"{_STORE}/selfie_segmenter/float16/1/selfie_segmenter.tflite",
    "191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b",
    (256, 256),
)
MODELS = (LANDSCAPE, SQUARE)

BUNDLED_DIR = Path(__file__).resolve().parent.parent / "models"

# The matted file's half width at most: webcam layers are rarely shown wider
# than this, and every pixel costs refinement and encoding time.
MAX_WIDTH = 1280
# The guided filter runs at most this wide; the result is scaled up.
GUIDE_WIDTH = 640
# Old matted files are removed past this total (oldest first).
CACHE_LIMIT_BYTES = 8 * 1024**3
# Frames segmented at once (see _render).
MODEL_THREADS = max(1, min(3, (os.cpu_count() or 2) // 2))

Progress = Callable[[str, float], None]  # (stage, 0..1); raises to cancel


# --- model files ------------------------------------------------------------


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _download(model: SegModel, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=dest.parent, suffix=".part")
    try:
        req = urllib.request.Request(model.url, headers={"User-Agent": "WipeClip-desktop"})
        with os.fdopen(fd, "wb") as out, urllib.request.urlopen(req, timeout=60) as res:  # noqa: S310 - fixed https URL
            while chunk := res.read(1 << 16):
                out.write(chunk)
        if _sha256(Path(tmp)) != model.sha256:
            raise OSError(f"{model.file} didn't match its pinned checksum")
        os.replace(tmp, dest)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def model_file(model: SegModel, fetch: bool = True) -> Path:
    """The verified model file: bundled with the engine, else downloaded
    once into the app's models folder. A file that doesn't match its pinned
    checksum is never used."""
    bundled = BUNDLED_DIR / model.file
    if bundled.is_file() and _sha256(bundled) == model.sha256:
        return bundled
    local = speech.models_dir() / "matte" / model.file
    if local.is_file() and _sha256(local) == model.sha256:
        return local
    if not fetch:
        raise FileNotFoundError(model.file)
    _download(model, local)
    return local


def models_ready() -> bool:
    try:
        for m in MODELS:
            model_file(m, fetch=False)
        return True
    except FileNotFoundError:
        return False


_nets = threading.local()


def _net(model: SegModel) -> cv2.dnn.Net:
    """Loaded once per thread and reused (a Net isn't safe to share between
    threads; frames are segmented on a few threads at once)."""
    cache = getattr(_nets, "by_file", None)
    if cache is None:
        cache = _nets.by_file = {}
    net = cache.get(model.file)
    if net is None:
        net = cache[model.file] = cv2.dnn.readNetFromTFLite(str(model_file(model)))
    return net


def model_for(width: int, height: int) -> SegModel:
    """Landscape model for wide frames, square for the rest (portrait frames
    are squeezed into it less than into the landscape one)."""
    return LANDSCAPE if width >= 1.3 * height else SQUARE


# --- segmentation -----------------------------------------------------------


def raw_mask(model: SegModel, frame: np.ndarray) -> np.ndarray:
    """The model's own mask for a BGR frame: float32 0..1 at its input size.
    Independent per frame, so it runs on several threads at once."""
    mw, mh = model.size
    x = cv2.resize(frame, (mw, mh), interpolation=cv2.INTER_AREA)
    x = cv2.cvtColor(x, cv2.COLOR_BGR2RGB).astype(np.float32) * (1 / 255)
    net = _net(model)
    net.setInput(np.ascontiguousarray(x.transpose(2, 0, 1)[None]))
    out = net.forward()
    return np.clip(out.reshape(mh, mw), 0, 1).astype(np.float32)


class Segmenter:
    """A person mask per frame, for consecutive frames of one video. Keeps
    the previous frame's mask for temporal smoothing."""

    def __init__(self, width: int, height: int, fine: bool = True):
        self.model = model_for(width, height)
        # Fine: a color guide (better hair, slower); else a gray one.
        self.fine = fine
        self.width, self.height = width, height
        gw = min(width, GUIDE_WIDTH)
        self.guide_size = (gw, max(2, round(height * gw / width)))
        # Guided filter: solved at a quarter of the guide size, applied at
        # the guide size (He & Sun's fast guided filter). A window of about
        # 2.5% of the frame follows hair and shoulders; eps keeps flat areas flat.
        sw = max(16, gw // 2)
        self.solve_size = (sw, max(2, round(height * sw / width)))
        self.box = (2 * max(1, round(sw / 80)) + 1,) * 2
        self.eps = 1e-3
        self.prev: np.ndarray | None = None

    def raw(self, frame: np.ndarray) -> np.ndarray:
        return raw_mask(self.model, frame)

    def smooth(self, cur: np.ndarray) -> np.ndarray:
        """Temporal smoothing that follows movement: where the mask changes a
        lot (something moved) the new frame wins at once, so there's no
        trail; where it barely changes (the model's flicker) frames are
        averaged."""
        if self.prev is None:
            self.prev = cur
            return cur
        follow = np.clip(0.35 + 2.5 * np.abs(cur - self.prev), 0, 1)
        out = self.prev + follow * (cur - self.prev)
        self.prev = out
        return out

    def refine(self, frame: np.ndarray, coarse: np.ndarray) -> np.ndarray:
        """The coarse mask fitted to the frame's own edges, at frame size, uint8."""
        return self._refine_color(frame, coarse) if self.fine else self._refine_gray(frame, coarse)

    def _refine_gray(self, frame: np.ndarray, coarse: np.ndarray) -> np.ndarray:
        """Faster: the fast guided filter with a gray guide (about 28 fps
        overall at 720p on an i7-9750H, against 21 with the color guide)."""
        gw, gh = self.guide_size
        sw, sh = self.solve_size
        k = self.box
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if (gw, gh) != (self.width, self.height):
            gray = cv2.resize(gray, (gw, gh), interpolation=cv2.INTER_AREA)
        g = cv2.resize(gray, (sw, sh), interpolation=cv2.INTER_AREA).astype(np.float32) * (1 / 255)
        p = cv2.resize(coarse, (sw, sh), interpolation=cv2.INTER_LINEAR)
        mean_g, mean_p = cv2.blur(g, k), cv2.blur(p, k)
        var_g = cv2.blur(g * g, k) - mean_g * mean_g
        a = (cv2.blur(g * p, k) - mean_g * mean_p) / (var_g + 2e-3)
        b = mean_p - a * mean_g
        a = cv2.resize(cv2.blur(a, k), (gw, gh), interpolation=cv2.INTER_LINEAR)
        b = cv2.resize(cv2.blur(b, k), (gw, gh), interpolation=cv2.INTER_LINEAR)
        return self._blend(p, a * (gray.astype(np.float32) * (1 / 255)) + b)

    def _blend(self, p: np.ndarray, fitted: np.ndarray) -> np.ndarray:
        """The fitted mask only along the outline: where the model is sure
        (inside the body, far background) its own mask stays, so a dark shirt
        or a bright wall can't turn see-through through the guide's texture."""
        gw, gh = self.guide_size
        base = cv2.resize(p, (gw, gh), interpolation=cv2.INTER_LINEAR)
        band = np.clip(base * (1 - base) * 6, 0, 1)
        q = cv2.convertScaleAbs(base + band * (fitted - base), alpha=255)
        if (gw, gh) != (self.width, self.height):
            q = cv2.resize(q, (self.width, self.height), interpolation=cv2.INTER_LINEAR)
        return q

    def _refine_color(self, frame: np.ndarray, coarse: np.ndarray) -> np.ndarray:
        """Fits the coarse mask to the frame's own edges and returns it at
        frame size, uint8: He & Sun's fast guided filter with a color guide
        (solved at half the guide size, applied at the guide size). A color
        guide separates hair from a wall of the same brightness, which a gray
        one can't. Per frame and independent, so it runs on several threads."""
        gw, gh = self.guide_size
        sw, sh = self.solve_size
        k = self.box
        full = frame if (gw, gh) == (self.width, self.height) else cv2.resize(frame, (gw, gh), interpolation=cv2.INTER_AREA)
        guide = cv2.resize(full, (sw, sh), interpolation=cv2.INTER_AREA).astype(np.float32) * (1 / 255)
        p = cv2.resize(coarse, (sw, sh), interpolation=cv2.INTER_LINEAR)
        b, g, r = cv2.split(guide)

        def mean(x: np.ndarray) -> np.ndarray:
            return cv2.blur(x, k)

        mb, mg, mr, mp = mean(b), mean(g), mean(r), mean(p)
        eps = self.eps
        # Covariance of the guide's colors in each window (symmetric 3x3),
        # and of each color with the mask.
        vbb = mean(b * b) - mb * mb + eps
        vbg = mean(b * g) - mb * mg
        vbr = mean(b * r) - mb * mr
        vgg = mean(g * g) - mg * mg + eps
        vgr = mean(g * r) - mg * mr
        vrr = mean(r * r) - mr * mr + eps
        cb, cg, cr = mean(b * p) - mb * mp, mean(g * p) - mg * mp, mean(r * p) - mr * mp
        # a = inverse(covariance) x (color, mask) covariance, per pixel.
        i00, i01, i02 = vgg * vrr - vgr * vgr, vbr * vgr - vbg * vrr, vbg * vgr - vbr * vgg
        i11, i12, i22 = vbb * vrr - vbr * vbr, vbr * vbg - vbb * vgr, vbb * vgg - vbg * vbg
        det = vbb * i00 + vbg * i01 + vbr * i02
        ab = (i00 * cb + i01 * cg + i02 * cr) / det
        ag = (i01 * cb + i11 * cg + i12 * cr) / det
        ar = (i02 * cb + i12 * cg + i22 * cr) / det
        bias = mp - ab * mb - ag * mg - ar * mr

        def up(x: np.ndarray) -> np.ndarray:
            return cv2.resize(mean(x), (gw, gh), interpolation=cv2.INTER_LINEAR)

        f = full.astype(np.float32) * (1 / 255)
        fitted = up(ab) * f[..., 0] + up(ag) * f[..., 1] + up(ar) * f[..., 2] + up(bias)
        return self._blend(p, fitted)

    def mask(self, frame: np.ndarray) -> np.ndarray:
        return self.refine(frame, self.smooth(self.raw(frame)))


# --- the matted file ----------------------------------------------------------


def cache_dir() -> Path:
    raw = os.environ.get("WIPECLIP_MATTE_DIR")
    return Path(raw) if raw else speech.models_dir().parent / "matte-cache"


def cached_path(src: str, fine: bool = True) -> Path:
    """Where `src`'s matted file goes: named by the file, its size and
    modification time and PIPELINE_VERSION, so an edited or replaced video
    (or a new pipeline) gets a new one. The name says nothing about the
    video (no path or file name in it)."""
    st = os.stat(src)
    key = f"{PIPELINE_VERSION}|{os.path.abspath(src)}|{st.st_size}|{st.st_mtime_ns}|{'fine' if fine else 'fast'}"
    return cache_dir() / f"{hashlib.sha256(key.encode()).hexdigest()[:32]}.mp4"


def matte_size(width: int, height: int) -> tuple[int, int]:
    """Width and half height of the matted file (picture on top, mask below):
    at most MAX_WIDTH wide, both multiples of 16 so compression blocks never
    straddle picture and mask. The aspect ratio can be off by a few pixels;
    the editor and export size the layer from the source, not this file."""
    scale = min(1.0, MAX_WIDTH / max(1, width))
    w = max(16, round(width * scale / 16) * 16)
    h = max(16, round(height * w / max(1, width) / 16) * 16)
    return w, h


# Videos the editor holds in memory (not on disk) are handed over once and
# kept here, named by a key the editor makes, so the engine can read them.
SOURCES = "sources"
_KEY_CHARS = set("0123456789abcdef")


def _valid_key(key: str) -> bool:
    return 16 <= len(key) <= 64 and set(key) <= _KEY_CHARS


def stored_source(key: str) -> Path | None:
    """The stored copy of an in-memory video, if the engine has it."""
    if not _valid_key(key):
        raise ValueError("invalid key")
    for p in (cache_dir() / SOURCES).glob(f"{key}.*"):
        # Not touched: its modification time is part of its matted file's
        # cache key (cached_path).
        if not p.name.endswith(".part"):
            return p
    return None


def store_source(key: str, suffix: str, read: Callable[[int], bytes]) -> Path:
    """Writes an in-memory video handed over by the editor (`read(n)` gives
    its next bytes, b"" at the end) under `key`, and returns its path."""
    if not _valid_key(key) or not suffix.startswith(".") or not suffix[1:].isalnum():
        raise ValueError("invalid key or suffix")
    folder = cache_dir() / SOURCES
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"{key}{suffix.lower()}"
    part = dest.with_name(dest.name + ".part")
    try:
        with open(part, "wb") as out:
            while chunk := read(1 << 20):
                out.write(chunk)
        os.replace(part, dest)
    finally:
        part.unlink(missing_ok=True)
    return dest


def _cached_files() -> list[Path]:
    root = cache_dir()
    return [p for p in [*root.glob("*.mp4"), *(root / SOURCES).glob("*")] if p.is_file() and not p.name.endswith(".part")]


def _evict(*keep: Path) -> None:
    """Removes the least recently used matted files and stored videos past
    CACHE_LIMIT_BYTES, never the ones in `keep`."""
    try:
        files = sorted((p for p in _cached_files() if p not in keep), key=lambda p: p.stat().st_mtime)
        total = sum(p.stat().st_size for p in files) + sum(p.stat().st_size for p in keep if p.is_file())
        for p in files:
            if total <= CACHE_LIMIT_BYTES:
                break
            total -= p.stat().st_size
            p.unlink(missing_ok=True)
    except OSError:
        pass


def clear_cache() -> int:
    """Removes every matted file and stored video; returns the bytes freed."""
    freed = 0
    for p in _cached_files():
        try:
            freed += p.stat().st_size
            p.unlink()
        except OSError:
            pass
    return freed


_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_render_lock = threading.Lock()


def render(src: str, width: int, height: int, fps: float, duration: float, progress: Progress, fine: bool = True) -> Path:
    """`src`'s matted file, made first if it isn't cached. `width`/`height`
    are its display size and `fps`/`duration` its rate and length (probe_media).
    Frames are decoded, segmented and encoded in three overlapping stages.

    Raises whatever `progress` raises to cancel (the partial file is removed),
    and RuntimeError if ffmpeg fails."""
    out = cached_path(src, fine)
    if out.is_file():
        os.utime(out)  # recently used: evicted last
        return out
    with _render_lock:
        if out.is_file():
            return out
        progress("prepare", 0.0)
        for m in MODELS:
            model_file(m)
        out.parent.mkdir(parents=True, exist_ok=True)
        _render(src, out, width, height, fps, duration, progress, fine)
        _evict(out, Path(src))
        return out


def _render(src: str, out: Path, width: int, height: int, fps: float, duration: float, progress: Progress, fine: bool = True) -> None:
    w, h = matte_size(width, height)
    rate = fps if 1 <= fps <= 120 else 30.0
    total = max(1, round(duration * rate))
    ffmpeg = get_ffmpeg_path()
    part = out.with_name(out.name + ".part")
    dec = subprocess.Popen(
        [ffmpeg, "-v", "error", "-i", src, "-map", "0:v:0", "-an", "-sn",
         "-vf", f"scale={w}:{h}:flags=area,format=bgr24", "-fps_mode", "cfr", "-r", f"{rate:.6f}",
         "-f", "rawvideo", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=_FLAGS,
    )  # fmt: skip
    enc = subprocess.Popen(
        [ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{2 * h}", "-r", f"{rate:.6f}",
         "-i", "pipe:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
         "-color_range", "tv", "-movflags", "+faststart", "-f", "mp4", str(part)],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=_FLAGS,
    )  # fmt: skip
    frame_bytes = w * h * 3
    frames: queue.Queue = queue.Queue(maxsize=8)
    outgoing: queue.Queue = queue.Queue(maxsize=8)
    errors: list[BaseException] = []

    def read() -> None:
        # Frames go to the model threads as soon as they're decoded; the
        # futures come back in order.
        try:
            while True:
                buf = dec.stdout.read(frame_bytes)  # type: ignore[union-attr]
                if len(buf) < frame_bytes:
                    break
                frame = np.frombuffer(buf, np.uint8).reshape(h, w, 3)
                frames.put((buf, frame, pool.submit(raw_mask, seg.model, frame)))
        except BaseException as exc:  # noqa: BLE001 - handed to the main thread
            errors.append(exc)
        finally:
            frames.put(None)

    def write() -> None:
        try:
            while (item := outgoing.get()) is not None:
                for part_bytes in item:
                    enc.stdin.write(part_bytes)  # type: ignore[union-attr]
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)
            while outgoing.get() is not None:  # drain so the producer never blocks
                pass

    seg = Segmenter(w, h, fine)

    def pack(buf: bytes, frame: np.ndarray, coarse: np.ndarray) -> tuple[bytes, bytes]:
        # Picture on top, mask below: the decoded bytes as they came, then
        # the mask as gray.
        return buf, cv2.cvtColor(seg.refine(frame, coarse), cv2.COLOR_GRAY2BGR).tobytes()

    # The model and the edge fitting take most of the time and are
    # independent per frame, so each runs on a few threads at once (OpenCV
    # releases the GIL); only the temporal smoothing goes in order, here.
    pool = ThreadPoolExecutor(max_workers=MODEL_THREADS)
    refiners = ThreadPoolExecutor(max_workers=MODEL_THREADS)
    reader = threading.Thread(target=read, daemon=True)
    writer = threading.Thread(target=write, daemon=True)
    reader.start()
    writer.start()
    done = 0
    ok = False
    try:
        last = 0.0
        packed: deque = deque()

        def flush(keep: int) -> None:
            nonlocal done, last
            while len(packed) > keep:
                outgoing.put(packed.popleft().result())
                done += 1
                now = time.monotonic()
                if now - last > 0.2:
                    last = now
                    progress("matte", min(1.0, done / total))

        while (item := frames.get()) is not None:
            buf, frame, coarse = item
            packed.append(refiners.submit(pack, buf, frame, seg.smooth(coarse.result())))
            flush(MODEL_THREADS * 2)
            if errors:
                raise errors[0]
        flush(0)
        outgoing.put(None)
        writer.join()
        enc.stdin.close()  # type: ignore[union-attr]
        if enc.wait() != 0 or done == 0 or errors:
            detail = enc.stderr.read().decode(errors="replace")[-400:]  # type: ignore[union-attr]
            raise RuntimeError(f"Background removal couldn't write its video. {detail}".strip())
        dec.wait()
        os.replace(part, out)
        ok = True
        progress("matte", 1.0)
    finally:
        if not ok:
            for p in (dec, enc):
                if p.poll() is None:
                    p.kill()
            # Unblock the threads so they end.
            try:
                while True:
                    frames.get_nowait()
            except queue.Empty:
                pass
            outgoing.put(None)
            for p in (dec, enc):
                p.wait()
            part.unlink(missing_ok=True)
        pool.shutdown(wait=not ok, cancel_futures=True)
        refiners.shutdown(wait=not ok, cancel_futures=True)


if __name__ == "__main__":
    # Build step (desktop.yml): puts the verified model files next to the
    # engine's code so desktop.spec bundles them.
    for m in MODELS:
        dest = BUNDLED_DIR / m.file
        if not (dest.is_file() and _sha256(dest) == m.sha256):
            _download(m, dest)
        print(f"{dest} ok")
