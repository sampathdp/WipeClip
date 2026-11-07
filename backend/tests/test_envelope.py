"""Volume curves on audio tracks in the export (editor.py envelope_expr):
points in seconds of the audio file, linear between them, held outside -
curveAt() in src/lib/editor/envelope.ts - and validated on the way in.

Run from the backend folder:  python -m unittest tests.test_envelope
"""

from __future__ import annotations

import os
import tempfile
import unittest

import numpy as np

from app import main
from app.pipeline import editor
from tests.test_audio_mix import FPS, H, RATE, W, audio_of, clip, make_flash_clicks, make_wav, render


def curve_at(points: list[tuple[float, float]], s: float) -> float:
    """envelope.ts curveAt."""
    if s <= points[0][0]:
        return points[0][1]
    if s >= points[-1][0]:
        return points[-1][1]
    for (a, va), (b, vb) in zip(points, points[1:]):
        if a <= s <= b:
            return va + (vb - va) * (s - a) / (b - a)
    return 1.0


class EnvelopeExportTest(unittest.TestCase):
    def test_curve_follows_the_file_time_of_the_track(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "flash.mov")
            make_flash_clicks(src, 4.0)
            wav = os.path.join(d, "tone.wav")
            make_wav(wav, "0.4*sin(2*PI*1000*t)", 6.0)
            # The track plays file seconds 1..4 from timeline 0.5; the points
            # are in file seconds: full, down to a quarter, then up to 1.5.
            points = [(1.5, 1.0), (2.5, 0.25), (3.5, 1.5)]
            plan = editor.ExportPlan(
                width=W, height=H, fps=FPS, with_audio=True,
                clips=[clip(src, 0.0, 4.0, volume=0.0)],
                audio=[editor.PlanAudio(path=wav, start=0.5, offset=1.0, duration=3.0, envelope=points)],
                output_format="audio",
            )  # fmt: skip
            out = os.path.join(d, "curve.m4a")
            render(plan, out)
            x = audio_of(out).astype(np.float64)
            for tl in (0.7, 1.5, 2.0, 2.5, 3.0, 3.4):
                seg = x[int((tl - 0.02) * RATE) : int((tl + 0.02) * RATE)]
                got = float(np.sqrt(np.mean(seg**2))) / (0.4 / np.sqrt(2))
                want = curve_at(points, 1.0 + (tl - 0.5))
                # One audio frame of steps (eval=frame) and AAC: within 6 %.
                self.assertAlmostEqual(got, want, delta=0.06 * max(1, want), msg=f"timeline {tl}")

    def test_expression_matches_the_editor_curve(self) -> None:
        points = [(0.0, 0.5), (1.0, 2.0), (3.0, 0.0), (4.0, 1.0)]
        expr = editor.envelope_expr(points, "S").replace("if(", "_if(").replace("lt(", "_lt(")
        for s in (-1.0, 0.0, 0.25, 0.999, 1.5, 2.0, 3.0, 3.5, 9.0):
            got = eval(expr.replace("S", repr(s)), {"_if": lambda c, a, b: a if c else b, "_lt": lambda a, b: a < b})
            self.assertAlmostEqual(got, curve_at(points, s), places=5, msg=f"s={s}")

    def test_invalid_curves_are_refused(self) -> None:
        self.assertTrue(main._valid_envelope([]))
        self.assertTrue(main._valid_envelope([[0, 0], [1, 2], [1, 1]]))
        for bad in ([[1.0, 3.0]], [[2.0, 1.0], [1.0, 1.0]], [[-1.0, 1.0]], [[1.0]], [[float("nan"), 1.0]]):
            self.assertFalse(main._valid_envelope(bad), bad)
