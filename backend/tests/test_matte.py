"""Webcam background removal (app/pipeline/matte.py and its export in
editor.py _matte_head), rendered with the real ffmpeg and checked pixel by
pixel. The export tests use a synthetic matted file (no model needed); the
engine test runs the real model when its files are available (bundled by
`python -m app.pipeline.matte`, or downloaded) and is skipped otherwise.

Run from the backend folder:  python -m unittest tests.test_matte
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import cv2
import numpy as np
from fastapi import HTTPException
from PIL import Image

from app.pipeline import editor, matte
from app.pipeline.video import get_ffmpeg_path
from tests.test_focus_export import FPS, H, W, base_plan, frame_at, make_quadrants, render

MAGENTA = (255, 0, 255)


def _ffmpeg(*args: str) -> None:
    subprocess.run([get_ffmpeg_path(), "-y", "-hide_banner", "-loglevel", "error", *args], check=True)


def make_matted(path: str, split: int = W // 2, seconds: float = 3.0) -> None:
    """A matted file as matte.py writes one (yuv420p, limited range): a
    magenta picture on top; below, its mask - the person (white) left of
    `split`, background (black) to the right."""
    graph = (
        f"color=magenta:s={W}x{H}:r={FPS}:d={seconds}[p];"
        f"color=white:s={split}x{H}:r={FPS}:d={seconds}[a];color=black:s={W - split}x{H}:r={FPS}:d={seconds}[b];"
        "[a][b]hstack[m];[p][m]vstack,format=yuv420p[v]"
    )
    _ffmpeg("-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-crf", "1", "-color_range", "tv", path)


def rgb(f: np.ndarray, x: int, y: int) -> tuple[int, int, int]:
    b, g, r = (int(v) for v in f[y, x])
    return r, g, b


def near(c: tuple[int, int, int], want: tuple[int, int, int], tol: int = 40) -> bool:
    return all(abs(a - b) <= tol for a, b in zip(c, want))


class MatteExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.mkdtemp(prefix="matte-test-")
        cls.base = os.path.join(cls.tmp, "quad.mp4")
        make_quadrants(cls.base)
        cls.matted = os.path.join(cls.tmp, "matted.mp4")
        make_matted(cls.matted)
        cls.yellow = os.path.join(cls.tmp, "yellow.png")
        Image.new("RGB", (64, 36), (255, 255, 0)).save(cls.yellow)
        cls.cyan = os.path.join(cls.tmp, "cyan.mp4")
        _ffmpeg("-f", "lavfi", "-i", f"color=cyan:s=64x36:r={FPS}:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", cls.cyan)

    def layer(self, m: editor.PlanMatte, end: float = 3.0) -> editor.ExportPlan:
        plan = base_plan(self.base)
        # A full-canvas webcam layer; its own (unused) video is the base.
        plan.overlays.append(
            editor.PlanOverlay(
                image_path=self.base, image_width=W, image_height=H, start=0.0, end=end,
                x=0.5, y=0.5, width=1.0, rotation=0.0, video=True, matte=m,
            )
        )  # fmt: skip
        return plan

    def frame(self, m: editor.PlanMatte, name: str, t: float = 1.0) -> np.ndarray:
        out = os.path.join(self.tmp, name)
        render(self.layer(m), out)
        return frame_at(out, t)

    def test_remove_shows_the_canvas_behind(self) -> None:
        f = self.frame(editor.PlanMatte(path=self.matted, mode="remove"), "remove.mp4")
        self.assertTrue(near(rgb(f, 20, 20), MAGENTA), f"person side should be the picture, got {rgb(f, 20, 20)}")
        # Right of the outline the base shows through: lime top right, white bottom right.
        self.assertTrue(near(rgb(f, W - 20, 20), (0, 255, 0)), f"background should be clear, got {rgb(f, W - 20, 20)}")
        self.assertTrue(near(rgb(f, W - 20, H - 20), (255, 255, 255)), f"background should be clear, got {rgb(f, W - 20, H - 20)}")

    def test_blur_keeps_the_layer_opaque(self) -> None:
        f = self.frame(editor.PlanMatte(path=self.matted, mode="blur", blur=60), "blur.mp4")
        # The blurred picture (uniform magenta) fills the background.
        self.assertTrue(near(rgb(f, W - 20, 20), MAGENTA), f"background should be the blurred picture, got {rgb(f, W - 20, 20)}")
        self.assertTrue(near(rgb(f, 20, 20), MAGENTA))

    def test_image_background(self) -> None:
        m = editor.PlanMatte(path=self.matted, mode="image", bg_path=self.yellow, bg_width=64, bg_height=36)
        f = self.frame(m, "image.mp4")
        self.assertTrue(near(rgb(f, W - 20, 20), (255, 255, 0)), f"background should be the image, got {rgb(f, W - 20, 20)}")
        self.assertTrue(near(rgb(f, 20, 20), MAGENTA))

    def test_image_background_fit_leaves_the_rest_clear(self) -> None:
        # A square image fitted into a 16:9 box: bars at the sides stay clear.
        square = os.path.join(self.tmp, "square.png")
        Image.new("RGB", (40, 40), (255, 255, 0)).save(square)
        m = editor.PlanMatte(path=self.matted, mode="image", bg_path=square, bg_width=40, bg_height=40, fit="fit")
        f = self.frame(m, "fit.mp4")
        self.assertTrue(near(rgb(f, W - 10, 20), (0, 255, 0)), f"outside the fitted image should be clear, got {rgb(f, W - 10, 20)}")
        self.assertTrue(near(rgb(f, W // 2 + 60, 20), (255, 255, 0)), f"inside the fitted image, got {rgb(f, W // 2 + 60, 20)}")

    def test_video_background_holds_its_last_frame(self) -> None:
        # The 1 s background, not looped, is held past its end.
        m = editor.PlanMatte(path=self.matted, mode="video", bg_path=self.cyan, bg_width=64, bg_height=36, loop=False)
        f = self.frame(m, "video.mp4", t=2.0)
        self.assertTrue(near(rgb(f, W - 20, 20), (0, 255, 255)), f"background should be the video, got {rgb(f, W - 20, 20)}")

    def test_video_background_loops(self) -> None:
        m = editor.PlanMatte(path=self.matted, mode="video", bg_path=self.cyan, bg_width=64, bg_height=36, loop=True)
        f = self.frame(m, "loop.mp4", t=2.5)
        self.assertTrue(near(rgb(f, W - 20, 20), (0, 255, 255)), f"background should be the video, got {rgb(f, W - 20, 20)}")

    def test_edge_grows_and_shrinks_the_outline(self) -> None:
        # Softness 100 blurs the outline by sigma 4 px here; the extreme edge
        # settings then move it about that far (alpha ~0.9 vs ~0.1 two
        # pixels either side - see matte_curve). Top row: base is red left
        # of the middle, lime right of it.
        x_out, x_in = W // 2 + 2, W // 2 - 3
        normal = self.frame(editor.PlanMatte(path=self.matted, mode="remove", soft=100), "edge0.mp4")
        grown = self.frame(editor.PlanMatte(path=self.matted, mode="remove", soft=100, edge=100), "grow.mp4")
        shrunk = self.frame(editor.PlanMatte(path=self.matted, mode="remove", soft=100, edge=-100), "shrink.mp4")
        self.assertTrue(near(rgb(normal, x_out, 20), (0, 255, 0), 70), f"x={x_out} starts as background, got {rgb(normal, x_out, 20)}")
        self.assertTrue(near(rgb(grown, x_out, 20), MAGENTA, 90), f"grown outline should cover x={x_out}, got {rgb(grown, x_out, 20)}")
        self.assertTrue(near(rgb(normal, x_in, 20), MAGENTA, 70), f"x={x_in} starts as the person, got {rgb(normal, x_in, 20)}")
        self.assertTrue(near(rgb(shrunk, x_in, 20), (255, 0, 0), 90), f"shrunk outline should clear x={x_in}, got {rgb(shrunk, x_in, 20)}")

    def test_plan_round_trips_through_json(self) -> None:
        plan = self.layer(editor.PlanMatte(path=self.matted, mode="image", bg_path=self.yellow, bg_width=64, bg_height=36, x=0.2))
        again = editor.plan_from_json(editor.plan_to_json(plan))
        self.assertEqual(again.overlays[0].matte, plan.overlays[0].matte)


class MatteMathTest(unittest.TestCase):
    """The numbers src/lib/editor/matte.ts must agree with (tests/desktop/matte.test.ts)."""

    def test_curve(self) -> None:
        self.assertEqual(editor.matte_curve(0.5, 0), 0.5)
        self.assertEqual(editor.matte_curve(0.2, 0), 0.0)  # faint halo dropped
        self.assertEqual(editor.matte_curve(0.8, 0), 1.0)
        self.assertGreater(editor.matte_curve(0.3, 100), 0.5)  # grown
        self.assertLess(editor.matte_curve(0.7, -100), 0.5)  # shrunk

    def test_bg_rect(self) -> None:
        m = editor.PlanMatte(path="", mode="image", bg_width=100, bg_height=100)
        self.assertEqual(editor.matte_bg_rect(160, 90, m), (0.0, -35.0, 160.0, 160.0))
        m.fit = "fit"
        self.assertEqual(editor.matte_bg_rect(160, 90, m), (35.0, 0.0, 90.0, 90.0))

    def test_sizes(self) -> None:
        self.assertEqual(matte.matte_size(1280, 720), (1280, 720))
        self.assertEqual(matte.matte_size(1920, 1080), (1280, 720))
        self.assertEqual(matte.matte_size(640, 480), (640, 480))
        w, h = matte.matte_size(1080, 1920)
        self.assertEqual((w % 16, h % 16), (0, 0))


@unittest.skipUnless(os.environ.get("MATTE_MODEL_TESTS") or matte.models_ready(), "segmentation model not available")
class MatteEngineTest(unittest.TestCase):
    def test_render_makes_a_cached_matted_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"WIPECLIP_MATTE_DIR": os.path.join(tmp, "cache")}):
            src = os.path.join(tmp, "cam.mp4")
            # A plain, person-free 1 s clip: the mask comes out (nearly) empty.
            _ffmpeg("-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", src)
            stages = []
            out = matte.render(src, 640, 360, 30.0, 1.0, lambda s, v: stages.append((s, v)))
            self.assertTrue(out.is_file())
            self.assertEqual(stages[-1], ("matte", 1.0))
            cap = cv2.VideoCapture(str(out))
            frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            ok, f = cap.read()
            cap.release()
            self.assertTrue(ok)
            self.assertEqual(f.shape[:2], (704, 640))  # picture over mask, 360 rounded to 352
            self.assertEqual(frames, 30)
            # Made once: a second call returns the cached file without work.
            again = []
            self.assertEqual(matte.render(src, 640, 360, 30.0, 1.0, lambda s, v: again.append(s)), out)
            self.assertEqual(again, [])

    def test_cancel_removes_the_partial_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"WIPECLIP_MATTE_DIR": os.path.join(tmp, "cache")}):
            src = os.path.join(tmp, "cam.mp4")
            _ffmpeg("-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", src)

            class Stop(Exception):
                pass

            def cancel(stage: str, value: float) -> None:
                if stage == "matte":
                    raise Stop

            with self.assertRaises(Stop):
                matte.render(src, 640, 360, 30.0, 3.0, cancel)
            self.assertEqual(list((matte.cache_dir()).glob("*")), [])

    def test_fine_and_fast_detail_are_cached_apart(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"WIPECLIP_MATTE_DIR": os.path.join(tmp, "cache")}):
            src = os.path.join(tmp, "cam.mp4")
            _ffmpeg("-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", src)
            fine = matte.render(src, 320, 180, 30.0, 0.5, lambda s, v: None, True)
            fast = matte.render(src, 320, 180, 30.0, 0.5, lambda s, v: None, False)
            self.assertNotEqual(fine, fast)
            self.assertTrue(fine.is_file() and fast.is_file())

    def test_api_in_memory_video_is_handed_over_once(self) -> None:
        from fastapi.testclient import TestClient

        from app import main

        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"WIPECLIP_MATTE_DIR": os.path.join(tmp, "cache")}), mock.patch.object(main, "LOCAL_MODE", True):
            src = os.path.join(tmp, "cam.mp4")
            _ffmpeg("-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", src)
            client = TestClient(main.app)
            key = "0123456789abcdef0123456789abcdef"
            # Asked by key first: the engine doesn't have it yet.
            res = client.post("/api/matte/render", data={"key": key, "detail": "fast"})
            self.assertEqual(res.status_code, 409)
            self.assertEqual(res.json()["detail"]["code"], "need_file")
            with open(src, "rb") as f:
                res = client.post("/api/matte/render", data={"key": key, "detail": "fast"}, files={"file": ("webcam.mp4", f, "video/mp4")})
            self.assertEqual(res.status_code, 200, res.text[:300])
            made = res.json()
            self.assertTrue(os.path.isfile(made["path"]))
            self.assertEqual((made["width"], made["height"]), (320, 176))
            # Kept: the next ask by key needs no file.
            res = client.post("/api/matte/render", data={"key": key, "detail": "fast"})
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["path"], made["path"])
            # Bad keys and non-videos are refused.
            self.assertEqual(client.post("/api/matte/render", data={"key": "../../x"}).status_code, 422)
            with open(src, "rb") as f:
                res = client.post("/api/matte/render", data={"key": "f" * 32}, files={"file": ("a.exe", f, "application/octet-stream")})
            self.assertEqual(res.status_code, 400)
            # The matted file is accepted by the export; the stored source isn't.
            self.assertEqual(main._matte_file(made["path"]), str(Path(made["path"]).resolve()))
            stored = matte.stored_source(key)
            with self.assertRaises(HTTPException):
                main._matte_file(str(stored))

    def test_api_live_frame(self) -> None:
        from fastapi.testclient import TestClient

        from app import main

        with mock.patch.object(main, "LOCAL_MODE", True):
            client = TestClient(main.app)
            w, h = 256, 144
            res = client.post(f"/api/matte/frame?w={w}&h={h}", content=bytes(w * h * 4))
            self.assertEqual(res.status_code, 200)
            self.assertEqual(len(res.content), w * h)
            self.assertEqual(client.post(f"/api/matte/frame?w={w}&h={h}", content=b"123").status_code, 400)
            self.assertEqual(client.post("/api/matte/frame?w=600&h=600", content=bytes(600 * 600 * 4)).status_code, 422)

    def test_empty_frame(self) -> None:
        seg = matte.Segmenter(256, 144)
        m = seg.mask(np.zeros((144, 256, 3), np.uint8))
        self.assertEqual(m.shape, (144, 256))
        self.assertEqual(m.dtype, np.uint8)


if __name__ == "__main__":
    unittest.main()
