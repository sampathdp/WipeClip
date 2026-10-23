"""Audio cleanup for the desktop editor's "Clean up audio": reduces steady
background noise (fan, hum, hiss) and evens out the loudness of a range of
a clip's sound, as a new audio file the editor puts on its own track.

ffmpeg's FFT denoiser (`afftdn`) needs the noise floor it should remove;
its own noise tracking barely reduces anything (measured), so the floor is
measured here first: the level of the quietest stretches (10th percentile
of 50 ms windows), where only the background is left. Then a gentle
high-pass for rumble, and the loudness brought to about -16 LUFS (the usual
level for spoken video) with one fixed gain - not loudnorm's dynamic mode,
which lifts the quiet gaps and with them the remaining noise. It doesn't
separate voices from music or remove one-off sounds (clicks, a door).
"""

from __future__ import annotations

import asyncio
import math
import re
import subprocess

import numpy as np

from app.pipeline.video import _run_ffmpeg, get_ffmpeg_path

TARGET_LUFS = -16.0
TRUE_PEAK_DB = -1.5
_RATE = 48000  # full band: resampling lower drops broadband noise energy and reads the floor too low
_WINDOW = _RATE // 20  # 50 ms
# Steady noise doesn't change much: the floor is read from at most this
# much of the range (2 min of 48 kHz float audio is about 23 MB).
_ANALYZE_SECONDS = 120.0


def _decode(in_path: str, start: float, dur: float, filters: str | None = None) -> np.ndarray:
    args = [get_ffmpeg_path(), "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", in_path, "-vn"]
    if filters:
        args += ["-af", filters]
    args += ["-ac", "1", "-ar", str(_RATE), "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(args, capture_output=True, check=True).stdout, np.float32)


def noise_floor_db(samples: np.ndarray) -> float:
    """Level of the quietest stretches, in dBFS (afftdn's `nf` range)."""
    n = len(samples) // _WINDOW
    if n == 0:
        return -60.0
    windows = samples[: n * _WINDOW].astype(np.float64).reshape(n, _WINDOW)
    levels = np.sqrt(np.mean(windows**2, axis=1))
    floor = float(np.percentile(levels, 10))
    return max(-80.0, min(-20.0, 20 * math.log10(max(floor, 1e-6))))


def _loudness(in_path: str, filters: str) -> tuple[float, float] | None:
    """Integrated loudness (LUFS) and true peak (dBTP) after `filters`."""
    err = subprocess.run(
        [get_ffmpeg_path(), "-hide_banner", "-nostats", "-i", in_path, "-af", f"{filters},ebur128=peak=true", "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    i = re.findall(r"I:\s+(-?[\d.]+) LUFS", err)
    p = re.findall(r"Peak:\s+(-?[\d.]+|-inf) dBFS", err)
    if not i or not p or p[-1] == "-inf":
        return None
    return float(i[-1]), float(p[-1])


def clean_filters(denoise: float, floor_db: float | None) -> str:
    """`denoise` 0..1 maps to afftdn's noise reduction of 6..40 dB."""
    parts = ["highpass=f=70"]
    d = max(0.0, min(1.0, denoise))
    if d > 0 and floor_db is not None:
        parts.append(f"afftdn=nr={6 + 34 * d:.1f}:nf={floor_db:.1f}")
    return ",".join(parts)


async def clean_audio(in_path: str, out_path: str, start: float, end: float, denoise: float, level: bool) -> None:
    dur = max(0.05, end - start)
    floor = None
    if denoise > 0:
        floor = noise_floor_db(await asyncio.to_thread(_decode, in_path, start, min(dur, _ANALYZE_SECONDS)))
    filters = clean_filters(denoise, floor)
    if level:
        # Measure the cleaned range, then one gain to the target, kept under
        # the true-peak ceiling.
        trimmed = f"atrim=start={start:.3f}:duration={dur:.3f},{filters}"
        measured = await asyncio.to_thread(_loudness, in_path, trimmed)
        if measured is not None:
            lufs, peak = measured
            gain = min(TARGET_LUFS - lufs, TRUE_PEAK_DB - peak)
            filters += f",volume={gain:.2f}dB"
    await _run_ffmpeg(
        [
            "-y",
            "-ss", f"{start:.3f}",
            "-t", f"{dur:.3f}",
            "-i", in_path,
            "-vn",
            "-af", filters,
            "-ar", "48000",
            "-c:a", "aac",
            "-b:a", "192k",
            out_path,
        ]
    )
