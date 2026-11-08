"""Clean up audio's engine options (audio_clean.clean_filters): mouth clicks
(adeclick) and wind (a steeper low cut) on the cleaned copy, still lined
up with the original; and breaths turned down in the export
(editor.breath_points = breathGain() in src/lib/editor/breaths.ts).

Run from the backend folder:  python -m unittest tests.test_cleanup_options
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import tempfile
import unittest

import numpy as np

from app import main
from app.pipeline import audio_clean, editor
from tests.test_audio_mix import FF, FPS, H, RATE, W, audio_of, clip, make_flash_clicks, make_wav, render


def write_wav(path: str, x: np.ndarray) -> None:
    subprocess.run(
        [FF, "-y", "-loglevel", "error", "-f", "f32le", "-ar", str(RATE), "-ac", "1", "-i", "-", "-c:a", "pcm_f32le", path],
        input=x.astype(np.float32).tobytes(),
        check=True,
    )


class CleanupOptionsTest(unittest.TestCase):
    def test_mouth_clicks_are_removed_and_the_copy_stays_aligned(self) -> None:
        t = np.arange(6 * RATE) / RATE
        voice = 0.3 * np.sin(2 * np.pi * 180 * t) * (np.sin(2 * np.pi * 2 * t) > 0)
        x = voice.copy()
        rng = np.random.default_rng(3)
        for c in rng.integers(RATE, 5 * RATE, 60):
            x[c : c + 8] += rng.uniform(-0.6, 0.6, 8)
        with tempfile.TemporaryDirectory() as d:
            src, out, plain = os.path.join(d, "in.wav"), os.path.join(d, "out.m4a"), os.path.join(d, "plain.m4a")
            write_wav(src, x)
            asyncio.run(audio_clean.clean_audio(src, out, 0, 6, 0.0, False, mouth=True))
            asyncio.run(audio_clean.clean_audio(src, plain, 0, 6, 0.0, False))
            y, p = audio_of(out).astype(np.float64), audio_of(plain).astype(np.float64)
            spikes = lambda s: int((np.abs(np.diff(s)) > 0.15).sum())  # noqa: E731
            self.assertLess(spikes(y), spikes(p) / 10, f"{spikes(p)} -> {spikes(y)}")
            # Same timing as the copy without it.
            a, b = y[RATE : 2 * RATE], p[RATE : 2 * RATE]
            self.assertEqual(max(range(-48, 49), key=lambda k: float(np.dot(a, np.roll(b, k)))), 0)

    def test_wind_cuts_rumble_but_keeps_the_voice(self) -> None:
        t = np.arange(4 * RATE) / RATE
        x = 0.3 * np.sin(2 * np.pi * 40 * t) + 0.3 * np.sin(2 * np.pi * 400 * t)
        with tempfile.TemporaryDirectory() as d:
            src, out, plain = os.path.join(d, "in.wav"), os.path.join(d, "out.m4a"), os.path.join(d, "plain.m4a")
            write_wav(src, x)
            asyncio.run(audio_clean.clean_audio(src, out, 0, 4, 0.0, False, wind=True))
            asyncio.run(audio_clean.clean_audio(src, plain, 0, 4, 0.0, False))

            def band(path: str, hz: float) -> float:
                s = audio_of(path).astype(np.float64)[RATE : 3 * RATE]
                f = np.abs(np.fft.rfft(s * np.hanning(len(s))))
                k = int(round(hz * len(s) / RATE))
                return float(20 * np.log10(f[k - 2 : k + 3].max()))

            self.assertLess(band(out, 40) - band(plain, 40), -15, "rumble at 40 Hz much lower than the gentle low cut leaves")
            self.assertGreater(band(out, 400) - band(plain, 400), -1, "the voice at 400 Hz kept")

    def test_engine_accepts_the_options(self) -> None:
        from unittest import mock

        from fastapi.testclient import TestClient

        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "in.wav")
            make_wav(src, "0.3*sin(2*PI*300*t)", 2.0)
            with mock.patch.object(main, "LOCAL_MODE", True):
                res = TestClient(main.app).post("/api/audio/clean", data={"path": src, "end": "2", "denoise": "0", "level": "false", "wind": "true", "mouth": "true"})
            self.assertEqual(res.status_code, 200, res.text[:300])


class BreathExportTest(unittest.TestCase):
    def test_breaths_are_turned_down_in_the_export(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "flash.mov")
            make_flash_clicks(src, 4.0)
            wav = os.path.join(d, "tone.wav")
            make_wav(wav, "0.4*sin(2*PI*1000*t)", 6.0)
            # Track from file second 1 at timeline 0.5; a breath at file 2.0..2.6.
            plan = editor.ExportPlan(
                width=W, height=H, fps=FPS, with_audio=True,
                clips=[clip(src, 0.0, 4.0, volume=0.0)],
                audio=[editor.PlanAudio(path=wav, start=0.5, offset=1.0, duration=3.0, breaths=[(2.0, 2.6)])],
                output_format="audio",
            )  # fmt: skip
            out = os.path.join(d, "breath.m4a")
            render(plan, out)
            x = audio_of(out).astype(np.float64)
            rms = lambda tl: float(np.sqrt(np.mean(x[int((tl - 0.03) * RATE) : int((tl + 0.03) * RATE)] ** 2)))  # noqa: E731
            drop = 20 * np.log10(rms(1.8) / rms(1.0))  # timeline 1.8 = file 2.3
            self.assertAlmostEqual(drop, editor.BREATH_DROP_DB, delta=1.0)
            self.assertAlmostEqual(rms(2.6) / rms(1.0), 1.0, delta=0.05, msg="back to full after it")

    def test_points_and_validation(self) -> None:
        pts = editor.breath_points([(2.0, 2.6), (1.0, 1.04)])
        self.assertEqual([round(p["t"], 6) for p in pts], [1.0, 1.02, 1.02, 1.04, 2.0, 2.03, 2.57, 2.6])
        self.assertTrue(main._valid_spans([[1, 2], [2, 3]]))
        for bad in ([[2, 1]], [[1, 2], [1.5, 3]], [[-1, 1]], [[1]]):
            self.assertFalse(main._valid_spans(bad), bad)


if __name__ == "__main__":
    unittest.main()
