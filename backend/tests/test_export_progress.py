"""Export progress and cancel (app/progress.py) through the HTTP endpoints,
with a real ffmpeg render. Tickets are mocked.

Run from the backend folder:  python -m unittest tests.test_export_progress
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
import time
import unittest
import uuid
from unittest import mock

from fastapi.testclient import TestClient

from app import main, progress
from tests.test_local_path_export import make_video, project


class ExportProgressTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = tempfile.TemporaryDirectory()
        cls.video = os.path.join(cls.dir.name, "long.mp4")
        make_video(cls.video, "green", seconds=12)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.dir.cleanup()

    def setUp(self) -> None:
        proj = project(2)
        for c in proj["clips"]:
            c["end"] = 12
        self.proj = json.dumps(proj)
        job = {"projectHash": hashlib.sha256(self.proj.encode()).hexdigest(), "resolution": "1080p", "branding": False, "compact": False}
        self.patches = [
            mock.patch.object(main, "LOCAL_MODE", True),
            mock.patch.object(main.tickets, "claim", mock.AsyncMock()),
            mock.patch.object(main.tickets, "verify", return_value=job),
        ]
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        for p in reversed(self.patches):
            p.stop()

    def start_export(self, job_id: str) -> tuple[threading.Thread, dict]:
        out: dict = {}

        def run() -> None:
            out["res"] = TestClient(main.app).post(
                "/api/video/export",
                data={"ticket": "t", "project": self.proj, "source_paths": json.dumps([self.video, self.video]), "job_id": job_id},
            )

        t = threading.Thread(target=run)
        t.start()
        return t, out

    def poll(self, job_id: str, until, timeout: float = 60) -> list:
        seen = []
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            r = self.client.get(f"/api/jobs/{job_id}")
            if r.status_code == 200:
                seen.append(r.json())
                if until(r.json()):
                    break
            time.sleep(0.1)
        return seen

    def test_progress_rises_to_done_and_job_is_cleared(self) -> None:
        job_id = str(uuid.uuid4())
        t, out = self.start_export(job_id)
        seen = self.poll(job_id, lambda s: (s["progress"] or 0) > 0.5)
        t.join(120)
        self.assertEqual(out["res"].status_code, 200, out["res"].text[:300])
        fractions = [s["progress"] for s in seen if s["progress"] is not None]
        self.assertTrue(fractions, f"no rendering progress seen: {seen}")
        self.assertEqual(fractions, sorted(fractions), "progress only goes up")
        self.assertTrue(all(0 <= f <= 1 for f in fractions))
        self.assertEqual(self.client.get(f"/api/jobs/{job_id}").status_code, 404)

    def test_cancel_stops_the_render(self) -> None:
        job_id = str(uuid.uuid4())
        t, out = self.start_export(job_id)
        self.poll(job_id, lambda s: s["phase"] == "rendering")
        started = time.monotonic()
        self.assertEqual(self.client.post(f"/api/jobs/{job_id}/cancel").status_code, 200)
        t.join(60)
        self.assertLess(time.monotonic() - started, 10, "cancel stops ffmpeg promptly")
        self.assertEqual(out["res"].status_code, 409)
        self.assertEqual(out["res"].json()["detail"]["code"], "cancelled")
        self.assertIsNone(progress.get(job_id))

    def test_unknown_or_bad_ids(self) -> None:
        self.assertEqual(self.client.get("/api/jobs/nope").status_code, 404)
        self.assertEqual(self.client.post("/api/jobs/nope/cancel").status_code, 404)
        self.assertIsNone(progress.start("short"))
        self.assertIsNone(progress.start("../../etc/passwd-0123456789"))


if __name__ == "__main__":
    unittest.main()
