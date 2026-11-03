"""FastAPI backend for WipeClip.co's video editing and object cleanup.

Run locally:
    uvicorn app.main:app --reload --port 8000

Environment variables:
    ALLOWED_ORIGINS      comma-separated list of allowed CORS origins
                         (default "*" - tighten this for production)
    MODERATION_PROVIDER  content-moderation backend for video endpoints:
                         "local" (default, self-hosted nudity classifier)
                         or a hosted provider you've wired up - see
                         app/pipeline/moderation.py
    INTERNAL_API_SECRET  if set, the image routes require this exact value
                         in an X-Internal-Process-Secret header (the Next.js
                         routes in front of them send it), and the job
                         tickets for /api/video/process and /api/video/export
                         must be signed with it (see app/tickets.py) - this
                         is what stops the credit and plan checks from being
                         bypassable by calling this backend directly. Unset
                         by default so local dev works with no extra config,
                         same as ALLOWED_ORIGINS. Required on Cloud Run (or
                         with REQUIRE_INTERNAL_SECRET=1): startup fails
                         without it. Upload tickets signed with it also
                         gate /api/video/upload-url and /api/video/probe.
    SITE_URL             the Next.js site, for claiming job tickets and
                         refunding failed paid jobs (app/tickets.py). Unset:
                         neither happens (local dev).
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
    MAX_CONCURRENT_JOBS  jobs run at once in inline mode (default 1); more
                         requests wait their turn - see app/config.py.
    JOB_THREADS          CPU threads per job (default cores / jobs).
    GCS_UPLOAD_BUCKET    optional. When set, the browser uploads videos for
                         /api/video/probe and /api/video/process straight to
                         this Cloud Storage bucket instead of to this server
                         - see app/uploads.py.
    EDITOR_MAX_REVERSE_BUFFER_MB  RAM budget for one reversed clip's frame
                         buffer (default 1024).
"""

from __future__ import annotations

import asyncio
import dataclasses
import hashlib
import hmac
import io
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import time
import traceback
import uuid
import wave
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, ValidationError
from starlette.background import BackgroundTask

from app import progress, jobs, tickets, uploads
from app.config import (
    IMAGE_PREVIEW_MAX_MEGAPIXELS,
    EDITOR_COMPACT_AUDIO_BITRATE,
    EDITOR_COMPACT_CRF,
    EDITOR_MAX_AUDIO,
    EDITOR_MAX_AUDIO_BYTES,
    EDITOR_MAX_LOCAL_AUDIO_BYTES,
    EDITOR_MAX_CAMERA_ROWS,
    EDITOR_MAX_CLIPS,
    EDITOR_MAX_EFFECTS,
    EDITOR_MAX_KEYFRAMES,
    EDITOR_MAX_GIF_SECONDS,
    EDITOR_MAX_DUCK_REGIONS,
    EDITOR_MAX_SPRITE_STATES,
    EDITOR_MAX_KEYFRAME_SPAN,
    EDITOR_MAX_FPS,
    EDITOR_MAX_FREEZE_SECONDS,
    EDITOR_MAX_MASK_ROWS,
    EDITOR_MAX_MASKS,
    EDITOR_MAX_POINTER_ROWS,
    EDITOR_MAX_REVERSE_BUFFER_BYTES,
    EDITOR_MAX_REVERSE_SECONDS,
    EDITOR_MAX_SOURCES,
    EDITOR_MAX_STICKER_BYTES,
    EDITOR_MAX_STICKER_DIMENSION,
    EDITOR_MAX_STICKERS,
    EDITOR_MAX_TOTAL_UPLOAD_BYTES,
    EDITOR_MAX_TRANSITION_SECONDS,
    LOCAL_MODE,
    LOCAL_TOKEN,
    MAX_CONCURRENT_JOBS,
    MAX_VIDEO_DURATION_SECONDS,
    MAX_VIDEO_UPLOAD_BYTES,
    MIN_REGION_PX,
    RESOLUTION_HEIGHTS,
    SHARPEN_AMOUNT_PRESETS,
)
from app.pipeline import activity, audio_clean, dub, encoders, io_utils, moderation, speech
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

# INTERNAL_API_SECRET is optional only so local dev needs no setup. Deployed
# (Cloud Run sets K_SERVICE; REQUIRE_INTERNAL_SECRET=1 covers other hosts),
# a missing secret would turn off every ticket and caller check, so refuse
# to start instead of serving an open API.
if (os.environ.get("K_SERVICE") or os.environ.get("REQUIRE_INTERNAL_SECRET") == "1") and not os.environ.get(
    "INTERNAL_API_SECRET"
):
    raise RuntimeError("INTERNAL_API_SECRET must be set in production.")
# The desktop engine listens on localhost, where any other program or web page
# could reach it; the per-launch token is what keeps it to the app.
if LOCAL_MODE and len(LOCAL_TOKEN) < 32:
    raise RuntimeError("WIPECLIP_LOCAL_TOKEN must be set (at least 32 characters) in local mode.")

_docs_enabled = os.environ.get("ENABLE_API_DOCS") == "1"
app = FastAPI(
    title="WipeClip.co API",
    version="1.0.0",
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

if LOCAL_MODE:
    # Registered before CORS so CORS wraps it: preflights (which can't carry
    # the header) get through, and a refusal still has CORS headers the app
    # can read.
    @app.middleware("http")
    async def _require_local_token(request: Request, call_next):
        if request.method != "OPTIONS":
            given = request.headers.get("X-Local-Token", "")
            if not hmac.compare_digest(given.encode(), LOCAL_TOKEN.encode()):
                return Response(status_code=403, content='{"detail":"Forbidden"}', media_type="application/json")
        return await call_next(request)


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
    given = request.headers.get("X-Internal-Process-Secret", "")
    if not hmac.compare_digest(given.encode(), expected.encode()):
        raise HTTPException(status_code=403, detail="Direct calls to this endpoint aren't permitted.")


# Desktop engine: what an export found out about a video on this machine,
# keyed by (path, size, modified time). Probing, the full decode check and the
# content screening take seconds on a long video and were redone on every
# export of the same, unchanged file.
_local_checks: dict[tuple[str, int, int], editor_pipeline.MediaInfo] = {}
_LOCAL_CHECKS_MAX = 64


def _checked_local_video(path: str) -> editor_pipeline.MediaInfo:
    """Probes, decode-checks and screens a video named by path (desktop
    engine), once per version of the file. Raises ValueError if it can't be
    read and HTTPException if screening refuses it."""
    st = os.stat(path)
    key = (path, st.st_size, st.st_mtime_ns)
    cached = _local_checks.get(key)
    if cached is not None:
        return dataclasses.replace(cached)
    info = editor_pipeline.probe_media(path)
    # OpenCV's read also proves frames actually decode (probe_media only
    # parses container metadata) - catches truncated files.
    cv_info, _ = video_pipeline.probe_video(path)
    info.duration = max(info.duration, cv_info.duration)
    _assert_video_safe(path)
    if len(_local_checks) >= _LOCAL_CHECKS_MAX:
        _local_checks.clear()
    _local_checks[key] = dataclasses.replace(info)
    return info


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


# Inline mode's concurrency cap (see MAX_CONCURRENT_JOBS in config.py):
# requests past it wait here instead of all running at once and exhausting
# RAM. With RQ, the worker count bounds concurrency instead.
_job_slots = asyncio.Semaphore(MAX_CONCURRENT_JOBS)


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
        async with _job_slots:
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


def _stream_result(path: str, media_type: str) -> FileResponse:
    """Streams a job's output file instead of reading it into memory. The
    file is moved out of the request's TemporaryDirectory first (which is
    deleted as the handler returns) and removed once it has been sent.
    """
    fd, kept = tempfile.mkstemp(suffix=Path(path).suffix)
    os.close(fd)
    os.replace(path, kept)
    return FileResponse(kept, media_type=media_type, background=BackgroundTask(os.remove, kept))


def _kept_result(path: str, media_type: str) -> dict:
    """Desktop engine: moves a finished export into WIPECLIP_EXPORTS_DIR
    (set by the app, which copies it to where the user saves it and deletes
    it afterwards) and names it, instead of sending the bytes."""
    folder = os.environ.get("WIPECLIP_EXPORTS_DIR")
    if not folder:
        raise HTTPException(status_code=400, detail="This engine has no folder for finished exports.")
    os.makedirs(folder, exist_ok=True)
    kept = os.path.join(folder, f"{uuid.uuid4().hex}{Path(path).suffix}")
    shutil.move(path, kept)
    return {"path": kept, "size": os.path.getsize(kept), "type": media_type}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    """Progress of a job started with this `job_id` (app/progress.py):
    `phase` "checking" or "rendering", `progress` 0..1 while rendering."""
    job = progress.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="No such job.")
    return {"phase": job.phase, "progress": job.fraction()}


@app.post("/api/jobs/{job_id}/cancel")
def job_cancel(job_id: str) -> dict:
    """Stops a running job; its own request then answers 409 "cancelled"."""
    job = progress.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="No such job.")
    job.cancel.set()
    return {"cancelled": True}


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


def _upload_limit(ticket: dict) -> int:
    """The most bytes an upload ticket (see src/app/api/upload-ticket) lets
    one video be."""
    try:
        return max(0, min(int(ticket.get("maxBytes", 0)), MAX_VIDEO_UPLOAD_BYTES))
    except (TypeError, ValueError):
        return 0


@app.post("/api/video/upload-url")
async def api_video_upload_url(ticket: str = Form(...), size: int = Form(...), extension: str = Form("")):
    """A signed URL the browser uploads a video to directly, plus the
    upload id to send to /api/video/probe and /api/video/process in place of
    the file - see app/uploads.py. 404 while GCS_UPLOAD_BUCKET is unset, which
    tells the frontend to post the file itself.

    Needs an upload ticket, claimed here so each one signs a single upload
    URL - otherwise anyone could fill the bucket. Its size is the cap the
    signed URL enforces.
    """
    limit = _upload_limit(tickets.verify(ticket, "upload"))
    if not uploads.enabled():
        raise HTTPException(status_code=404, detail="Direct uploads aren't configured.")
    if size > limit:
        raise HTTPException(
            status_code=400, detail=f"File too large (max {MAX_VIDEO_UPLOAD_BYTES // (1024 * 1024)}MB)"
        )
    await tickets.claim(ticket)
    return await asyncio.to_thread(uploads.create_upload_url, extension, limit)


def _local_file(raw: str, suffixes: set[str]) -> str:
    """Desktop engine only: a file already on this machine, named by its
    path and used where it is (never copied or changed). The app's editor
    sends paths of videos the user picked or recorded, so large files
    aren't uploaded to localhost; upload byte caps don't apply to them, the
    duration limits and content screening do. Refused by the cloud backend."""
    if not LOCAL_MODE:
        raise HTTPException(status_code=400, detail="File paths are only accepted by the desktop engine.")
    p = Path(raw)
    if not p.is_absolute() or p.suffix.lower() not in suffixes or not p.is_file():
        raise HTTPException(status_code=400, detail="The video file can't be found. It may have been moved or deleted.")
    return str(p)


def _local_paths(raw: Optional[str], field: str) -> Optional[list[Optional[str]]]:
    """`source_paths`/`audio_paths` of an export: a JSON list, one entry per
    file in order, each a path (desktop engine) or null for the next file in
    the matching upload list."""
    if raw is None:
        return None
    try:
        items = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {field}") from exc
    if not isinstance(items, list) or not all(i is None or isinstance(i, str) for i in items):
        raise HTTPException(status_code=400, detail=f"Invalid {field}")
    return items


async def _receive_video(
    file: Optional[UploadFile],
    upload_id: Optional[str],
    tmp: str,
    max_bytes: int = MAX_VIDEO_UPLOAD_BYTES,
    path: Optional[str] = None,
    suffixes: Optional[set[str]] = None,
) -> str:
    """Puts the job's video in `tmp` - from the bucket when the browser
    uploaded it there (`upload_id`), else from the request body - and
    returns its path. A local `path` (desktop engine) is returned as is;
    `suffixes` widens which files it may be (default: videos)."""
    if path:
        return _local_file(path, suffixes or _VIDEO_SUFFIXES)
    if upload_id:
        in_path = os.path.join(tmp, f"input{uploads.suffix(upload_id)}")
        await asyncio.to_thread(uploads.download, upload_id, in_path, max_bytes)
        return in_path
    if file is None:
        raise HTTPException(status_code=400, detail="No video was uploaded.")
    in_path = os.path.join(tmp, f"input{Path(file.filename or '').suffix or '.mp4'}")
    _save_upload(file, in_path, max_bytes)
    return in_path


@app.post("/api/audio/clean")
async def api_audio_clean(
    file: Optional[UploadFile] = File(None),
    path: Optional[str] = Form(None),
    start: float = Form(0.0, ge=0),
    end: float = Form(..., gt=0),
    denoise: float = Form(0.6, ge=0, le=1),
    level: bool = Form(True),
):
    """Desktop engine only: a cleaned copy of a clip's or an audio track's
    sound (noise reduced, loudness evened out if `level` -
    app/pipeline/audio_clean.py) for source seconds `start`..`end`, as an
    AAC file. Audio tracks send their whole file (start 0), so the copy
    lines up with the original sample for sample. Free and unmetered like
    the import check: it runs on the user's own machine. The cloud backend
    refuses it; the recording never leaves the device.
    """
    if not LOCAL_MODE:
        raise HTTPException(status_code=404, detail="Not available here.")
    # No length cap: ffmpeg streams the range, and the noise floor is read
    # from at most two minutes of it (audio_clean._ANALYZE_SECONDS).
    if end <= start:
        raise HTTPException(status_code=400, detail="Invalid range")
    with tempfile.TemporaryDirectory() as tmp:
        in_path = await _receive_video(file, None, tmp, path=path, suffixes=_VIDEO_SUFFIXES | _AUDIO_SUFFIXES)
        out_path = os.path.join(tmp, "clean.m4a")
        try:
            await audio_clean.clean_audio(in_path, out_path, start, end, denoise, level)
        except RuntimeError as exc:
            traceback.print_exc()
            raise HTTPException(
                status_code=400, detail="This audio couldn't be cleaned up. The file may have no sound, or a format that can't be read."
            ) from exc
        return _stream_result(out_path, "audio/mp4")


_DECODE_RATES = {8000, 16000, 22050, 24000, 44100, 48000}
# Waveform: peaks per second, from audio decoded at this rate (media.ts).
_PEAKS_PER_SECOND = 50
_PEAKS_RATE = 8000


@app.post("/api/audio/decode")
async def api_audio_decode(path: str = Form(...), rate: int = Form(16000), channels: int = Form(1)):
    """Desktop engine only: a file's whole sound as raw 32-bit float PCM
    (interleaved, 1 or 2 `channels`, at `rate`), decoded by ffmpeg straight
    from disk. The editor's captions, voice translation and loudness read the
    whole file into the page and decoded it there before, which skipped
    files over 400 MB (any long video)."""
    if not LOCAL_MODE:
        raise HTTPException(status_code=404, detail="Not available here.")
    if rate not in _DECODE_RATES or channels not in (1, 2):
        raise HTTPException(status_code=400, detail="Invalid format")
    src = _local_file(path, _AUDIO_SUFFIXES | _VIDEO_SUFFIXES)
    fd, out = tempfile.mkstemp(suffix=".f32")
    os.close(fd)
    try:
        await video_pipeline._run_ffmpeg(["-y", "-i", src, "-vn", "-ac", str(channels), "-ar", str(rate), "-f", "f32le", out])
    except RuntimeError as exc:
        os.remove(out)
        raise HTTPException(status_code=400, detail="This file's sound couldn't be read.") from exc
    return FileResponse(out, media_type="application/octet-stream", background=BackgroundTask(os.remove, out))


def _audio_peaks(path: str) -> np.ndarray:
    """The loudest sample in each 1/_PEAKS_PER_SECOND s of a file's sound,
    decoded as a stream so a long file is never held in memory whole."""
    block = _PEAKS_RATE // _PEAKS_PER_SECOND
    proc = subprocess.Popen(
        [video_pipeline.get_ffmpeg_path(), "-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(_PEAKS_RATE), "-f", "f32le", "-"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
    )
    assert proc.stdout is not None
    parts: list[np.ndarray] = []
    pending = b""
    step = block * 4  # bytes per peak
    while chunk := proc.stdout.read(step * 4096):
        data = pending + chunk
        whole = len(data) // step * step
        pending = data[whole:]
        if whole:
            parts.append(np.abs(np.frombuffer(data[:whole], np.float32)).reshape(-1, block).max(axis=1))
    tail = len(pending) // 4 * 4
    if tail:
        parts.append(np.abs(np.frombuffer(pending[:tail], np.float32)).max(keepdims=True))
    if proc.wait() != 0 and not parts:
        raise ValueError("no sound")
    return np.concatenate(parts).astype(np.float32) if parts else np.zeros(0, np.float32)


@app.post("/api/audio/peaks")
async def api_audio_peaks(path: str = Form(...)):
    """Desktop engine only: the timeline waveform of a file on this machine,
    as float32 peaks (_PEAKS_PER_SECOND a second, not normalized). The page
    used to read and decode the whole file for it, and drew none over 400 MB."""
    if not LOCAL_MODE:
        raise HTTPException(status_code=404, detail="Not available here.")
    src = _local_file(path, _AUDIO_SUFFIXES | _VIDEO_SUFFIXES)
    try:
        peaks = await asyncio.to_thread(_audio_peaks, src)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="This file's sound couldn't be read.") from exc
    return Response(peaks.tobytes(), media_type="application/octet-stream")


MAX_ACTIVITY_RANGES = 50


@app.post("/api/video/activity")
async def api_video_activity(path: str = Form(...), ranges: str = Form(...)):
    """Desktop engine only: how much the picture changes in each of up to
    MAX_ACTIVITY_RANGES source-time ranges ([[start, end], ...] JSON) of a
    video on this machine (app/pipeline/activity.py). Used by the editor's
    silence review; only those ranges are decoded."""
    if not LOCAL_MODE:
        raise HTTPException(status_code=404, detail="Not available here.")
    try:
        raw = json.loads(ranges)
        parsed = [(float(a), float(b)) for a, b in raw]
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid ranges") from None
    if not parsed or len(parsed) > MAX_ACTIVITY_RANGES:
        raise HTTPException(status_code=400, detail="Invalid ranges")
    for a, b in parsed:
        if not (math.isfinite(a) and math.isfinite(b)) or a < 0 or b <= a or b - a > 3600:
            raise HTTPException(status_code=400, detail="Invalid range")
    in_path = _local_file(path, _VIDEO_SUFFIXES)
    try:
        result = await activity.measure_ranges(in_path, parsed)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail="This video couldn't be read.") from exc
    return {"ranges": result}


@app.post("/api/video/motion")
async def api_video_motion(path: str = Form(...), start: float = Form(...), end: float = Form(...)):
    """Desktop engine only: picture change and scene-change scores through
    source seconds start..end (at most activity.MAX_PROFILE_SECONDS) of a
    video on this machine (app/pipeline/activity.py motion_profile). Used by
    the editor's highlight suggestions."""
    if not LOCAL_MODE:
        raise HTTPException(status_code=404, detail="Not available here.")
    if not (math.isfinite(start) and math.isfinite(end)) or start < 0 or end <= start or end - start > activity.MAX_PROFILE_SECONDS:
        raise HTTPException(status_code=400, detail="Invalid range")
    in_path = _local_file(path, _VIDEO_SUFFIXES)
    try:
        return await activity.motion_profile(in_path, start, end)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail="This video couldn't be read.") from exc


# One transcription at a time: each uses every core the engine has.
_speech_lock = asyncio.Lock()
# Longest speech mix accepted: 2 hours of float32 is about 460 MB.
MAX_SPEECH_BYTES = 2 * 3600 * speech.RATE * 4


@app.get("/api/speech/model")
def api_speech_model(language: str = "auto") -> dict:
    """Desktop engine only: whether the speech model for `language` is on
    this machine yet, and its download size, so the editor asks before the
    first download (app/pipeline/speech.py). `gpu`: whether an NVIDIA card
    can be used, and whether its libraries are downloaded yet. `own`: a
    model of the language's own (Sinhala, Tamil, ...), not the general one."""
    if not LOCAL_MODE:
        raise HTTPException(status_code=404, detail="Not available here.")
    model = speech.model_for(language)
    return {"ready": speech.is_ready(model), "sizeMb": model.size_mb, "gpu": speech.gpu_status(), "own": model.key != "general"}


@app.post("/api/speech/transcribe")
async def api_speech_transcribe(
    audio: UploadFile = File(...),
    language: str = Form("auto"),
    gpu: bool = Form(False),
    job_id: Optional[str] = Form(None),
):
    """Desktop engine only: a word-timed transcript of `audio` (raw 16 kHz
    mono float32, little-endian - the editor's speech mix) with
    faster-whisper (app/pipeline/speech.py), downloading the model first if
    needed. `gpu`: run on the NVIDIA card, downloading its libraries
    first if needed. Progress and cancel under `job_id` (app/progress.py):
    phase "download", "prepare" or "transcribe". 409 "model_needed" when
    "auto" hears a language whose own model isn't downloaded (Sinhala, Tamil, ...).
    Free and unmetered: it runs on the user's own machine, and the audio
    never leaves it."""
    if not LOCAL_MODE:
        raise HTTPException(status_code=404, detail="Not available here.")
    if not re.fullmatch(r"auto|[a-z]{2,3}", language):
        raise HTTPException(status_code=400, detail="Invalid language")
    raw = await audio.read(MAX_SPEECH_BYTES + 1)
    if not raw or len(raw) % 4 or len(raw) > MAX_SPEECH_BYTES:
        raise HTTPException(status_code=400, detail="Invalid audio")
    samples = np.frombuffer(raw, dtype="<f4")

    job = progress.start(job_id)

    def report(stage: str, value: float) -> None:
        if job:
            job.check()
            job.phase, job.done, job.total = stage, value, 1.0

    try:
        async with _speech_lock:
            result = await asyncio.to_thread(speech.transcribe, samples, language, report, gpu)
        return result
    except speech.ModelNeeded as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "model_needed",
                "language": exc.language,
                "sizeMb": exc.model.size_mb,
                "message": f"This sounds like {speech.LANGUAGE_NAMES.get(exc.language, exc.language)}, which has its own, more accurate speech model ({exc.model.size_mb} MB). Download it in the panel, then try again.",
            },
        ) from exc
    except speech.LanguageUnclear as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "language_unclear",
                "message": "Couldn't tell which language this is. Pick it in the Language list, then try again.",
            },
        ) from exc
    except progress.Cancelled as exc:
        raise HTTPException(status_code=409, detail={"code": "cancelled", "message": "Speech recognition cancelled."}) from exc
    except OSError as exc:  # urllib's errors are OSErrors too
        traceback.print_exc()
        raise HTTPException(
            status_code=502,
            detail={"code": "model_download", "message": "The speech model couldn't be downloaded. Check your connection and try again."},
        ) from exc
    finally:
        progress.finish(job_id)


# Longest video whose voice is translated in one go: 30 minutes of 44.1 kHz
# stereo float32 is about 640 MB in memory.
MAX_DUB_SECONDS = 30 * 60


@app.get("/api/dub/models")
def api_dub_models() -> dict:
    """Desktop engine only: whether the voice translation models are on this
    machine yet (app/pipeline/dub.py), and what's left to download."""
    if not LOCAL_MODE:
        raise HTTPException(status_code=404, detail="Not available here.")
    return dub.models_status()


@app.post("/api/dub/render")
async def api_dub_render(
    audio: UploadFile = File(...),
    sentences: str = Form(...),
    job_id: Optional[str] = Form(None),
):
    """Desktop engine only: the speech in `audio` (raw 44.1 kHz stereo
    float32, interleaved - the editor's mix of the timeline's speech) said
    again in English in the speaker's voice (app/pipeline/dub.py).
    `sentences`: JSON [{start, end, text}], the source sentences' times and
    their English text. Answers a 16-bit WAV with three channels: the English
    voice, then the background in stereo. Downloads the models first if
    needed. Progress and cancel under `job_id`: phase "download",
    "separate", "voice" or "speak". Runs on the user's own machine; nothing
    is uploaded."""
    if not LOCAL_MODE:
        raise HTTPException(status_code=404, detail="Not available here.")
    try:
        parsed = json.loads(sentences)
        items = [{"start": float(x["start"]), "end": float(x["end"]), "text": str(x["text"])[:2000]} for x in parsed]
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(status_code=400, detail="Invalid sentences") from exc
    limit = MAX_DUB_SECONDS * dub.RATE * 2 * 4
    raw = await audio.read(limit + 1)
    if not raw or len(raw) % 8 or len(raw) > limit:
        raise HTTPException(status_code=400, detail="Invalid audio")
    mix = np.frombuffer(raw, dtype="<f4").reshape(-1, 2).T
    total = mix.shape[1] / dub.RATE
    items = [x for x in items if x["text"].strip() and math.isfinite(x["start"]) and math.isfinite(x["end"]) and 0 <= x["start"] < x["end"] <= total + 1]
    if not items:
        raise HTTPException(status_code=400, detail="Nothing to say")
    items.sort(key=lambda x: x["start"])

    job = progress.start(job_id)

    def report(stage: str, value: float) -> None:
        if job:
            job.check()
            job.phase, job.done, job.total = stage, value, 1.0

    try:
        async with _speech_lock:
            english, background = await asyncio.to_thread(dub.render, mix, items, report)
    except progress.Cancelled as exc:
        raise HTTPException(status_code=409, detail={"code": "cancelled", "message": "Voice translation cancelled."}) from exc
    except OSError as exc:
        traceback.print_exc()
        raise HTTPException(
            status_code=502,
            detail={"code": "model_download", "message": "The voice models couldn't be downloaded. Check your connection and try again."},
        ) from exc
    finally:
        progress.finish(job_id)
    pcm = (np.clip(np.vstack([english[None], background]).T, -1, 1) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(3)
        w.setsampwidth(2)
        w.setframerate(dub.RATE)
        w.writeframes(pcm.tobytes())
    return Response(content=buf.getvalue(), media_type="audio/wav")


@app.post("/api/video/probe")
async def api_video_probe(
    ticket: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    upload_id: Optional[str] = Form(None),
    path: Optional[str] = Form(None),  # desktop engine: a file on this machine
):
    """Returns a representative preview frame (PNG) plus video metadata as
    response headers, so the frontend can let the user draw a cleanup
    region against real pixel coordinates before committing to a full encode.
    Takes the video as `file`, or as the `upload_id` of a direct upload.

    Needs the same upload ticket as /api/video/upload-url (not claimed here:
    the upload already claimed it, and probing reuses it). The desktop engine
    takes none: the file is already on the user's machine and nothing is billed.
    """
    if LOCAL_MODE:
        limit = MAX_VIDEO_UPLOAD_BYTES
    else:
        limit = _upload_limit(tickets.verify(ticket or "", "upload"))
    with tempfile.TemporaryDirectory() as tmp:
        in_path = await _receive_video(file, upload_id, tmp, limit, path)
        try:
            info, frame_png = video_pipeline.probe_video(in_path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        # The desktop engine opens videos of any length; the export's plan
        # decides how long an edit may be (api_video_export).
        if info.duration > MAX_VIDEO_DURATION_SECONDS and not LOCAL_MODE:
            raise HTTPException(
                status_code=400,
                detail=f"Video too long ({info.duration:.0f}s); max supported is {MAX_VIDEO_DURATION_SECONDS:.0f}s",
            )

        if LOCAL_MODE and path:
            # Also remembered for the export, so it isn't screened again.
            try:
                _checked_local_video(in_path)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        else:
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


@app.post("/api/video/process")
async def api_video_process(
    ticket: str = Form(...),
    file: Optional[UploadFile] = File(None),
    upload_id: Optional[str] = Form(None),  # a direct upload, in place of `file`
    path: Optional[str] = Form(None),  # desktop engine: a file on this machine, in place of `file`
    x: int = Form(...),
    y: int = Form(...),
    w: int = Form(...),
    h: int = Form(...),
    start: Optional[float] = Form(None),  # optional source-time range (seconds) -
    end: Optional[float] = Form(None),  # see the docstring
):
    """Removes an unwanted object inside a user-marked rectangular region
    for the full video duration. The region is always user-supplied; there's
    no automatic region detection.

    Called by the browser directly, with a ticket from the Next.js
    /api/process route (see app/tickets.py): the output resolution and the
    quality tier come from the ticket, which also says who paid, so a failed
    or rejected job is refunded.

    `start`/`end`, when both given, restrict the job to that range of the
    upload: it's cut out first (editor.cut_range) and only the cut is
    processed and returned. The browser editor uses this to run AI cleanup
    on one timeline segment. The cut is in display orientation, so the
    region is then expected in display-oriented pixels too - which is what
    the editor's frame grab gives it. Omitted, behavior is unchanged.
    """
    job = tickets.verify(ticket, "process")
    resolution, quality = job.get("resolution"), job.get("quality")
    if resolution not in RESOLUTION_HEIGHTS or quality not in ("standard", "pro"):
        raise HTTPException(status_code=403, detail="Invalid job ticket.")
    # The seconds of video the ticket paid for (credits are per started
    # minute); local tickets carry none and get the server-wide ceiling.
    paid_seconds = job.get("maxSeconds")
    if paid_seconds is None:
        max_seconds = MAX_VIDEO_DURATION_SECONDS
    elif isinstance(paid_seconds, (int, float)) and paid_seconds > 0:
        max_seconds = min(float(paid_seconds), MAX_VIDEO_DURATION_SECONDS)
    else:
        raise HTTPException(status_code=403, detail="Invalid job ticket.")
    await tickets.claim(ticket)
    try:
        result = await _video_process(file, upload_id, x, y, w, h, start, end, resolution, quality, max_seconds, path)
    except (Exception, asyncio.CancelledError):
        # Any failure, rejection (moderation, bad region) or disconnect: no
        # usable result, so the credits go back.
        await tickets.refund(ticket)
        raise
    # Done with the direct upload. Kept on failure, so a retry doesn't
    # re-upload; the bucket's lifecycle rule removes it either way.
    if upload_id:
        await asyncio.to_thread(uploads.delete, upload_id)
    return result


async def _video_process(
    file: Optional[UploadFile],
    upload_id: Optional[str],
    x: int,
    y: int,
    w: int,
    h: int,
    start: Optional[float],
    end: Optional[float],
    resolution: str,
    quality: str,
    max_seconds: float = MAX_VIDEO_DURATION_SECONDS,
    path: Optional[str] = None,
):
    if w < MIN_REGION_PX or h < MIN_REGION_PX:
        raise HTTPException(status_code=400, detail=f"Region too small; minimum {MIN_REGION_PX}px per side")

    with tempfile.TemporaryDirectory() as tmp:
        in_path = await _receive_video(file, upload_id, tmp, path=path)
        out_path = os.path.join(tmp, "output.mp4")

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
        # A second of slack for container vs decoder duration differences.
        # Raising here refunds the ticket (see api_video_process).
        if info.duration > max_seconds + 1.0:
            raise HTTPException(
                status_code=400,
                detail=f"This video is longer ({info.duration:.0f}s) than the length it was charged for. Please try again.",
            )
        # The region is drawn in the browser against a scaled-up preview, so
        # rounding on the way back to source pixels can push an edge-flush box
        # a pixel past the frame - and ffmpeg's crop/overlay (and the inpainting
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

        # Generous bound relative to reconstruct_region's own measured ~6.5x
        # realtime FSR pass (see REGION_FSR_* in config.py), so a queued
        # job gets real headroom before _run_pipeline_job gives up on it.
        # quality="pro" does extra per-frame optical-flow work on top of
        # that (see REGION_FLOW_* in config.py), so it gets a wider bound.
        job_timeout = max(180.0, info.duration * (16 if quality == "pro" else 10))

        try:
            await _run_pipeline_job(
                jobs.reconstruct_region_job,
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

        return _stream_result(out_path, "video/mp4")


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


class _EditorLut(BaseModel):
    """An imported 3D LUT (src/lib/editor/lut.ts): size^3 RGB triplets, red
    fastest, 0..1."""

    size: int = Field(ge=2, le=33)
    data: list[float] = Field(max_length=33**3 * 3)
    intensity: float = Field(100, ge=0, le=100)


class _EditorLook(BaseModel):
    filter: str = "original"
    intensity: float = Field(100, ge=0, le=100)
    adjust: _EditorAdjust = Field(default_factory=_EditorAdjust)
    # Curves as [r, g, b] tables (src/lib/editor/curves.ts).
    curve: Optional[list[list[float]]] = Field(None, min_length=3, max_length=3)
    lut: Optional[_EditorLut] = None


class _EditorTransform(BaseModel):
    x: float = Field(0.5, ge=-1, le=2)
    y: float = Field(0.5, ge=-1, le=2)
    scale: float = Field(1, ge=0.1, le=4)
    rotation: float = Field(0, ge=-360, le=360)


class _EditorCrop(BaseModel):
    x: float = Field(0, ge=0, le=0.9)
    y: float = Field(0, ge=0, le=0.9)
    w: float = Field(1, ge=0.05, le=1)
    h: float = Field(1, ge=0.05, le=1)


class _EditorKeyframe(BaseModel):
    """One keyframe (src/lib/editor/keyframes.ts): clip-local seconds on
    clips, timeline seconds on layers."""

    t: float = Field(ge=-EDITOR_MAX_KEYFRAME_SPAN, le=EDITOR_MAX_KEYFRAME_SPAN)
    x: float = Field(ge=-3, le=4)
    y: float = Field(ge=-3, le=4)
    scale: float = Field(ge=0.01, le=20)
    rotation: float = Field(ge=-3600, le=3600)
    opacity: float = Field(1, ge=0, le=1)
    ease: str = "smooth"


class _EditorClip(BaseModel):
    source: int = Field(ge=0, lt=EDITOR_MAX_SOURCES)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    # Freeze frame: the source time of the held frame; start/end then only
    # give the hold length.
    freeze: Optional[float] = Field(None, ge=0)
    reverse: bool = False
    crop: _EditorCrop = Field(default_factory=_EditorCrop)
    transition: Optional[_EditorTransition] = None
    speed: float = Field(1, ge=0.5, le=2)
    # The clip's own volume (0..2) times the video-sound track's (0..2,
    # src/lib/editor/mix.ts clipMixVolume).
    volume: float = Field(1, ge=0, le=4)
    transform: _EditorTransform = Field(default_factory=_EditorTransform)
    look: _EditorLook = Field(default_factory=_EditorLook)
    # Focus zoom rows [t, x, y, s] in clip time (see PlanClip.camera).
    camera: Optional[list[list[float]]] = Field(None, max_length=EDITOR_MAX_CAMERA_ROWS)
    keyframes: list[_EditorKeyframe] = Field(default_factory=list, max_length=EDITOR_MAX_KEYFRAMES)
    # Speed curve: speeds of equal source pieces (src/lib/editor/speed.ts).
    ramp: list[float] = Field(default_factory=list, max_length=64)
    # Shape mask: index into `overlays` of its grayscale PNG.
    mask: Optional[int] = Field(None, ge=0, lt=EDITOR_MAX_STICKERS)
    stabilize: float = Field(0, ge=0, le=100)


class _EditorPointerCursor(BaseModel):
    image: int = Field(ge=0, lt=EDITOR_MAX_STICKERS)
    width: float = Field(gt=0, le=0.5)  # fractions of canvas height
    height: float = Field(gt=0, le=0.5)
    hotX: float = Field(ge=0, le=1)
    hotY: float = Field(ge=0, le=1)


class _EditorPointerRing(BaseModel):
    image: int = Field(ge=0, lt=EDITOR_MAX_STICKERS)
    size: float = Field(ge=1, le=4)  # sprite width / ring radius


class _EditorPointer(BaseModel):
    cursor: Optional[_EditorPointerCursor] = None
    rings: list[_EditorPointerRing] = Field(default_factory=list, max_length=2)
    cursorRows: list[list[float]] = Field(default_factory=list, max_length=EDITOR_MAX_POINTER_ROWS)
    ringRows: list[list[float]] = Field(default_factory=list, max_length=EDITOR_MAX_POINTER_ROWS)


def _finite(row: list[float], n: int) -> bool:
    return len(row) == n and all(math.isfinite(v) for v in row)


def _camera_rows(rows: list[list[float]]) -> list[tuple[float, float, float, float]]:
    out = []
    for r in rows:
        if not _finite(r, 4):
            raise HTTPException(status_code=400, detail="Invalid zoom data")
        t, x, y, s = r
        if t < 0 or not (0.2 <= s <= 1) or x < -1e-6 or y < -1e-6 or x + s > 1 + 1e-3 or y + s > 1 + 1e-3:
            raise HTTPException(status_code=400, detail="Invalid zoom data")
        out.append((t, max(0.0, x), max(0.0, y), s))
    return out


def _pointer_plan(p: _EditorPointer, overlay_images: list[tuple[str, int, int]]) -> editor_pipeline.PlanPointer:
    if len(p.cursorRows) + len(p.ringRows) > EDITOR_MAX_POINTER_ROWS:
        raise HTTPException(status_code=400, detail="Too much pointer data")
    if any(i >= len(overlay_images) for i in [*(r.image for r in p.rings), *([p.cursor.image] if p.cursor else [])]):
        raise HTTPException(status_code=400, detail="Pointer refers to a missing image")
    cursor_rows = []
    for r in p.cursorRows:
        if not _finite(r, 3) or r[0] < 0 or not (-1 <= r[1] <= 2 and -1 <= r[2] <= 2):
            raise HTTPException(status_code=400, detail="Invalid pointer data")
        cursor_rows.append((r[0], r[1], r[2]))
    ring_rows = []
    for r in p.ringRows:
        if not _finite(r, 6) or r[0] < 0 or r[1] not in (0, 1, 2, 3) or not (-1 <= r[2] <= 2 and -1 <= r[3] <= 2) or not (0 <= r[4] <= 0.5) or not (0 <= r[5] <= 1):
            raise HTTPException(status_code=400, detail="Invalid pointer data")
        ring_rows.append((r[0], int(r[1]), r[2], r[3], r[4], r[5]))
    if ring_rows and not p.rings:
        raise HTTPException(status_code=400, detail="Click highlights need their image")
    return editor_pipeline.PlanPointer(
        cursor_path=overlay_images[p.cursor.image][0] if p.cursor else None,
        cursor_w=p.cursor.width if p.cursor else 0.0,
        cursor_h=p.cursor.height if p.cursor else 0.0,
        hot_x=p.cursor.hotX if p.cursor else 0.0,
        hot_y=p.cursor.hotY if p.cursor else 0.0,
        ring_paths=[overlay_images[r.image][0] for r in p.rings],
        ring_sizes=[r.size for r in p.rings],
        cursor_rows=cursor_rows if p.cursor else [],
        ring_rows=ring_rows,
    )


class _EditorMask(BaseModel):
    mode: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    strength: float = Field(60, ge=0, le=100)
    color: str = Field("#000000", pattern=_HEX_COLOR)
    rows: list[list[float]] = Field(min_length=1, max_length=EDITOR_MAX_MASK_ROWS)


def _check_keyframes(kfs: list[_EditorKeyframe]) -> None:
    if any(k.ease not in editor_pipeline.EASES for k in kfs) or any(b.t < a.t for a, b in zip(kfs, kfs[1:])):
        raise HTTPException(status_code=400, detail="Invalid keyframes")


def _keyframe_dicts(kfs: list[_EditorKeyframe]) -> list[dict]:
    return [k.model_dump() for k in kfs]


def _mask_plan(m: _EditorMask, total: float) -> editor_pipeline.PlanMask | None:
    if m.mode not in editor_pipeline.MASK_MODES:
        raise HTTPException(status_code=400, detail="Unknown mask type")
    rows = []
    for r in m.rows:
        if not _finite(r, 5) or r[0] < 0 or not all(-0.01 <= v <= 1.01 for v in r[1:3]) or not all(0 <= v <= 1.01 for v in r[3:5]):
            raise HTTPException(status_code=400, detail="Invalid mask data")
        rows.append((r[0], r[1], r[2], r[3], r[4]))
    end = min(m.end, total)
    return editor_pipeline.PlanMask(m.mode, m.start, end, m.strength, m.color, rows) if end - m.start >= 0.02 else None


class _EditorKey(BaseModel):
    color: str = Field(pattern=_HEX_COLOR)
    similarity: float = Field(ge=0, le=100)
    smoothness: float = Field(ge=0, le=100)


class _EditorSprite(BaseModel):
    """Animated text: the image is a cols x rows grid of states, state k
    shown from times[k] (timeline seconds; src/lib/editor/textAnim.ts)."""

    cols: int = Field(ge=1, le=64)
    rows: int = Field(ge=1, le=64)
    times: list[float] = Field(min_length=1, max_length=EDITOR_MAX_SPRITE_STATES)


class _EditorOverlay(BaseModel):
    # Exactly one of: a PNG (index into `overlays`), or a video source
    # (index into `sources`) for a picture-in-picture layer.
    image: Optional[int] = Field(None, ge=0, lt=EDITOR_MAX_STICKERS)
    video: Optional[int] = Field(None, ge=0, lt=EDITOR_MAX_SOURCES)
    offset: float = Field(0, ge=0)  # video layers: source seconds it starts from
    volume: float = Field(1, ge=0, le=2)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    x: float = Field(ge=-0.5, le=1.5)
    y: float = Field(ge=-0.5, le=1.5)
    width: float = Field(ge=0.01, le=3.0)
    rotation: float = Field(ge=-360, le=360)
    opacity: float = Field(1, ge=0, le=1)
    animIn: str = "none"
    animOut: str = "none"
    blend: str = "normal"
    key: Optional[_EditorKey] = None  # video layers; images come keyed
    keyframes: list[_EditorKeyframe] = Field(default_factory=list, max_length=EDITOR_MAX_KEYFRAMES)
    sprite: Optional[_EditorSprite] = None
    mask: Optional[int] = Field(None, ge=0, lt=EDITOR_MAX_STICKERS)  # video layers: mask PNG index


class _EditorDuck(BaseModel):
    """Auto-ducking (src/lib/editor/ducking.ts): lowered by `amount` during
    each [start, end] region of speech, timeline seconds."""

    amount: float = Field(ge=0, le=1)
    regions: list[list[float]] = Field(max_length=EDITOR_MAX_DUCK_REGIONS)


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
    duck: Optional[_EditorDuck] = None
    voice: str = "none"


class _EditorEffect(BaseModel):
    type: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    intensity: float = Field(50, ge=0, le=100)


class _EditorBackground(BaseModel):
    type: str = "color"  # color | gradient | blur | image
    color: str = Field("#000000", pattern=_HEX_COLOR)
    color2: str = Field("#000000", pattern=_HEX_COLOR)


class _EditorFrame(BaseModel):
    """The main video as a card (src/lib/editor/types.ts CanvasFrame)."""

    padding: float = Field(0, ge=0, le=0.2)
    radius: float = Field(0, ge=0, le=0.1)
    shadow: float = Field(0, ge=0, le=1)


class _EditorCanvas(BaseModel):
    aspect: str = "original"
    fit: str = "fit"
    frame: Optional[_EditorFrame] = None
    background: _EditorBackground = Field(default_factory=_EditorBackground)


class _EditorProject(BaseModel):
    clips: list[_EditorClip] = Field(min_length=1, max_length=EDITOR_MAX_CLIPS)
    overlays: list[_EditorOverlay] = Field(default_factory=list, max_length=EDITOR_MAX_STICKERS)
    audio: list[_EditorAudio] = Field(default_factory=list, max_length=EDITOR_MAX_AUDIO)
    effects: list[_EditorEffect] = Field(default_factory=list, max_length=EDITOR_MAX_EFFECTS)
    canvas: _EditorCanvas = Field(default_factory=_EditorCanvas)
    pointer: Optional[_EditorPointer] = None
    masks: list[_EditorMask] = Field(default_factory=list, max_length=EDITOR_MAX_MASKS)
    # Output frame rate the editor previews at. Screen recordings are
    # variable frame rate (frames only when the screen changes), so their
    # probed average (often ~15 fps) is far below the capture rate; without
    # this, zooms and click rings would render at that average.
    fps: Optional[float] = Field(None, ge=1, le=EDITOR_MAX_FPS)
    # "mp4" | "gif" | "audio" (editor_pipeline.OUTPUT_FORMATS), and the
    # MP4's quality (QUALITY_CRF).
    format: str = "mp4"
    quality: str = "standard"
    # Loudness normalization, dB, measured by the editor (loudness.ts) so
    # the preview plays the same level; the export's limiter follows it.
    masterGain: float = Field(0, ge=-editor_pipeline.MAX_MASTER_GAIN_DB, le=editor_pipeline.MAX_MASTER_GAIN_DB)


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


def _branding_overlay(tmp: str) -> tuple[str, int, int]:
    """The free-tier "Made with WipeClip" mark: white text on a translucent
    dark pill, as an RGBA PNG; returns its path and size."""
    text = "Made with WipeClip"
    font, scale, thickness = cv2.FONT_HERSHEY_DUPLEX, 1.4, 2
    (tw, th), baseline = cv2.getTextSize(text, font, scale, thickness)
    pad_x, pad_y = 28, 18
    w, h = tw + 2 * pad_x, th + baseline + 2 * pad_y
    img = np.zeros((h, w, 4), dtype=np.uint8)
    r = h // 2
    pill = (20, 20, 20, 150)
    cv2.rectangle(img, (r, 0), (w - r, h), pill, -1)
    cv2.circle(img, (r, r), r, pill, -1, cv2.LINE_AA)
    cv2.circle(img, (w - r - 1, r), r, pill, -1, cv2.LINE_AA)
    cv2.putText(img, text, (pad_x, pad_y + th), font, scale, (255, 255, 255, 235), thickness, cv2.LINE_AA)
    path = os.path.join(tmp, "branding.png")
    if not cv2.imwrite(path, img):
        raise HTTPException(status_code=500, detail="Could not prepare the export")
    return path, w, h


@app.post("/api/video/export")
async def api_video_export(
    ticket: str = Form(...),
    project: Optional[str] = Form(None),
    # The same JSON as a file: form fields are capped at 1 MB by the upload
    # parser, which a long project (captions, cursor rows) can pass. The
    # desktop app sends it this way.
    project_file: Optional[UploadFile] = File(None),
    sources: list[UploadFile] = File(default=[]),
    overlays: list[UploadFile] = File(default=[]),
    audios: list[UploadFile] = File(default=[]),
    background: Optional[UploadFile] = File(None),
    source_paths: Optional[str] = Form(None),
    audio_paths: Optional[str] = Form(None),
    job_id: Optional[str] = Form(None),
    keep_output: bool = Form(False),
):
    """Renders a browser-editor project (see app/pipeline/editor.py) into
    one MP4. `sources[0]` is the original upload and sets the frame rate and
    (with the canvas aspect) the output size; further sources are AI-cleaned
    segments. `overlays` are the PNGs for stickers/text/images, `audios`
    uploaded audio files, `background` an optional canvas background image.
    `project` is the JSON timeline - see _EditorProject. The desktop engine
    also takes `source_paths`/`audio_paths` (see _local_paths): files on the
    user's machine used in place, mixed in order with the uploads.

    With a `job_id` (see app/progress.py) the caller can watch the render's
    progress at /api/jobs/{job_id} and cancel it there.

    Desktop engine with `keep_output`: the file stays on disk in
    WIPECLIP_EXPORTS_DIR and the answer is JSON {path, size, type}, so a long
    export never has to pass through the app's memory (the app copies it to
    where the user saves it). Length: the ticket's `maxSeconds` (the plan's
    limit; null = none) on the desktop engine, MAX_VIDEO_DURATION_SECONDS on
    the cloud backend.

    Nothing the client says about a file is trusted: every video and audio
    file is re-probed (videos are moderation-screened too), every image is
    decoded, size-checked, screened and re-encoded, all ranges are validated
    against probed durations, and every name (transition, filter, effect,
    animation, canvas) is whitelisted. Plan limits are enforced by the
    Next.js /api/export route, which checks the project and issues the
    ticket this is called with (see app/tickets.py): the ticket pins that
    exact project (by hash) and decides the resolution, the free-tier mark
    (`branding`) and the smaller free-tier encoding (`compact`, see
    EDITOR_COMPACT_CRF).
    """
    job = tickets.verify(ticket, "export")
    if project is None:
        if project_file is None:
            raise HTTPException(status_code=400, detail="Invalid project data")
        try:
            project = project_file.file.read().decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(status_code=400, detail="Invalid project data") from exc
    if hashlib.sha256(project.encode()).hexdigest() != job.get("projectHash"):
        raise HTTPException(status_code=403, detail="Invalid job ticket.")
    resolution = job.get("resolution")
    if resolution not in RESOLUTION_HEIGHTS:
        raise HTTPException(status_code=403, detail="Invalid job ticket.")
    branding, compact = bool(job.get("branding")), bool(job.get("compact"))
    if LOCAL_MODE:
        # The plan's limit; a ticket from before plans set one keeps the old cap.
        raw_max = job.get("maxSeconds", MAX_VIDEO_DURATION_SECONDS)
        max_seconds: Optional[float] = None if raw_max is None else float(raw_max)
    else:
        max_seconds = MAX_VIDEO_DURATION_SECONDS
        keep_output = False
    await tickets.claim(ticket)
    # Each source/audio is ("upload", UploadFile) or ("path", str).
    src_plan = _local_paths(source_paths, "source_paths")
    aud_plan = _local_paths(audio_paths, "audio_paths")
    if (src_plan is not None or aud_plan is not None) and not LOCAL_MODE:
        raise HTTPException(status_code=400, detail="File paths are only accepted by the desktop engine.")

    def merge(plan: Optional[list[Optional[str]]], uploads: list[UploadFile]) -> list[tuple[str, object]]:
        if plan is None:
            return [("upload", u) for u in uploads]
        if sum(1 for p in plan if p is None) != len(uploads):
            raise HTTPException(status_code=400, detail="Files don't match the list of paths")
        queue = iter(uploads)
        return [("upload", next(queue)) if p is None else ("path", p) for p in plan]

    source_items = merge(src_plan, sources)
    audio_items = merge(aud_plan, audios)
    if not source_items or len(source_items) > EDITOR_MAX_SOURCES:
        raise HTTPException(status_code=400, detail="Invalid number of source videos")
    if len(overlays) > EDITOR_MAX_STICKERS:
        raise HTTPException(
            status_code=400,
            detail=f"This project has {len(overlays)} text, caption and image layers; up to {EDITOR_MAX_STICKERS} can be exported together. Export it in parts, or remove some.",
        )
    if len(audio_items) > EDITOR_MAX_AUDIO:
        raise HTTPException(status_code=400, detail=f"Up to {EDITOR_MAX_AUDIO} audio tracks can be exported together.")

    try:
        spec = _EditorProject.model_validate(json.loads(project))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(status_code=400, detail="Invalid project data") from exc

    for c in spec.clips:
        if c.source >= len(source_items):
            raise HTTPException(status_code=400, detail="Clip refers to a missing source video")
        if c.transition and c.transition.type not in editor_pipeline.TRANSITIONS:
            raise HTTPException(status_code=400, detail="Unknown transition")
        if c.look.filter not in editor_pipeline.FILTER_IDS:
            raise HTTPException(status_code=400, detail="Unknown filter")
        if c.look.curve and any(not (2 <= len(t) <= 256) or not all(math.isfinite(v) and 0 <= v <= 1 for v in t) for t in c.look.curve):
            raise HTTPException(status_code=400, detail="Invalid curves")
        lut = c.look.lut
        if lut and (len(lut.data) != lut.size**3 * 3 or not all(math.isfinite(v) and 0 <= v <= 1 for v in lut.data)):
            raise HTTPException(status_code=400, detail="Invalid LUT")
        _check_keyframes(c.keyframes)
        if c.mask is not None and c.mask >= len(overlays):
            raise HTTPException(status_code=400, detail="Clip mask is missing")
        if c.ramp and (c.freeze is not None or c.reverse or not all(math.isfinite(s) and 0.1 <= s <= 10 for s in c.ramp)):
            raise HTTPException(status_code=400, detail="Invalid speed curve")
    for o in spec.overlays:
        if (o.image is None) == (o.video is None):
            raise HTTPException(status_code=400, detail="Invalid layer")
        if (o.image is not None and o.image >= len(overlays)) or (o.video is not None and o.video >= len(source_items)):
            raise HTTPException(status_code=400, detail="Layer refers to a missing file")
        if o.animIn not in editor_pipeline.ANIMS_IN or o.animOut not in editor_pipeline.ANIMS_OUT:
            raise HTTPException(status_code=400, detail="Unknown animation")
        if o.blend not in editor_pipeline.BLEND_MODES:
            raise HTTPException(status_code=400, detail="Unknown blend mode")
        _check_keyframes(o.keyframes)
        if o.mask is not None and (o.video is None or o.mask >= len(overlays)):
            raise HTTPException(status_code=400, detail="Layer mask is missing")
        sp = o.sprite
        if sp and (
            o.image is None
            or len(sp.times) > sp.cols * sp.rows
            or not _finite(sp.times, len(sp.times))
            or any(b < a for a, b in zip(sp.times, sp.times[1:]))
        ):
            raise HTTPException(status_code=400, detail="Invalid text animation")
    for a in spec.audio:
        if (a.audio is None) == (a.video is None):
            raise HTTPException(status_code=400, detail="Invalid audio clip")
        if (a.audio is not None and a.audio >= len(audio_items)) or (a.video is not None and a.video >= len(source_items)):
            raise HTTPException(status_code=400, detail="Audio clip refers to a missing file")
        if a.voice not in editor_pipeline.VOICE_FX:
            raise HTTPException(status_code=400, detail="Unknown voice effect")
        if a.duck and any(not _finite(r, 2) or r[1] < r[0] for r in a.duck.regions):
            raise HTTPException(status_code=400, detail="Invalid ducking")
    for e in spec.effects:
        if e.type not in editor_pipeline.EFFECTS:
            raise HTTPException(status_code=400, detail="Unknown effect")
    if spec.format not in editor_pipeline.OUTPUT_FORMATS or spec.quality not in editor_pipeline.QUALITY_CRF:
        raise HTTPException(status_code=400, detail="Unknown export format")
    canvas = spec.canvas
    if canvas.aspect != "original" and canvas.aspect not in _CANVAS_ASPECTS:
        raise HTTPException(status_code=400, detail="Unknown canvas size")
    if canvas.fit not in ("fit", "fill") or canvas.background.type not in ("color", "gradient", "blur", "image"):
        raise HTTPException(status_code=400, detail="Invalid canvas settings")
    if canvas.background.type == "image" and background is None:
        raise HTTPException(status_code=400, detail="Background image missing")

    job = progress.start(job_id)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            total_bytes = 0
            source_paths: list[str] = []
            source_infos: list[editor_pipeline.MediaInfo] = []
            for i, (kind, item) in enumerate(source_items):
                if kind == "path":
                    path = _local_file(item, _VIDEO_SUFFIXES)
                else:
                    suffix = Path(item.filename or "").suffix.lower()
                    path = os.path.join(tmp, f"source{i}{suffix if suffix in _VIDEO_SUFFIXES else '.mp4'}")
                    total_bytes += _save_upload(item, path, MAX_VIDEO_UPLOAD_BYTES)
                    if total_bytes > EDITOR_MAX_TOTAL_UPLOAD_BYTES and not LOCAL_MODE:
                        raise HTTPException(status_code=400, detail="Project files are too large to export together")
                try:
                    if kind == "path":
                        info = _checked_local_video(path)
                    else:
                        info = editor_pipeline.probe_media(path)
                        # OpenCV's read also proves frames actually decode (probe_media
                        # only parses container metadata) - catches truncated files.
                        cv_info, _ = video_pipeline.probe_video(path)
                        info.duration = max(info.duration, cv_info.duration)
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail="One of the videos could not be read") from exc
                # A long source is fine on the desktop: only the edit's length counts there.
                if info.duration > MAX_VIDEO_DURATION_SECONDS + 1 and not LOCAL_MODE:
                    raise HTTPException(status_code=400, detail="Video too long")
                if kind != "path":
                    _assert_video_safe(path)
                source_paths.append(path)
                if job:
                    job.check()
                source_infos.append(info)

            audio_paths: list[str] = []
            audio_durations: list[float] = []
            audio_monos: list[bool] = []
            for i, (kind, item) in enumerate(audio_items):
                if kind == "path":
                    # Extracted audio of a video on disk: the video file itself.
                    path = _local_file(item, _AUDIO_SUFFIXES | _VIDEO_SUFFIXES)
                else:
                    suffix = Path(item.filename or "").suffix.lower()
                    path = os.path.join(tmp, f"audio{i}{suffix if suffix in _AUDIO_SUFFIXES else '.bin'}")
                    total_bytes += _save_upload(item, path, EDITOR_MAX_LOCAL_AUDIO_BYTES if LOCAL_MODE else EDITOR_MAX_AUDIO_BYTES)
                    if total_bytes > EDITOR_MAX_TOTAL_UPLOAD_BYTES and not LOCAL_MODE:
                        raise HTTPException(status_code=400, detail="Project files are too large to export together")
                try:
                    audio_durations.append(editor_pipeline.probe_audio(path))
                    audio_monos.append(editor_pipeline.probe_audio_mono(path))
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
            if spec.fps:
                fps = spec.fps

            plan_clips: list[editor_pipeline.PlanClip] = []
            for c in spec.clips:
                info = source_infos[c.source]
                if c.freeze is not None:
                    hold = c.end - c.start
                    if hold > EDITOR_MAX_FREEZE_SECONDS + 0.01 or hold < 0.5 / fps:
                        raise HTTPException(status_code=400, detail="A freeze frame is too long")
                    # Last decodable frame at the latest; then held for `hold`.
                    start, duration = max(0.0, min(c.freeze, info.duration - 2 / fps)), hold
                else:
                    end = min(c.end, info.duration)
                    if c.start >= end - 0.5 / fps:
                        raise HTTPException(status_code=400, detail="A clip's time range is outside its video")
                    if c.reverse and end - c.start > EDITOR_MAX_REVERSE_SECONDS + 0.01:
                        raise HTTPException(status_code=400, detail="A reversed clip is too long")
                    if c.reverse:
                        # ffmpeg's reverse buffers every frame, after scaling to
                        # the clip's fitted box (canvas size times its zoom) -
                        # yuv420p is 1.5 bytes per pixel.
                        zoom = max(1.0, c.transform.scale)
                        frames = (end - c.start) / c.speed * fps
                        if out_w * out_h * zoom * zoom * 1.5 * frames > EDITOR_MAX_REVERSE_BUFFER_BYTES:
                            raise HTTPException(
                                status_code=400,
                                detail="A reversed clip is too long for this resolution. Shorten it or export at a lower resolution.",
                            )
                    start, duration = c.start, end - c.start
                # Clamp the crop into the frame (x + w <= 1, y + h <= 1).
                crop_w, crop_h = min(c.crop.w, 1 - c.crop.x), min(c.crop.h, 1 - c.crop.y)
                plan_clips.append(
                    editor_pipeline.PlanClip(
                        source_path=source_paths[c.source],
                        source_has_audio=info.has_audio and c.freeze is None,
                        source_mono=info.audio_mono,
                        source_width=info.width,
                        source_height=info.height,
                        start=start,
                        duration=duration,
                        freeze=c.freeze is not None,
                        reverse=c.reverse and c.freeze is None,
                        crop_x=c.crop.x,
                        crop_y=c.crop.y,
                        crop_w=crop_w,
                        crop_h=crop_h,
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
                        curve=c.look.curve or [],
                        lut_size=c.look.lut.size if c.look.lut else 0,
                        lut_data=c.look.lut.data if c.look.lut else [],
                        lut_intensity=c.look.lut.intensity if c.look.lut else 0.0,
                        camera=_camera_rows(c.camera) if c.camera and c.freeze is None else [],
                        keyframes=_keyframe_dicts(c.keyframes),
                        ramp=list(c.ramp),
                        mask_path=overlay_images[c.mask][0] if c.mask is not None else None,
                        stabilize=c.stabilize if c.freeze is None else 0.0,
                    )
                )

            plan = editor_pipeline.ExportPlan(
                width=out_w,
                height=out_h,
                fps=round(fps, 3),
                with_audio=False,
                clips=plan_clips,
                fit=canvas.fit,
                frame_padding=canvas.frame.padding if canvas.frame else 0.0,
                frame_radius=canvas.frame.radius if canvas.frame else 0.0,
                frame_shadow=canvas.frame.shadow if canvas.frame else 0.0,
                background=canvas.background.type,
                color=canvas.background.color,
                color2=canvas.background.color2,
                background_image=background_path,
            )
            if spec.pointer and (spec.pointer.cursorRows or spec.pointer.ringRows):
                plan.pointer = _pointer_plan(spec.pointer, overlay_images)
            plan.output_format = spec.format
            plan.master_gain_db = spec.masterGain
            plan.crf = editor_pipeline.QUALITY_CRF[spec.quality]
            if compact:
                plan.crf = EDITOR_COMPACT_CRF
                plan.audio_bitrate = EDITOR_COMPACT_AUDIO_BITRATE
            editor_pipeline.quantize_plan(plan)
            total = editor_pipeline.timeline_duration(plan)
            if max_seconds is not None and total > max_seconds + 0.5:
                if not LOCAL_MODE:
                    raise HTTPException(status_code=400, detail="The edited video is too long to export")
                minutes = int(max_seconds // 60)
                raise HTTPException(
                    status_code=403,
                    detail={
                        "code": "plan_required",
                        "message": f"The free plan exports videos up to {minutes} minutes. Upgrade to any paid plan to export longer videos, or trim this one.",
                    },
                )
            for m in spec.masks:
                planned = _mask_plan(m, total)
                if planned:
                    plan.masks.append(planned)

            # Layers entirely past the end of the (possibly shortened) timeline
            # are skipped; the rest are clamped to it.
            layer_audio: list[editor_pipeline.PlanAudio] = []
            for o in spec.overlays:
                start, end = o.start, min(o.end, total)
                if o.video is not None:
                    info = source_infos[o.video]
                    end = min(end, start + info.duration - o.offset)
                if end - start < 0.05:
                    continue
                if o.video is not None:
                    info = source_infos[o.video]
                    path, iw, ih = source_paths[o.video], info.width, info.height
                    if info.has_audio and o.volume > 0:
                        layer_audio.append(
                            editor_pipeline.PlanAudio(
                                path=path, start=start, offset=o.offset, duration=end - start, volume=o.volume, mono=info.audio_mono
                            )
                        )
                else:
                    path, iw, ih = overlay_images[o.image]  # type: ignore[index]
                    if o.sprite:
                        # Sized and placed as one cell of the grid.
                        iw, ih = max(1, iw // o.sprite.cols), max(1, ih // o.sprite.rows)
                plan.overlays.append(
                    editor_pipeline.PlanOverlay(
                        image_path=path, image_width=iw, image_height=ih, start=start, end=end,
                        x=o.x, y=o.y, width=o.width, rotation=o.rotation, opacity=o.opacity,
                        anim_in=o.animIn, anim_out=o.animOut,
                        video=o.video is not None, offset=o.offset, blend=o.blend,
                        key_color=o.key.color if o.key and o.video is not None else None,
                        key_similarity=o.key.similarity if o.key else 0.0,
                        key_smoothness=o.key.smoothness if o.key else 0.0,
                        keyframes=_keyframe_dicts(o.keyframes),
                        sprite_cols=o.sprite.cols if o.sprite else 1,
                        sprite_rows=o.sprite.rows if o.sprite else 1,
                        sprite_times=list(o.sprite.times) if o.sprite else [],
                        mask_path=overlay_images[o.mask][0] if o.mask is not None else None,
                    )
                )
            if branding:
                # Drawn last, so it sits above every user layer.
                path, iw, ih = _branding_overlay(tmp)
                mark_h = 0.045 * out_h
                width = iw * (mark_h / ih) / out_w
                margin = 0.02 * min(out_w, out_h)
                plan.overlays.append(
                    editor_pipeline.PlanOverlay(
                        image_path=path, image_width=iw, image_height=ih, start=0.0, end=total,
                        x=1 - width / 2 - margin / out_w, y=1 - (mark_h / 2 + margin) / out_h,
                        width=width, rotation=0.0, opacity=1.0,
                    )
                )
            for e in spec.effects:
                start, end = e.start, min(e.end, total)
                if end - start >= 0.05:
                    plan.effects.append(editor_pipeline.PlanEffect(type=e.type, start=start, end=end, intensity=e.intensity))
            for a in spec.audio:
                if a.audio is not None:
                    path, src_duration, mono = audio_paths[a.audio], audio_durations[a.audio], audio_monos[a.audio]
                else:
                    info = source_infos[a.video]  # type: ignore[index]
                    if not info.has_audio:
                        continue
                    path, src_duration, mono = source_paths[a.video], info.duration, info.audio_mono  # type: ignore[index]
                duration = min(a.duration, src_duration - a.offset, total - a.start)
                if duration < 0.05:
                    continue
                plan.audio.append(
                    editor_pipeline.PlanAudio(
                        path=path, start=a.start, offset=a.offset, duration=duration,
                        volume=a.volume, fade_in=min(a.fadeIn, duration / 2), fade_out=min(a.fadeOut, duration / 2),
                        voice=a.voice,
                        mono=mono,
                        duck_amount=a.duck.amount if a.duck else 0.0,
                        duck_regions=[(r[0], r[1]) for r in a.duck.regions] if a.duck else [],
                    )
                )
            plan.audio.extend(layer_audio)
            plan.with_audio = bool(plan.audio) or any(c.source_has_audio for c in plan.clips)
            if plan.output_format == "audio" and not plan.with_audio:
                raise HTTPException(status_code=400, detail="This project has no sound to export.")
            if plan.output_format == "gif":
                plan.with_audio = False
                if total > EDITOR_MAX_GIF_SECONDS:
                    raise HTTPException(status_code=400, detail=f"GIFs can be up to {int(EDITOR_MAX_GIF_SECONDS)} seconds long. Trim the video or export an MP4.")

            out_name, out_type = editor_pipeline.OUTPUT_FORMATS[plan.output_format]
            out_path = os.path.join(tmp, out_name)
            plan_json = editor_pipeline.plan_to_json(plan)
            # Full re-encode of the timeline plus per-clip decode seeks; layers,
            # effects and grading add compositing work on top.
            job_timeout = max(180.0, total * (8 + 0.5 * (len(plan.overlays) + len(plan.effects))))
            try:
                await _run_pipeline_job(jobs.editor_export_job, plan_json, out_path, job_id if job else None, timeout=job_timeout)
            except progress.Cancelled:
                raise
            except encoders.DiskFull as exc:
                need = f" It needs about {exc.needed / 1e9:.1f} GB" if exc.needed else ""
                free = f"; {exc.free / 1e9:.1f} GB is free" if exc.free is not None else ""
                raise HTTPException(
                    status_code=507,
                    detail={
                        "code": "disk_full",
                        "message": f"Not enough free disk space to export.{need}{free}. Free some space (or empty the Recycle Bin / Trash) and export again. Your project is unchanged.",
                    },
                ) from exc
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                raise HTTPException(
                    status_code=500,
                    detail={
                        "code": "export_failed",
                        "message": "Export failed. Your original video is safe. Please try exporting again.",
                    },
                ) from exc

            if keep_output:
                return _kept_result(out_path, out_type)
            return _stream_result(out_path, out_type)
    except progress.Cancelled as exc:
        raise HTTPException(status_code=409, detail={"code": "cancelled", "message": "Export cancelled."}) from exc
    finally:
        progress.finish(job_id)



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

        return _stream_result(out_path, "image/png")


@app.post("/api/image/sharpen")
async def api_image_sharpen(
    request: Request,
    file: UploadFile = File(...),
    strength: str = Form("standard"),  # "light" | "standard" | "strong"
    preview: bool = Form(False),
):
    """Standalone selective-unsharp-mask pass (sharpen.sharpen), independent
    of auto-enhance's full bg-removal/decontam pipeline - just clarity/detail
    enhancement on the image as uploaded.

    `preview=true` downscales to IMAGE_PREVIEW_MAX_MEGAPIXELS first, the same
    server-set free tier cap as /api/image/auto-enhance.
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
                jobs.image_sharpen_job,
                in_path,
                out_path,
                SHARPEN_AMOUNT_PRESETS[strength],
                IMAGE_PREVIEW_MAX_MEGAPIXELS if preview else None,
                timeout=60.0,
            )
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            raise HTTPException(
                status_code=500, detail=f"Image processing failed: {type(exc).__name__}: {exc}"
            ) from exc

        return _stream_result(out_path, "image/png")


@app.post("/api/image/auto-enhance")
async def api_image_auto_enhance(
    request: Request,
    file: UploadFile = File(...),
    preview: bool = Form(False),
):
    """Runs the full background-removal + halo-decontamination + alpha
    cleanup + sharpen pipeline (full_pipeline.auto_enhance) at its defaults.

    `preview=true` downscales to IMAGE_PREVIEW_MAX_MEGAPIXELS before
    processing - the Next.js /api/remove-background route sets this for the
    free daily result (never trusts the client's own value, same "server
    decides, client can't override" pattern api_video_process uses for
    output resolution); full resolution costs a credit there.
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

        preview_max_megapixels = IMAGE_PREVIEW_MAX_MEGAPIXELS if preview else None
        try:
            await _run_pipeline_job(
                jobs.image_auto_enhance_job, in_path, out_path, preview_max_megapixels, timeout=60.0
            )
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            raise HTTPException(
                status_code=500, detail=f"Image processing failed: {type(exc).__name__}: {exc}"
            ) from exc

        return _stream_result(out_path, "image/png")
