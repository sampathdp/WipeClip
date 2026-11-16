"""Several video layers at once in the editor export - split screens and
picture in picture: crop, stretch, stacking order, timing, masks and
frames (shadow and border) - rendered with the real ffmpeg on synthetic
media and checked pixel by pixel.

Run from the backend folder:  python -m unittest tests.test_layer_compose
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import time
import unittest

from PIL import Image, ImageDraw

from app.pipeline import editor
from app.pipeline.video import get_ffmpeg_path
from tests.test_focus_export import FPS, H, W, base_plan, color, frame_at, make_quadrants, render

# The quadrants of the test video, as layer crops (x, y, w, h).
RED = (0.0, 0.0, 0.5, 0.5)
GREEN = (0.5, 0.0, 0.5, 0.5)
BLUE = (0.0, 0.5, 0.5, 0.5)
WHITE = (0.5, 0.5, 0.5, 0.5)


def layer(src: str, x: float, y: float, width: float, **kw) -> editor.PlanOverlay:
    return editor.PlanOverlay(
        image_path=src, image_width=W, image_height=H, start=kw.pop("start", 0.0), end=kw.pop("end", 3.0),
        x=x, y=y, width=width, rotation=0.0, video=True, **kw,
    )  # fmt: skip


def make_gray(path: str, seconds: float = 3.0) -> None:
    subprocess.run(
        [get_ffmpeg_path(), "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", f"color=gray:s={W}x{H}:r={FPS}:d={seconds}",
         "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "10", path],
        check=True,
    )  # fmt: skip


class LayerComposeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.mkdtemp(prefix="compose-test-")
        cls.src = os.path.join(cls.tmp, "quad.mp4")
        make_quadrants(cls.src)
        cls.gray = os.path.join(cls.tmp, "gray.mp4")
        make_gray(cls.gray)

    def out(self, name: str) -> str:
        return os.path.join(self.tmp, name)

    def test_cropped_layer_shows_only_the_kept_part(self) -> None:
        # The blue quadrant alone, over the whole canvas.
        plan = base_plan(self.gray)
        plan.overlays.append(layer(self.src, 0.5, 0.5, 1.0, crop=BLUE))
        out = self.out("crop.mp4")
        render(plan, out)
        f = frame_at(out, 1.0)
        for y, x in ((8, 8), (8, W - 8), (H - 8, 8), (H - 8, W - 8), (H // 2, W // 2)):
            self.assertEqual(color(f[y, x]), "blue", f"at {(x, y)}")

    def test_crop_keeps_the_picture_scale(self) -> None:
        # The left half (red over blue), half the canvas wide: its box is
        # 160 x 180, centred - so the picture isn't squeezed or stretched.
        plan = base_plan(self.gray)
        plan.overlays.append(layer(self.src, 0.5, 0.5, 0.5, crop=(0.0, 0.0, 0.5, 1.0)))
        out = self.out("half.mp4")
        render(plan, out)
        f = frame_at(out, 1.0)
        self.assertEqual(color(f[45, 160]), "red")
        self.assertEqual(color(f[135, 160]), "blue")
        self.assertNotIn(color(f[90, 40]), ("red", "blue"), "left of the box is the base")
        self.assertNotIn(color(f[90, 280]), ("red", "blue"), "right of the box is the base")
        self.assertEqual(color(f[45, 86]), "red", "just inside the box's left edge")
        self.assertEqual(color(f[45, 234]), "red", "just inside its right edge")

    def test_stretch_sets_the_box_shape(self) -> None:
        # The whole video in a box 80 wide and 180 high (aspect 80/180).
        plan = base_plan(self.gray)
        plan.overlays.append(layer(self.src, 0.5, 0.5, 0.25, box_aspect=80 / 180))
        out = self.out("stretch.mp4")
        render(plan, out)
        f = frame_at(out, 1.0)
        self.assertEqual(color(f[10, 130]), "red")
        self.assertEqual(color(f[10, 190]), "green")
        self.assertEqual(color(f[170, 130]), "blue")
        self.assertEqual(color(f[170, 190]), "white")
        self.assertNotIn(color(f[90, 110]), ("red", "blue"))

    def test_four_videos_in_a_grid(self) -> None:
        # Four layers at once, each a different part of its video, in a
        # 2 x 2 grid: every screen is the right one, in the right place.
        plan = base_plan(self.gray)
        cells = [((0.25, 0.25), WHITE), ((0.75, 0.25), BLUE), ((0.25, 0.75), GREEN), ((0.75, 0.75), RED)]
        for (x, y), crop in cells:
            plan.overlays.append(layer(self.src, x, y, 0.5, crop=crop))
        out = self.out("grid.mp4")
        started = time.perf_counter()
        render(plan, out)
        self.render_seconds = time.perf_counter() - started
        for t in (0.2, 1.5, 2.8):
            f = frame_at(out, t)
            self.assertEqual(color(f[45, 80]), "white", f"top left at {t}")
            self.assertEqual(color(f[45, 240]), "blue", f"top right at {t}")
            self.assertEqual(color(f[135, 80]), "green", f"bottom left at {t}")
            self.assertEqual(color(f[135, 240]), "red", f"bottom right at {t}")
            # Each screen right up to the middle lines: no gaps, no overlap.
            self.assertEqual(color(f[45, 156]), "white")
            self.assertEqual(color(f[45, 164]), "blue")
            self.assertEqual(color(f[86, 80]), "white")
            self.assertEqual(color(f[94, 80]), "green")

    def test_stacking_order_and_timing(self) -> None:
        # Two overlapping layers: the later one in the list is on top, and
        # each shows only during its own time.
        plan = base_plan(self.gray)
        plan.overlays.append(layer(self.src, 0.5, 0.5, 0.5, crop=RED, start=0.0, end=3.0))
        plan.overlays.append(layer(self.src, 0.5, 0.5, 0.25, crop=GREEN, start=1.0, end=2.0))
        out = self.out("stack.mp4")
        render(plan, out)
        self.assertEqual(color(frame_at(out, 0.5)[90, 160]), "red", "before the top layer starts")
        self.assertEqual(color(frame_at(out, 1.5)[90, 160]), "green", "the top layer covers the middle")
        self.assertEqual(color(frame_at(out, 1.5)[90, 110]), "red", "the lower layer shows around it")
        self.assertEqual(color(frame_at(out, 2.5)[90, 160]), "red", "after the top layer ends")

    def test_layer_plays_from_its_offset_in_step(self) -> None:
        # A video whose colour changes at 1.0 s, as a layer starting at 0.5 s
        # of the timeline from 0.5 s of its video: the change lands on 1.0 s.
        flip = self.out("flip.mp4")
        graph = f"color=red:s={W}x{H}:r={FPS}:d=1[a];color=blue:s={W}x{H}:r={FPS}:d=2[b];[a][b]concat=n=2:v=1,format=yuv420p[v]"
        subprocess.run([get_ffmpeg_path(), "-y", "-loglevel", "error", "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-crf", "10", flip], check=True)
        plan = base_plan(self.gray)
        plan.overlays.append(layer(flip, 0.5, 0.5, 0.5, start=0.5, end=2.5, offset=0.5))
        plan.overlays.append(layer(flip, 0.25, 0.25, 0.25, start=0.0, end=3.0))
        out = self.out("sync.mp4")
        render(plan, out)
        self.assertNotIn(color(frame_at(out, 0.3)[130, 160]), ("red", "blue"), "not started yet")
        self.assertEqual(color(frame_at(out, 0.8)[130, 160]), "red")
        self.assertEqual(color(frame_at(out, 1.2)[130, 160]), "blue")
        # The second layer, from its start: the same change at the same time.
        self.assertEqual(color(frame_at(out, 0.8)[45, 80]), "red")
        self.assertEqual(color(frame_at(out, 1.2)[45, 80]), "blue")

    def test_frame_shadow_and_border(self) -> None:
        # Box 160 x 90 in the middle. Border: an orange line inside its
        # edge. Shadow: darkens the base around the box, not the box itself.
        over = self.out("over.png")
        img = Image.new("RGBA", (160, 90), (0, 0, 0, 0))
        ImageDraw.Draw(img).rectangle((0, 0, 159, 89), outline=(255, 140, 0, 255), width=8)
        img.save(over)
        pad = round(0.2 * 90)
        under = self.out("under.png")
        img = Image.new("RGBA", (160 + 2 * pad, 90 + 2 * pad), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rectangle((0, 0, img.width - 1, img.height - 1), fill=(0, 0, 0, 255))
        d.rectangle((pad, pad, pad + 159, pad + 89), fill=(0, 0, 0, 0))
        img.save(under)
        plan = base_plan(self.gray)
        plan.overlays.append(layer(self.src, 0.5, 0.5, 0.5, crop=WHITE, frame_under=under, frame_over=over, frame_pad=0.2))
        out = self.out("frame.mp4")
        render(plan, out)
        f = frame_at(out, 1.0)
        self.assertEqual(color(f[90, 160]), "white", "the picture, untouched by the shadow")
        self.assertEqual(color(f[90, 83]), "orange", "border inside the left edge")
        self.assertEqual(color(f[48, 160]), "orange", "border inside the top edge")
        b, g, r = (int(v) for v in f[90, 70])
        self.assertTrue(max(r, g, b) < 40, f"shadow beside the box, got {(r, g, b)}")
        b, g, r = (int(v) for v in f[90, 30])
        self.assertTrue(100 < g < 160, f"past the shadow the base is as it was, got {(r, g, b)}")

    def test_mask_follows_the_cropped_box(self) -> None:
        # A mask showing the left half, on a layer cropped to the top half
        # (red | green) over the whole canvas: red shows, green doesn't.
        mask = self.out("mask.png")
        img = Image.new("RGB", (64, 64), (0, 0, 0))
        ImageDraw.Draw(img).rectangle((0, 0, 31, 63), fill=(255, 255, 255))
        img.save(mask)
        plan = base_plan(self.gray)
        plan.overlays.append(layer(self.src, 0.5, 0.25, 1.0, crop=(0.0, 0.0, 1.0, 0.5), mask_path=mask))
        out = self.out("maskcrop.mp4")
        render(plan, out)
        f = frame_at(out, 1.0)
        self.assertEqual(color(f[45, 80]), "red")
        self.assertNotIn(color(f[45, 240]), ("green", "red"), "masked out: the base shows")
        self.assertNotIn(color(f[135, 80]), ("red", "blue"), "below the box: the base")

    def test_animated_layer_grows_to_full_screen(self) -> None:
        # Picture in picture growing into the main screen: small in the
        # bottom-right corner at 0.5 s, the whole canvas at 2.5 s.
        kfs = [
            {"t": 0.5, "x": 0.85, "y": 0.85, "scale": 1.0, "rotation": 0.0, "opacity": 1.0, "ease": "linear"},
            {"t": 2.5, "x": 0.5, "y": 0.5, "scale": 5.0, "rotation": 0.0, "opacity": 1.0, "ease": "linear"},
        ]
        plan = base_plan(self.gray)
        plan.overlays.append(layer(self.src, 0.85, 0.85, 0.2, crop=GREEN, keyframes=kfs))
        out = self.out("grow.mp4")
        render(plan, out)
        early = frame_at(out, 0.3)
        self.assertEqual(color(early[153, 272]), "green", "small, in the corner")
        self.assertNotEqual(color(early[90, 160]), "green")
        late = frame_at(out, 2.8)
        for y, x in ((8, 8), (H - 8, W - 8), (90, 160)):
            self.assertEqual(color(late[y, x]), "green", f"fills the canvas at {(x, y)}")

    def test_layers_without_the_new_fields_are_built_as_before(self) -> None:
        # No crop, stretch or frame: the same filters as before they existed.
        o = layer(self.src, 0.5, 0.5, 0.5)
        chain, _ = editor._overlay_filters(o, "[1:v:0]", 0, base_plan(self.src), "base")
        self.assertNotIn("crop=", chain)
        self.assertIn("scale=160:90:flags=lanczos", chain)
        self.assertEqual(chain.count("overlay="), 1)


if __name__ == "__main__":
    unittest.main()


class LayerApiTest(unittest.TestCase):
    """The same fields through the export endpoint, as the editor sends them
    (src/lib/editor/exportProject.ts): validation, then a real render."""

    @classmethod
    def setUpClass(cls) -> None:
        from tests.test_local_path_export import make_video

        cls.dir = tempfile.TemporaryDirectory()
        cls.red = os.path.join(cls.dir.name, "red.mp4")
        cls.blue = os.path.join(cls.dir.name, "blue.mp4")
        make_video(cls.red, "red")
        make_video(cls.blue, "blue")
        cls.over = os.path.join(cls.dir.name, "over.png")
        img = Image.new("RGBA", (160, 180), (0, 0, 0, 0))
        ImageDraw.Draw(img).rectangle((0, 0, 159, 179), outline=(255, 140, 0, 255), width=10)
        img.save(cls.over)
        cls.under = os.path.join(cls.dir.name, "under.png")
        Image.new("RGBA", (224, 244), (0, 0, 0, 0)).save(cls.under)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.dir.cleanup()

    def setUp(self) -> None:
        from unittest import mock

        from fastapi.testclient import TestClient

        from app import main

        self.main = main
        self.mock = mock
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

    def export(self, overlay: dict, images: list[str]) -> object:
        import hashlib
        import json

        from tests.test_local_path_export import project

        base = {"video": 1, "offset": 0, "volume": 0, "start": 0, "end": 1, "x": 0.75, "y": 0.5, "width": 0.5, "rotation": 0, "opacity": 1, "animIn": "none", "animOut": "none"}
        proj = project(1) | {"overlays": [base | overlay]}
        text = json.dumps(proj)
        job = {"projectHash": hashlib.sha256(text.encode()).hexdigest(), "resolution": "720p", "branding": False, "compact": False}
        handles = [open(p, "rb") for p in images]
        try:
            files = [("overlays", (os.path.basename(p), h, "image/png")) for p, h in zip(images, handles)]
            with self.mock.patch.object(self.main.tickets, "verify", return_value=job):
                # A request needs at least one file part; a tiny one when there are no images.
                return self.client.post(
                    "/api/video/export",
                    data={"ticket": "t", "project": text, "source_paths": json.dumps([self.red, self.blue])},
                    files=files or [("project_file", ("project.json", text.encode(), "application/json"))],
                )
        finally:
            for h in handles:
                h.close()

    def test_cropped_framed_layer_renders(self) -> None:
        # The blue video's middle half, filling the right half of the canvas,
        # with a border and a (clear) shadow picture.
        res = self.export({"crop": {"x": 0.25, "y": 0, "w": 0.5, "h": 1}, "frame": {"under": 1, "over": 0, "pad": 0.2}}, [self.over, self.under])
        self.assertEqual(res.status_code, 200, res.text[:300])
        out = os.path.join(self.dir.name, "api.mp4")
        with open(out, "wb") as f:
            f.write(res.content)
        f = frame_at(out, 0.5)
        self.assertEqual(color(f[90, 80]), "red", "the main video on the left")
        self.assertEqual(color(f[90, 240]), "blue", "the layer on the right")
        self.assertEqual(color(f[90, 164]), "orange", "its border inside its left edge")
        self.assertEqual(color(f[90, 150]), "red", "nothing past its edge")

    def test_stretched_layer_renders(self) -> None:
        res = self.export({"aspect": 320 / 90, "width": 1, "x": 0.5, "y": 0.25}, [])
        self.assertEqual(res.status_code, 200, res.text[:300])
        out = os.path.join(self.dir.name, "api-stretch.mp4")
        with open(out, "wb") as f:
            f.write(res.content)
        f = frame_at(out, 0.5)
        self.assertEqual(color(f[45, 160]), "blue", "the top half")
        self.assertEqual(color(f[135, 160]), "red", "the bottom half is the main video")

    def test_bad_layer_fields_are_refused(self) -> None:
        self.assertEqual(self.export({"crop": {"x": 0.6, "y": 0, "w": 0.6, "h": 1}}, []).status_code, 400, "a crop past the frame")
        self.assertEqual(self.export({"frame": {"over": 3, "pad": 0}}, [self.over]).status_code, 400, "a frame picture that wasn't sent")
        self.assertGreaterEqual(self.export({"aspect": 0}, []).status_code, 400, "a zero stretch")
        # Crop, stretch and frame are for video layers only.
        res = self.export({"video": None, "image": 0, "crop": {"x": 0, "y": 0, "w": 0.5, "h": 1}}, [self.over])
        self.assertEqual(res.status_code, 400)
