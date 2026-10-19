"""Privacy masks in the editor export, rendered with the real ffmpeg on a
synthetic video and checked pixel by pixel.

Run from the backend folder:  python -m unittest tests.test_privacy_export
"""

from __future__ import annotations

import os
import tempfile
import unittest

import numpy as np

from app.pipeline import editor
from tests.test_focus_export import FPS, H, W, base_plan, frame_at, make_quadrants, render


def make_checker(path: str, seconds: float = 3.0) -> None:
    """A fine black/white checkerboard: blur turns it grey, pixelate
    keeps hard edges but coarse, solid makes it one color."""
    import subprocess

    from app.pipeline.video import get_ffmpeg_path

    subprocess.run(
        [
            get_ffmpeg_path(), "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
            "-i", f"nullsrc=s={W}x{H}:r={FPS}:d={seconds},geq=lum='if(mod(floor(X/4)+floor(Y/4),2),235,16)':cb=128:cr=128,format=yuv420p",
            "-c:v", "libx264", "-crf", "8", path,
        ],
        check=True,
    )


def contrast(img: np.ndarray, x0: int, y0: int, x1: int, y1: int) -> float:
    patch = img[y0:y1, x0:x1].astype(float).mean(axis=2)
    return float(patch.std())


class PrivacyExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.mkdtemp(prefix="privacy-test-")
        cls.checker = os.path.join(cls.tmp, "checker.mp4")
        make_checker(cls.checker)
        cls.quad = os.path.join(cls.tmp, "quad.mp4")
        make_quadrants(cls.quad)

    def render_masks(self, src: str, masks: list[editor.PlanMask]) -> str:
        plan = base_plan(src)
        plan.masks = masks
        out = os.path.join(self.tmp, f"m{len(os.listdir(self.tmp))}.mp4")
        render(plan, out)
        return out

    def test_blur_covers_only_its_rectangle_and_time(self) -> None:
        m = editor.PlanMask("blur", 1.0, 2.0, 80, "#000000", [(1.0, 0.25, 0.25, 0.5, 0.5)])
        out = self.render_masks(self.checker, [m])
        during, before = frame_at(out, 1.5), frame_at(out, 0.5)
        self.assertLess(contrast(during, 120, 70, 200, 110), 15, "blurred inside")
        self.assertGreater(contrast(during, 5, 5, 60, 30), 60, "sharp outside")
        self.assertGreater(contrast(before, 120, 70, 200, 110), 60, "not before its start")
        self.assertGreater(contrast(frame_at(out, 2.5), 120, 70, 200, 110), 60, "not after its end")

    def test_pixelate_and_solid(self) -> None:
        pix = editor.PlanMask("pixelate", 0.0, 3.0, 60, "#000000", [(0.0, 0.0, 0.0, 0.5, 1.0)])
        solid = editor.PlanMask("solid", 0.0, 3.0, 0, "#ff00ff", [(0.0, 0.5, 0.0, 0.5, 0.5)])
        out = self.render_masks(self.checker, [pix, solid])
        f = frame_at(out, 1.0)
        b, g, r = (int(v) for v in f[40, 240])
        self.assertTrue(r > 200 and b > 200 and g < 60, f"solid magenta, got {(r, g, b)}")
        # Pixelated: blocks much bigger than the 4 px checker -> long runs of equal pixels.
        row = f[90, 10:150].astype(int).mean(axis=1)
        changes = int((np.abs(np.diff(row)) > 40).sum())
        self.assertLess(changes, 20, "coarse blocks, not the fine checker")
        self.assertGreater(contrast(f, 200, 120, 300, 170), 60, "unmasked corner untouched")

    def test_moving_mask_follows_rows(self) -> None:
        # Solid box moving from the left half to the right half at 1.5 s.
        m = editor.PlanMask("solid", 0.0, 3.0, 0, "#00ff00", [(0.0, 0.0, 0.0, 0.25, 0.25), (1.5, 0.75, 0.0, 0.25, 0.25), (2.5, 0, 0, 0, 0)])
        out = self.render_masks(self.quad, [m])
        early, late, hidden = frame_at(out, 1.0), frame_at(out, 2.0), frame_at(out, 2.8)
        self.assertGreater(int(early[10, 10][1]), 200)
        self.assertLess(int(late[10, 10][1]), 80, "moved away")
        self.assertGreater(int(late[10, 300][1]), 200)
        # Hidden row: no full-frame box (drawbox treats w=0 as full width).
        b, g, r = (int(v) for v in hidden[170, 300])
        self.assertTrue(r > 200 and g > 200 and b > 200, "white quadrant visible again")

    def test_masks_survive_the_export_job(self) -> None:
        """Through jobs.editor_export_job, the way the API runs an export:
        the plan crosses the job boundary as JSON. Masks, pointer rows and
        camera rows used to be dropped there - the job rendered without
        them although rendering the plan directly was fine."""
        from app import jobs

        plan = base_plan(self.checker)
        plan.masks = [editor.PlanMask("solid", 0.5, 2.5, 0, "#ff00ff", [(0.5, 0.25, 0.25, 0.5, 0.5)])]
        plan.clips[0].camera = [(0.0, 0.0, 0.0, 1.0)]
        plan.pointer = editor.PlanPointer(None, 0, 0, 0, 0, [], [], [(0.0, -1.0, -1.0)], [])
        back = editor.plan_from_json(editor.plan_to_json(plan))
        self.assertEqual(back.masks, plan.masks)
        self.assertEqual(back.pointer, plan.pointer)
        self.assertEqual(back.clips[0].camera, plan.clips[0].camera)
        self.assertEqual(editor.plan_to_json(back), editor.plan_to_json(plan), "lossless round trip")

        editor.quantize_plan(plan)
        out = os.path.join(self.tmp, "job.mp4")
        jobs.editor_export_job(editor.plan_to_json(plan), out)
        b, g, r = (int(v) for v in frame_at(out, 1.5)[90, 160])
        self.assertTrue(r > 200 and b > 200 and g < 60, f"mask rendered by the job, got {(r, g, b)}")



class MaskValidationTest(unittest.TestCase):
    def test_invalid_masks_are_rejected(self) -> None:
        from fastapi import HTTPException

        from app.main import _EditorMask, _mask_plan

        ok = _mask_plan(_EditorMask.model_validate({"mode": "blur", "start": 0, "end": 5, "rows": [[0, 0.1, 0.1, 0.2, 0.2]]}), 3.0)
        self.assertIsNotNone(ok)
        self.assertEqual(ok.end, 3.0, "clamped to the timeline")
        for bad in (
            {"mode": "glow", "start": 0, "end": 1, "rows": [[0, 0, 0, 0.1, 0.1]]},
            {"mode": "blur", "start": 0, "end": 1, "rows": [[0, 0, 0, 2, 0.1]]},
            {"mode": "blur", "start": 0, "end": 1, "rows": [[0, 0, 0, 0.1]]},
            {"mode": "solid", "start": 0, "end": 1, "rows": [[0, float("nan"), 0, 0.1, 0.1]]},
        ):
            with self.assertRaises(HTTPException, msg=bad):
                _mask_plan(_EditorMask.model_validate(bad), 3.0)
        self.assertIsNone(_mask_plan(_EditorMask.model_validate({"mode": "blur", "start": 4, "end": 5, "rows": [[4, 0, 0, 0.1, 0.1]]}), 3.0), "past the end")


if __name__ == "__main__":
    unittest.main()
