"""Video watermark removal/replacement via ffmpeg (+ OpenCV for removal).

Unlike the image pipeline (which works on decoded pixel arrays throughout),
most of this module keeps video out-of-process: OpenCV reads a probe frame
+ metadata, ffmpeg does the actual re-encode. Frame-by-frame decode/
process/encode in Python doesn't scale to minutes-long video, so
replace_logo() (a straight overlay compositing job) stays a single native
ffmpeg pass, same as this file always did.

remove_logo() is the exception: reconstructing the covered region well
enough (see WATERMARK_FSR_* in config.py) needs OpenCV-contrib's
exemplar-based FSR inpainting run per-frame, which ffmpeg has no
equivalent for. That part does pay the frame-by-frame Python cost -
measured at roughly 6.5x realtime end-to-end - which is real but still a
deliberate choice, not an oversight: cheaper reconstruction methods were
tried first and visibly smeared or blurred, which is exactly the defect
this exists to avoid. "Far too slow" would describe doing this for
everything, not for one small region on one video endpoint.

The watermark region is user-confirmed, not user-required: there's no
per-platform "Gemini icon" template (Google doesn't publish a reference
asset, and its position/scale isn't guaranteed constant across
resolutions), but detect_watermark_candidates() below suggests a region
via temporal-static-region detection - reliable for *any* fixed corner/
overlay logo, not just a specific one - and the frontend prefills
RegionSelector with the top suggestion. The user can still drag to
relocate/resize or ignore it entirely; nothing is ever auto-applied
without that confirmation.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass

import cv2
import imageio_ffmpeg
import numpy as np

from app.config import (
    VIDEO_ENCODE_CRF,
    VIDEO_ENCODE_PRESET,
    WATERMARK_DETECT_BAR_FLATNESS_THRESHOLD,
    WATERMARK_DETECT_BOX_PADDING_PX,
    WATERMARK_DETECT_LOW_VAR_FRACTION,
    WATERMARK_DETECT_MAX_BLOB_AREA_FRACTION,
    WATERMARK_DETECT_MAX_CANDIDATES,
    WATERMARK_DETECT_MIN_BLOB_AREA_FRACTION,
    WATERMARK_DETECT_MIN_MOTION,
    WATERMARK_DETECT_MIN_SOLIDITY,
    WATERMARK_DETECT_SAMPLE_FRAMES,
    WATERMARK_FLOW_CONTEXT_PAD_PX,
    WATERMARK_FLOW_ESTIMATION_SCALE,
    WATERMARK_FLOW_SEARCH_RADIUS_FRAMES,
    WATERMARK_FSR_CONTEXT_PAD_PX,
    WATERMARK_FSR_SCALE,
    WATERMARK_INPAINT_FSR_MAX_REGION_PX,
    WATERMARK_PATCH_SHARPEN_AMOUNT,
    WATERMARK_PATCH_SHARPEN_KSIZE,
)
from app.pipeline.logo_match import match_known_logos


def get_ffmpeg_path() -> str:
    """Prefer a system-installed ffmpeg (if the deployment environment has
    one on PATH) and fall back to the static binary bundled by
    imageio-ffmpeg, so this works out of the box with no OS-level install.
    """
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return system_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


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


@dataclass
class WatermarkCandidate:
    x: int
    y: int
    w: int
    h: int
    confidence: float  # 0..1, how strongly static this region is relative
                        # to the rest of the frame - not relative to other
                        # candidates, so it stays meaningful even when only
                        # one candidate comes back.
    label: str | None = None  # matched reference logo's name (see
                        # logo_match.py), or None for a plain
                        # temporal-static-region candidate with no
                        # identified brand.


def _iou(a, b) -> float:
    """Intersection-over-union of two x/y/w/h boxes (duck-typed - works for
    both WatermarkCandidate and logo_match.LogoMatchCandidate).
    """
    ax0, ay0, ax1, ay1 = a.x, a.y, a.x + a.w, a.y + a.h
    bx0, by0, bx1, by1 = b.x, b.y, b.x + b.w, b.y + b.h
    iw = max(0, min(ax1, bx1) - max(ax0, bx0))
    ih = max(0, min(ay1, by1) - max(ay0, by0))
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union > 0 else 0.0


def _edge_attached_run(is_flat: np.ndarray) -> np.ndarray:
    """Marks the leading run from index 0 and the trailing run from the end
    of `is_flat` (1-D bool) that are contiguously True - used to find
    letterbox/pillarbox bars, which always start at a frame edge and run
    inward until real content breaks the uniformity. A flat row/column in
    the *middle* of the frame (plain sky, a wall) is left alone; only bars
    actually touching an edge count.
    """
    mask = np.zeros_like(is_flat)
    n = len(is_flat)
    i = 0
    while i < n and is_flat[i]:
        mask[i] = True
        i += 1
    j = n - 1
    while j >= 0 and is_flat[j]:
        mask[j] = True
        j -= 1
    return mask


def detect_watermark_candidates(path: str) -> tuple[list[WatermarkCandidate], int, int]:
    """Suggests likely watermark/logo region(s) by finding areas that stay
    pixel-static across sampled frames while the rest of the frame moves -
    the same signature a fixed corner/overlay logo has, regardless of what
    it actually looks like. Unlike a template matcher this needs no
    reference asset per platform, and unlike the "just check the corners"
    heuristic it also catches centered or non-corner overlays.

    This is a *suggestion* for the frontend to prefill RegionSelector with -
    it never runs delogo/overlay itself. Same suggest-only contract as the
    image editor's detect_artifact_candidates(): numbers only, human
    confirms or redraws before anything is applied.

    Deliberately conservative: a genuinely static-camera clip (talking
    head, tripod shot) has low motion *everywhere*, which would make the
    whole frame look like "the watermark" if compared to nothing. So the
    temporal side of this only fires when the clip has a clear split
    between a small low-variance region and a higher-variance rest (gated
    by WATERMARK_DETECT_MIN_MOTION on the frame's median motion) - no clear
    split means no *temporal* candidates, rather than a bogus full-frame
    box the user could accidentally accept over real content. That gate
    does NOT suppress logo template matching (see logo_match.py) below it,
    which needs no motion at all and runs regardless - a mostly-static
    clip (title card, screen recording) can still get a match if a known
    logo is visible in the one frame checked. Letterbox/pillarbox bars are
    excluded explicitly from the temporal side: they're just as
    pixel-static as a logo but span nearly the full width or height, which
    no actual corner/overlay logo does.

    Returns:
        (candidates, width, height) - width/height are the sampled frames'
        dimensions, 0 if fewer than 3 frames could be read.

    Raises:
        ValueError: if no frames could be read (mirrors probe_video).
    """
    frames = sample_frames(path, WATERMARK_DETECT_SAMPLE_FRAMES)
    if len(frames) < 3:
        return [], 0, 0

    h, w = frames[0].shape[:2]
    gray_stack = np.stack(
        [cv2.cvtColor(cv2.resize(f, (w, h)), cv2.COLOR_BGR2GRAY).astype(np.float32) for f in frames]
    )
    pixel_std = gray_stack.std(axis=0)

    median_motion = float(np.median(pixel_std))

    # Below WATERMARK_DETECT_MIN_MOTION there isn't enough motion anywhere
    # to trust "this patch is more static than normal" - but that only
    # disables the *temporal* candidates below, not logo template matching
    # further down, which works off a single frame and needs no motion
    # signal at all. Gating both on this check was a real bug: a clip
    # that's mostly-static everywhere (title card, screen recording, a
    # test pattern) would skip logo matching too and return nothing even
    # when a known logo was sitting right there in the one frame checked.
    temporal_candidates: list[WatermarkCandidate] = []
    if median_motion >= WATERMARK_DETECT_MIN_MOTION:
        low_variance = pixel_std < median_motion * WATERMARK_DETECT_LOW_VAR_FRACTION

        # Exclude letterbox/pillarbox bars *before* connected-components, not
        # after: a corner logo is often placed inside such a bar, so if left in,
        # the logo's low-variance blob merges with the bar's into one blob that
        # then looks exactly like a bar and gets discarded along with it. A
        # bar is spatially uniform (flat) across its full width/height and
        # touches a frame edge; a logo breaks that flatness, which breaks the
        # edge-attached run right where the logo starts - so this only strips
        # the actual bar pixels, the logo itself stays a candidate.
        mean_frame = gray_stack.mean(axis=0)
        row_is_flat = mean_frame.std(axis=1) < WATERMARK_DETECT_BAR_FLATNESS_THRESHOLD
        col_is_flat = mean_frame.std(axis=0) < WATERMARK_DETECT_BAR_FLATNESS_THRESHOLD
        bar_rows = _edge_attached_run(row_is_flat)
        bar_cols = _edge_attached_run(col_is_flat)
        low_variance &= ~(bar_rows[:, None] | bar_cols[None, :])

        low_variance = low_variance.astype(np.uint8)
        # Morphological cleanup before connected-components, same purpose as
        # the image detector's top-hat: strip single-pixel compression-noise
        # specks, then bridge small gaps within one logo's own glyphs/edges.
        low_variance = cv2.morphologyEx(low_variance, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        low_variance = cv2.morphologyEx(low_variance, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))

        frame_area = h * w
        min_area = frame_area * WATERMARK_DETECT_MIN_BLOB_AREA_FRACTION
        max_area = frame_area * WATERMARK_DETECT_MAX_BLOB_AREA_FRACTION

        n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(low_variance, connectivity=8)

        scored: list[WatermarkCandidate] = []
        for label in range(1, n_labels):
            area = stats[label, cv2.CC_STAT_AREA]
            if area < min_area or area > max_area:
                continue
            bx = stats[label, cv2.CC_STAT_LEFT]
            by = stats[label, cv2.CC_STAT_TOP]
            bw = stats[label, cv2.CC_STAT_WIDTH]
            bh = stats[label, cv2.CC_STAT_HEIGHT]

            # Letterbox/pillarbox bars are pixel-static too, but span nearly
            # the full width or height - no real overlay logo does that.
            if bw > 0.9 * w and bh < 0.2 * h:
                continue
            if bh > 0.9 * h and bw < 0.2 * w:
                continue

            solidity = area / float(bw * bh)
            if solidity < WATERMARK_DETECT_MIN_SOLIDITY:
                continue

            blob_mask = labels == label
            mean_std = float(pixel_std[blob_mask].mean())
            # How much more static this region is than the frame's typical
            # motion - near 1.0 means near-perfectly static against real
            # motion elsewhere, near 0.0 means barely distinguishable from it.
            confidence = round(float(np.clip((median_motion - mean_std) / median_motion, 0.0, 1.0)), 3)

            px0 = int(max(0, bx - WATERMARK_DETECT_BOX_PADDING_PX))
            py0 = int(max(0, by - WATERMARK_DETECT_BOX_PADDING_PX))
            px1 = int(min(w, bx + bw + WATERMARK_DETECT_BOX_PADDING_PX))
            py1 = int(min(h, by + bh + WATERMARK_DETECT_BOX_PADDING_PX))

            scored.append(WatermarkCandidate(x=px0, y=py0, w=px1 - px0, h=py1 - py0, confidence=confidence))

        scored.sort(key=lambda c: -c.confidence)
        temporal_candidates = scored[:WATERMARK_DETECT_MAX_CANDIDATES]

    # A named-logo match (see logo_match.py) is strictly more informative
    # than "this patch didn't move" - where the two overlap, the identified
    # match replaces the unlabeled duplicate rather than sitting next to it.
    # No-op (empty list) when no reference logo images are configured.
    logo_candidates = match_known_logos(frames[0])
    merged = list(temporal_candidates)
    for logo in logo_candidates:
        merged = [c for c in merged if _iou(c, logo) < 0.3]
        merged.append(
            WatermarkCandidate(x=logo.x, y=logo.y, w=logo.w, h=logo.h, confidence=logo.confidence, label=logo.label)
        )
    merged.sort(key=lambda c: -c.confidence)
    return merged, w, h


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
    it actually needs - see WATERMARK_FSR_CONTEXT_PAD_PX) and run at a
    reduced working resolution (WATERMARK_FSR_SCALE) for speed, then
    upscaled back for the composite. Only the exact (x, y, w, h) pixels in
    the returned frame differ from the input - everything else, including
    the rest of the padded crop, is untouched.

    FSR cost climbs steeply with region area; _inpaint_region() sends a box
    past WATERMARK_INPAINT_FSR_MAX_REGION_PX to _telea_inpaint_region()
    instead, so this only ever runs on watermark-sized regions.
    """
    fh, fw = frame.shape[:2]
    cx0 = max(0, x - WATERMARK_FSR_CONTEXT_PAD_PX)
    cy0 = max(0, y - WATERMARK_FSR_CONTEXT_PAD_PX)
    cx1 = min(fw, x + w + WATERMARK_FSR_CONTEXT_PAD_PX)
    cy1 = min(fh, y + h + WATERMARK_FSR_CONTEXT_PAD_PX)
    crop = frame[cy0:cy1, cx0:cx1]

    # xphoto's mask convention is inverted from cv2.inpaint's: non-zero
    # means "keep as-is", zero means "reconstruct this".
    mask = np.full(crop.shape[:2], 255, np.uint8)
    mask[y - cy0 : y - cy0 + h, x - cx0 : x - cx0 + w] = 0

    small = cv2.resize(crop, None, fx=WATERMARK_FSR_SCALE, fy=WATERMARK_FSR_SCALE, interpolation=cv2.INTER_AREA)
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
    sharper (see _inpaint_region / WATERMARK_INPAINT_FSR_MAX_REGION_PX).
    Same contract: only the (x, y, w, h) pixels of the returned frame differ.
    """
    fh, fw = frame.shape[:2]
    cx0 = max(0, x - WATERMARK_FSR_CONTEXT_PAD_PX)
    cy0 = max(0, y - WATERMARK_FSR_CONTEXT_PAD_PX)
    cx1 = min(fw, x + w + WATERMARK_FSR_CONTEXT_PAD_PX)
    cy1 = min(fh, y + h + WATERMARK_FSR_CONTEXT_PAD_PX)
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
    watermark-sized box, Telea (diffusion, soft but near-instant) once the
    box is larger than WATERMARK_INPAINT_FSR_MAX_REGION_PX - where FSR would
    cost minutes per clip without looking any sharper.
    """
    if w * h > WATERMARK_INPAINT_FSR_MAX_REGION_PX:
        return _telea_inpaint_region(frame, x, y, w, h)
    return _fsr_inpaint_region(frame, x, y, w, h)


def _flow_assisted_inpaint_region(
    center_frame: np.ndarray, neighbor_frames: list[np.ndarray], x: int, y: int, w: int, h: int
) -> np.ndarray:
    """Reconstructs frame[y:y+h, x:x+w] by recovering real pixels from
    `neighbor_frames` wherever dense optical flow shows the region's
    underlying content was visible there (camera pan/scroll moved it out
    from under the fixed watermark position at some nearby point in time),
    falling back to _inpaint_region for whatever pixels no neighbor
    ever uncovers. See WATERMARK_FLOW_* in config.py for the full
    rationale and tuning knobs.

    `neighbor_frames` is searched in the order given and stops early once
    the region is fully recovered - the caller (see
    _inpaint_region_to_temp_video_flow) is expected to order it
    nearest-in-time first, since closer frames need smaller flow (more
    reliable) and are more likely to match the center frame's lighting.
    """
    fh, fw = center_frame.shape[:2]
    pad = WATERMARK_FLOW_CONTEXT_PAD_PX
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

    scale = WATERMARK_FLOW_ESTIMATION_SCALE
    small_center_gray = cv2.resize(center_gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    grid_y, grid_x = np.mgrid[0:crop_h, 0:crop_w].astype(np.float32)

    for neighbor in neighbor_frames:
        if filled[ry0:ry1, rx0:rx1].all():
            break  # region fully recovered already - no need to check further neighbors

        n_crop = neighbor[cy0:cy1, cx0:cx1]
        if n_crop.shape != center_crop.shape:
            continue  # defensive - every frame in this video shares one resolution
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
        # watermark. cv2.BORDER_CONSTANT would otherwise make an
        # out-of-bounds map look like a valid (black) sample.
        in_bounds = (map_x >= 0) & (map_x < crop_w) & (map_y >= 0) & (map_y < crop_h)
        outside_region = ~((map_x >= rx0) & (map_x < rx1) & (map_y >= ry0) & (map_y < ry1))
        trust = in_bounds & outside_region & ~filled

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


def _inpaint_region_to_temp_video(input_path: str, x: int, y: int, w: int, h: int) -> str:
    """Decodes every frame, reconstructs the fixed region at (x, y, w, h)
    with _inpaint_region(), and writes just that reconstructed w*h
    patch - not the whole frame - to a new silent, lossless (FFV1) temp
    video. remove_logo() composites the patch straight back onto the
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
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        cap.release()
        raise ValueError("Could not open this file as a video")

    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0

    fd, tmp_path = tempfile.mkstemp(suffix=".mkv")
    os.close(fd)
    writer = cv2.VideoWriter(tmp_path, cv2.VideoWriter_fourcc(*"FFV1"), fps, (w, h))
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            writer.write(_inpaint_region(frame, x, y, w, h)[y : y + h, x : x + w])
    finally:
        cap.release()
        writer.release()
    return tmp_path


def _inpaint_region_to_temp_video_flow(input_path: str, x: int, y: int, w: int, h: int) -> str:
    """quality="pro" counterpart to _inpaint_region_to_temp_video(): same
    contract (silent lossless w*h patch video out, composited back onto the
    original by remove_logo), but reconstructs each frame with
    _flow_assisted_inpaint_region() instead of plain per-frame FSR.

    Streams through the video once, keeping a sliding buffer of at most
    2*WATERMARK_FLOW_SEARCH_RADIUS_FRAMES+1 full decoded frames - bounded
    regardless of clip length, since a center frame is only finalized (and
    the oldest buffered frame dropped) once enough lookahead exists for it.
    A frame near either end of the clip simply gets fewer neighbors on
    that side, not an error.

    Raises:
        ValueError: if the file can't be opened as a video (mirrors
            probe_video/sample_frames).
    """
    radius = WATERMARK_FLOW_SEARCH_RADIUS_FRAMES

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        cap.release()
        raise ValueError("Could not open this file as a video")

    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0

    fd, tmp_path = tempfile.mkstemp(suffix=".mkv")
    os.close(fd)
    writer = cv2.VideoWriter(tmp_path, cv2.VideoWriter_fourcc(*"FFV1"), fps, (w, h))

    window: list[np.ndarray] = []
    window_start = 0  # global frame index of window[0]
    next_emit = 0  # global frame index of the next frame to finalize
    cur_idx = -1  # global frame index of the most recently read frame; -1 if none read yet

    def _emit_center() -> None:
        center_pos = next_emit - window_start
        neighbors = sorted(
            (i for i in range(len(window)) if i != center_pos), key=lambda i: abs(i - center_pos)
        )
        patch = _flow_assisted_inpaint_region(
            window[center_pos], [window[i] for i in neighbors], x, y, w, h
        )
        writer.write(patch[y : y + h, x : x + w])

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
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
    finally:
        cap.release()
        writer.release()
    return tmp_path


async def remove_logo(
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
    run per-frame in Python (see WATERMARK_FSR_* in config.py for the full
    story - in short, an exemplar/frequency-based method that finds
    well-matching real content instead of diffusing a smooth gradient,
    which is what made ffmpeg's `delogo` and then plain Telea inpainting
    both still look soft on anything with real color texture). The
    per-frame pass writes only the reconstructed region to a lossless
    intermediate; a final ffmpeg pass sharpens that patch (see
    WATERMARK_PATCH_SHARPEN_* - cosmetic contrast restoration) and
    composites it straight onto the untouched original, taking the
    original's audio and - crucially - its exact frame timing, so the
    result is the same length as the source and every pixel outside the
    box is bit-for-bit the original rather than a re-encode.

    `quality="pro"` swaps the per-frame FSR pass for
    _inpaint_region_to_temp_video_flow's optical-flow-assisted
    reconstruction (see WATERMARK_FLOW_* in config.py) - recovers real
    pixels where camera motion allows it, still falls back to plain FSR
    per-pixel wherever it can't.

    `output_height`, if given, downscales the result afterward (width kept
    proportional via `-2`), applied in that same final pass - the region
    coordinates the user marked are against the source resolution, so
    scaling any earlier would require rescaling x/y/w/h too, for no benefit.
    Callers are responsible for never passing a height taller than the
    source (this function does not upscale).
    """
    inpaint_fn = _inpaint_region_to_temp_video_flow if quality == "pro" else _inpaint_region_to_temp_video
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
            f"[1:v]unsharp=luma_msize_x={WATERMARK_PATCH_SHARPEN_KSIZE}:"
            f"luma_msize_y={WATERMARK_PATCH_SHARPEN_KSIZE}:"
            f"luma_amount={WATERMARK_PATCH_SHARPEN_AMOUNT}[patch];"
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


async def replace_logo(
    input_path: str,
    output_path: str,
    logo_path: str,
    x: int,
    y: int,
    w: int,
    h: int,
    output_height: int | None = None,
) -> None:
    """Overlays `logo_path` into the given region for the full video
    duration, scaled to fit inside (w, h) preserving its aspect ratio and
    centered (never stretched/distorted).

    Deliberately avoids the `pad` filter: padding the scaled logo out to an
    exact (w, h) canvas before overlaying is the "obvious" way to center it,
    but `scale ... force_original_aspect_ratio=decrease` can round its
    output a pixel larger than the requested box for some aspect ratios
    (most reliably reproduced with a square target), which makes a
    fixed-size `pad` immediately downstream fail with "Padded dimensions
    cannot be smaller than input dimensions". Centering via overlay's own
    `overlay_w`/`overlay_h` expressions sidesteps the whole class of bug -
    there's no second fixed-size target for the scaled output to mismatch.

    `output_height` behaves as in `remove_logo`: applied after the overlay,
    at the source resolution, never an upscale.
    """
    overlay_label = "outv" if output_height is None else "ov"
    filter_complex = (
        f"[1:v]format=rgba,scale=w={w}:h={h}:force_original_aspect_ratio=decrease[logo];"
        f"[0:v][logo]overlay=x={x}+({w}-overlay_w)/2:y={y}+({h}-overlay_h)/2[{overlay_label}]"
    )
    if output_height is not None:
        filter_complex += f";[{overlay_label}]scale=-2:{output_height}[outv]"
    await _run_ffmpeg(
        [
            "-y",
            "-i",
            input_path,
            "-i",
            logo_path,
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
