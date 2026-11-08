"""Echo and reverb reduction (app/pipeline/dereverb.py) and background
removal (audio_clean isolate, the voice separator) in the cleaned copy:
less sound in the pauses, the same length and timing, a dry voice barely
touched, and the engine's options, progress and limits.

The background test needs the separator model (166 MB); it runs when it's
downloaded (WIPECLIP_MODELS_DIR) and is skipped otherwise.

Run from the backend folder:  python -m unittest tests.test_echo_background
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock

import numpy as np
from fastapi.testclient import TestClient
from scipy.signal import fftconvolve

from app import main
from app.pipeline import audio_clean, dereverb, dub, speech
from tests.test_audio_mix import RATE, audio_of
from tests.test_cleanup_options import write_wav


FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "speech-10s.wav"


def speech_at(seconds: float = 10.0) -> np.ndarray:
    """tests/fixtures/speech-10s.wav (synthesized narration, 16 kHz) at
    RATE, the first `seconds`: real speech, which the separator knows."""
    with wave.open(str(FIXTURE)) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float64) / 32768
        rate = w.getframerate()
    t = np.arange(int(min(seconds, len(x) / rate) * RATE)) / RATE
    return np.interp(t, np.arange(len(x)) / rate, x)


def room(rt60: float, drr_db: float) -> np.ndarray:
    n = int(rt60 * 1.2 * RATE)
    tt = np.arange(n) / RATE
    h = np.random.default_rng(7).standard_normal(n) * np.exp(-6.9 * tt / rt60)
    h[: int(0.002 * RATE)] = 0
    h *= np.sqrt(10 ** (-drr_db / 10) / np.sum(h**2))
    h[0] = 1.0
    return h


def pause_level(sig: np.ndarray, dry: np.ndarray) -> float:
    """Level in the dry voice's pauses relative to its speech, dB."""
    fr = 480
    n = min(len(sig), len(dry)) // fr
    ed = (dry[: n * fr].reshape(n, fr) ** 2).mean(1)
    e = (sig[: n * fr].reshape(n, fr) ** 2).mean(1)
    quiet, loud = ed < ed.max() * 1e-5, ed > ed.max() * 1e-2
    return float(10 * np.log10(e[quiet].mean() / e[loud].mean()))


class DereverbTest(unittest.TestCase):
    def test_reverb_in_the_pauses_is_reduced(self) -> None:
        dry = speech_at(10)
        wet = fftconvolve(dry, room(0.5, 2))[: len(dry)]
        out = dereverb.dereverb(wet, RATE, 2)
        self.assertEqual(len(out), len(wet))
        before, after = pause_level(wet, dry), pause_level(out, dry)
        self.assertLess(after, before - 6, f"{before:.1f} -> {after:.1f} dB")

    def test_stronger_removes_more(self) -> None:
        dry = speech_at(10)
        wet = fftconvolve(dry, room(0.7, 0))[: len(dry)]
        levels = [pause_level(dereverb.dereverb(wet, RATE, s), dry) for s in (1, 2, 3)]
        self.assertTrue(levels[0] > levels[1] > levels[2], levels)

    def test_a_dry_voice_is_barely_changed_and_stays_in_time(self) -> None:
        dry = speech_at(8)
        out = dereverb.dereverb(dry, RATE, 1)
        g = float(np.dot(out, dry) / np.dot(out, out))
        sdr = 10 * np.log10(np.sum(dry**2) / np.sum((g * out - dry) ** 2))
        self.assertGreater(sdr, 15)
        a, b = out[RATE : 3 * RATE], dry[RATE : 3 * RATE]
        self.assertEqual(max(range(-48, 49), key=lambda k: float(np.dot(a, np.roll(b, k)))), 0)


class EngineTest(unittest.TestCase):
    def test_echo_copy_is_aligned_and_reports_progress(self) -> None:
        dry = speech_at(6)
        wet = fftconvolve(dry, room(0.5, 2))[: len(dry)]
        with tempfile.TemporaryDirectory() as d:
            src, out, plain = os.path.join(d, "in.wav"), os.path.join(d, "out.m4a"), os.path.join(d, "plain.m4a")
            write_wav(src, wet * 0.8)
            seen: list[tuple[str, float]] = []
            asyncio.run(audio_clean.clean_audio(src, out, 0, 6, 0.0, False, echo=2, report=lambda s, v: seen.append((s, v))))
            asyncio.run(audio_clean.clean_audio(src, plain, 0, 6, 0.0, False))
            y, p = audio_of(out).astype(np.float64), audio_of(plain).astype(np.float64)
            self.assertAlmostEqual(len(y) / RATE, 6.0, delta=0.025)
            a, b = y[RATE : 3 * RATE], p[RATE : 3 * RATE]
            self.assertEqual(max(range(-48, 49), key=lambda k: float(np.dot(a, np.roll(b, k)))), 0)
            self.assertEqual(seen[-1], ("echo", 1.0))
            self.assertLess(pause_level(y, dry), pause_level(p, dry) - 5)

    def test_options_limits_and_cancel(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "in.wav")
            write_wav(src, speech_at(3))
            client = TestClient(main.app)
            with mock.patch.object(main, "LOCAL_MODE", True):
                bad = client.post("/api/audio/clean", data={"path": src, "end": "3", "echo": "4"})
                self.assertEqual(bad.status_code, 422)
                with mock.patch.object(audio_clean, "MAX_HEAVY_SECONDS", 1):
                    long = client.post("/api/audio/clean", data={"path": src, "end": "3", "echo": "2"})
                self.assertEqual(long.status_code, 400)
                self.assertIn("minutes", long.json()["detail"])

                def cancelled(*a, **k):
                    raise main.progress.Cancelled()

                with mock.patch.object(audio_clean, "clean_audio", cancelled):
                    res = client.post("/api/audio/clean", data={"path": src, "end": "3", "echo": "2", "job_id": "j1"})
                self.assertEqual(res.status_code, 409)
                models = client.get("/api/audio/models").json()
                self.assertEqual(models["separator"]["sizeMb"], dub.SEPARATOR.size_mb)


@unittest.skipUnless(speech.is_ready(dub.SEPARATOR), "the voice separation model isn't downloaded")
class BackgroundTest(unittest.TestCase):
    def test_music_behind_the_voice_is_removed(self) -> None:
        dry = speech_at(10)
        tt = np.arange(len(dry)) / RATE
        music = sum(0.05 * np.sin(2 * np.pi * f * tt) for f in (220, 277, 330)) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.25 * tt))
        with tempfile.TemporaryDirectory() as d:
            src, out, plain = os.path.join(d, "in.wav"), os.path.join(d, "out.m4a"), os.path.join(d, "plain.m4a")
            write_wav(src, dry + music)
            stages: set[str] = set()
            asyncio.run(audio_clean.clean_audio(src, out, 0, 10, 0.0, False, isolate=True, report=lambda s, v: stages.add(s)))
            asyncio.run(audio_clean.clean_audio(src, plain, 0, 10, 0.0, False))
            y, p = audio_of(out).astype(np.float64), audio_of(plain).astype(np.float64)
            self.assertIn("separate", stages)
            self.assertAlmostEqual(len(y) / RATE, 10.0, delta=0.025)
            self.assertLess(pause_level(y, dry), pause_level(p, dry) - 15, "the music in the pauses")
            a, b = y[RATE : 3 * RATE], p[RATE : 3 * RATE]
            self.assertEqual(max(range(-48, 49), key=lambda k: float(np.dot(a, np.roll(b, k)))), 0)


if __name__ == "__main__":
    unittest.main()
