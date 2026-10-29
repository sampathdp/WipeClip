"""Export encoder choice, the libx264 fallback, output checks and disk space
(app/pipeline/encoders.py, editor.render_export), with real ffmpeg renders.
The hardware test runs only where that encoder works (it's skipped
elsewhere, e.g. on CI).

Run from the backend folder:  python -m unittest tests.test_encoders
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import os
import shutil
import subprocess
import tempfile
import threading
import unittest
from collections import namedtuple
from unittest import mock

from app import progress
from app.pipeline import editor, encoders
from app.pipeline.video import get_ffmpeg_path

W, H, FPS = 640, 360, 30


def make_clip(path: str, seconds: float = 3, audio: bool = True) -> None:
    args = [get_ffmpeg_path(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc2=s={W}x{H}:r={FPS}:d={seconds}"]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=f=440:d={seconds}", "-c:a", "aac"]
    subprocess.run([*args, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest", path], check=True)


def plan_for(src: str, seconds: float = 3, audio: bool = True) -> editor.ExportPlan:
    clip = editor.PlanClip(source_path=src, source_has_audio=audio, source_width=W, source_height=H, start=0.0, duration=seconds)
    return editor.ExportPlan(width=W, height=H, fps=FPS, with_audio=audio, clips=[clip])


def render(plan: editor.ExportPlan, out: str, job=None) -> str:
    """Runs render_export, returns what it logged."""
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        asyncio.run(editor.render_export(plan, out, job))
    return err.getvalue()


class EncoderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = tempfile.mkdtemp(prefix="enc-test-")
        cls.src = os.path.join(cls.dir, "src.mp4")
        make_clip(cls.src)

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.dir, ignore_errors=True)

    def out(self, name: str) -> str:
        return os.path.join(self.dir, name)

    def test_args_per_encoder(self) -> None:
        self.assertEqual(encoders.encoder_args("libx264", 20)[:6], ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"])
        nv = encoders.encoder_args("h264_nvenc", 20)
        self.assertIn("h264_nvenc", nv)
        self.assertEqual(nv[nv.index("-cq") + 1], str(20 + encoders.NVENC_CQ_OFFSET))
        qsv = encoders.encoder_args("h264_qsv", 20)
        self.assertEqual(qsv[qsv.index("-global_quality") + 1], str(20 + encoders.QSV_QUALITY_OFFSET))

    def test_choice(self) -> None:
        with mock.patch.dict(os.environ, {"WIPECLIP_ENCODER": "auto"}), mock.patch.object(encoders, "LOCAL_MODE", False):
            self.assertEqual(encoders.pick_encoder(), "libx264", "the cloud has no GPU")
        with mock.patch.dict(os.environ, {"WIPECLIP_ENCODER": "auto"}), mock.patch.object(encoders, "LOCAL_MODE", True), mock.patch.object(encoders, "_chosen", None):
            with mock.patch.object(encoders, "HARDWARE", ("h264_nvenc", "h264_qsv")), mock.patch.object(encoders, "_works", side_effect=lambda e: e == "h264_qsv"), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(encoders.pick_encoder(), "h264_qsv", "the first one that works")
            with mock.patch.object(encoders, "_works", side_effect=AssertionError("probed twice")):
                self.assertEqual(encoders.pick_encoder(), "h264_qsv", "kept for the session")
            encoders.give_up_hardware()
            self.assertEqual(encoders.pick_encoder(), "libx264")
        with mock.patch.dict(os.environ, {"WIPECLIP_ENCODER": "h264_nvenc"}):
            self.assertEqual(encoders.pick_encoder(), "h264_nvenc")

    def test_a_failing_encoder_falls_back_to_libx264(self) -> None:
        out = self.out("fallback.mp4")
        with mock.patch.dict(os.environ, {"WIPECLIP_ENCODER": "h264_doesnotexist"}):
            log = render(plan_for(self.src), out)
        self.assertIn("h264_doesnotexist failed", log)
        self.assertIn("encoder libx264", log)
        self.assertNotIn(self.dir, log, "no file paths in the log")
        info = encoders.probe_output(out)
        self.assertEqual(info["video"], ("h264", W, H))
        self.assertEqual(info["audio"], "aac")

    def test_output_checks(self) -> None:
        out = self.out("ok.mp4")
        render(plan_for(self.src), out)
        ok = dict(duration=3.0, width=W, height=H, video=True, audio=True, fps=FPS)
        encoders.validate_output(out, **ok)
        with self.assertRaises(encoders.OutputInvalid):
            encoders.validate_output(out, **{**ok, "duration": 5.0})
        with self.assertRaises(encoders.OutputInvalid):
            encoders.validate_output(out, **{**ok, "width": 1280, "height": 720})
        silent = self.out("silent.mp4")
        render(plan_for(self.src, audio=False), silent)
        with self.assertRaises(encoders.OutputInvalid):
            encoders.validate_output(silent, **ok)
        # A file cut off mid-write (crash, full disk): unreadable or its end doesn't decode.
        cut = self.out("cut.mp4")
        with open(out, "rb") as f, open(cut, "wb") as g:
            g.write(f.read()[: os.path.getsize(out) // 2])
        with self.assertRaises(encoders.OutputInvalid):
            encoders.validate_output(cut, **ok)
        with self.assertRaises(encoders.OutputInvalid):
            encoders.validate_output(self.out("missing.mp4"), **ok)

    def test_not_enough_space_is_refused_before_rendering(self) -> None:
        Usage = namedtuple("Usage", "total used free")
        out = self.out("nospace.mp4")
        with mock.patch.object(encoders.shutil, "disk_usage", return_value=Usage(10**9, 10**9 - 10**6, 10**6)):
            with self.assertRaises(encoders.DiskFull) as e:
                render(plan_for(self.src), out)
        self.assertGreater(e.exception.needed, e.exception.free)
        self.assertFalse(os.path.exists(out), "nothing rendered")

    def test_disk_full_during_the_render(self) -> None:
        self.assertTrue(encoders.is_disk_full("Error writing trailer: No space left on device"))
        self.assertTrue(encoders.is_disk_full("There is not enough space on the disk."))
        self.assertFalse(encoders.is_disk_full("Invalid argument"))
        with mock.patch.object(editor, "_run_ffmpeg", mock.AsyncMock(side_effect=RuntimeError("ffmpeg failed (exit -28): No space left on device"))):
            with self.assertRaises(encoders.DiskFull):
                render(plan_for(self.src), self.out("full.mp4"))

    def test_cancel_removes_the_temporary_folder(self) -> None:
        long_src = self.out("long.mp4")
        make_clip(long_src, seconds=20)
        before = set(os.listdir(tempfile.gettempdir()))
        job = progress.JobProgress()
        timer = threading.Timer(0.8, job.cancel.set)
        timer.start()
        with self.assertRaises(progress.Cancelled):
            render(plan_for(long_src, seconds=20), self.out("cancelled.mp4"), job)
        timer.cancel()
        left = [n for n in set(os.listdir(tempfile.gettempdir())) - before if n.startswith("wipeclip-export-")]
        self.assertEqual(left, [])

    def test_hardware_encoders_that_work_here(self) -> None:
        tried = 0
        for enc in encoders.SUPPORTED:
            if not encoders._works(enc):
                continue
            tried += 1
            out = self.out(f"{enc}.mp4")
            with mock.patch.dict(os.environ, {"WIPECLIP_ENCODER": enc}):
                log = render(plan_for(self.src), out)
            self.assertIn(f"encoder {enc}", log, log)
            self.assertNotIn("failed", log)
            self.assertEqual(encoders.probe_output(out)["video"], ("h264", W, H))
        if not tried:
            self.skipTest("no working hardware encoder on this machine")


if __name__ == "__main__":
    unittest.main()
