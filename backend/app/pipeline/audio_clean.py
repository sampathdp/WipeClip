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
import os
import re
import subprocess
from functools import lru_cache

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
    res = subprocess.run(args, capture_output=True)
    if res.returncode != 0:
        # A RuntimeError like _run_ffmpeg's, which the route turns into a
        # message; without the command (or the chained error), which names
        # the user's file.
        raise RuntimeError(f"ffmpeg couldn't decode the audio (exit {res.returncode})")
    return np.frombuffer(res.stdout, np.float32)


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


@lru_cache(maxsize=8)
def filter_delay(filters: str) -> int:
    """Samples `filters` delay the sound at _RATE, measured on an impulse.
    afftdn outputs its FFT window late (1200 samples, 25 ms, at 48 kHz with
    ffmpeg 7.1) and ffmpeg doesn't compensate; uncorrected, the cleaned
    copy played 25 ms behind the picture (measured)."""
    src = f"aevalsrc='between(n\\,{_RATE // 2}\\,{_RATE // 2})':s={_RATE}:d=1"
    res = subprocess.run(
        [get_ffmpeg_path(), "-loglevel", "error", "-f", "lavfi", "-i", src, "-af", f"apad=pad_dur=0.5,{filters}", "-ac", "1", "-f", "f32le", "-"],
        capture_output=True,
    )
    x = np.frombuffer(res.stdout, np.float32)
    if res.returncode != 0 or len(x) < _RATE or not np.any(x):
        return 0
    return max(0, int(np.argmax(np.abs(x))) - _RATE // 2)


def clean_filters(denoise: float, floor_db: float | None) -> str:
    """`denoise` 0..1 maps to afftdn's noise reduction of 6..40 dB. Runs at
    _RATE, so the denoiser's delay is the same for every file, and is
    compensated: the input is padded by it and the output starts that much
    later, so the copy lines up with the original sample for sample."""
    parts = [f"aresample={_RATE}", "highpass=f=70"]
    d = max(0.0, min(1.0, denoise))
    if d > 0 and floor_db is not None:
        parts.append(f"afftdn=nr={6 + 34 * d:.1f}:nf={floor_db:.1f}")
    chain = ",".join(parts)
    delay = filter_delay(chain)
    if delay:
        chain = f"{parts[0]},apad=pad_len={delay},{','.join(parts[1:])},atrim=start_sample={delay},asetpts=PTS-STARTPTS"
    return chain


# --- Clipping repair ------------------------------------------------------
# A recording that hit full scale has flat tops where the wave was cut off.
# Each run of 2+ samples at the file's peak level is redrawn as a cubic
# Hermite curve between its neighbors, with their slopes, so the wave goes
# on past the old ceiling as it did in the air. Measured on a test tone
# driven 2x into clipping: error -15.9 dB -> -34.5 dB, about 2 ms per second
# of audio (ffmpeg's adeclip got -25.9 dB at 1.3x real time). The repaired
# copy is then scaled under full scale, and the gain that undoes that is
# returned, so the editor plays it at the original level.

_CLIP_FRACTION = 0.999  # of the file's peak: what counts as the ceiling
_CHUNK = _RATE * 10
_REPAIR_HEADROOM = 0.95  # repaired copy's peak


def _runs(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    d = np.diff(np.concatenate(([0], mask.astype(np.int8), [0])))
    return np.flatnonzero(d == 1), np.flatnonzero(d == -1)


def repair_clipping(x: np.ndarray, ceiling: float) -> tuple[np.ndarray, int]:
    """One channel: clipped runs (|x| >= ceiling) redrawn. Runs that touch
    either end (no neighbors to draw from) are kept. Returns the samples
    (float64) and how many runs were repaired."""
    y = x.astype(np.float64)
    n = len(y)
    a, b = _runs(np.abs(x) >= ceiling)
    keep = ((b - a) >= 2) & (a >= 2) & (b <= n - 2)
    a, b = a[keep], b[keep]
    if len(a) == 0:
        return y, 0
    y = y.copy()
    s0, s1 = a - 1, b  # the unclipped samples either side
    p0, p1 = y[s0], y[s1]
    m0, m1 = y[s0] - y[s0 - 1], y[s1 + 1] - y[s1]
    width = (s1 - s0).astype(np.float64)
    lens = b - a
    rid = np.repeat(np.arange(len(a)), lens)
    pos = np.arange(int(lens.sum())) - np.repeat(np.cumsum(lens) - lens, lens) + 1
    u = pos / width[rid]
    w = width[rid]
    v = (
        (2 * u**3 - 3 * u**2 + 1) * p0[rid]
        + (u**3 - 2 * u**2 + u) * w * m0[rid]
        + (-2 * u**3 + 3 * u**2) * p1[rid]
        + (u**3 - u**2) * w * m1[rid]
    )
    idx = np.repeat(a, lens) + pos - 1
    sign = np.sign(x[idx])
    # Never inside the ceiling: the real wave went past it.
    y[idx] = sign * np.maximum(sign * v, ceiling)
    return y, len(a)


def _decode_stream(in_path: str, start: float, dur: float, channels: int) -> subprocess.Popen:
    return subprocess.Popen(
        [get_ffmpeg_path(), "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", in_path, "-vn",
         "-ac", str(channels), "-ar", str(_RATE), "-f", "f32le", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )  # fmt: skip


def _chunks(in_path: str, start: float, dur: float, channels: int):
    proc = _decode_stream(in_path, start, dur, channels)
    assert proc.stdout is not None
    size = _CHUNK * channels * 4
    try:
        while True:
            buf = proc.stdout.read(size)
            if not buf:
                break
            usable = len(buf) - len(buf) % (channels * 4)
            yield np.frombuffer(buf[:usable], np.float32).reshape(-1, channels)
    finally:
        proc.stdout.close()
        if proc.wait() != 0:
            raise RuntimeError(f"ffmpeg couldn't decode the audio (exit {proc.returncode})")


def repair_to_raw(in_path: str, raw_path: str, start: float, dur: float, channels: int) -> tuple[float, int]:
    """Writes the range, clipping repaired, as 48 kHz float32 to `raw_path`.
    Returns (make-up gain the copy needs, runs repaired). Streams in 10 s
    chunks, each cut where two samples in a row are below the ceiling, so
    no run is split; two samples before each chunk give the slopes."""
    max_carry = _CHUNK * 6  # a minute without two quiet samples in a row: just emit
    peak = 0.0
    for c in _chunks(in_path, start, dur, channels):
        if len(c):
            peak = max(peak, float(np.max(np.abs(c))))
    if peak <= 0:
        raise RuntimeError("no sound")
    ceiling = peak * _CLIP_FRACTION
    out_peak = 0.0
    repaired = 0
    carry = np.zeros((0, channels), np.float32)
    before = np.zeros((0, channels), np.float32)

    def emit(seg: np.ndarray, ctx: np.ndarray, f) -> None:
        nonlocal out_peak, repaired
        full = np.concatenate((ctx, seg))
        out = np.empty((len(seg), channels), np.float32)
        for ch in range(channels):
            y, k = repair_clipping(full[:, ch], ceiling)
            repaired += k
            out[:, ch] = y[len(ctx) :]
        out_peak = max(out_peak, float(np.max(np.abs(out))) if len(out) else 0.0)
        f.write(out.tobytes())

    with open(raw_path, "wb") as f:
        for c in _chunks(in_path, start, dur, channels):
            x = np.concatenate((carry, c))
            quiet = np.all(np.abs(x) < ceiling, axis=1)
            ok = np.flatnonzero(quiet[:-1] & quiet[1:])
            cut = int(ok[-1]) if len(ok) else 0
            if cut < 2:
                if len(x) > max_carry:
                    emit(x, before, f)
                    before = x[-2:]
                    carry = np.zeros((0, channels), np.float32)
                else:
                    carry = x
                continue
            # Repair up to two samples past the cut (the anchors), emit to it.
            seg = x[: cut + 2]
            full = np.concatenate((before, seg))
            out = np.empty((cut, channels), np.float32)
            for ch in range(channels):
                y, k = repair_clipping(full[:, ch], ceiling)
                repaired += k
                out[:, ch] = y[len(before) : len(before) + cut]
            out_peak = max(out_peak, float(np.max(np.abs(out))))
            f.write(out.tobytes())
            before = x[max(0, cut - 2) : cut]
            carry = x[cut:]
        if len(carry):
            emit(carry, before, f)
    scale = min(1.0, _REPAIR_HEADROOM / out_peak) if out_peak > 0 else 1.0
    return 1.0 / scale, repaired


async def clean_audio(in_path: str, out_path: str, start: float, end: float, denoise: float, level: bool, repair: bool = False) -> float:
    """Writes the cleaned copy; returns the gain to play it at (above 1 when
    the clipping repair had to scale it down to fit)."""
    dur = max(0.05, end - start)
    if repair:
        return await _clean_repaired(in_path, out_path, start, dur, denoise)
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
    return 1.0


async def _clean_repaired(in_path: str, out_path: str, start: float, dur: float, denoise: float) -> float:
    """Clipping repaired first (on the original samples), then the usual
    cleanup chain, scaled under full scale; returns the make-up gain."""
    from app.pipeline.editor import probe_audio_mono

    channels = 1 if probe_audio_mono(in_path) else 2
    raw = out_path + ".f32"
    try:
        gain, _ = await asyncio.to_thread(repair_to_raw, in_path, raw, start, dur, channels)
        floor = None
        if denoise > 0:
            n = min(os.path.getsize(raw) // (4 * channels), int(_ANALYZE_SECONDS * _RATE))
            x = np.fromfile(raw, np.float32, count=n * channels).reshape(-1, channels).mean(axis=1)
            floor = noise_floor_db(x)  # afftdn runs before the scaling
        filters = f"{clean_filters(denoise, floor)},volume={1 / gain:.6f}"
        await _run_ffmpeg(
            ["-y", "-f", "f32le", "-ar", str(_RATE), "-ac", str(channels), "-i", raw, "-af", filters, "-ar", "48000", "-c:a", "aac", "-b:a", "192k", out_path]
        )  # fmt: skip
    finally:
        if os.path.exists(raw):
            os.remove(raw)
    return gain
