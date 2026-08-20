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

A stronger hosted moderation API is wired up but inert by default:
MODERATION_PROVIDER=aws (unset/"local" is the default) routes both
screen_video and the image tool's moderation check through
screen_frames_cloud() below, which calls AWS Rekognition's
DetectModerationLabels - requires `pip install boto3` (not a hard
dependency, see _rekognition_client()) plus standard AWS credentials/region
env vars. Add a GCP Video Intelligence SafeSearch or Azure Content
Moderator branch the same way, in screen_frames()'s dispatch below.
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


@lru_cache(maxsize=1)
def _rekognition_client():
    # Imported lazily, same reasoning as _detector() above: boto3 is only
    # needed at all when MODERATION_PROVIDER=aws is actually set, and isn't
    # in requirements.txt for that reason - `pip install boto3` (and set
    # standard AWS credentials/region env vars) before setting
    # MODERATION_PROVIDER=aws, or this raises ImportError.
    import boto3

    return boto3.client("rekognition")


def screen_frames_cloud(frames: list[np.ndarray]) -> ModerationResult:
    """Hosted-moderation counterpart to screen_frames_local(), dispatched by
    MODERATION_PROVIDER (see module docstring). Currently wires up AWS
    Rekognition's DetectModerationLabels; add a GCP/Azure branch the same
    way if you need one - same signature, same caller (screen_video below).

    Fails loudly rather than silently falling back to the local pass if
    credentials/config are missing - MODERATION_PROVIDER=aws is an explicit
    opt-in, so a broken AWS setup should surface as an error, not silently
    downgrade content-safety coverage without anyone noticing.

    Raises:
        RuntimeError: if AWS credentials/permissions aren't configured, or
            the Rekognition call otherwise fails.
    """
    import io

    import cv2

    client = _rekognition_client()
    hit_labels: set[str] = set()
    for frame in frames:
        ok, jpeg = cv2.imencode(".jpg", frame)
        if not ok:
            continue
        try:
            response = client.detect_moderation_labels(Image={"Bytes": io.BytesIO(jpeg.tobytes()).getvalue()})
        except Exception as exc:  # noqa: BLE001 - boto3 raises its own exception hierarchy
            raise RuntimeError(f"AWS Rekognition moderation call failed: {exc}") from exc

        for label in response.get("ModerationLabels", []):
            name = label.get("Name", "")
            confidence = label.get("Confidence", 0.0) / 100.0  # Rekognition uses 0-100, not 0-1
            if confidence >= NSFW_CONFIDENCE_THRESHOLD:
                hit_labels.add(name)

    return ModerationResult(flagged=bool(hit_labels), labels=sorted(hit_labels))


def screen_frames(frames: list[np.ndarray]) -> ModerationResult:
    """Dispatches to whichever moderation backend MODERATION_PROVIDER names
    - "local" (default) or "aws" today, see module docstring for adding
    another. This is the single entrypoint every caller (video and image
    routes alike) should use, so a provider switch takes effect everywhere
    at once rather than needing every call site updated individually.
    """
    provider = os.environ.get("MODERATION_PROVIDER", "local")
    if provider == "local":
        return screen_frames_local(frames)
    if provider == "aws":
        return screen_frames_cloud(frames)
    raise NotImplementedError(
        f"MODERATION_PROVIDER={provider!r} is not wired up - add a provider "
        "branch here and (if needed) a new screen_frames_*() function in "
        "this module."
    )


def screen_video(path: str) -> ModerationResult:
    """Samples frames across the video at `path` and screens them.

    Raises:
        ValueError: if no frames could be read (mirrors probe_video).
        NotImplementedError: if MODERATION_PROVIDER names a provider that
            hasn't been wired up yet (see module docstring).
    """
    frames = sample_frames(path, NSFW_SAMPLE_FRAMES)
    return screen_frames(frames)
