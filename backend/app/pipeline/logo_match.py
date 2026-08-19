"""Known-platform watermark/logo matching via template correlation.

Complements detect_watermark_candidates() in video.py (which finds *any*
fixed overlay purely from motion - it has to stay conservative, since any
genuinely static patch of real scene looks the same to it) with a match
against a *specific* known logo shape. If the video was downloaded from a
platform whose watermark you've saved a reference image for, matching that
reference is a much higher-confidence, higher-precision signal than "this
patch didn't move" - and it works even on a single frame, or on a clip
with too little motion for the temporal detector to trust anything.

This repo does NOT ship any actual platform logos: TikTok/CapCut/
Instagram/Shutterstock/Getty/etc. watermarks are someone else's
trademarked assets, and reproducing them here isn't appropriate. Drop your
own reference PNGs into LOGO_REFERENCE_DIR (see config.py) - ideally
cropped tight to just the logo, with a transparent background if you have
one - and matching against them happens automatically. With the directory
empty or missing (the shipped state), match_known_logos() is a no-op:
empty list, same suggest-only contract as everything else in this file.
"""

from __future__ import annotations

import dataclasses
from functools import lru_cache

import cv2
import numpy as np

from app.config import (
    LOGO_MATCH_MAX_CANDIDATES,
    LOGO_MATCH_MIN_SCORE,
    LOGO_MATCH_SCALE_MAX,
    LOGO_MATCH_SCALE_MIN,
    LOGO_MATCH_SCALE_STEPS,
    LOGO_REFERENCE_DIR,
)


@dataclasses.dataclass
class LogoMatchCandidate:
    x: int
    y: int
    w: int
    h: int
    confidence: float  # 0..1, the template match's own correlation score -
                        # meaningful in isolation, not just relative to
                        # other candidates from this image
    label: str  # matched reference's filename stem, e.g. "tiktok"


@dataclasses.dataclass
class _Reference:
    name: str
    gray: np.ndarray


@lru_cache(maxsize=1)
def _load_references() -> list[_Reference]:
    """Loads every *.png in LOGO_REFERENCE_DIR once per process - cached
    like the rembg/NudeDetector singletons elsewhere in this codebase,
    cheap to keep resident, wasteful to redecode on every request.

    A transparent reference is flattened onto flat mid-gray rather than
    matched with an alpha mask: OpenCV only supports a match mask on the
    (TM_SQDIFF, TM_CCORR) filter family, not TM_CCOEFF - and TM_CCORR isn't
    mean-centered, so it's biased toward whichever window is closest in
    raw brightness rather than closest in *shape*. Measured on a synthetic
    test logo: masked TM_CCORR_NORMED locked onto a brighter wrong region
    at 0.977 over the true match's own 0.974 at a different scale - a
    structural bias, not a tuning problem. Flattening to neutral gray lets
    every reference use plain TM_CCOEFF_NORMED instead, which normalizes
    out local brightness/contrast and doesn't have that failure mode.
    """
    refs: list[_Reference] = []
    if not LOGO_REFERENCE_DIR.is_dir():
        return refs
    for path in sorted(LOGO_REFERENCE_DIR.glob("*.png")):
        img = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
        if img is None or img.ndim < 2 or img.shape[0] < 8 or img.shape[1] < 8:
            continue
        if img.ndim == 3 and img.shape[2] == 4:
            alpha = img[..., 3:4].astype(np.float32) / 255.0
            bgr = img[..., :3].astype(np.float32)
            flattened = bgr * alpha + 127.0 * (1.0 - alpha)
            gray = cv2.cvtColor(flattened.astype(np.uint8), cv2.COLOR_BGR2GRAY)
        elif img.ndim == 3:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        else:
            gray = img
        refs.append(_Reference(name=path.stem, gray=gray))
    return refs


def match_known_logos(frame_bgr: np.ndarray) -> list[LogoMatchCandidate]:
    """Multi-scale template match of every loaded reference logo against
    `frame_bgr`. One representative frame is enough - a real overlay logo
    doesn't change scale or shape within one video, unlike the temporal
    detector this doesn't need multiple sampled frames.

    For each reference, tries every scale in
    [LOGO_MATCH_SCALE_MIN, LOGO_MATCH_SCALE_MAX] and keeps whichever scored
    highest; that becomes one candidate if it clears LOGO_MATCH_MIN_SCORE.
    Grayscale-only matching (not color) so a platform's grading/filter
    presets or the app's own theme color don't affect matching a logo
    that's usually monochrome/white anyway.

    Returns: candidates sorted by confidence, capped at
    LOGO_MATCH_MAX_CANDIDATES. Always [] when LOGO_REFERENCE_DIR has no
    reference images (the shipped default - see module docstring).
    """
    references = _load_references()
    if not references:
        return []

    frame_gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    fh, fw = frame_gray.shape[:2]
    scales = np.linspace(LOGO_MATCH_SCALE_MIN, LOGO_MATCH_SCALE_MAX, LOGO_MATCH_SCALE_STEPS)

    candidates: list[LogoMatchCandidate] = []
    for ref in references:
        rh, rw = ref.gray.shape[:2]
        best_score = -1.0
        best_box: tuple[int, int, int, int] | None = None

        for scale in scales:
            tw, th = int(rw * scale), int(rh * scale)
            # Skip degenerate templates and anything that can no longer
            # fit inside the frame at this scale.
            if tw < 8 or th < 8 or tw >= fw or th >= fh:
                continue
            template = cv2.resize(ref.gray, (tw, th), interpolation=cv2.INTER_AREA)
            result = cv2.matchTemplate(frame_gray, template, cv2.TM_CCOEFF_NORMED)

            _, max_val, _, max_loc = cv2.minMaxLoc(result)
            if max_val > best_score:
                best_score = max_val
                best_box = (max_loc[0], max_loc[1], tw, th)

        if best_box is not None and best_score >= LOGO_MATCH_MIN_SCORE:
            x, y, w, h = best_box
            candidates.append(
                LogoMatchCandidate(
                    x=x, y=y, w=w, h=h, confidence=round(float(min(1.0, best_score)), 3), label=ref.name
                )
            )

    candidates.sort(key=lambda c: -c.confidence)
    return candidates[:LOGO_MATCH_MAX_CANDIDATES]
