"""On-screen activity for the silence review (app/pipeline/activity.py),
with real ffmpeg renders: a still screen, moving content, and a still screen
with a blinking text cursor and a small moving pointer (must count as still).

Run from the backend folder:  python -m unittest tests.test_activity
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import tempfile
import time
import unittest
from unittest import mock

from fastapi import HTTPException

from app import main
from app.pipeline import activity
from app.pipeline.video import get_ffmpeg_path

SIZE = "1280x720"


def make_video(path: str) -> None:
    """0-3 s still gray, 3-6 s moving test pattern, 6-12 s gray with a
    blinking 3x24 px caret and a 12 px pointer gliding across."""
    q = f"s={SIZE}:r=30"
    graph = (
        f"color=0x808080:{q}:d=3[a];"
        f"testsrc2={q}:d=3[b];"
        f"color=0x808080:{q}:d=6,"
        "drawbox=x=400:y=300:w=3:h=24:color=black:t=fill:enable='lt(mod(t,1),0.5)',"
        "drawbox=x='100+t*60':y=500:w=12:h=12:color=white:t=fill[c];"
        "[a][b][c]concat=n=3:v=1,format=yuv420p[v]"
    )
    subprocess.run(
        [get_ffmpeg_path(), "-y", "-loglevel", "error", "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-g", "30", path],
        check=True,
    )


class ActivityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = tempfile.TemporaryDirectory()
        cls.video = os.path.join(cls.dir.name, "screen.mp4")
        make_video(cls.video)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.dir.cleanup()

    def measure(self, ranges):
        return asyncio.run(activity.measure_ranges(self.video, ranges))

    def test_still_moving_and_cursor_only(self) -> None:
        t = time.perf_counter()
        still, moving, caret = self.measure([(0.5, 2.8), (3.2, 5.8), (6.5, 11.5)])
        took = time.perf_counter() - t
        print(f"3 ranges, 7.4 s of 720p, measured in {took:.2f} s")
        self.assertLess(still["changing"], 0.1)
        self.assertGreater(moving["changing"], 0.9)
        self.assertLess(caret["changing"], 0.15, "a blinking caret and a small pointer aren't activity")

    def test_a_range_across_the_change_is_partly_moving(self) -> None:
        (r,) = self.measure([(1.5, 4.5)])
        # 1.5 s still, 1.5 s moving.
        self.assertGreater(r["changing"], 0.35)
        self.assertLess(r["changing"], 0.65)
        self.assertTrue(r["still"] and r["still"][0][0] >= 1.5 and r["still"][0][1] <= 3.2, r["still"])

    def test_log_parsing(self) -> None:
        log = "lavfi.freezedetect.freeze_start: 0\nfreeze_end: 2\nlavfi.freezedetect.freeze_start: 5\n"
        spans = activity.still_spans(log, 7)
        self.assertEqual(spans, [(0.0, 2.0), (5.0, 7.0)])
        self.assertAlmostEqual(activity.changing_fraction(spans, 7), 3 / 7)
        self.assertEqual(activity.changing_fraction([], 0), 0.0)

    def test_motion_profile(self) -> None:
        t = time.perf_counter()
        prof = asyncio.run(activity.motion_profile(self.video, 0, 12))
        print(f"motion profile of 12 s of 720p in {time.perf_counter() - t:.2f} s")
        times, motion, scene = prof["times"], prof["motion"], prof["scene"]
        self.assertEqual(len(times), len(motion))
        self.assertAlmostEqual(len(times), 12 * activity.PROFILE_FPS, delta=2)
        at = lambda a, b, xs: [x for tt, x in zip(times, xs) if a <= tt < b]  # noqa: E731
        self.assertLess(max(at(0.5, 2.8, motion)), 0.1, "still gray")
        self.assertGreater(min(at(3.3, 5.8, motion)), 0.5, "moving pattern")
        self.assertLess(max(at(6.5, 11.5, motion)), 0.1, "caret and pointer average away")
        # The two hard cuts (3 s and 6 s) score far above everything else.
        cuts = sorted(tt for tt, v in zip(times, scene) if v > 10)
        self.assertTrue(cuts and all(abs(c - 3) < 0.3 or abs(c - 6) < 0.3 for c in cuts), (cuts, scene))
        self.assertTrue(any(abs(c - 3) < 0.3 for c in cuts) and any(abs(c - 6) < 0.3 for c in cuts), cuts)
        # A later range is reported in source seconds.
        part = asyncio.run(activity.motion_profile(self.video, 4, 8))
        self.assertGreaterEqual(part["times"][0], 4)
        self.assertLess(part["times"][-1], 8.01)

    def test_motion_endpoint_validates_and_is_local_only(self) -> None:
        with mock.patch.object(main, "LOCAL_MODE", False), self.assertRaises(HTTPException) as e:
            asyncio.run(main.api_video_motion(path=self.video, start=0, end=2))
        self.assertEqual(e.exception.status_code, 404)
        with mock.patch.object(main, "LOCAL_MODE", True):
            self.assertTrue(asyncio.run(main.api_video_motion(path=self.video, start=0, end=2))["times"])
            for a, b in [(2, 1), (-1, 2), (0, activity.MAX_PROFILE_SECONDS + 1), (0, float("nan"))]:
                with self.assertRaises(HTTPException):
                    asyncio.run(main.api_video_motion(path=self.video, start=a, end=b))

    def test_endpoint_validates_and_is_local_only(self) -> None:
        ok = json.dumps([[0.5, 2.5]])
        with mock.patch.object(main, "LOCAL_MODE", False), self.assertRaises(HTTPException) as e:
            asyncio.run(main.api_video_activity(path=self.video, ranges=ok))
        self.assertEqual(e.exception.status_code, 404)
        with mock.patch.object(main, "LOCAL_MODE", True):
            res = asyncio.run(main.api_video_activity(path=self.video, ranges=ok))
            self.assertEqual(len(res["ranges"]), 1)
            for bad in ["[]", "x", json.dumps([[2, 1]]), json.dumps([[-1, 2]]), json.dumps([[0, 1]] * 51)]:
                with self.assertRaises(HTTPException):
                    asyncio.run(main.api_video_activity(path=self.video, ranges=bad))
            with self.assertRaises(HTTPException):
                asyncio.run(main.api_video_activity(path=os.path.join(self.dir.name, "missing.mp4"), ranges=ok))


if __name__ == "__main__":
    unittest.main()
