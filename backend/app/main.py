"""FastAPI backend for WipeClip.co's video watermark/object removal.

Run locally:
    uvicorn app.main:app --reload --port 8000

Environment variables:
    ALLOWED_ORIGINS      comma-separated list of allowed CORS origins
                         (default "*" - tighten this for production)
    MODERATION_PROVIDER  content-moderation backend for video endpoints:
                         "local" (default, self-hosted nudity classifier)
                         or a hosted provider you've wired up - see
                         app/pipeline/moderation.py
    INTERNAL_API_SECRET  if set, /api/video/process requires this exact
                         value in an X-Internal-Process-Secret header.
                         The Next.js frontend's /api/process route (which
                         checks and spends credits before forwarding here)
                         sends it automatically - this is what stops that
                         credit check from being bypassable by calling this
                         backend directly. Unset by default so local dev
                         works with no extra config, same as ALLOWED_ORIGINS.
    ENABLE_API_DOCS      set to "1" to serve /docs, /redoc and /openapi.json.
                         Off by default: this API has no per-endpoint auth
                         beyond INTERNAL_API_SECRET above, so a public
                         Swagger UI just makes every route easier to find
                         and hit directly. Turn it on for local debugging
                         only.
    REDIS_URL            optional. When set, video/image processing jobs
                         run through an RQ queue (a separate `python -m
                         app.worker` process) instead of inline in the
                         request - see app/queue.py for the full contract
                         and its filesystem-locality caveat. Unset by
                         default, same "no-op until configured" pattern as
                         INTERNAL_API_SECRET above.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import tempfile
import time
import traceback
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError

from app import jobs
from app.config import (
    BG_REMOVE_PREVIEW_MAX_MEGAPIXELS,
    EDITOR_MAX_AUDIO,
    EDITOR_MAX_AUDIO_BYTES,
    EDITOR_MAX_CLIPS,
    EDITOR_MAX_EFFECTS,
    EDITOR_MAX_FPS,
    EDITOR_MAX_SOURCES,
    EDITOR_MAX_STICKER_BYTES,
    EDITOR_MAX_STICKER_DIMENSION,
    EDITOR_MAX_STICKERS,
    EDITOR_MAX_TOTAL_UPLOAD_BYTES,
    EDITOR_MAX_TRANSITION_SECONDS,
    MAX_VIDEO_DURATION_SECONDS,
    MAX_VIDEO_UPLOAD_BYTES,
    MIN_REGION_PX,
    RESOLUTION_HEIGHTS,
    SHARPEN_AMOUNT_PRESETS,
)
from app.pipeline import detect_artifacts, io_utils, moderation
from app.pipeline import editor as editor_pipeline
from app.pipeline import video as video_pipeline
from app.queue import get_queue

# Scaffolded but inert: with SENTRY_DSN unset, sentry_sdk.init() is simply
# never called, so this has zero effect - same "no-op until configured"
# pattern as INTERNAL_API_SECRET/MODERATION_PROVIDER/REDIS_URL above.
_sentry_dsn = os.environ.get("SENTRY_DSN")
if _sentry_dsn:
    import sentry_sdk

    sentry_sdk.init(dsn=_sentry_dsn, traces_sample_rate=0.1)

_docs_enabled = os.environ.get("ENABLE_API_DOCS") == "1"
app = FastAPI(
    title="WipeClip.co API",
    version="1.0.0",
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

_origins = os.environ.get("ALLOWED_ORIGINS", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _origins == "*" else [o.strip() for o in _origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
    # Response headers aren't readable via fetch() cross-origin unless
    # explicitly exposed - browsers only allow the CORS-safelisted set by
    # default. The video probe endpoint returns metadata as custom headers
    # (X-Video-*) alongside the PNG body, so those need to be listed here.
    expose_headers=["X-Video-Width", "X-Video-Height", "X-Video-Duration", "X-Video-Fps", "X-Video-Has-Audio"],
)


def _assert_internal_caller(request: Request) -> None:
    """See INTERNAL_API_SECRET in the module docstring. No-op if the
    secret isn't configured, so local dev works without extra setup.
    """
    expected = os.environ.get("INTERNAL_API_SECRET")
    if not expected:
        return
    if request.headers.get("X-Internal-Process-Secret") != expected:
        raise HTTPException(status_code=403, detail="Direct calls to this endpoint aren't permitted.")


def _assert_video_safe(path: str) -> None:
    """Screens the video at `path` for explicit content; see
    app/pipeline/moderation.py for what this does and doesn't cover.
    """
    try:
        result = moderation.screen_video(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result.flagged:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "content_blocked",
                "message": "This video appears to contain explicit content and can't be processed here.",
            },
        )


def _assert_image_safe(bgra) -> None:
    """Image-upload equivalent of _assert_video_safe: screens a single
    decoded frame through moderation.screen_frames() - the same
    MODERATION_PROVIDER-dispatching entrypoint video uses, so a provider
    switch (e.g. to MODERATION_PROVIDER=aws) covers both without a
    separate image-specific code path.
    """
    try:
        result = moderation.screen_frames([bgra[..., :3]])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result.flagged:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "content_blocked",
                "message": "This image appears to contain explicit content and can't be processed here.",
            },
        )


async def _run_pipeline_job(job_func, *args, timeout: float) -> None:
    """Runs one of app/jobs.py's synchronous job functions - through the RQ
    queue when REDIS_URL is configured (see app/queue.py), otherwise inline
    via asyncio.to_thread so it still doesn't block the event loop. Same
    call site either way; only where the work actually executes differs.

    Raises:
        RuntimeError: if a queued job failed on the worker.
        TimeoutError: if it didn't finish within `timeout` seconds.
    """
    queue = get_queue()
    if queue is None:
        await asyncio.to_thread(job_func, *args)
        return

    job = queue.enqueue(job_func, *args, job_timeout=int(timeout) + 30, result_ttl=300, failure_ttl=300)

    def _wait_for_job() -> None:
        deadline = time.monotonic() + timeout
        while True:
            job.refresh()
            if job.is_finished:
                return
            if job.is_failed:
                raise RuntimeError(f"Processing job failed: {job.exc_info}")
            if time.monotonic() >= deadline:
                raise TimeoutError("Processing timed out")
            time.sleep(0.5)

    await asyncio.to_thread(_wait_for_job)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/video/probe")
async def api_video_probe(file: UploadFile = File(...)):
    """Returns a representative preview frame (PNG) plus video metadata as
    response headers, so the frontend can let the user draw a watermark
    region against real pixel coordinates before committing to a full encode.
    """
    data = await file.read()
    if len(data) > MAX_VIDEO_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400, detail=f"Video too large (max {MAX_VIDEO_UPLOAD_BYTES // (1024 * 1024)}MB)"
        )

    with tempfile.TemporaryDirectory() as tmp:
        in_path = os.path.join(tmp, f"input{Path(file.filename or '').suffix or '.mp4'}")
        with open(in_path, "wb") as f:
            f.write(data)
        try:
            info, frame_png = video_pipeline.probe_video(in_path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if info.duration > MAX_VIDEO_DURATION_SECONDS:
            raise HTTPException(
                status_code=400,
                detail=f"Video too long ({info.duration:.0f}s); max supported is {MAX_VIDEO_DURATION_SECONDS:.0f}s",
            )

        _assert_video_safe(in_path)

        # Only the editor reads this (to show "no audio" and to know whether
        # a silent track needs synthesizing on export); best-effort so a
        # parsing surprise never fails a probe that otherwise succeeded.
        try:
            has_audio = editor_pipeline.probe_media(in_path).has_audio
        except Exception:  # noqa: BLE001
            has_audio = True

    return Response(
        content=frame_png,
        media_type="image/png",
        headers={
            "X-Video-Width": str(info.width),
            "X-Video-Height": str(info.height),
            "X-Video-Duration": str(info.duration),
            "X-Video-Fps": str(info.fps),
            "X-Video-Has-Audio": "1" if has_audio else "0",
        },
    )


@app.post("/api/video/detect-watermark")
async def api_video_detect_watermark(file: UploadFile = File(...)):
    """Suggests a likely watermark/logo region by finding areas that stay
    pixel-static across sampled frames while the rest of the frame moves -
    see detect_watermark_candidates() in app/pipeline/video.py. Coordinates
    only, never processes the video; the frontend prefills RegionSelector
    with the top candidate for the user to accept, drag, or ignore.
    """
    data = await file.read()
    if len(data) > MAX_VIDEO_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400, detail=f"Video too large (max {MAX_VIDEO_UPLOAD_BYTES // (1024 * 1024)}MB)"
        )

    with tempfile.TemporaryDirectory() as tmp:
        in_path = os.path.join(tmp, f"input{Path(file.filename or '').suffix or '.mp4'}")
        with open(in_path, "wb") as f:
            f.write(data)
        try:
            candidates, width, height = video_pipeline.detect_watermark_candidates(in_path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "width": width,
        "height": height,
        "candidates": [
            {"x": c.x, "y": c.y, "w": c.w, "h": c.h, "confidence": c.confidence, "label": c.label}
            for c in candidates
        ],
    }


@app.post("/api/video/process")
async def api_video_process(
    request: Request,
    file: UploadFile = File(...),
    mode: str = Form(...),  # "remove" | "replace"
    x: int = Form(...),
    y: int = Form(...),
    w: int = Form(...),
    h: int = Form(...),
    resolution: str = Form("720p"),  # "720p" | "1080p" | "4k"
    quality: str = Form("standard"),  # "standard" | "pro" - see remove_logo() in video.py
    logo: Optional[UploadFile] = File(None),
    start: Optional[float] = Form(None),  # optional source-time range (seconds) -
    end: Optional[float] = Form(None),  # see the docstring
):
    """Removes (delogo) or replaces (overlay) a user-marked rectangular
    region for the full video duration. The region is always user-supplied -
    see app/pipeline/video.py for why there's no automatic watermark
    detector.

    `start`/`end`, when both given, restrict the job to that range of the
    upload: it's cut out first (editor.cut_range) and only the cut is
    processed and returned. The browser editor uses this to run AI cleanup
    on one timeline segment. The cut is in display orientation, so the
    region is then expected in display-oriented pixels too - which is what
    the editor's frame grab gives it. Omitted, behavior is unchanged.
    """
    _assert_internal_caller(request)
    if mode not in ("remove", "replace"):
        raise HTTPException(status_code=400, detail="mode must be 'remove' or 'replace'")
    if resolution not in RESOLUTION_HEIGHTS:
        raise HTTPException(
            status_code=400,
            detail=f"resolution must be one of {', '.join(RESOLUTION_HEIGHTS)}",
        )
    if quality not in ("standard", "pro"):
        raise HTTPException(status_code=400, detail="quality must be 'standard' or 'pro'")
    if w < MIN_REGION_PX or h < MIN_REGION_PX:
        raise HTTPException(status_code=400, detail=f"Region too small; minimum {MIN_REGION_PX}px per side")
    if mode == "replace" and logo is None:
        raise HTTPException(status_code=400, detail="A logo image is required for mode='replace'")

    data = await file.read()
    if len(data) > MAX_VIDEO_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400, detail=f"Video too large (max {MAX_VIDEO_UPLOAD_BYTES // (1024 * 1024)}MB)"
        )

    with tempfile.TemporaryDirectory() as tmp:
        in_path = os.path.join(tmp, f"input{Path(file.filename or '').suffix or '.mp4'}")
        out_path = os.path.join(tmp, "output.mp4")
        with open(in_path, "wb") as f:
            f.write(data)

        try:
            info, _ = video_pipeline.probe_video(in_path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if (start is None) != (end is None):
            raise HTTPException(status_code=400, detail="start and end must be given together")
        if start is not None and end is not None:
            source_duration = max(info.duration, editor_pipeline.probe_media(in_path).duration)
            if not (math.isfinite(start) and math.isfinite(end)) or start < 0 or end - start < 0.1:
                raise HTTPException(status_code=400, detail="Invalid time range")
            if start >= source_duration:
                raise HTTPException(status_code=400, detail="Time range is outside the video")
            end = min(end, source_duration)
            cut_path = os.path.join(tmp, "range.mp4")
            try:
                await editor_pipeline.cut_range(in_path, cut_path, start, end)
                info, _ = video_pipeline.probe_video(cut_path)
            except (RuntimeError, ValueError) as exc:
                traceback.print_exc()
                raise HTTPException(status_code=400, detail="Could not read that part of the video") from exc
            in_path = cut_path

        if info.duration > MAX_VIDEO_DURATION_SECONDS:
            raise HTTPException(
                status_code=400,
                detail=f"Video too long ({info.duration:.0f}s); max supported is {MAX_VIDEO_DURATION_SECONDS:.0f}s",
            )
        # The region is drawn in the browser against a scaled-up preview, so
        # rounding on the way back to source pixels can push an edge-flush box
        # a pixel past the frame - and ffmpeg's crop/overlay (and delogo
        # before it) reject a region that isn't fully inside. Clamp into
        # bounds rather than 400-ing: a box the user deliberately dragged to
        # the very corner is a valid request. Only a region with no real
        # overlap, or one that collapses below the minimum once clamped, is a
        # genuine error.
        x0 = max(0, min(x, info.width))
        y0 = max(0, min(y, info.height))
        x1 = max(0, min(x + w, info.width))
        y1 = max(0, min(y + h, info.height))
        x, y, w, h = x0, y0, x1 - x0, y1 - y0
        if w < MIN_REGION_PX or h < MIN_REGION_PX:
            raise HTTPException(status_code=400, detail="Region is outside the video frame")

        _assert_video_safe(in_path)

        # Never upscale: only pass a target height when it's actually
        # smaller than the source, otherwise leave the source resolution as-is.
        requested_height = RESOLUTION_HEIGHTS[resolution]
        output_height = requested_height if requested_height < info.height else None

        # Generous bound relative to remove_logo's own measured ~6.5x
        # realtime FSR pass (see WATERMARK_FSR_* in config.py), so a queued
        # job gets real headroom before _run_pipeline_job gives up on it.
        # quality="pro" does extra per-frame optical-flow work on top of
        # that (see WATERMARK_FLOW_* in config.py), so it gets a wider bound.
        job_timeout = max(180.0, info.duration * (16 if quality == "pro" else 10))

        try:
            if mode == "remove":
                await _run_pipeline_job(
                    jobs.remove_logo_job,
                    in_path,
                    out_path,
                    x,
                    y,
                    w,
                    h,
                    output_height,
                    quality,
                    timeout=job_timeout,
                )
            else:
                assert logo is not None  # checked above
                logo_data = await logo.read()
                logo_path = os.path.join(tmp, "logo.png")
                with open(logo_path, "wb") as f:
                    f.write(logo_data)
                await _run_pipeline_job(
                    jobs.replace_logo_job,
                    in_path,
                    out_path,
                    logo_path,
                    x,
                    y,
                    w,
                    h,
                    output_height,
                    timeout=job_timeout,
                )
        except Exception as exc:  # noqa: BLE001
            # Broad on purpose (not just RuntimeError): ffmpeg failures are
            # RuntimeError, but subprocess-launch failures (e.g. a bad ffmpeg
            # path, or platform-specific asyncio subprocess issues) surface
            # as other exception types entirely - swallowing those behind a
            # narrow except left this endpoint returning a content-free 500
            # with no way to tell what actually broke.
            traceback.print_exc()
            raise HTTPException(
                status_code=500, detail=f"Video processing failed: {type(exc).__name__}: {exc}"
            ) from exc

        with open(out_path, "rb") as f:
            result = f.read()

    return Response(content=result, media_type="video/mp4")


_HEX_COLOR = r"^#[0-9a-fA-F]{6}$"


class _EditorTransition(BaseModel):
    type: str
    duration: float = Field(ge=0, le=EDITOR_MAX_TRANSITION_SECONDS)


class _EditorAdjust(BaseModel):
    brightness: float = Field(0, ge=-100, le=100)
    contrast: float = Field(0, ge=-100, le=100)
    saturation: float = Field(0, ge=-100, le=100)
    exposure: float = Field(0, ge=-100, le=100)
    temperature: float = Field(0, ge=-100, le=100)
    tint: float = Field(0, ge=-100, le=100)
    highlights: float = Field(0, ge=-100, le=100)
    shadows: float = Field(0, ge=-100, le=100)
    sharpness: float = Field(0, ge=0, le=100)
    blur: float = Field(0, ge=0, le=100)
    opacity: float = Field(100, ge=0, le=100)


class _EditorLook(BaseModel):
    filter: str = "original"
    intensity: float = Field(100, ge=0, le=100)
    adjust: _EditorAdjust = Field(default_factory=_EditorAdjust)


class _EditorTransform(BaseModel):
    x: float = Field(0.5, ge=-1, le=2)
    y: float = Field(0.5, ge=-1, le=2)
    scale: float = Field(1, ge=0.1, le=4)
    rotation: float = Field(0, ge=-360, le=360)


class _EditorClip(BaseModel):
    source: int = Field(ge=0, lt=EDITOR_MAX_SOURCES)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    transition: Optional[_EditorTransition] = None
    speed: float = Field(1, ge=0.5, le=2)
    volume: float = Field(1, ge=0, le=2)
    transform: _EditorTransform = Field(default_factory=_EditorTransform)
    look: _EditorLook = Field(default_factory=_EditorLook)


class _EditorOverlay(BaseModel):
    image: int = Field(ge=0, lt=EDITOR_MAX_STICKERS)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    x: float = Field(ge=-0.5, le=1.5)
    y: float = Field(ge=-0.5, le=1.5)
    width: float = Field(ge=0.01, le=3.0)
    rotation: float = Field(ge=-360, le=360)
    opacity: float = Field(1, ge=0, le=1)
    animIn: str = "none"
    animOut: str = "none"


class _EditorAudio(BaseModel):
    # Exactly one of: an uploaded audio file (index into `audios`), or a
    # video source (index into `sources`) for "Extract audio".
    audio: Optional[int] = Field(None, ge=0, lt=EDITOR_MAX_AUDIO)
    video: Optional[int] = Field(None, ge=0, lt=EDITOR_MAX_SOURCES)
    start: float = Field(ge=0)
    offset: float = Field(0, ge=0)
    duration: float = Field(gt=0)
    volume: float = Field(1, ge=0, le=2)
    fadeIn: float = Field(0, ge=0, le=10)
    fadeOut: float = Field(0, ge=0, le=10)


class _EditorEffect(BaseModel):
    type: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    intensity: float = Field(50, ge=0, le=100)


class _EditorBackground(BaseModel):
    type: str = "color"  # color | gradient | blur | image
    color: str = Field("#000000", pattern=_HEX_COLOR)
    color2: str = Field("#000000", pattern=_HEX_COLOR)


class _EditorCanvas(BaseModel):
    aspect: str = "original"
    fit: str = "fit"
    background: _EditorBackground = Field(default_factory=_EditorBackground)


class _EditorProject(BaseModel):
    clips: list[_EditorClip] = Field(min_length=1, max_length=EDITOR_MAX_CLIPS)
    overlays: list[_EditorOverlay] = Field(default_factory=list, max_length=EDITOR_MAX_STICKERS)
    audio: list[_EditorAudio] = Field(default_factory=list, max_length=EDITOR_MAX_AUDIO)
    effects: list[_EditorEffect] = Field(default_factory=list, max_length=EDITOR_MAX_EFFECTS)
    canvas: _EditorCanvas = Field(default_factory=_EditorCanvas)


_VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
_AUDIO_SUFFIXES = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac", ".webm"}
_CANVAS_ASPECTS = {"16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1.0, "4:5": 4 / 5, "4:3": 4 / 3}


def _save_upload(upload: UploadFile, path: str, max_bytes: int) -> int:
    """Streams an upload to `path` in chunks (never the whole file in
    memory) and returns its size; raises 400 past `max_bytes`.
    """
    written = 0
    upload.file.seek(0)
    with open(path, "wb") as out:
        while chunk := upload.file.read(1024 * 1024):
            written += len(chunk)
            if written > max_bytes:
                raise HTTPException(
                    status_code=400, detail=f"File too large (max {max_bytes // (1024 * 1024)}MB)"
                )
            out.write(chunk)
    return written


def _load_image_upload(upload: UploadFile, tmp: str, name: str) -> tuple[str, int, int]:
    """Decodes, size-checks, moderation-screens and re-encodes an image
    upload (overlay or background) to a clean RGBA PNG; returns its path
    and size."""
    raw_path = os.path.join(tmp, f"{name}.upload")
    _save_upload(upload, raw_path, EDITOR_MAX_STICKER_BYTES)
    img = cv2.imdecode(np.fromfile(raw_path, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None or img.ndim not in (2, 3):
        raise HTTPException(status_code=400, detail="An image could not be read")
    ih, iw = img.shape[:2]
    if iw < 2 or ih < 2 or max(iw, ih) > EDITOR_MAX_STICKER_DIMENSION:
        raise HTTPException(status_code=400, detail="An image has an unsupported size")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGRA)
    elif img.shape[2] == 3:
        img = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    _assert_image_safe(img)
    clean_path = os.path.join(tmp, f"{name}.png")
    if not cv2.imwrite(clean_path, img):
        raise HTTPException(status_code=500, detail="Could not prepare an image")
    return clean_path, iw, ih


@app.post("/api/video/export")
async def api_video_export(
    request: Request,
    project: str = Form(...),
    resolution: str = Form("720p"),
    sources: list[UploadFile] = File(...),
    overlays: list[UploadFile] = File(default=[]),
    audios: list[UploadFile] = File(default=[]),
    background: Optional[UploadFile] = File(None),
):
    """Renders a browser-editor project (see app/pipeline/editor.py) into
    one MP4. `sources[0]` is the original upload and sets the frame rate and
    (with the canvas aspect) the output size; further sources are AI-cleaned
    segments. `overlays` are the PNGs for stickers/text/images, `audios`
    uploaded audio files, `background` an optional canvas background image.
    `project` is the JSON timeline - see _EditorProject.

    Nothing the client says about a file is trusted: every video and audio
    file is re-probed (videos are moderation-screened too), every image is
    decoded, size-checked, screened and re-encoded, all ranges are validated
    against probed durations, and every name (transition, filter, effect,
    animation, canvas) is whitelisted. Credits are handled by the Next.js
    /api/export route in front of this, exactly like /api/video/process.
    """
    _assert_internal_caller(request)
    if resolution not in RESOLUTION_HEIGHTS:
        raise HTTPException(
            status_code=400, detail=f"resolution must be one of {', '.join(RESOLUTION_HEIGHTS)}"
        )
    if not sources or len(sources) > EDITOR_MAX_SOURCES:
        raise HTTPException(status_code=400, detail="Invalid number of source videos")
    if len(overlays) > EDITOR_MAX_STICKERS or len(audios) > EDITOR_MAX_AUDIO:
        raise HTTPException(status_code=400, detail="Too many layers")

    try:
        spec = _EditorProject.model_validate(json.loads(project))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(status_code=400, detail="Invalid project data") from exc

    for c in spec.clips:
        if c.source >= len(sources):
            raise HTTPException(status_code=400, detail="Clip refers to a missing source video")
        if c.transition and c.transition.type not in editor_pipeline.TRANSITIONS:
            raise HTTPException(status_code=400, detail="Unknown transition")
        if c.look.filter not in editor_pipeline.FILTER_IDS:
            raise HTTPException(status_code=400, detail="Unknown filter")
    for o in spec.overlays:
        if o.image >= len(overlays):
            raise HTTPException(status_code=400, detail="Layer refers to a missing image")
        if o.animIn not in editor_pipeline.ANIMS_IN or o.animOut not in editor_pipeline.ANIMS_OUT:
            raise HTTPException(status_code=400, detail="Unknown animation")
    for a in spec.audio:
        if (a.audio is None) == (a.video is None):
            raise HTTPException(status_code=400, detail="Invalid audio clip")
        if (a.audio is not None and a.audio >= len(audios)) or (a.video is not None and a.video >= len(sources)):
            raise HTTPException(status_code=400, detail="Audio clip refers to a missing file")
    for e in spec.effects:
        if e.type not in editor_pipeline.EFFECTS:
            raise HTTPException(status_code=400, detail="Unknown effect")
    canvas = spec.canvas
    if canvas.aspect != "original" and canvas.aspect not in _CANVAS_ASPECTS:
        raise HTTPException(status_code=400, detail="Unknown canvas size")
    if canvas.fit not in ("fit", "fill") or canvas.background.type not in ("color", "gradient", "blur", "image"):
        raise HTTPException(status_code=400, detail="Invalid canvas settings")
    if canvas.background.type == "image" and background is None:
        raise HTTPException(status_code=400, detail="Background image missing")

    with tempfile.TemporaryDirectory() as tmp:
        total_bytes = 0
        source_paths: list[str] = []
        source_infos: list[editor_pipeline.MediaInfo] = []
        for i, upload in enumerate(sources):
            suffix = Path(upload.filename or "").suffix.lower()
            path = os.path.join(tmp, f"source{i}{suffix if suffix in _VIDEO_SUFFIXES else '.mp4'}")
            total_bytes += _save_upload(upload, path, MAX_VIDEO_UPLOAD_BYTES)
            if total_bytes > EDITOR_MAX_TOTAL_UPLOAD_BYTES:
                raise HTTPException(status_code=400, detail="Project files are too large to export together")
            try:
                info = editor_pipeline.probe_media(path)
                # OpenCV's read also proves frames actually decode (probe_media
                # only parses container metadata) - catches truncated files.
                cv_info, _ = video_pipeline.probe_video(path)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="One of the videos could not be read") from exc
            info.duration = max(info.duration, cv_info.duration)
            if info.duration > MAX_VIDEO_DURATION_SECONDS + 1:
                raise HTTPException(status_code=400, detail="Video too long")
            _assert_video_safe(path)
            source_paths.append(path)
            source_infos.append(info)

        audio_paths: list[str] = []
        audio_durations: list[float] = []
        for i, upload in enumerate(audios):
            suffix = Path(upload.filename or "").suffix.lower()
            path = os.path.join(tmp, f"audio{i}{suffix if suffix in _AUDIO_SUFFIXES else '.bin'}")
            total_bytes += _save_upload(upload, path, EDITOR_MAX_AUDIO_BYTES)
            if total_bytes > EDITOR_MAX_TOTAL_UPLOAD_BYTES:
                raise HTTPException(status_code=400, detail="Project files are too large to export together")
            try:
                audio_durations.append(editor_pipeline.probe_audio(path))
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="An audio file could not be read") from exc
            audio_paths.append(path)

        overlay_images = [_load_image_upload(u, tmp, f"overlay{i}") for i, u in enumerate(overlays)]
        background_path = _load_image_upload(background, tmp, "background")[0] if background is not None else None

        # Output canvas: the original's frame rate; its display size, or the
        # chosen aspect ratio at the original's short side. The short side is
        # then capped (never upscaled) at the requested resolution, and both
        # sides rounded down to even numbers for yuv420p.
        base = source_infos[0]
        short_side = min(base.width, base.height)
        if canvas.aspect == "original":
            cw, ch = float(base.width), float(base.height)
        else:
            ar = _CANVAS_ASPECTS[canvas.aspect]
            cw, ch = (short_side * ar, float(short_side)) if ar >= 1 else (float(short_side), short_side / ar)
        scale = min(1.0, RESOLUTION_HEIGHTS[resolution] / min(cw, ch)) if short_side > 0 else 1.0
        out_w = max(2, int(cw * scale) // 2 * 2)
        out_h = max(2, int(ch * scale) // 2 * 2)
        fps = base.fps if 1 <= base.fps <= EDITOR_MAX_FPS else (EDITOR_MAX_FPS if base.fps > EDITOR_MAX_FPS else 30.0)

        plan_clips: list[editor_pipeline.PlanClip] = []
        for c in spec.clips:
            info = source_infos[c.source]
            end = min(c.end, info.duration)
            if c.start >= end - 0.5 / fps:
                raise HTTPException(status_code=400, detail="A clip's time range is outside its video")
            plan_clips.append(
                editor_pipeline.PlanClip(
                    source_path=source_paths[c.source],
                    source_has_audio=info.has_audio,
                    source_width=info.width,
                    source_height=info.height,
                    start=c.start,
                    duration=end - c.start,
                    transition=c.transition.type if c.transition and c.transition.duration > 0 else None,
                    transition_duration=c.transition.duration if c.transition else 0.0,
                    speed=c.speed,
                    volume=c.volume,
                    x=c.transform.x,
                    y=c.transform.y,
                    scale=c.transform.scale,
                    rotation=c.transform.rotation,
                    filter=c.look.filter,
                    intensity=c.look.intensity,
                    adjust=c.look.adjust.model_dump(),
                )
            )

        plan = editor_pipeline.ExportPlan(
            width=out_w,
            height=out_h,
            fps=round(fps, 3),
            with_audio=False,
            clips=plan_clips,
            fit=canvas.fit,
            background=canvas.background.type,
            color=canvas.background.color,
            color2=canvas.background.color2,
            background_image=background_path,
        )
        editor_pipeline.quantize_plan(plan)
        total = editor_pipeline.timeline_duration(plan)
        if total > MAX_VIDEO_DURATION_SECONDS:
            raise HTTPException(status_code=400, detail="The edited video is too long to export")

        # Layers entirely past the end of the (possibly shortened) timeline
        # are skipped; the rest are clamped to it.
        for o in spec.overlays:
            start, end = o.start, min(o.end, total)
            if end - start < 0.05:
                continue
            path, iw, ih = overlay_images[o.image]
            plan.overlays.append(
                editor_pipeline.PlanOverlay(
                    image_path=path, image_width=iw, image_height=ih, start=start, end=end,
                    x=o.x, y=o.y, width=o.width, rotation=o.rotation, opacity=o.opacity,
                    anim_in=o.animIn, anim_out=o.animOut,
                )
            )
        for e in spec.effects:
            start, end = e.start, min(e.end, total)
            if end - start >= 0.05:
                plan.effects.append(editor_pipeline.PlanEffect(type=e.type, start=start, end=end, intensity=e.intensity))
        for a in spec.audio:
            if a.audio is not None:
                path, src_duration = audio_paths[a.audio], audio_durations[a.audio]
            else:
                info = source_infos[a.video]  # type: ignore[index]
                if not info.has_audio:
                    continue
                path, src_duration = source_paths[a.video], info.duration  # type: ignore[index]
            duration = min(a.duration, src_duration - a.offset, total - a.start)
            if duration < 0.05:
                continue
            plan.audio.append(
                editor_pipeline.PlanAudio(
                    path=path, start=a.start, offset=a.offset, duration=duration,
                    volume=a.volume, fade_in=min(a.fadeIn, duration / 2), fade_out=min(a.fadeOut, duration / 2),
                )
            )
        plan.with_audio = bool(plan.audio) or any(source_infos[c.source].has_audio for c in spec.clips)

        out_path = os.path.join(tmp, "export.mp4")
        plan_json = json.dumps(
            {
                **{k: getattr(plan, k) for k in ("width", "height", "fps", "with_audio", "fit", "background", "color", "color2", "background_image")},
                "clips": [vars(c) for c in plan.clips],
                "overlays": [vars(o) for o in plan.overlays],
                "audio": [vars(a) for a in plan.audio],
                "effects": [vars(e) for e in plan.effects],
            }
        )
        # Full re-encode of the timeline plus per-clip decode seeks; layers,
        # effects and grading add compositing work on top.
        job_timeout = max(180.0, total * (8 + 0.5 * (len(plan.overlays) + len(plan.effects))))
        try:
            await _run_pipeline_job(jobs.editor_export_job, plan_json, out_path, timeout=job_timeout)
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "export_failed",
                    "message": "Export failed. Your original video is safe. Please try exporting again.",
                },
            ) from exc

        with open(out_path, "rb") as f:
            result = f.read()

    return Response(content=result, media_type="video/mp4")



@app.post("/api/image/detect-artifacts")
async def api_image_detect_artifacts(file: UploadFile = File(...)):
    """Suggests likely watermark/blemish regions via detect_artifacts.
    detect_artifact_candidates() - suggest-only, never processes the image;
    the frontend prefills RegionSelector with the top candidate, same
    suggest-then-confirm contract as /api/video/detect-watermark.
    """
    data = await file.read()
    try:
        bgra, _ = io_utils.decode_upload_to_bgra(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    candidates = detect_artifacts.detect_artifact_candidates(bgra)
    h, w = bgra.shape[:2]
    return {
        "width": w,
        "height": h,
        "candidates": [
            {"x": c.x, "y": c.y, "w": c.w, "h": c.h, "confidence": c.confidence} for c in candidates
        ],
    }


@app.post("/api/image/remove")
async def api_image_remove(
    request: Request,
    file: UploadFile = File(...),
    x: int = Form(...),
    y: int = Form(...),
    w: int = Form(...),
    h: int = Form(...),
):
    """Reconstructs a user-marked rectangular region via manual_inpaint's
    paint-to-remove path - the image analogue of /api/video/process's
    mode='remove'. The mask is built from the same x/y/w/h rectangle
    RegionSelector already produces, rather than a freehand-drawn mask, so
    the frontend can reuse RegionSelector as-is.
    """
    _assert_internal_caller(request)
    if w < MIN_REGION_PX or h < MIN_REGION_PX:
        raise HTTPException(status_code=400, detail=f"Region too small; minimum {MIN_REGION_PX}px per side")

    data = await file.read()
    try:
        bgra, icc_profile = io_utils.decode_upload_to_bgra(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    img_h, img_w = bgra.shape[:2]
    if x < 0 or y < 0 or x + w > img_w or y + h > img_h:
        raise HTTPException(status_code=400, detail="Region is outside the image")

    _assert_image_safe(bgra)

    # Goes through the same temp-file + _run_pipeline_job path as video, even
    # inline (no REDIS_URL): image_remove_job re-decodes from in_path itself
    # (see app/jobs.py), so the icc_profile decoded above is only used for
    # the moderation/bounds checks here, not passed across the job boundary.
    with tempfile.TemporaryDirectory() as tmp:
        in_path = os.path.join(tmp, "input.png")
        out_path = os.path.join(tmp, "output.png")
        with open(in_path, "wb") as f:
            f.write(data)

        try:
            await _run_pipeline_job(jobs.image_remove_job, in_path, out_path, x, y, w, h, timeout=60.0)
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            raise HTTPException(
                status_code=500, detail=f"Image processing failed: {type(exc).__name__}: {exc}"
            ) from exc

        with open(out_path, "rb") as f:
            result = f.read()

    return Response(content=result, media_type="image/png")


@app.post("/api/image/sharpen")
async def api_image_sharpen(
    request: Request,
    file: UploadFile = File(...),
    strength: str = Form("standard"),  # "light" | "standard" | "strong"
):
    """Standalone selective-unsharp-mask pass (sharpen.sharpen), independent
    of auto-enhance's full bg-removal/decontam pipeline - just clarity/detail
    enhancement on the image as uploaded.
    """
    _assert_internal_caller(request)
    if strength not in SHARPEN_AMOUNT_PRESETS:
        raise HTTPException(
            status_code=400, detail=f"strength must be one of {', '.join(SHARPEN_AMOUNT_PRESETS)}"
        )

    data = await file.read()
    try:
        bgra, _ = io_utils.decode_upload_to_bgra(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    _assert_image_safe(bgra)

    with tempfile.TemporaryDirectory() as tmp:
        in_path = os.path.join(tmp, "input.png")
        out_path = os.path.join(tmp, "output.png")
        with open(in_path, "wb") as f:
            f.write(data)

        try:
            await _run_pipeline_job(
                jobs.image_sharpen_job, in_path, out_path, SHARPEN_AMOUNT_PRESETS[strength], timeout=60.0
            )
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            raise HTTPException(
                status_code=500, detail=f"Image processing failed: {type(exc).__name__}: {exc}"
            ) from exc

        with open(out_path, "rb") as f:
            result = f.read()

    return Response(content=result, media_type="image/png")


@app.post("/api/image/auto-enhance")
async def api_image_auto_enhance(
    request: Request,
    file: UploadFile = File(...),
    preview: bool = Form(False),
):
    """Runs the full background-removal + halo-decontamination + alpha
    cleanup + sharpen pipeline (full_pipeline.auto_enhance) at its defaults.

    `preview=true` downscales to BG_REMOVE_PREVIEW_MAX_MEGAPIXELS before
    processing - the Next.js /api/remove-background route hard-sets this
    for anonymous callers only (never trusts the client's own value, same
    "server decides, client can't override" pattern api_video_process uses
    for output resolution), matching remove.bg's free-tier resolution cap.
    """
    _assert_internal_caller(request)

    data = await file.read()
    try:
        bgra, _ = io_utils.decode_upload_to_bgra(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    _assert_image_safe(bgra)

    with tempfile.TemporaryDirectory() as tmp:
        in_path = os.path.join(tmp, "input.png")
        out_path = os.path.join(tmp, "output.png")
        with open(in_path, "wb") as f:
            f.write(data)

        preview_max_megapixels = BG_REMOVE_PREVIEW_MAX_MEGAPIXELS if preview else None
        try:
            await _run_pipeline_job(
                jobs.image_auto_enhance_job, in_path, out_path, preview_max_megapixels, timeout=60.0
            )
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            raise HTTPException(
                status_code=500, detail=f"Image processing failed: {type(exc).__name__}: {exc}"
            ) from exc

        with open(out_path, "rb") as f:
            result = f.read()

    return Response(content=result, media_type="image/png")
