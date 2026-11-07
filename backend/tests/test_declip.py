"""Clipping repair (app/pipeline/audio_clean.py repair_clipping and the
"repair" cleanup): flat tops redrawn close to the wave that was cut off,
the copy scaled under full scale with the make-up gain returned, sample
alignment kept, and chunk boundaries invisible.

Run from the backend folder:  python -m unittest tests.test_declip
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import tempfile
import unittest
from unittest import mock

import numpy as np
from fastapi.testclient import TestClient

from app import main
from app.pipeline import audio_clean
from tests.test_audio_mix import FF, RATE, audio_of


def tone(seconds: float, rate: int = RATE) -> np.ndarray:
    t = np.arange(int(seconds * rate)) / rate
    # Two partials with a slow swell, like a sung or shouted vowel.
    return 0.9 * (np.sin(2 * np.pi * 220 * t) + 0.5 * np.sin(2 * np.pi * 660 * t + 1)) / 1.5 * (0.6 + 0.4 * np.sin(2 * np.pi * 0.5 * t))


def distortion_db(y: np.ndarray) -> float:
    """Energy outside the tone's two partials (and their swell sidebands),
    relative to all of it: what clipping adds, blind to phase and level."""
    seg = y[RATE : 3 * RATE] * np.hanning(2 * RATE)
    p = np.abs(np.fft.rfft(seg)) ** 2
    f = np.fft.rfftfreq(len(seg), 1 / RATE)
    near = (np.abs(f - 220) < 4) | (np.abs(f - 660) < 4) | (f < 100)
    return float(10 * np.log10(p[~near].sum() / p.sum()))


def err_db(y: np.ndarray, ref: np.ndarray) -> float:
    n = min(len(y), len(ref))
    return float(20 * np.log10(np.sqrt(np.mean((y[:n] - ref[:n]) ** 2)) / np.sqrt(np.mean(ref[:n] ** 2))))


class RepairTest(unittest.TestCase):
    def test_flat_tops_are_redrawn_close_to_the_real_wave(self) -> None:
        for drive, want in ((1.3, -70), (2.0, -33), (3.0, -21)):
            ref = tone(4) * drive
            clipped = np.clip(ref, -1, 1)
            y, runs = audio_clean.repair_clipping(clipped, 0.999)
            self.assertGreater(runs, 0)
            self.assertLess(err_db(y, ref), want, f"drive {drive}: {err_db(clipped, ref):.1f} -> {err_db(y, ref):.1f} dB")
            self.assertLess(err_db(y, ref), err_db(clipped, ref) - 10)

    def test_unclipped_peaks_barely_change(self) -> None:
        # A smooth crest has a few samples within 0.1 % of the peak; redrawn
        # from its neighbors' slopes it comes out the same curve.
        x = tone(1) * 0.5
        y, _ = audio_clean.repair_clipping(x, float(np.max(np.abs(x))) * audio_clean._CLIP_FRACTION)
        self.assertLess(err_db(y, x), -80)

    def test_runs_at_the_very_ends_are_kept(self) -> None:
        x = np.array([1.0, 1.0, 1.0, 0.5, 0.2, 0.5, 1.0, 1.0], np.float32)
        y, runs = audio_clean.repair_clipping(x, 0.999)
        self.assertEqual(runs, 0)
        np.testing.assert_array_equal(y, x)


class RepairedCopyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = tempfile.TemporaryDirectory()
        # 25 s: longer than one 10 s chunk, so the cuts between chunks are tested.
        cls.ref = tone(25) * 2.0
        cls.src = os.path.join(cls.dir.name, "clipped.wav")
        subprocess.run(
            [FF, "-y", "-loglevel", "error", "-f", "f32le", "-ar", str(RATE), "-ac", "1", "-i", "-", "-c:a", "pcm_f32le", cls.src],
            input=np.clip(cls.ref, -1, 1).astype(np.float32).tobytes(),
            check=True,
        )

    @classmethod
    def tearDownClass(cls) -> None:
        cls.dir.cleanup()

    def test_copy_is_repaired_scaled_and_aligned(self) -> None:
        out = os.path.join(self.dir.name, "repaired.m4a")
        gain = asyncio.run(audio_clean.clean_audio(self.src, out, 0.0, 25.0, 0.0, False, repair=True))
        self.assertGreater(gain, 1.3)
        y = audio_of(out).astype(np.float64)
        self.assertLess(float(np.max(np.abs(y))), 1.0, "fits under full scale")
        self.assertAlmostEqual(len(y) / RATE, 25.0, delta=0.025)
        # Far less distortion than the clipped original (the copy also has
        # the cleanup's 70 Hz high-pass and AAC, so it's compared by its
        # spectrum, not sample by sample).
        before = distortion_db(audio_of(self.src).astype(np.float64))
        after = distortion_db(y)
        self.assertLess(after, before - 12, f"distortion {before:.1f} -> {after:.1f} dB")
        # Same timing as the plain cleaned copy (same chain, no repair):
        # the cross-correlation peaks at lag 0.
        plain = os.path.join(self.dir.name, "plain.m4a")
        asyncio.run(audio_clean.clean_audio(self.src, plain, 0.0, 25.0, 0.0, False))
        a, b = y[RATE : 2 * RATE], audio_of(plain).astype(np.float64)[RATE : 2 * RATE]
        best = max(range(-48, 49), key=lambda k: float(np.dot(a, np.roll(b, k))))
        self.assertEqual(best, 0)

    def test_no_seam_at_chunk_boundaries(self) -> None:
        raw = os.path.join(self.dir.name, "repaired.f32")
        gain, runs = audio_clean.repair_to_raw(self.src, raw, 0.0, 25.0, 1)
        y = np.fromfile(raw, np.float32).astype(np.float64)
        self.assertEqual(len(y), 25 * RATE)
        self.assertGreater(runs, 1000)
        # Every chunk edge is as close to the real wave as the rest.
        for edge in (10 * RATE, 20 * RATE):
            seg = slice(edge - 2000, edge + 2000)
            self.assertLess(err_db(y[seg], self.ref[seg]), -25, f"around sample {edge}")
        self.assertAlmostEqual(gain, float(np.max(np.abs(y))) / audio_clean._REPAIR_HEADROOM, places=4)

    def test_engine_returns_the_gain(self) -> None:
        with mock.patch.object(main, "LOCAL_MODE", True):
            res = TestClient(main.app).post("/api/audio/clean", data={"path": self.src, "start": "0", "end": "25", "denoise": "0", "level": "false", "repair": "true"})
        self.assertEqual(res.status_code, 200, res.text[:300])
        self.assertGreater(float(res.headers["x-clean-gain"]), 1.3)
        with mock.patch.object(main, "LOCAL_MODE", True):
            plain = TestClient(main.app).post("/api/audio/clean", data={"path": self.src, "start": "0", "end": "25", "denoise": "0.5", "level": "false"})
        self.assertEqual(float(plain.headers["x-clean-gain"]), 1.0)


if __name__ == "__main__":
    unittest.main()
