"""Synchronous job entrypoints, callable both directly (inline, via
asyncio.to_thread - see _run_pipeline_job in main.py) and as RQ job targets
when REDIS_URL is set (see app/queue.py). RQ resolves a job by importable
module path and calls it synchronously in the worker process - it has no
event loop of its own - so the video wrappers below run their async
pipeline calls through asyncio.run() rather than being async themselves.

Every function here takes and produces file paths, never in-memory arrays
or raw bytes, so a job's arguments stay small values Redis can carry
cheaply - the actual image/video data only ever touches disk, matching how
video processing already worked before this module existed.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import numpy as np

from app.config import DEFAULT_SHARPEN_RADIUS
from app.pipeline import editor as editor_pipeline
from app.pipeline import full_pipeline, io_utils, manual_inpaint, sharpen as sharpen_pipeline
from app.pipeline import video as video_pipeline


def reconstruct_region_job(
    in_path: str, out_path: str, x: int, y: int, w: int, h: int, output_height: int | None, quality: str
) -> None:
    asyncio.run(video_pipeline.reconstruct_region(in_path, out_path, x, y, w, h, output_height, quality))


def editor_export_job(plan_json: str, out_path: str) -> None:
    """`plan_json` is editor.ExportPlan serialized by main.py (a plain
    string, so it crosses the RQ boundary cheaply like the other jobs' args).
    """
    plan = editor_pipeline.plan_from_json(plan_json)
    # main.py already quantized durations (speed + frame snapping) before
    # serializing; don't apply it twice.
    plan._quantized = True  # type: ignore[attr-defined]
    asyncio.run(editor_pipeline.render_export(plan, out_path))


def image_remove_job(in_path: str, out_path: str, x: int, y: int, w: int, h: int) -> None:
    bgra, icc_profile = io_utils.decode_upload_to_bgra(Path(in_path).read_bytes())
    mask = np.zeros(bgra.shape[:2], dtype=np.uint8)
    mask[y : y + h, x : x + w] = 255
    result = manual_inpaint.paint_remove(bgra, mask)
    Path(out_path).write_bytes(io_utils.encode_bgra_to_png(result, icc_profile))


def image_auto_enhance_job(in_path: str, out_path: str, preview_max_megapixels: float | None) -> None:
    bgra, icc_profile = io_utils.decode_upload_to_bgra(Path(in_path).read_bytes())
    if preview_max_megapixels is not None:
        bgra = io_utils.downscale_to_max_megapixels(bgra, preview_max_megapixels)
    result = full_pipeline.auto_enhance(bgra)
    Path(out_path).write_bytes(io_utils.encode_bgra_to_png(result, icc_profile))


def image_sharpen_job(in_path: str, out_path: str, amount: float) -> None:
    bgra, icc_profile = io_utils.decode_upload_to_bgra(Path(in_path).read_bytes())
    result = sharpen_pipeline.sharpen(bgra, DEFAULT_SHARPEN_RADIUS, amount)
    Path(out_path).write_bytes(io_utils.encode_bgra_to_png(result, icc_profile))
