"""Track tone in the export (app/pipeline/editor.py tone_chain): the chains
built from the editor's numbers are the ones pinned in
tests/fixtures/tone-chains.json (which the editor's own test runs through
ffmpeg against the preview's code), the request is validated, and a toned
track stays on its timeline time.

Run from the backend folder:  python -m unittest tests.test_voice_tone
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from app import main
from app.pipeline import editor
from tests.test_audio_mix import FPS, H, W, _between, audio_of, clicks, clip, make_flash_clicks, make_wav, render

FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "tone-chains.json"


def _tone(wire: dict) -> editor.PlanTone:
    return main._plan_tone(main._EditorTone(**wire))  # type: ignore[return-value]


class ToneChainTest(unittest.TestCase):
    def test_chains_match_the_pinned_fixture(self) -> None:
        cases = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
        self.assertGreaterEqual(len(cases), 8)
        for c in cases:
            self.assertEqual(editor.tone_chain(_tone(c["wire"])), c["chain"], c["name"])

    def test_nothing_to_do_is_no_filter(self) -> None:
        self.assertEqual(editor.tone_chain(None), "")
        self.assertEqual(editor.tone_chain(editor.PlanTone()), "")

    def test_request_values_are_validated(self) -> None:
        for bad in ({"bass": 13}, {"mid": -40}, {"deEss": 2}, {"comp": {"threshold": 5, "ratio": 2, "attack": 10, "release": 150, "makeup": 0}},
                    {"comp": {"threshold": -20, "ratio": 50, "attack": 10, "release": 150, "makeup": 0}},
                    {"comp": {"threshold": -20, "ratio": 2, "attack": 10, "release": 150, "makeup": 40}}):  # fmt: skip
            with self.assertRaises(ValidationError, msg=str(bad)):
                main._EditorTone(**bad)
        ok = main._EditorAudio(audio=0, start=0, duration=1, tone={"lowCut": True, "bass": -3})
        self.assertIsNotNone(ok.tone)


class ToneExportTest(unittest.TestCase):
    def test_a_toned_track_stays_on_its_timeline_time(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "flash.mov")
            make_flash_clicks(src, 2.0)
            wav = os.path.join(d, "click.wav")
            make_wav(wav, f"0.6*sin(2*PI*1000*t)*({_between((0.5,), 0.005)})", 2.0)
            cases = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
            podcast = next(c for c in cases if c.get("preset") == "podcast")
            plan = editor.ExportPlan(
                width=W, height=H, fps=FPS, with_audio=True,
                clips=[clip(src, 0.0, 0.8, volume=0.0)],
                audio=[editor.PlanAudio(path=wav, start=0.2, offset=0.0, duration=0.6, tone=_tone(podcast["wire"]))],
                output_format="audio",
            )  # fmt: skip
            out = os.path.join(d, "toned.m4a")
            render(plan, out)
            a = clicks(audio_of(out), threshold=0.1)
            self.assertEqual(len(a), 1, a)
            self.assertAlmostEqual(a[0], 0.7, delta=0.003)


if __name__ == "__main__":
    unittest.main()
