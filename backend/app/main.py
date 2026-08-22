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
import os
import tempfile
import time
import traceback
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from app import jobs
from app.config import (
    BG_REMOVE_PREVIEW_MAX_MEGAPIXELS,
    MAX_VIDEO_DURATION_SECONDS,
    MAX_VIDEO_UPLOAD_BYTES,
    MIN_REGION_PX,
    RESOLUTION_HEIGHTS,
    SHARPEN_AMOUNT_PRESETS,
)
from app.pipeline import detect_artifacts, io_utils, moderation
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
    expose_headers=["X-Video-Width", "X-Video-Height", "X-Video-Duration", "X-Video-Fps"],
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

    return Response(
        content=frame_png,
        media_type="image/png",
        headers={
            "X-Video-Width": str(info.width),
            "X-Video-Height": str(info.height),
            "X-Video-Duration": str(info.duration),
            "X-Video-Fps": str(info.fps),
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
):
    """Removes (delogo) or replaces (overlay) a user-marked rectangular
    region for the full video duration. The region is always user-supplied -
    see app/pipeline/video.py for why there's no automatic watermark
    detector.
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

        if info.duration > MAX_VIDEO_DURATION_SECONDS:
            raise HTTPException(
                status_code=400,
                detail=f"Video too long ({info.duration:.0f}s); max supported is {MAX_VIDEO_DURATION_SECONDS:.0f}s",
            )
        if x < 0 or y < 0 or x + w > info.width or y + h > info.height:
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
