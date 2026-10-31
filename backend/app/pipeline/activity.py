"""On-screen activity for the editor's silence review: how much of a time
range the picture actually changes. A silent stretch where the screen keeps
changing (a video playing, a build scrolling past, a game) is part of the
footage, not dead time, so the editor reviews it instead of suggesting a cut.

ffmpeg's `freezedetect` marks stretches where consecutive frames differ by
less than a noise tolerance (mean absolute frame difference). Frames are
scaled down first: that's much faster, and a blinking text cursor or a
pointer moving over a still window averages away, which is what we want -
those aren't "something happening". Only the requested ranges are decoded
(`-ss` before `-i` seeks to the nearest keyframe), never the whole file.
"""

from __future__ import annotations

import asyncio
import re
import subprocess

from app.pipeline.video import get_ffmpeg_path

# Mean absolute difference (0..1) below which a frame counts as unchanged.
NOISE = 0.003
# Shortest still stretch that counts.
MIN_STILL = 0.5
SCALE_WIDTH = 320
# Frames compared per second: plenty for 0.5 s stretches, and the filter
# chain then runs on a third of a 30 fps recording (measured: 1080p at about
# 7x real time instead of 6x; hardware decoding was slower, the frames have
# to come back from the GPU).
SAMPLE_FPS = 10

_START = re.compile(r"freeze_start: ([0-9.]+)")
_END = re.compile(r"freeze_end: ([0-9.]+)")


def still_spans(log: str, length: float) -> list[tuple[float, float]]:
    """Still stretches from freezedetect's log, relative to the range start.
    A freeze still running at the end has no freeze_end: it lasts to `length`."""
    starts = [float(m) for m in _START.findall(log)]
    ends = [float(m) for m in _END.findall(log)]
    spans = []
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else length
        spans.append((max(0.0, s), min(length, max(s, e))))
    return spans


def changing_fraction(spans: list[tuple[float, float]], length: float) -> float:
    if length <= 0:
        return 0.0
    still = sum(e - s for s, e in spans)
    return max(0.0, min(1.0, 1.0 - still / length))


def _measure(ffmpeg: str, path: str, start: float, end: float) -> dict:
    length = max(0.0, end - start)
    proc = subprocess.run(
        [
            ffmpeg, "-hide_banner", "-nostats", "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", path,
            "-an", "-sn", "-vf", f"fps={SAMPLE_FPS},scale={SCALE_WIDTH}:-2,freezedetect=n={NOISE}:d={MIN_STILL}", "-f", "null", "-",
        ],
        capture_output=True,
        stdin=subprocess.DEVNULL,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed (exit {proc.returncode})")
    spans = still_spans(proc.stderr.decode(errors="replace"), length)
    return {
        "start": start,
        "end": end,
        "changing": round(changing_fraction(spans, length), 4),
        "still": [[round(start + s, 3), round(start + e, 3)] for s, e in spans],
    }


async def measure_ranges(path: str, ranges: list[tuple[float, float]]) -> list[dict]:
    """Per range (source seconds): the fraction of time the picture changes,
    and the still stretches in source seconds. Sequential: each range is
    short, and the caller sends small batches so it can stop between them."""
    ffmpeg = get_ffmpeg_path()
    out = []
    for start, end in ranges:
        out.append(await asyncio.to_thread(_measure, ffmpeg, path, start, end))
    return out


# --- motion profile (highlight suggestions) -------------------------------------
#
# For highlight suggestions the editor needs, over a whole stretch of a
# video, how much the picture moves and where the footage cuts to another
# scene. ffmpeg's `scdet` gives both per frame: `mafd`, the mean absolute
# difference to the previous frame (0..100 of full scale), and `score`, its
# scene-change score (the change in mafd, 0..100). Frames are sampled at
# PROFILE_FPS and scaled to PROFILE_WIDTH, like the check above.

PROFILE_FPS = 4
PROFILE_WIDTH = 160
# Longest range one call decodes; the editor sends shorter pieces so it can
# stop between them.
MAX_PROFILE_SECONDS = 600

_FRAME = re.compile(r"pts_time:([0-9.]+)")
_MAFD = re.compile(r"lavfi\.scd\.mafd=([0-9.]+)")
_SCORE = re.compile(r"lavfi\.scd\.score=([0-9.]+)")


def parse_profile(text: str) -> tuple[list[float], list[float], list[float]]:
    """(times relative to the range start, mafd, score) from
    `metadata=mode=print` output; frames missing a value get 0."""
    times: list[float] = []
    mafd: list[float] = []
    score: list[float] = []
    for line in text.splitlines():
        if (m := _FRAME.search(line)) is not None:
            times.append(float(m.group(1)))
            mafd.append(0.0)
            score.append(0.0)
        elif times and (m := _MAFD.search(line)) is not None:
            mafd[-1] = float(m.group(1))
        elif times and (m := _SCORE.search(line)) is not None:
            score[-1] = float(m.group(1))
    return times, mafd, score


def _profile(ffmpeg: str, path: str, start: float, end: float) -> dict:
    length = max(0.0, end - start)
    proc = subprocess.run(
        [
            ffmpeg, "-hide_banner", "-nostats", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", path,
            "-an", "-sn", "-vf", f"fps={PROFILE_FPS},scale={PROFILE_WIDTH}:-2,scdet=t=100,metadata=mode=print:file=-", "-f", "null", "-",
        ],
        capture_output=True,
        stdin=subprocess.DEVNULL,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed (exit {proc.returncode})")
    times, mafd, score = parse_profile(proc.stdout.decode(errors="replace"))
    return {
        "start": start,
        "end": end,
        "fps": PROFILE_FPS,
        "times": [round(start + t, 3) for t in times],
        "motion": [round(v, 2) for v in mafd],
        "scene": [round(v, 2) for v in score],
    }


async def motion_profile(path: str, start: float, end: float) -> dict:
    """Per sampled frame of source seconds start..end: time, picture change
    (mafd) and scene-change score, both 0..100."""
    return await asyncio.to_thread(_profile, get_ffmpeg_path(), path, start, end)
