"""Echo and reverb reduction: weighted prediction error (WPE), the standard
blind dereverberation method (Nakatani et al., "Speech dereverberation based
on variance-normalized delayed linear prediction", IEEE TASLP 2010).

In the short-time spectrum, the late reverb of each frequency is predicted
from the frames before it (after a short delay that keeps the direct sound
and early reflections, which carry the voice) and subtracted. The
prediction is weighted by the clean speech's own power, estimated in a few
iterations, so loud speech doesn't dominate it. One channel at a time,
written here with numpy (no model to download). Filters are estimated per
block of a few seconds, so a room that changes - or a moving speaker - is
followed, and memory stays bounded on long files.
"""

from __future__ import annotations

from typing import Callable, Optional

import numpy as np

TAPS = 10  # frames of the past each prediction uses
DELAY = 3  # frames skipped first: the direct sound and early reflections stay
ITERATIONS = 3
BLOCK_SECONDS = 8.0


def _frame(rate: int) -> tuple[int, int]:
    """FFT size and hop: about 32 ms and 8 ms, as WPE is usually run."""
    n = 1 << int(round(np.log2(rate * 0.032)))
    return n, n // 4


def _stft(x: np.ndarray, n: int, hop: int, win: np.ndarray) -> np.ndarray:
    pad = np.pad(x, (n, n + hop))
    count = (len(pad) - n) // hop + 1
    idx = np.arange(n)[None, :] + hop * np.arange(count)[:, None]
    return np.fft.rfft(pad[idx] * win, axis=1).astype(np.complex64)  # (T, F)


def _istft(spec: np.ndarray, n: int, hop: int, win: np.ndarray, length: int) -> np.ndarray:
    frames = np.fft.irfft(spec, n=n, axis=1) * win
    total = hop * (len(spec) - 1) + n
    out = np.zeros(total, np.float64)
    norm = np.zeros(total, np.float64)
    for t in range(len(spec)):
        out[t * hop : t * hop + n] += frames[t]
        norm[t * hop : t * hop + n] += win**2
    out /= np.maximum(norm, 1e-8)
    return out[n : n + length]


def _wpe_block(Y: np.ndarray, start: int, end: int) -> np.ndarray:
    """Dereverberated frames start..end of Y (T, F), predicted from the
    frames before each (which may reach before `start`)."""
    K, D = TAPS, DELAY
    lo = max(0, start - K - D + 1)
    seg = Y[lo:end].T  # (F, Ts)
    F, Ts = seg.shape
    off = start - lo
    # Delayed taps: for target frame t, frames t-D, ..., t-D-K+1.
    stacked = np.zeros((F, Ts, K), np.complex64)
    for k in range(K):
        shift = D + k
        if shift < Ts:
            stacked[:, shift:, k] = seg[:, : Ts - shift]
    target = seg[:, off:]
    taps = stacked[:, off:, :]  # (F, Tb, K)
    est = target.copy()
    for _ in range(ITERATIONS):
        power = np.maximum(np.abs(est) ** 2, 1e-10)
        # Average over neighboring frames, as the speech power varies smoothly.
        power = (power + np.roll(power, 1, axis=1) + np.roll(power, -1, axis=1)) / 3
        weighted = taps / power[:, :, None]
        R = np.matmul(weighted.conj().transpose(0, 2, 1), taps)  # (F, K, K)
        p = np.matmul(weighted.conj().transpose(0, 2, 1), target[:, :, None])  # (F, K, 1)
        R += np.eye(K, dtype=np.complex64)[None] * (1e-6 * np.trace(R, axis1=1, axis2=2).real[:, None, None] / K + 1e-12)
        G = np.linalg.solve(R, p)  # (F, K, 1)
        est = target - np.matmul(taps, G)[:, :, 0]
    return est.T  # (Tb, F)


# --- Late reverb suppression (after WPE) -----------------------------------
# What WPE leaves: the late tail, estimated from the spectrum LATE_MS
# earlier, decayed at the room's rate (Lebart et al. 2001; Habets 2007),
# and taken out with a spectral gain no lower than GAIN_FLOOR_DB (lower
# sounds watery). The room's decay time is estimated from the sound itself.

LATE_MS = 50.0

# Strengths: the room's reverb time assumed (s) and the lowest gain (dB).
# The reverb time can't be read reliably from continuous speech (tried:
# estimates from the decays after words stayed at 0.55-0.7 s for rooms of
# 0.3-1.4 s), so the user picks the strength and compares by ear.
# Measured on speech in simulated rooms (tail = level in the pauses):
#   Light:  0.4 s room -9 dB, 0.7 s -4 dB, 1.0 s -2 dB; dry speech 21.8 dB SDR
#   Medium: 0.4 s -14 dB,     0.7 s -6 dB, 1.0 s -3 dB; dry speech 16.7 dB SDR
#   Strong: 0.4 s -16 dB,     0.7 s -7 dB, 1.0 s -4 dB; dry speech 14.6 dB SDR
STRENGTHS = {1: (0.4, -12.0), 2: (0.7, -15.0), 3: (1.0, -20.0)}


def suppress_late(Y: np.ndarray, rt60: float, hop_s: float, floor_db: float = -15.0) -> np.ndarray:
    """Spectral subtraction of the late reverb from Y (T, F)."""
    late = max(1, int(round(LATE_MS / 1000 / hop_s)))
    delta = 3 * np.log(10) / rt60
    decay = np.exp(-2 * delta * late * hop_s)
    power = np.abs(Y) ** 2
    # Smoothed power, so the estimate follows the sound, not each frame.
    smooth = power.copy()
    for t in range(1, len(power)):
        smooth[t] = 0.6 * smooth[t - 1] + 0.4 * power[t]
    est = np.zeros_like(power)
    est[late:] = decay * smooth[:-late]
    floor = 10 ** (floor_db / 20)
    gain = np.clip(1 - est / np.maximum(power, 1e-12), floor**2, 1) ** 0.5
    # Smooth the gain over time a little against "musical noise".
    for t in range(1, len(gain)):
        gain[t] = np.maximum(gain[t], 0.5 * gain[t - 1] + 0.5 * gain[t] - 0.15)
    return (Y * gain).astype(np.complex64)


def dereverb(x: np.ndarray, rate: int, strength: int = 2, progress: Optional[Callable[[float], None]] = None) -> np.ndarray:
    """One channel (float), the same length and timing, with late reverb
    taken out: WPE, then late reverb suppression at `strength` (1-3)."""
    rt60, floor_db = STRENGTHS.get(strength, STRENGTHS[2])
    n, hop = _frame(rate)
    win = np.hanning(n + 1)[:-1].astype(np.float64)
    Y = _stft(x.astype(np.float64), n, hop, win)
    out = np.empty_like(Y)
    block = max(TAPS + DELAY + 1, int(BLOCK_SECONDS * rate / hop))
    for start in range(0, len(Y), block):
        end = min(len(Y), start + block)
        out[start:end] = _wpe_block(Y, start, end)
        if progress:
            progress(0.9 * end / len(Y))
    out = suppress_late(out, rt60, hop / rate, floor_db)
    if progress:
        progress(1.0)
    return _istft(out, n, hop, win, len(x)).astype(np.float32)
