"""Video region reconstruction via ffmpeg (+ OpenCV for the inpainting).

Unlike the image pipeline (which works on decoded pixel arrays throughout),
most of this module keeps video out-of-process: OpenCV reads a probe frame
+ metadata, ffmpeg does the actual re-encode. Frame-by-frame decode/
process/encode in Python doesn't scale to minutes-long video, so ffmpeg
does every pass it can natively.

reconstruct_region() is the exception: reconstructing the covered region
well enough (see REGION_FSR_* in config.py) needs OpenCV-contrib's
exemplar-based FSR inpainting run per-frame, which ffmpeg has no
equivalent for. That part does pay the frame-by-frame Python cost -
measured at roughly 6.5x realtime end-to-end - which is real but still a
deliberate choice, not an oversight: cheaper reconstruction methods were
tried first and visibly smeared or blurred, which is exactly the defect
this exists to avoid. "Far too slow" would describe doing this for
everything, not for one small region on one video endpoint.

The region is always marked by the user on their own footage; nothing is
detected or applied automatically.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import tempfile
from collections import deque
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass

import cv2
import imageio_ffmpeg
import numpy as np

from app.config import (
    JOB_THREADS,
    VIDEO_ENCODE_CRF,
    VIDEO_ENCODE_PRESET,
    REGION_FLOW_CONTEXT_PAD_PX,
    REGION_FLOW_ESTIMATION_SCALE,
    REGION_FLOW_MIN_RECOVERABLE,
    REGION_FLOW_PROBE_SAMPLES,
    REGION_FLOW_SEARCH_RADIUS_FRAMES,
    REGION_FSR_CONTEXT_PAD_PX,
    REGION_FSR_SCALE,
    REGION_INPAINT_FSR_MAX_REGION_PX,
    REGION_PATCH_SHARPEN_AMOUNT,
    REGION_PATCH_SHARPEN_KSIZE,
    REGION_REUSE_MAX_MEAN_DIFF,
)


def get_ffmpeg_path() -> str:
    """Prefer a system-installed ffmpeg (if the deployment environment has
    one on PATH) and fall back to the static binary bundled by
    imageio-ffmpeg, so this works out of the box with no OS-level install.
    """
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return system_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


# OpenCV's own thread pool (FSR/Telea inpainting, optical flow) - same per-job
# share as ffmpeg gets, see JOB_THREADS.
cv2.setNumThreads(JOB_THREADS)


@dataclass
class VideoInfo:
    width: int
    height: int
    duration: float
    fps: float


def probe_video(path: str) -> tuple[VideoInfo, bytes]:
    """Reads basic metadata and a representative preview frame (PNG bytes)
    from the video at `path`, via OpenCV rather than ffprobe (which isn't
    bundled by imageio-ffmpeg) - cv2.VideoCapture already covers everything
    needed here.

    Raises:
        ValueError: if the file can't be opened as a video, or has no
            readable frames.
    """
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        cap.release()
        raise ValueError("Could not open this file as a video")

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = float(cap.get(cv2.CAP_PROP_FPS)) or 0.0
    frame_count = float(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = frame_count / fps if fps > 0 else 0.0

    # A frame a second or so in tends to be more representative than frame 0
    # (which is sometimes a black/fade-in frame), while staying cheap to seek to.
    if fps > 0 and duration > 1:
        cap.set(cv2.CAP_PROP_POS_FRAMES, min(fps, frame_count - 1))
    ok, frame = cap.read()
    if not ok:
        # Fall back to the very first frame if seeking failed for any reason.
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ok, frame = cap.read()
    cap.release()

    if not ok or frame is None:
        raise ValueError("Could not read any frames from this video")

    ok, png = cv2.imencode(".png", frame)
    if not ok:
        raise ValueError("Could not encode preview frame")

    if width <= 0 or height <= 0:
        height, width = frame.shape[:2]

    return VideoInfo(width=width, height=height, duration=duration, fps=fps), png.tobytes()


def sample_frames(path: str, count: int) -> list[np.ndarray]:
    """Reads up to `count` frames evenly spaced across the video, for content
    screening rather than display - unlike probe_video's single "most
    representative" frame, this needs to catch content that only appears
    partway through the clip.

    Raises:
        ValueError: if the file can't be opened, or no frames were read.
    """
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        cap.release()
        raise ValueError("Could not open this file as a video")

    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if frame_count <= 0:
        # Frame count metadata is sometimes unreliable (e.g. some webm/vp9
        # files); fall back to reading sequentially from the start.
        frames = []
        while len(frames) < count:
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(frame)
        cap.release()
        if not frames:
            raise ValueError("Could not read any frames from this video")
        return frames

    indices = sorted(set(int(frame_count * i / count) for i in range(count)))
    frames = []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, min(idx, frame_count - 1))
        ok, frame = cap.read()
        if ok and frame is not None:
            frames.append(frame)
    cap.release()

    if not frames:
        raise ValueError("Could not read any frames from this video")
    return frames


async def _run_ffmpeg(args: list[str]) -> None:
    # Deliberately NOT asyncio.create_subprocess_exec: on Windows that
    # requires the ProactorEventLoop, and uvicorn's --reload supervisor
    # ends up running the worker under SelectorEventLoop instead (its own
    # event loop is already created, via multiprocessing.spawn, before our
    # app module - and therefore any event-loop-policy fix we could set at
    # import time - ever runs). create_subprocess_exec then raises a bare
    # NotImplementedError, which is a RuntimeError subclass with an empty
    # message, so it silently read as a content-free 500. A plain blocking
    # subprocess.run() off the event loop thread (via asyncio.to_thread)
    # doesn't touch asyncio's subprocess transport at all, so it works
    # identically regardless of which loop implementation is active.
    ffmpeg = get_ffmpeg_path()
    # Every caller ends its args with the output path; -threads must sit
    # right before it to reach the encoder.
    n = str(JOB_THREADS)
    args = ["-filter_complex_threads", n, "-filter_threads", n, *args[:-1], "-threads", n, args[-1]]

    def _run() -> subprocess.CompletedProcess:
        return subprocess.run([ffmpeg, *args], capture_output=True)

    proc = await asyncio.to_thread(_run)
    if proc.returncode != 0:
        # ffmpeg's stderr is verbose; keep the tail, which is where the
        # actual error message almost always ends up.
        tail = proc.stderr.decode(errors="replace")[-2000:]
        raise RuntimeError(f"ffmpeg failed (exit {proc.returncode}): {tail}")


def _fsr_inpaint_region(frame: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
    """Reconstructs frame[y:y+h, x:x+w] with xphoto's FSR inpainting,
    restricted to a small padded crop around the region (all the context
    it actually needs - see REGION_FSR_CONTEXT_PAD_PX) and run at a
    reduced working resolution (REGION_FSR_SCALE) for speed, then
    upscaled back for the composite. Only the exact (x, y, w, h) pixels in
    the returned frame differ from the input - everything else, including
    the rest of the padded crop, is untouched.

    FSR cost climbs steeply with region area; _inpaint_region() sends a box
    past REGION_INPAINT_FSR_MAX_REGION_PX to _telea_inpaint_region()
    instead, so this only ever runs on small regions.
    """
    fh, fw = frame.shape[:2]
    cx0 = max(0, x - REGION_FSR_CONTEXT_PAD_PX)
    cy0 = max(0, y - REGION_FSR_CONTEXT_PAD_PX)
    cx1 = min(fw, x + w + REGION_FSR_CONTEXT_PAD_PX)
    cy1 = min(fh, y + h + REGION_FSR_CONTEXT_PAD_PX)
    crop = frame[cy0:cy1, cx0:cx1]

    # xphoto's mask convention is inverted from cv2.inpaint's: non-zero
    # means "keep as-is", zero means "reconstruct this".
    mask = np.full(crop.shape[:2], 255, np.uint8)
    mask[y - cy0 : y - cy0 + h, x - cx0 : x - cx0 + w] = 0

    small = cv2.resize(crop, None, fx=REGION_FSR_SCALE, fy=REGION_FSR_SCALE, interpolation=cv2.INTER_AREA)
    small_mask = cv2.resize(mask, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
    reconstructed_small = np.zeros_like(small)
    cv2.xphoto.inpaint(small, small_mask, reconstructed_small, cv2.xphoto.INPAINT_FSR_FAST)
    reconstructed = cv2.resize(
        reconstructed_small, (crop.shape[1], crop.shape[0]), interpolation=cv2.INTER_CUBIC
    )

    out = frame.copy()
    out[y : y + h, x : x + w] = reconstructed[y - cy0 : y - cy0 + h, x - cx0 : x - cx0 + w]
    return out


def _telea_inpaint_region(frame: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
    """Diffusion (Telea) fill for the region, on the same padded crop as
    _fsr_inpaint_region. Softer than FSR but near-instant - used only for
    boxes too large for FSR to finish in reasonable time or to fill any
    sharper (see _inpaint_region / REGION_INPAINT_FSR_MAX_REGION_PX).
    Same contract: only the (x, y, w, h) pixels of the returned frame differ.
    """
    fh, fw = frame.shape[:2]
    cx0 = max(0, x - REGION_FSR_CONTEXT_PAD_PX)
    cy0 = max(0, y - REGION_FSR_CONTEXT_PAD_PX)
    cx1 = min(fw, x + w + REGION_FSR_CONTEXT_PAD_PX)
    cy1 = min(fh, y + h + REGION_FSR_CONTEXT_PAD_PX)
    crop = frame[cy0:cy1, cx0:cx1]

    # cv2.inpaint's mask convention: non-zero means "reconstruct this".
    mask = np.zeros(crop.shape[:2], np.uint8)
    mask[y - cy0 : y - cy0 + h, x - cx0 : x - cx0 + w] = 255
    reconstructed = cv2.inpaint(crop, mask, 3, cv2.INPAINT_TELEA)

    out = frame.copy()
    out[y : y + h, x : x + w] = reconstructed[y - cy0 : y - cy0 + h, x - cx0 : x - cx0 + w]
    return out


def _inpaint_region(frame: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
    """Reconstructs frame[y:y+h, x:x+w], picking the method by region size:
    FSR (exemplar-based, sharp, cost climbs steeply with area) for a
    small box, Telea (diffusion, soft but near-instant) once the
    box is larger than REGION_INPAINT_FSR_MAX_REGION_PX - where FSR would
    cost minutes per clip without looking any sharper.
    """
    if w * h > REGION_INPAINT_FSR_MAX_REGION_PX:
        return _telea_inpaint_region(frame, x, y, w, h)
    return _fsr_inpaint_region(frame, x, y, w, h)


def _flow_assisted_inpaint_region(
    center_frame: np.ndarray, neighbor_frames: list[np.ndarray], x: int, y: int, w: int, h: int
) -> np.ndarray:
    """Reconstructs frame[y:y+h, x:x+w] by recovering real pixels from
    `neighbor_frames` wherever dense optical flow shows the region's
    underlying content was visible there (camera pan/scroll moved it out
    from under the fixed object position at some nearby point in time),
    falling back to _inpaint_region for whatever pixels no neighbor
    ever uncovers. See REGION_FLOW_* in config.py for the full
    rationale and tuning knobs.

    `neighbor_frames` is searched in the order given and stops early once
    the region is fully recovered - the caller (see
    _inpaint_region_to_temp_video_flow) is expected to order it
    nearest-in-time first, since closer frames need smaller flow (more
    reliable) and are more likely to match the center frame's lighting.
    """
    fh, fw = center_frame.shape[:2]
    pad = REGION_FLOW_CONTEXT_PAD_PX
    cx0 = max(0, x - pad)
    cy0 = max(0, y - pad)
    cx1 = min(fw, x + w + pad)
    cy1 = min(fh, y + h + pad)

    center_crop = center_frame[cy0:cy1, cx0:cx1]
    crop_h, crop_w = center_crop.shape[:2]
    center_gray = cv2.cvtColor(center_crop, cv2.COLOR_BGR2GRAY)

    # Region coordinates in crop-space.
    rx0, ry0 = x - cx0, y - cy0
    rx1, ry1 = rx0 + w, ry0 + h

    recovered = np.zeros_like(center_crop)
    filled = np.zeros((crop_h, crop_w), dtype=bool)

    scale = REGION_FLOW_ESTIMATION_SCALE
    small_center_gray = cv2.resize(center_gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    grid_y, grid_x = np.mgrid[0:crop_h, 0:crop_w].astype(np.float32)

    for neighbor in neighbor_frames:
        if filled[ry0:ry1, rx0:rx1].all():
            break  # region fully recovered already - no need to check further neighbors

        n_crop = neighbor[cy0:cy1, cx0:cx1]
        if n_crop.shape != center_crop.shape:
            continue  # defensive - every frame in this video shares one resolution
        sampled, uncovered = _flow_sample(small_center_gray, n_crop, grid_x, grid_y, (rx0, ry0, rx1, ry1))
        trust = uncovered & ~filled

        recovered[trust] = sampled[trust]
        filled |= trust

    region_filled = filled[ry0:ry1, rx0:rx1]
    recovered_region = recovered[ry0:ry1, rx0:rx1]
    if not region_filled.all():
        # Leftover pixels no neighbor ever uncovered (static shot, or
        # motion too large for the padded search window) still need a
        # fill - same reconstruction as quality="standard" (FSR, or Telea
        # for a very large box - see _inpaint_region).
        fallback_region = _inpaint_region(center_frame, x, y, w, h)[y : y + h, x : x + w]
        recovered_region = recovered_region.copy()
        recovered_region[~region_filled] = fallback_region[~region_filled]

    out = center_frame.copy()
    out[y : y + h, x : x + w] = recovered_region
    return out


def _flow_sample(
    small_center_gray: np.ndarray,
    n_crop: np.ndarray,
    grid_x: np.ndarray,
    grid_y: np.ndarray,
    region: tuple[int, int, int, int],
) -> tuple[np.ndarray, np.ndarray]:
    """Warps the neighbor crop onto the center crop with dense optical flow.
    Returns the warped neighbor and which center pixels it really shows -
    `region` is (x0, y0, x1, y1) in crop space."""
    crop_h, crop_w = n_crop.shape[:2]
    rx0, ry0, rx1, ry1 = region
    scale = REGION_FLOW_ESTIMATION_SCALE
    n_gray = cv2.cvtColor(n_crop, cv2.COLOR_BGR2GRAY)
    small_n_gray = cv2.resize(n_gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    # Flow FROM center TO neighbor: for each center-crop pixel, where
    # that scene point ended up in the neighbor frame - exactly what's
    # needed to sample the neighbor for a center-frame pixel.
    flow_small = cv2.calcOpticalFlowFarneback(
        small_center_gray, small_n_gray, None, 0.5, 3, 15, 3, 5, 1.2, 0
    )
    flow = cv2.resize(flow_small, (crop_w, crop_h), interpolation=cv2.INTER_LINEAR) / scale

    map_x = grid_x + flow[..., 0]
    map_y = grid_y + flow[..., 1]
    sampled = cv2.remap(n_crop, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)

    # Only trust a region pixel's sample if the neighbor location it
    # maps to is (a) inside the crop, and (b) itself NOT inside the
    # region - i.e. genuinely uncovered content there, not more
    # covered content. cv2.BORDER_CONSTANT would otherwise make an
    # out-of-bounds map look like a valid (black) sample.
    in_bounds = (map_x >= 0) & (map_x < crop_w) & (map_y >= 0) & (map_y < crop_h)
    outside_region = ~((map_x >= rx0) & (map_x < rx1) & (map_y >= ry0) & (map_y < ry1))
    return sampled, in_bounds & outside_region


def _flow_can_recover(input_path: str, x: int, y: int, w: int, h: int) -> bool:
    """Whether the pro pass would recover anything: checks
    REGION_FLOW_PROBE_SAMPLES frame pairs, the search radius apart and
    spread across the clip, for motion that uncovers the region. A still
    shot never does, and then every frame would pay for the full neighbor
    search only to fall back to the plain fill anyway. Errs towards True
    when it can't tell, so the pro pass still runs."""
    radius = REGION_FLOW_SEARCH_RADIUS_FRAMES
    pad = REGION_FLOW_CONTEXT_PAD_PX
    scale = REGION_FLOW_ESTIMATION_SCALE
    cap = cv2.VideoCapture(input_path)
    try:
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) if cap.isOpened() else 0
        if frame_count <= radius:
            return True
        last_start = frame_count - radius - 1
        samples = max(1, REGION_FLOW_PROBE_SAMPLES)
        starts = sorted({last_start * i // max(1, samples - 1) for i in range(samples)})

        checked = 0
        for start in starts:
            cap.set(cv2.CAP_PROP_POS_FRAMES, start)
            ok_a, a = cap.read()
            for _ in range(radius - 1):
                cap.grab()
            ok_b, b = cap.read()
            if not (ok_a and ok_b):
                continue
            fh, fw = a.shape[:2]
            cx0, cy0 = max(0, x - pad), max(0, y - pad)
            cx1, cy1 = min(fw, x + w + pad), min(fh, y + h + pad)
            a_crop, b_crop = a[cy0:cy1, cx0:cx1], b[cy0:cy1, cx0:cx1]
            crop_h, crop_w = a_crop.shape[:2]
            small_a = cv2.resize(
                cv2.cvtColor(a_crop, cv2.COLOR_BGR2GRAY), None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA
            )
            grid_y, grid_x = np.mgrid[0:crop_h, 0:crop_w].astype(np.float32)
            rx0, ry0 = x - cx0, y - cy0
            _, uncovered = _flow_sample(small_a, b_crop, grid_x, grid_y, (rx0, ry0, rx0 + w, ry0 + h))
            checked += 1
            if uncovered[ry0 : ry0 + h, rx0 : rx0 + w].mean() >= REGION_FLOW_MIN_RECOVERABLE:
                return True
        return checked == 0
    finally:
        cap.release()


def _context_changed(key: np.ndarray, frame: np.ndarray, x: int, y: int, w: int, h: int) -> bool:
    """Whether the pixels the fill reads (the padded crop around the region,
    not the region itself) differ between `key` and `frame` by more than
    REGION_REUSE_MAX_MEAN_DIFF on average."""
    fh, fw = frame.shape[:2]
    pad = REGION_FSR_CONTEXT_PAD_PX
    cx0, cy0 = max(0, x - pad), max(0, y - pad)
    cx1, cy1 = min(fw, x + w + pad), min(fh, y + h + pad)
    diff = cv2.absdiff(key[cy0:cy1, cx0:cx1], frame[cy0:cy1, cx0:cx1])
    diff[y - cy0 : y - cy0 + h, x - cx0 : x - cx0 + w] = 0
    context_values = (diff.shape[0] * diff.shape[1] - w * h) * diff.shape[2]
    if context_values <= 0:
        return True
    return float(diff.sum(dtype=np.int64)) / context_values > REGION_REUSE_MAX_MEAN_DIFF


def _inpaint_patch(frame: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
    return _inpaint_region(frame, x, y, w, h)[y : y + h, x : x + w]


class _OrderedPatchWriter:
    """Writes patches in frame order while up to JOB_THREADS frames are
    reconstructed in parallel. OpenCV releases the GIL inside its calls, so
    threads are enough - no frames get copied to other processes. A bounded
    queue keeps memory flat however long the clip is."""

    def __init__(self, writer: cv2.VideoWriter, pool: ThreadPoolExecutor):
        self._writer = writer
        self._pool = pool
        self._pending: deque[Future] = deque()
        self._max_pending = JOB_THREADS * 2

    def submit(self, fn, *args) -> Future:
        future = self._pool.submit(fn, *args)
        self.add(future)
        return future

    def add(self, future: Future) -> None:
        self._pending.append(future)
        while len(self._pending) > self._max_pending:
            self._writer.write(self._pending.popleft().result())

    def flush(self) -> None:
        while self._pending:
            self._writer.write(self._pending.popleft().result())


def _crop_box(input_path: str, x: int, y: int, w: int, h: int, pad: int) -> tuple[int, int, int, int, float]:
    """The region padded by `pad` on each side, clamped to the frame, as
    (x0, y0, x1, y1), plus the frame rate.

    Raises:
        ValueError: if the file can't be opened as a video.
    """
    cap = cv2.VideoCapture(input_path)
    try:
        if not cap.isOpened():
            raise ValueError("Could not open this file as a video")
        fw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        fh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    finally:
        cap.release()
    return max(0, x - pad), max(0, y - pad), min(fw, x + w + pad), min(fh, y + h + pad), fps


def _cropped_frames(input_path: str, box: tuple[int, int, int, int]):
    """Yields every frame's `box` (x0, y0, x1, y1) as a read-only BGR array.

    ffmpeg decodes (multi-threaded, in C) and crops before anything reaches
    Python, so the fill pass only ever handles the small box it needs, not
    whole 1080p/4K frames - that full-frame decode and copy was most of a
    still shot's processing time. -noautorotate keeps the same storage
    orientation the final composite uses, so the region lines up.
    """
    x0, y0, x1, y1 = box
    cw, ch = x1 - x0, y1 - y0
    proc = subprocess.Popen(
        [
            get_ffmpeg_path(), "-v", "error", "-noautorotate", "-threads", str(JOB_THREADS),
            "-i", input_path, "-map", "0:v:0", "-vf", f"crop={cw}:{ch}:{x0}:{y0}",
            "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    size = cw * ch * 3
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield np.frombuffer(buf, np.uint8).reshape(ch, cw, 3)
    finally:
        proc.kill()
        proc.wait()


def _inpaint_region_to_temp_video(input_path: str, x: int, y: int, w: int, h: int) -> str:
    """Decodes every frame, reconstructs the fixed region at (x, y, w, h)
    with _inpaint_region(), and writes just that reconstructed w*h
    patch - not the whole frame - to a new silent, lossless (FFV1) temp
    video. reconstruct_region() composites the patch straight back onto the
    untouched original on the final pass, so:
      - nothing outside the box is ever decoded and re-encoded here (that
        was softening the entire picture, not only the region), and
      - the output's frame timing and duration come from the source
        itself, not from OpenCV's frame-rate reading - which is unreliable
        on variable-frame-rate phone/screen-recording clips and was making
        some 10s clips come out roughly half length.

    Blocking/CPU-bound; callers should run this via asyncio.to_thread, same
    reasoning as _run_ffmpeg's use of it.

    Raises:
        ValueError: if the file can't be opened as a video (mirrors
            probe_video/sample_frames).
    """
    # The fill reads only the region plus REGION_FSR_CONTEXT_PAD_PX around
    # it, so that box is all that gets decoded; the region's position is
    # then relative to the box.
    box = _crop_box(input_path, x, y, w, h, REGION_FSR_CONTEXT_PAD_PX)
    fps = box[4]
    rx, ry = x - box[0], y - box[1]

    fd, tmp_path = tempfile.mkstemp(suffix=".mkv")
    os.close(fd)
    writer = cv2.VideoWriter(tmp_path, cv2.VideoWriter_fourcc(*"FFV1"), fps, (w, h))
    frames = _cropped_frames(input_path, box[:4])
    try:
        with ThreadPoolExecutor(max_workers=JOB_THREADS) as pool:
            out = _OrderedPatchWriter(writer, pool)
            # The fill only reads the pixels around the region, so a frame
            # whose surroundings match the last computed one reuses its
            # result (see REGION_REUSE_MAX_MEAN_DIFF) - on a still shot that
            # is almost every frame.
            key_frame: np.ndarray | None = None
            key_patch: Future | None = None
            for crop in frames:
                if key_frame is None or key_patch is None or _context_changed(key_frame, crop, rx, ry, w, h):
                    key_frame = crop
                    key_patch = out.submit(_inpaint_patch, crop, rx, ry, w, h)
                else:
                    out.add(key_patch)
            out.flush()
    finally:
        frames.close()  # stops ffmpeg if the pass ended early
        writer.release()
    return tmp_path


def _inpaint_region_to_temp_video_flow(input_path: str, x: int, y: int, w: int, h: int) -> str:
    """quality="pro" counterpart to _inpaint_region_to_temp_video(): same
    contract (silent lossless w*h patch video out, composited back onto the
    original by reconstruct_region), but reconstructs each frame with
    _flow_assisted_inpaint_region() instead of plain per-frame FSR.

    Streams through the video once, keeping a sliding buffer of at most
    2*REGION_FLOW_SEARCH_RADIUS_FRAMES+1 full decoded frames - bounded
    regardless of clip length, since a center frame is only finalized (and
    the oldest buffered frame dropped) once enough lookahead exists for it.
    A frame near either end of the clip simply gets fewer neighbors on
    that side, not an error.

    Raises:
        ValueError: if the file can't be opened as a video (mirrors
            probe_video/sample_frames).
    """
    radius = REGION_FLOW_SEARCH_RADIUS_FRAMES

    # Same box decode as _inpaint_region_to_temp_video, with the flow
    # search's wider padding (which also covers the fill's fallback).
    box = _crop_box(input_path, x, y, w, h, max(REGION_FLOW_CONTEXT_PAD_PX, REGION_FSR_CONTEXT_PAD_PX))
    fps = box[4]
    frames = _cropped_frames(input_path, box[:4])
    x, y = x - box[0], y - box[1]

    fd, tmp_path = tempfile.mkstemp(suffix=".mkv")
    os.close(fd)
    writer = cv2.VideoWriter(tmp_path, cv2.VideoWriter_fourcc(*"FFV1"), fps, (w, h))

    window: list[np.ndarray] = []
    window_start = 0  # global frame index of window[0]
    next_emit = 0  # global frame index of the next frame to finalize
    cur_idx = -1  # global frame index of the most recently read frame; -1 if none read yet

    pool = ThreadPoolExecutor(max_workers=JOB_THREADS)
    out = _OrderedPatchWriter(writer, pool)

    def _flow_patch(center: np.ndarray, neighbors: list[np.ndarray]) -> np.ndarray:
        return _flow_assisted_inpaint_region(center, neighbors, x, y, w, h)[y : y + h, x : x + w]

    def _emit_center() -> None:
        center_pos = next_emit - window_start
        neighbors = sorted(
            (i for i in range(len(window)) if i != center_pos), key=lambda i: abs(i - center_pos)
        )
        # The task holds its own list of frame references, so trimming the
        # window afterwards doesn't pull frames out from under it.
        out.submit(_flow_patch, window[center_pos], [window[i] for i in neighbors])

    try:
        for frame in frames:
            window.append(frame)
            cur_idx = window_start + len(window) - 1

            # Emit every center that now has full lookahead available -
            # keeps the buffer from ever growing past radius frames ahead
            # of next_emit.
            while next_emit + radius <= cur_idx:
                _emit_center()
                next_emit += 1
                while window_start < next_emit - radius:
                    window.pop(0)
                    window_start += 1

        # Drain: end of stream - finalize whatever's left with however
        # much lookahead each one actually has (the clip's tail). Bounded
        # by cur_idx (the last frame actually read), NOT by `window` being
        # non-empty - next_emit can still be behind cur_idx while window
        # has already been trimmed down by the loop above, and stopping on
        # an empty window would either exit early or (if window
        # temporarily has stale entries) index past its end.
        while next_emit <= cur_idx:
            _emit_center()
            next_emit += 1
            while window_start < next_emit - radius:
                window.pop(0)
                window_start += 1
        out.flush()
    finally:
        pool.shutdown(wait=True)
        frames.close()
        writer.release()
    return tmp_path


async def reconstruct_region(
    input_path: str,
    output_path: str,
    x: int,
    y: int,
    w: int,
    h: int,
    output_height: int | None = None,
    quality: str = "standard",
) -> None:
    """Reconstructs the given region with OpenCV-contrib's FSR inpainting,
    run per-frame in Python (see REGION_FSR_* in config.py for the full
    story - in short, an exemplar/frequency-based method that finds
    well-matching real content instead of diffusing a smooth gradient,
    which is what made ffmpeg's boundary interpolation and then plain Telea inpainting
    both still look soft on anything with real color texture). The
    per-frame pass writes only the reconstructed region to a lossless
    intermediate; a final ffmpeg pass sharpens that patch (see
    REGION_PATCH_SHARPEN_* - cosmetic contrast restoration) and
    composites it straight onto the untouched original, taking the
    original's audio and - crucially - its exact frame timing, so the
    result is the same length as the source and every pixel outside the
    box is bit-for-bit the original rather than a re-encode.

    `quality="pro"` swaps the per-frame FSR pass for
    _inpaint_region_to_temp_video_flow's optical-flow-assisted
    reconstruction (see REGION_FLOW_* in config.py) - recovers real
    pixels where camera motion allows it, still falls back to plain FSR
    per-pixel wherever it can't.

    `output_height`, if given, downscales the result afterward (width kept
    proportional via `-2`), applied in that same final pass - the region
    coordinates the user marked are against the source resolution, so
    scaling any earlier would require rescaling x/y/w/h too, for no benefit.
    Callers are responsible for never passing a height taller than the
    source (this function does not upscale).
    """
    inpaint_fn = _inpaint_region_to_temp_video
    # On a still shot the pro pass can't uncover anything and only costs
    # time, so it runs only when a quick probe sees motion it can use.
    if quality == "pro" and await asyncio.to_thread(_flow_can_recover, input_path, x, y, w, h):
        inpaint_fn = _inpaint_region_to_temp_video_flow
    tmp_path = await asyncio.to_thread(inpaint_fn, input_path, x, y, w, h)
    try:
        # tmp_path is the reconstructed region only (input 1). Sharpen it -
        # so the unsharp pass never touches already-sharp real content and
        # can't ring/halo it - then overlay it onto the original (input 0)
        # at the marked coordinates. -noautorotate keeps the original in
        # the storage orientation OpenCV used when the region was marked,
        # so x/y still line up. eof_action=repeat: if OpenCV decoded fewer
        # frames than the container reports, the last reconstructed patch
        # holds for the tail rather than the video ending early.
        overlay_label = "outv" if output_height is None else "ov"
        filter_complex = (
            f"[1:v]unsharp=luma_msize_x={REGION_PATCH_SHARPEN_KSIZE}:"
            f"luma_msize_y={REGION_PATCH_SHARPEN_KSIZE}:"
            f"luma_amount={REGION_PATCH_SHARPEN_AMOUNT}[patch];"
            f"[0:v][patch]overlay=x={x}:y={y}:eof_action=repeat[{overlay_label}]"
        )
        if output_height is not None:
            filter_complex += f";[{overlay_label}]scale=-2:{output_height}[outv]"
        await _run_ffmpeg(
            [
                "-y",
                "-noautorotate",
                "-i",
                input_path,
                "-i",
                tmp_path,
                "-filter_complex",
                filter_complex,
                "-map",
                "[outv]",
                "-map",
                "0:a?",
                "-c:v",
                "libx264",
                "-preset",
                VIDEO_ENCODE_PRESET,
                "-crf",
                str(VIDEO_ENCODE_CRF),
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "copy",
                output_path,
            ]
        )
    finally:
        os.remove(tmp_path)
