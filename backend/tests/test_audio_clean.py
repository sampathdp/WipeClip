"""Clean up audio (app/pipeline/audio_clean.py, /api/audio/clean) on a real
signal: steady noise under a speech-like tone, with a noise-only stretch.

Run from the backend folder:  python -m unittest tests.test_audio_clean
"""

from __future__ import annotations

import os
import re
import subprocess
import tempfile
import traceback
import unittest
from unittest import mock

import numpy as np
from fastapi.testclient import TestClient

from app import main
from app.pipeline import audio_clean
from app.pipeline.video import get_ffmpeg_path

FF = get_ffmpeg_path()


def make_noisy(path: str) -> None:
    # 1 s of noise alone, then 4 s of a 220 Hz tone (syllable-like 4 Hz
    # envelope) over the same noise; a 2 s black video track on top so it's
    # a "video" like the editor's sources.
    subprocess.run(
        [FF, "-y", "-loglevel", "error",
         "-f", "lavfi", "-i", "color=black:s=160x90:r=30:d=5",
         "-f", "lavfi", "-i", "aevalsrc='0.25*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*4*t))*gte(t\\,1)':s=48000:d=5",
         "-f", "lavfi", "-i", "anoisesrc=color=white:amplitude=0.05:s=48000:d=5",
         "-filter_complex", "[1:a][2:a]amix=inputs=2:normalize=0[a]",
         "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", path],
        check=True,
    )


def samples(path: str, start: float, dur: float) -> np.ndarray:
    raw = subprocess.run(
        [FF, "-loglevel", "error", "-ss", str(start), "-t", str(dur), "-i", path, "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, np.float32)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2)))


def integrated_lufs(path: str) -> float:
    err = subprocess.run([FF, "-hide_banner", "-i", path, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1])


class AudioCleanTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = tempfile.TemporaryDirectory()
        cls.src = os.path.join(cls.dir.name, "noisy clip.mp4")
        make_noisy(cls.src)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.dir.cleanup()

    def clean(self, **data) -> bytes:
        with mock.patch.object(main, "LOCAL_MODE", True):
            res = TestClient(main.app).post("/api/audio/clean", data={"path": self.src, "start": "0", "end": "5", **data})
        self.assertEqual(res.status_code, 200, res.text[:300])
        self.assertEqual(res.headers["content-type"], "audio/mp4")
        return res.content

    def test_reduces_noise_and_levels_loudness(self) -> None:
        out = os.path.join(self.dir.name, "clean.m4a")
        with open(out, "wb") as f:
            f.write(self.clean(denoise="1", level="true"))
        def snr(p: str) -> float:
            return rms(samples(p, 2.0, 2.0)) / rms(samples(p, 0.3, 0.6))

        # Measured: 4.3 -> 25 (about +15 dB); the loudness lands on target.
        self.assertGreater(snr(out), snr(self.src) * 3, f"SNR {snr(self.src):.1f} -> {snr(out):.1f}")
        self.assertAlmostEqual(integrated_lufs(out), -16, delta=1)
        self.assertAlmostEqual(len(samples(out, 0, 10)) / 48000, 5, delta=0.15)

    def test_loudness_reads_files_with_any_name(self) -> None:
        # ffmpeg prints the path in UTF-8; read with Windows' code page, a
        # name with "”" (byte 0x9d) used to lose the whole output.
        named = os.path.join(self.dir.name, "My “demo” clip ÝÍ.mp4")
        with open(self.src, "rb") as a, open(named, "wb") as b:
            b.write(a.read())
        self.assertIsNotNone(audio_clean._loudness(named, "anull"))

    def test_range_and_no_denoise(self) -> None:
        out = os.path.join(self.dir.name, "range.m4a")
        with mock.patch.object(main, "LOCAL_MODE", True):
            res = TestClient(main.app).post("/api/audio/clean", data={"path": self.src, "start": "1", "end": "3", "denoise": "0", "level": "false"})
        self.assertEqual(res.status_code, 200)
        with open(out, "wb") as f:
            f.write(res.content)
        self.assertAlmostEqual(len(samples(out, 0, 10)) / 48000, 2, delta=0.15)

    def test_only_on_the_desktop_engine(self) -> None:
        with mock.patch.object(main, "LOCAL_MODE", False):
            res = TestClient(main.app).post("/api/audio/clean", data={"start": "0", "end": "1"})
        self.assertEqual(res.status_code, 404)

    def test_bad_range(self) -> None:
        with mock.patch.object(main, "LOCAL_MODE", True):
            res = TestClient(main.app).post("/api/audio/clean", data={"path": self.src, "start": "3", "end": "2"})
        self.assertEqual(res.status_code, 400)

    def test_unreadable_file_is_a_message_without_its_path(self) -> None:
        broken = os.path.join(self.dir.name, "broken clip.mp4")
        with open(broken, "wb") as f:
            f.write(b"not a video")
        with mock.patch.object(main, "LOCAL_MODE", True), mock.patch("traceback.print_exc") as printed:
            res = TestClient(main.app).post("/api/audio/clean", data={"path": broken, "start": "0", "end": "1"})
        self.assertEqual(res.status_code, 400, res.text[:300])
        self.assertIn("couldn't be cleaned up", res.json()["detail"])
        # What gets logged is the error kind, never the file's name.
        self.assertTrue(printed.called)
        with self.assertRaises(RuntimeError) as caught:
            audio_clean._decode(broken, 0, 1)
        self.assertNotIn("broken clip", "".join(traceback.format_exception(caught.exception)))


if __name__ == "__main__":
    unittest.main()
