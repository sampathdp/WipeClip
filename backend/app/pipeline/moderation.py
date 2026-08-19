"""Explicit-content screening, run before any processing.

Local pass only: a self-hosted nudity detector (NudeNet, ONNX-based - same
runtime as the rest of this backend, no extra network calls once its model
is cached on first use) flags likely exposed-nudity frames sampled across
the clip. This catches the common "adult content uploaded to a free tool"
case cheaply and offline, but it is a heuristic classifier, not a
guarantee - it will miss some material and can flag borderline-but-legitimate
content (swimwear, medical/artistic nudity).

It is explicitly NOT CSAM detection. CSAM screening is a hash-matching
problem against known-image databases (PhotoDNA, Thorn Safer, Google CSAI
Match), requires formal registration with the operating body, and must not
be approximated with a classifier like this one - do not extend this module
to try. If that's a real risk surface for your deployment, integrate one of
those vetted services separately.

To add a stronger hosted moderation API (AWS Rekognition content moderation,
Google Cloud Video Intelligence SafeSearch, Azure Content Moderator)
alongside or instead of the local pass: implement a `screen_frames_cloud(
frames) -> ModerationResult` here with the same signature as
`screen_frames_local`, then point `screen_video` at it based on
`MODERATION_PROVIDER`.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np

from app.config import NSFW_BLOCKED_LABELS, NSFW_CONFIDENCE_THRESHOLD, NSFW_SAMPLE_FRAMES
from app.pipeline.video import sample_frames


@dataclass
class ModerationResult:
    flagged: bool
    labels: list[str] = field(default_factory=list)


@lru_cache(maxsize=1)
def _detector():
    # Imported lazily: pulls in onnxruntime and downloads/caches the model
    # (~a few MB, from the nudenet package's release assets) on first call,
    # same lazy-singleton pattern as the rembg session in bg_removal.py.
    from nudenet import NudeDetector

    return NudeDetector()


def screen_frames_local(frames: list[np.ndarray]) -> ModerationResult:
    detector = _detector()
    hit_labels: set[str] = set()
    for frame in frames:
        for detection in detector.detect(frame):
            label = detection.get("class", "")
            score = detection.get("score", 0.0)
            if label in NSFW_BLOCKED_LABELS and score >= NSFW_CONFIDENCE_THRESHOLD:
                hit_labels.add(label)
    return ModerationResult(flagged=bool(hit_labels), labels=sorted(hit_labels))


def screen_video(path: str) -> ModerationResult:
    """Samples frames across the video at `path` and screens them.

    Raises:
        ValueError: if no frames could be read (mirrors probe_video).
        NotImplementedError: if MODERATION_PROVIDER names a provider that
            hasn't been wired up yet (see module docstring).
    """
    frames = sample_frames(path, NSFW_SAMPLE_FRAMES)
    provider = os.environ.get("MODERATION_PROVIDER", "local")
    if provider == "local":
        return screen_frames_local(frames)
    raise NotImplementedError(
        f"MODERATION_PROVIDER={provider!r} is not wired up - implement "
        "screen_frames_cloud() in this module and dispatch to it here."
    )
