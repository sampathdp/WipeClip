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

    def export(self, data: dict, files: list) -> object:
        proj = json.dumps(project(2))
        job = {"projectHash": hashlib.sha256(proj.encode()).hexdigest(), "resolution": "720p", "branding": False, "compact": False}
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

    def test_probe_by_path(self) -> None:
        res = self.client.post("/api/video/probe", data={"path": self.on_disk})
        self.assertEqual(res.status_code, 200, res.text[:300])
        self.assertEqual(res.headers["X-Video-Width"], "320")


if __name__ == "__main__":
    unittest.main()
