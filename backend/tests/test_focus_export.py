"""Focus zoom and pointer layers in the editor export, rendered with the
real ffmpeg on a synthetic video and checked pixel by pixel.

Run from the backend folder:  python -m unittest tests.test_focus_export
Also checks the fixtures in tests/fixtures, which the frontend's tests
(tests/desktop/focus.test.ts) verify against the preview's own code, so
both sides agree on zoom geometry and on where effects are drawn.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import unittest

import cv2
import numpy as np
from PIL import Image, ImageDraw

from app.pipeline import editor
from app.pipeline.video import get_ffmpeg_path

W, H, FPS = 320, 180, 30
VECTORS = os.path.join(os.path.dirname(__file__), "fixtures", "camera_vectors.json")
PAYLOAD = os.path.join(os.path.dirname(__file__), "fixtures", "focus_payload.json")


def make_quadrants(path: str, seconds: float = 3.0) -> None:
    """Red / green / blue / white quadrants."""
    q = f"s={W // 2}x{H // 2}:r={FPS}:d={seconds}"
    graph = (
        f"color=red:{q}[a];color=lime:{q}[b];color=blue:{q}[c];color=white:{q}[d];"
        "[a][b][c][d]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0,format=yuv420p[v]"
    )
    subprocess.run(
        [get_ffmpeg_path(), "-y", "-hide_banner", "-loglevel", "error", "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-crf", "10", path],
        check=True,
    )


def frame_at(path: str, t: float) -> np.ndarray:
    cap = cv2.VideoCapture(path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, round(t * FPS))
    ok, frame = cap.read()
    cap.release()
    assert ok, f"no frame at {t}"
    return frame  # BGR


def color(px: np.ndarray) -> str:
    b, g, r = (int(v) for v in px)
    if r > 200 and g > 200 and b > 200:
        return "white"
    if r > 180 and g < 80 and b < 80:
        return "red"
    if g > 180 and r < 80 and b < 80:
        return "green"
    if b > 180 and r < 80 and g < 80:
        return "blue"
    if r > 200 and g > 120 and b < 80:
        return "orange"
    return f"rgb({r},{g},{b})"


def render(plan: editor.ExportPlan, out: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        args = editor.build_export_args(plan, out, tmp)
        subprocess.run([get_ffmpeg_path(), "-loglevel", "error", *args], check=True)


def base_plan(src: str, **clip_kw) -> editor.ExportPlan:
    clip = editor.PlanClip(source_path=src, source_has_audio=False, source_width=W, source_height=H, start=0.0, duration=3.0, **clip_kw)
    return editor.ExportPlan(width=W, height=H, fps=FPS, with_audio=False, clips=[clip])


class FocusExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.mkdtemp(prefix="focus-test-")
        cls.src = os.path.join(cls.tmp, "quad.mp4")
        make_quadrants(cls.src)

    def test_zoom_into_top_left_quadrant_and_back(self) -> None:
        # Rest, then (eased by the client) fully zoomed on the red quadrant
        # from 1.0 s, then back to rest at 2.5 s.
        rows = [(0.0, 0.0, 0.0, 1.0), (1.0, 0.0, 0.0, 0.5), (2.5, 0.0, 0.0, 1.0)]
        out = os.path.join(self.tmp, "zoom.mp4")
        render(base_plan(self.src, camera=rows), out)
        before = frame_at(out, 0.5)
        zoomed = frame_at(out, 1.5)
        after = frame_at(out, 2.8)
        self.assertEqual(color(before[170, 300]), "white")
        self.assertEqual(color(zoomed[170, 300]), "red", "bottom-right shows the zoomed top-left quadrant")
        self.assertEqual(color(zoomed[10, 10]), "red")
        self.assertEqual(color(after[170, 300]), "white")
        self.assertEqual(color(after[10, 300]), "green")

    def test_zoom_near_edge_with_crop(self) -> None:
        # Clip cropped to the right half (green over white); window at the
        # bottom edge of that crop: shows white only.
        rows = [(0.0, 0.25, 0.5, 0.5)]
        out = os.path.join(self.tmp, "edge.mp4")
        render(base_plan(self.src, camera=rows, crop_x=0.5, crop_w=0.5), out)
        f = frame_at(out, 1.0)
        # Fitted box of a 160x180 crop in a 320x180 canvas: centered, 160 wide.
        self.assertEqual(color(f[90, 160]), "white")
        self.assertEqual(color(f[5, 100]), "white")

    def test_pointer_ring_and_cursor(self) -> None:
        ring = os.path.join(self.tmp, "ring.png")
        Image.new("RGBA", (64, 64), (0, 0, 0, 0)).save(ring)
        img = Image.open(ring)
        ImageDraw.Draw(img).ellipse((0, 0, 63, 63), fill=(255, 140, 0, 255))
        img.save(ring)
        cursor = os.path.join(self.tmp, "cursor.png")
        Image.new("RGBA", (20, 20), (0, 0, 255, 255)).save(cursor)
        plan = base_plan(self.src)
        plan.pointer = editor.PlanPointer(
            cursor_path=cursor,
            cursor_w=20 / H,
            cursor_h=20 / H,
            hot_x=0.0,
            hot_y=0.0,
            ring_paths=[ring, ring],
            ring_sizes=[2.0, 2.0],
            # Cursor top-left at the canvas center from 0.5 s, hidden from 2 s.
            cursor_rows=[(0.0, -1, -1), (0.5, 0.5, 0.5), (2.0, -1, -1)],
            # Ring of radius 0.1*H on the red quadrant 1.0-1.5 s.
            ring_rows=[(1.0, 0, 0.25, 0.25, 0.1, 1.0), (1.5, 0, 0, 0, 0, 0)],
        )
        out = os.path.join(self.tmp, "pointer.mp4")
        render(plan, out)
        self.assertEqual(color(frame_at(out, 0.2)[100, 170]), "white", "cursor not shown yet")
        self.assertEqual(color(frame_at(out, 1.0)[100, 170]), "blue", "cursor drawn at its hotspot")
        # Rows start at the click; before it the ring must not show (it did:
        # the first row's values were held back to frame 0).
        self.assertEqual(color(frame_at(out, 0.5)[45, 80]), "red", "no ring before its click")
        self.assertEqual(color(frame_at(out, 1.2)[45, 80]), "orange", "ring visible")
        self.assertEqual(color(frame_at(out, 1.8)[45, 80]), "red", "ring gone")
        self.assertEqual(color(frame_at(out, 2.5)[100, 170]), "white", "cursor hidden again")

    def test_frontend_payload_renders_like_the_preview(self) -> None:
        """The export payload the browser builds for a synthetic recording
        (fixture written by tests/desktop/focus.test.ts from the preview's
        own code), validated by the API layer and rendered: the click ring is
        where the preview draws it, and the zoom frames the clicked area."""
        from app.main import _EditorPointer, _camera_rows, _pointer_plan

        with open(PAYLOAD, encoding="utf-8") as f:
            payload = json.load(f)
        ring = os.path.join(self.tmp, "ring-e2e.png")
        img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        ImageDraw.Draw(img).ellipse((0, 0, 63, 63), fill=(255, 140, 0, 255))
        img.save(ring)
        plan = base_plan(self.src, camera=_camera_rows(payload["camera"]))
        pointer = _EditorPointer.model_validate({"rings": [{"image": 0, "size": 2.0}, {"image": 0, "size": 2.0}], "ringRows": payload["ringRows"]})
        plan.pointer = _pointer_plan(pointer, [(ring, 64, 64)])
        out = os.path.join(self.tmp, "e2e.mp4")
        render(plan, out)
        at = payload["expect"]["ringAt"]
        # The ring's fill is drawn at the preview's alpha over the (red) video.
        b, g, r = (int(v) for v in frame_at(out, at["t"])[at["y"], at["x"]])
        self.assertGreater(r, 200)
        self.assertLess(b, 60)
        self.assertAlmostEqual(g, 140 * at["alpha"], delta=30)
        zoomed = frame_at(out, payload["expect"]["zoomedAt"])
        for y, x in ((5, 5), (5, W - 5), (H - 5, 5), (H - 5, W - 5)):
            self.assertEqual(color(zoomed[y, x]), "red", (y, x))

    def test_requested_frame_rate_is_validated(self) -> None:
        """Screen recordings send their capture rate (their probed average is
        lower: frames only arrive when the screen changes)."""
        from pydantic import ValidationError

        from app.main import _EditorProject

        clip = {"source": 0, "start": 0, "end": 1}
        self.assertEqual(_EditorProject.model_validate({"clips": [clip], "fps": 30}).fps, 30)
        self.assertIsNone(_EditorProject.model_validate({"clips": [clip]}).fps, "older clients: probe decides")
        for bad in (0, 500, float("nan")):
            with self.assertRaises(ValidationError, msg=bad):
                _EditorProject.model_validate({"clips": [clip], "fps": bad})

    def test_invalid_rows_are_rejected(self) -> None:
        from fastapi import HTTPException

        from app.main import _EditorPointer, _camera_rows, _pointer_plan

        for bad in ([[0, 0, 0]], [[0, 0.9, 0, 0.5]], [[-1, 0, 0, 1]], [[0, 0, 0, 0.1]], [[0, float("nan"), 0, 1]]):
            with self.assertRaises(HTTPException):
                _camera_rows(bad)
        with self.assertRaises(HTTPException):
            _pointer_plan(_EditorPointer.model_validate({"rings": [{"image": 5, "size": 2}], "ringRows": [[0, 0, 0.5, 0.5, 0.1, 1]]}), [])
        with self.assertRaises(HTTPException):
            _pointer_plan(_EditorPointer.model_validate({"rings": [{"image": 0, "size": 2}], "ringRows": [[0, 7, 0.5, 0.5, 0.1, 1]]}), [("x", 1, 1)])

    def test_long_timeline_with_many_rows(self) -> None:
        """A 20 s clip with a zoom transition every second and a click
        every 0.3 s on every ring layer: the graph stays small enough and
        renders at a usable speed."""
        long_src = os.path.join(self.tmp, "long.mp4")
        make_quadrants(long_src, 20)
        camera = []
        for f in range(0, 20 * FPS):
            u = (f % FPS) / FPS
            camera.append((f / FPS, 0.25 * u, 0.25 * u, 1 - 0.5 * u))
        rings = []
        for k in range(int(20 / 0.3)):
            t0 = k * 0.3
            for j in range(9):
                rings.append((round(t0 + j / FPS, 4), k % 4, 0.5, 0.5, 0.02 + 0.005 * j, 1 - j / 9))
        clip = editor.PlanClip(source_path=long_src, source_has_audio=False, source_width=W, source_height=H, start=0.0, duration=20.0, camera=camera)
        plan = editor.ExportPlan(width=W, height=H, fps=FPS, with_audio=False, clips=[clip])
        ring = os.path.join(self.tmp, "ring-long.png")
        Image.new("RGBA", (64, 64), (255, 140, 0, 255)).save(ring)
        plan.pointer = editor.PlanPointer(None, 0, 0, 0, 0, [ring, ring], [2.0, 2.0], [], sorted(rings))
        out = os.path.join(self.tmp, "long-out.mp4")
        t = time.perf_counter()
        render(plan, out)
        self.assertLess(time.perf_counter() - t, 60)
        self.assertEqual(color(frame_at(out, 10.0)[170, 300]), "white", "zoom restarts each second")

    def test_step_expression_holds_values(self) -> None:
        expr = editor.step_expr([0.0, 1.0, 1.0333, 2.0], [5, 6, 6, 7], "t", 30)
        # Unchanged rows are dropped; boundaries half a frame early.
        self.assertEqual(expr.count("if("), 2)
        env = lambda t: eval(expr.replace("if(", "_if(").replace("lt(", "_lt("), {"_if": lambda c, a, b: a if c else b, "_lt": lambda a, b: a < b, "t": t})  # noqa: E731
        self.assertEqual([env(t) for t in (0, 0.98, 0.99, 1.5, 1.99, 3)], [5, 5, 6, 6, 7, 7])

    def test_shared_camera_vectors(self) -> None:
        """Zoom pixel geometry agreed with windowPixels() in camera.ts."""
        with open(VECTORS, encoding="utf-8") as f:
            vectors = json.load(f)
        for v in vectors:
            self.assertEqual(
                list(editor.camera_geometry(v["x"], v["y"], v["s"], v["boxW"], v["boxH"])),
                v["expect"],
                v,
            )


if __name__ == "__main__":
    unittest.main()
