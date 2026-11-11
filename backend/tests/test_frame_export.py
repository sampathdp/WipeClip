"""Canvas frame (padding, rounded corners, shadow) in a real export render,
matching the preview's geometry (src/lib/editor/timeline.ts frameInset /
frameShadow, PreviewPlayer's clip-path and box-shadow).

Run from the backend folder:  python -m unittest tests.test_frame_export
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest

import numpy as np

from app.pipeline import editor
from app.pipeline.video import get_ffmpeg_path
from tests.test_focus_export import FPS, H, W, base_plan, frame_at, render


def make_red(path: str) -> None:
    subprocess.run(
        [get_ffmpeg_path(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=red:s={W}x{H}:r={FPS}:d=3",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", path],
        check=True,
    )


class FrameExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = tempfile.TemporaryDirectory()
        cls.src = os.path.join(cls.dir.name, "red.mp4")
        make_red(cls.src)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.dir.cleanup()

    def render_frame(self, padding: float, radius: float, shadow: float) -> np.ndarray:
        plan = base_plan(self.src)
        plan.color = "#ffffff"
        plan.frame_padding, plan.frame_radius, plan.frame_shadow = padding, radius, shadow
        out = os.path.join(self.dir.name, f"f-{padding}-{radius}-{shadow}.mp4")
        render(plan, out)
        return frame_at(out, 1.0).astype(int)  # BGR

    def test_padding_insets_the_video(self) -> None:
        img = self.render_frame(0.1, 0, 0)
        # Box: 80% of the canvas, centered.
        self.assertGreater(img[H // 2, W // 2][2], 200)  # red inside
        self.assertTrue((img[3, 3] > 230).all())  # white background in the inset
        self.assertTrue((img[H // 2, int(W * 0.05)] > 230).all())  # left inset
        self.assertGreater(img[H // 2, int(W * 0.12)][2], 200)  # just inside the left edge

    def test_rounded_corners(self) -> None:
        img = self.render_frame(0.1, 0.1, 0)
        x0, y0 = int(W * 0.1), int(H * 0.1)
        corner = img[y0 + 1, x0 + 1]
        self.assertTrue((corner > 200).all(), f"corner is cut away: {corner}")
        r = int(0.1 * min(W, H))
        edge = img[y0 + 2, x0 + r + 4]
        self.assertGreater(edge[2], 200, f"top edge past the curve is video: {edge}")
        self.assertLess(edge[1], 90)

    def test_shadow_below_the_card(self) -> None:
        plain = self.render_frame(0.1, 0.05, 0)
        shadow = self.render_frame(0.1, 0.05, 1)
        below = (int(H * 0.9) + 3, W // 2)
        self.assertTrue((plain[below] > 235).all())
        self.assertLess(int(shadow[below].mean()), int(plain[below].mean()) - 15, "shadow darkens under the card")
        far = (2, 2)
        self.assertTrue((shadow[far] > 235).all(), "and fades out away from it")
        self.assertGreater(shadow[H // 2, W // 2][2], 200, "the video itself is unchanged")

    def test_gradient_background_blends_like_css(self) -> None:
        # The preview's CSS linear-gradient(to bottom): sRGB interpolation at
        # each row's center. (ffmpeg's `gradients` jumped to the second color.)
        plan = base_plan(self.src, scale=0.3)
        plan.background, plan.color, plan.color2 = "gradient", "#7c5cff", "#22d3ee"
        out = os.path.join(self.dir.name, "gradient.mp4")
        render(plan, out)
        img = frame_at(out, 1.0).astype(int)[:, :, ::-1]  # RGB
        c0, c1 = np.array([0x7C, 0x5C, 0xFF]), np.array([0x22, 0xD3, 0xEE])
        for y in range(0, H, 9):
            css = c0 + (c1 - c0) * (y + 0.5) / H
            self.assertLessEqual(np.abs(img[y, 10] - css).max(), 6, f"row {y}: {img[y, 10]} vs {css.round()}")

    def test_plan_round_trip_keeps_the_frame(self) -> None:
        plan = base_plan(self.src)
        plan.frame_padding, plan.frame_radius, plan.frame_shadow = 0.1, 0.04, 0.5
        back = editor.plan_from_json(editor.plan_to_json(plan))
        self.assertEqual((back.frame_padding, back.frame_radius, back.frame_shadow), (0.1, 0.04, 0.5))

    def test_plan_round_trip_keeps_voice_tone(self) -> None:
        # The desktop engine renders from the JSON (jobs.editor_export_job):
        # a track's tone came back a dict, and the export failed at the mix.
        plan = base_plan(self.src)
        comp = editor.PlanCompressor(threshold=-19.2, ratio=2.5, attack=10, release=150, makeup=3.96)
        tone = editor.PlanTone(bass=5, mid=-1, treble=-2, de_ess=0.2, comp=comp)
        plan.audio = [editor.PlanAudio(path=self.src, start=0, offset=0, duration=1, tone=tone), editor.PlanAudio(path=self.src, start=1, offset=0, duration=1)]
        back = editor.plan_from_json(editor.plan_to_json(plan))
        self.assertEqual(back.audio[0].tone, tone)
        self.assertIsNone(back.audio[1].tone)
        self.assertEqual(editor.tone_chain(back.audio[0].tone), editor.tone_chain(tone))

    def test_shadow_numbers_match_the_preview(self) -> None:
        self.assertIsNone(editor.frame_shadow(0))
        self.assertEqual(editor.frame_shadow(1), (0.02, 0.06, 0.6))


if __name__ == "__main__":
    unittest.main()
