"""End to end through the HTTP endpoints, as the desktop app calls its
engine: one video named by path (it stays on disk), one uploaded, then a
real export render and a probe by path. Tickets are mocked; everything
else (probing, screening, rendering) runs for real.

Run from the backend folder:  python -m unittest tests.test_local_path_export
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from unittest import mock

import numpy as np

from fastapi.testclient import TestClient

from app import main
from app.pipeline.video import get_ffmpeg_path


def make_video(path: str, color: str, seconds: float = 2.0) -> None:
    subprocess.run(
        [get_ffmpeg_path(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color={color}:s=320x180:r=30:d={seconds}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", path],
        check=True,
    )


def project(sources: int) -> dict:
    look = {"filter": "original", "intensity": 100, "adjust": {k: 0 for k in (
        "brightness", "contrast", "saturation", "exposure", "temperature", "tint", "highlights", "shadows", "sharpness", "blur")} | {"opacity": 100}}
    clip = {"start": 0, "end": 1, "freeze": None, "reverse": False, "crop": {"x": 0, "y": 0, "w": 1, "h": 1}, "transition": None,
            "speed": 1, "volume": 1, "transform": {"x": 0.5, "y": 0.5, "scale": 1, "rotation": 0}, "look": look}
    return {
        "canvas": {"aspect": "original", "fit": "fit", "background": {"type": "color", "color": "#000000", "color2": "#000000"}},
        "clips": [{**clip, "source": i} for i in range(sources)],
        "overlays": [], "audio": [], "effects": [],
    }


class LocalPathExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = tempfile.TemporaryDirectory()
        cls.on_disk = os.path.join(cls.dir.name, "on disk.mp4")
        cls.uploaded = os.path.join(cls.dir.name, "uploaded.mp4")
        make_video(cls.on_disk, "red")
        make_video(cls.uploaded, "blue")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.dir.cleanup()

    def setUp(self) -> None:
        self.patches = [
            mock.patch.object(main, "LOCAL_MODE", True),
            mock.patch.object(main.tickets, "claim", mock.AsyncMock()),
            mock.patch.object(main.tickets, "refund", mock.AsyncMock()),
        ]
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        for p in reversed(self.patches):
            p.stop()

    def export(self, data: dict, files: list, proj_data: dict | None = None, **ticket) -> object:
        proj = json.dumps(proj_data or project(2))
        job = {"projectHash": hashlib.sha256(proj.encode()).hexdigest(), "resolution": "720p", "branding": False, "compact": False, **ticket}
        with mock.patch.object(main.tickets, "verify", return_value=job):
            return self.client.post("/api/video/export", data={"ticket": "t", "project": proj, **data}, files=files)

    def test_export_mixes_paths_and_uploads_in_order(self) -> None:
        with open(self.uploaded, "rb") as up:
            res = self.export({"source_paths": json.dumps([self.on_disk, None])}, [("sources", ("uploaded.mp4", up, "video/mp4"))])
        self.assertEqual(res.status_code, 200, res.text[:300])
        out = os.path.join(self.dir.name, "out.mp4")
        with open(out, "wb") as f:
            f.write(res.content)
        # Two 1 s clips: about 2 s of video, first red (the path), then blue.
        frame = lambda t: subprocess.run(  # noqa: E731
            [get_ffmpeg_path(), "-loglevel", "error", "-ss", str(t), "-i", out, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            capture_output=True, check=True,
        ).stdout
        r, _, b = frame(0.5)
        self.assertGreater(r, 150)
        self.assertLess(b, 80)
        r, _, b = frame(1.5)
        self.assertLess(r, 80)
        self.assertGreater(b, 150)
        self.assertTrue(os.path.exists(self.on_disk), "the file on disk is left in place")

    def test_export_rejects_mismatched_lists(self) -> None:
        res = self.export({"source_paths": json.dumps([self.on_disk, None])}, [])
        self.assertEqual(res.status_code, 400)

    def test_export_rejects_missing_path(self) -> None:
        res = self.export({"source_paths": json.dumps([self.on_disk, os.path.join(self.dir.name, "gone.mp4")])}, [])
        self.assertEqual(res.status_code, 400)
        self.assertIn("moved or deleted", res.text)

    def test_export_takes_audio_over_the_cloud_cap(self) -> None:
        # Voice translation's WAVs run past the cloud's 50 MB per-audio cap
        # after five minutes; the engine has to take them (cap shrunk here so
        # the test file stays small).
        wav = os.path.join(self.dir.name, "English voice.wav")
        subprocess.run(
            [get_ffmpeg_path(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=2",
             "-ac", "2", wav],
            check=True,
        )
        proj = project(1) | {"audio": [{"audio": 0, "start": 0, "offset": 0, "duration": 1, "volume": 1, "fadeIn": 0, "fadeOut": 0}]}
        with mock.patch.object(main, "EDITOR_MAX_AUDIO_BYTES", 1024), open(wav, "rb") as f:
            res = self.export(
                {"source_paths": json.dumps([self.on_disk])}, [("audios", ("English voice.wav", f, "audio/wav"))], proj
            )
        self.assertEqual(res.status_code, 200, res.text[:300])

    def test_plan_length_from_the_ticket(self) -> None:
        paths = {"source_paths": json.dumps([self.on_disk, self.on_disk])}
        # Free plan: 1 s allowed, the 2 s edit is refused with an upgrade.
        res = self.export(paths, [], maxSeconds=1)
        self.assertEqual(res.status_code, 403, res.text[:300])
        self.assertEqual(res.json()["detail"]["code"], "plan_required")
        # Paid plan: no limit, past the old 10-minute cap.
        with mock.patch.object(main, "MAX_VIDEO_DURATION_SECONDS", 1.0):
            self.assertEqual(self.export(paths, [], maxSeconds=None).status_code, 200)
            # A ticket from before plans set a length keeps the old cap.
            self.assertEqual(self.export(paths, []).status_code, 403)

    def test_keep_output_leaves_the_file_on_disk(self) -> None:
        folder = os.path.join(self.dir.name, "exports")
        with mock.patch.dict(os.environ, {"WIPECLIP_EXPORTS_DIR": folder}):
            res = self.export({"source_paths": json.dumps([self.on_disk, self.on_disk]), "keep_output": "true"}, [])
        self.assertEqual(res.status_code, 200, res.text[:300])
        body = res.json()
        self.assertEqual(os.path.dirname(body["path"]), folder)
        self.assertEqual(os.path.getsize(body["path"]), body["size"])
        self.assertEqual(body["type"], "video/mp4")

    def test_unchanged_files_are_checked_once(self) -> None:
        main._local_checks.clear()
        paths = {"source_paths": json.dumps([self.on_disk, self.on_disk])}
        with mock.patch.object(main.moderation, "screen_video", wraps=main.moderation.screen_video) as screen:
            self.assertEqual(self.export(paths, []).status_code, 200)
            self.assertEqual(self.export(paths, []).status_code, 200)
        self.assertEqual(screen.call_count, 1)

    def test_sound_decoded_from_disk(self) -> None:
        wav = os.path.join(self.dir.name, "tone.wav")
        subprocess.run(
            [get_ffmpeg_path(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=2", "-ac", "2", wav],
            check=True,
        )
        res = self.client.post("/api/audio/decode", data={"path": wav, "rate": "16000", "channels": "2"})
        self.assertEqual(res.status_code, 200, res.text[:300])
        self.assertAlmostEqual(len(res.content) / 4 / 2 / 16000, 2.0, delta=0.05)
        res = self.client.post("/api/audio/peaks", data={"path": wav})
        self.assertEqual(res.status_code, 200, res.text[:300])
        peaks = np.frombuffer(res.content, np.float32)
        self.assertAlmostEqual(len(peaks), 100, delta=2)
        self.assertGreater(float(peaks.min()), 0.05)
        # A video without sound has nothing to decode.
        self.assertEqual(self.client.post("/api/audio/decode", data={"path": self.on_disk}).status_code, 400)
        self.assertEqual(self.client.post("/api/audio/decode", data={"path": wav, "rate": "12345"}).status_code, 400)

    def test_probe_by_path(self) -> None:
        res = self.client.post("/api/video/probe", data={"path": self.on_disk})
        self.assertEqual(res.status_code, 200, res.text[:300])
        self.assertEqual(res.headers["X-Video-Width"], "320")


if __name__ == "__main__":
    unittest.main()
