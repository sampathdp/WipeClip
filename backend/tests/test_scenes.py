"""Scene analysis (app/pipeline/scenes.py), its text reading (ocr.py) and
sensitive text checks (sensitive.py). Synthetic screens and made-up values
only - no real credentials anywhere.

Run from the backend folder:  python -m unittest tests.test_scenes
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from unittest import mock

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from app.pipeline import ocr, scenes, sensitive
from app.pipeline.video import get_ffmpeg_path

W, H = 1280, 720


def cats(text: str) -> list[str]:
    return sorted(f.category for f in sensitive.scan_line(text, (0, 0, 10 * len(text), 20)))


class SensitiveTest(unittest.TestCase):
    def test_finds_common_kinds(self) -> None:
        self.assertEqual(cats("Contact: jane.doe@example.com"), ["email"])
        self.assertEqual(cats("Card 4111 1111 1111 1111 exp 12/30"), ["card"])  # a published test number
        self.assertEqual(cats("IBAN GB82 WEST 1234 5698 7654 32"), ["iban"])  # the standard example
        self.assertIn("key", cats("aws_access_key_id = AKIAIOSFODNN7EXAMPLE"))  # the documented example
        self.assertIn("connection", cats("DATABASE_URL=postgres://app:Hunter2Pass@db.example.com:5432/app"))
        self.assertIn("secret", cats("API_KEY=Zx9fQ2kLm8Pq4Rt7Vw1Y"))
        self.assertIn("token", cats("Authorization: Bearer abcDEF1234567890ghijKLMN"))
        self.assertIn("private-key", cats("-----BEGIN RSA PRIVATE KEY-----"))
        self.assertIn("phone", cats("Call +1 415 555 0132 today"))

    def test_checks_cut_false_alarms(self) -> None:
        self.assertEqual(cats("Card 4111 1111 1111 1112"), [])  # fails the Luhn check
        self.assertEqual(cats("IBAN GB82 WEST 1234 5698 7654 33"), [])  # fails mod 97
        self.assertEqual(cats("Released 2026-11-07, version 1.2.3"), [])
        self.assertEqual(cats("Open the project settings and press Save"), [])
        self.assertEqual(cats("password = changeme"), ["secret"])  # a password assignment, even a plain one
        self.assertEqual(cats("token_count = 12"), [])  # short, not random

    def test_never_carries_the_value(self) -> None:
        for text in ("API_KEY=Zx9fQ2kLm8Pq4Rt7Vw1Y", "jane.doe@example.com", "AKIAIOSFODNN7EXAMPLE"):
            for f in sensitive.scan_line(text, (0, 0, 300, 20)):
                self.assertNotIn(text.split("=")[-1], f.reason)
                self.assertNotIn("example", f.reason)

    def test_box_covers_the_match(self) -> None:
        text = "Contact: jane.doe@example.com"
        (f,) = sensitive.scan_line(text, (100, 50, 290, 20))
        x, y, w, h = f.box
        self.assertLessEqual(x, 100 + 290 * 9 / len(text))
        self.assertGreaterEqual(x + w, 100 + 290 * (len(text) - 1) / len(text))
        self.assertEqual((y, h), (50, 20))

    def test_password_label_points_at_its_field(self) -> None:
        found = sensitive.password_fields([("Password", (100, 200, 90, 20)), ("Email", (100, 150, 60, 20))], 1280)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].category, "password")
        self.assertGreater(found[0].box[1], 200)  # below the label


class ClassifyTest(unittest.TestCase):
    def frame(self) -> np.ndarray:
        rng = np.random.default_rng(1)
        return (rng.random((90, 160)) * 255).astype(np.uint8)

    def test_kinds_of_change(self) -> None:
        a = self.frame()
        self.assertEqual(scenes.classify(a, a)[1], "still")
        cursor = a.copy()
        cursor[40:44, 80:82] = 255  # a pointer moving
        self.assertEqual(scenes.classify(a, cursor)[1], "still")
        scrolled = np.roll(a, -6, axis=0)
        self.assertEqual(scenes.classify(a, scrolled)[1], "scroll")
        self.assertEqual(scenes.classify(a, 255 - a)[1], "cut")
        dialog = a.copy()
        dialog[25:65, 50:110] = 128
        frac, kind, box = scenes.classify(a, dialog)
        self.assertEqual(kind, "active")
        self.assertEqual(box, (50, 25, 60, 40))


def line(text: str, y: int, h: int = 20, x: int = 40) -> ocr.Line:
    return ocr.Line(text, (x, y, 10 * len(text), h), 0.95)


class DescribeTest(unittest.TestCase):
    def test_features(self) -> None:
        d = scenes.describe(
            [
                line("localhost:3000/settings", 10),
                line("Project Settings", 80, 40),
                line("$ npm run dev", 200),
                line("const app = express();", 230),
                line("import x from 'y';", 260),
                line("function go() {", 290),
                line("Error: build failed", 320),
                line("Saved successfully", 350),
                line("Email: jane.doe@example.com", 380),
            ],
            W,
            H,
            None,
        )
        self.assertEqual(d["headings"][0]["text"], "Project Settings")
        self.assertTrue(d["terminal"] and d["code"] and d["settings"])
        self.assertEqual(d["command"], "$ npm run dev")
        self.assertEqual(d["error"], "Error: build failed")
        self.assertEqual(d["success"], "Saved successfully")
        self.assertEqual(d["host"], "localhost:3000")
        # A flagged line is never kept as text.
        self.assertFalse(any("example.com" in lb["text"] for lb in d["labels"]))
        self.assertNotIn("example.com", json.dumps(d))

    def test_dialog_is_a_centered_box(self) -> None:
        self.assertTrue(scenes.describe([], W, H, (400, 200, 480, 300))["dialog"])
        self.assertFalse(scenes.describe([], W, H, (0, 0, 200, 720))["dialog"])


def render(text_lines: list[tuple[str, int, int, tuple[int, int, int]]], bg=(245, 245, 245), dialog=None) -> np.ndarray:
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    for text, y, size, color in text_lines:
        d.text((60, y), text, font=ImageFont.truetype("arial.ttf", size), fill=color)
    if dialog:
        d.rectangle((420, 240, 860, 480), fill=(255, 255, 255), outline=(80, 80, 80), width=3)
        d.text((450, 260), dialog, font=ImageFont.truetype("arial.ttf", 30), fill=(20, 20, 20))
        d.rectangle((700, 410, 830, 460), fill=(40, 110, 220))
        d.text((735, 420), "Delete", font=ImageFont.truetype("arial.ttf", 22), fill=(255, 255, 255))
    return np.array(img)


def make_screen_video(path: str) -> None:
    """Three screens, 3 s each: a settings page with an email on it; the
    same page with a dialog; a terminal with a command and an error."""
    settings = render([("Project Settings", 40, 44, (20, 20, 20)), ("Owner: jane.doe@example.com", 160, 22, (40, 40, 40)), ("Database connection", 210, 22, (40, 40, 40))])
    dialog = render([("Project Settings", 40, 44, (20, 20, 20)), ("Owner: jane.doe@example.com", 160, 22, (40, 40, 40)), ("Database connection", 210, 22, (40, 40, 40))], dialog="Delete project?")
    terminal = render([("$ npm run dev", 60, 24, (120, 230, 120)), ("Error: build failed", 110, 24, (240, 90, 90))], bg=(25, 25, 25))
    fps = 10
    proc = subprocess.Popen(
        [get_ffmpeg_path(), "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(fps), "-i", "pipe:0",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", path],
        stdin=subprocess.PIPE,
    )  # fmt: skip
    for frame in (settings, dialog, terminal):
        for _ in range(3 * fps):
            proc.stdin.write(frame.tobytes())  # type: ignore[union-attr]
    proc.stdin.close()  # type: ignore[union-attr]
    proc.wait()


@unittest.skipUnless(ocr.models_ready(), "text reading models not available (python -m app.pipeline.ocr)")
class AnalyzeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.video = os.path.join(cls.tmp.name, "screen.mp4")
        make_screen_video(cls.video)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmp.cleanup()

    def run_level(self, level: str, clicks=None) -> dict:
        with mock.patch.dict(os.environ, {"WIPECLIP_SCENE_DIR": os.path.join(self.tmp.name, "cache")}):
            return scenes.analyze(self.video, W, H, 9.0, level, clicks or [], lambda s, v: None)

    def test_reads_where_the_screen_settles(self) -> None:
        r = self.run_level("thorough", [[5.5, (735 + 30) / W, 432 / H]])
        times = [f["t"] for f in r["frames"]]
        self.assertGreaterEqual(len(times), 3, times)
        heads = [h["text"] for f in r["frames"] for h in f["headings"]]
        self.assertIn("Project Settings", heads)
        dialog = [f for f in r["frames"] if 3 <= f["t"] < 6]
        self.assertTrue(dialog and any(h["text"] == "Delete project?" for f in dialog for h in f["headings"]), dialog)
        term = [f for f in r["frames"] if f["t"] >= 6]
        self.assertTrue(term and term[0]["terminal"] and term[0]["error"])
        # The clicked button is named.
        self.assertEqual(r["clicks"][0]["label"], "Delete")
        # The email: found, placed, for as long as it's on screen - and not kept as text.
        emails = [p for p in r["privacy"] if p["category"] == "email"]
        self.assertEqual(len(emails), 1, r["privacy"])
        self.assertLess(emails[0]["start"], 0.6)
        self.assertGreater(emails[0]["end"], 5.5)
        self.assertLess(emails[0]["end"], 6.6)
        x, y, w, h = emails[0]["box"]
        self.assertTrue(x < 0.3 and 0.18 < y < 0.26 and w > 0.1, emails[0]["box"])
        self.assertNotIn("jane.doe", json.dumps(r))

    def test_quick_reads_less_and_is_cached(self) -> None:
        r = self.run_level("quick")
        self.assertGreaterEqual(r["stats"]["framesRead"], 2)
        # The dialog frame reads only what changed.
        dialog = [f for f in r["frames"] if 3 <= f["t"] < 6]
        self.assertTrue(dialog and dialog[0]["region"] is not None and dialog[0]["dialog"], dialog)
        calls = []
        with mock.patch.object(scenes, "scan", side_effect=lambda *a, **k: calls.append(1)):
            again = self.run_level("quick")
        self.assertEqual(calls, [])
        self.assertEqual(again, r)

    def test_cancel(self) -> None:
        class Stop(Exception):
            pass

        def cancel(stage: str, value: float) -> None:
            if stage == "read":
                raise Stop

        with mock.patch.dict(os.environ, {"WIPECLIP_SCENE_DIR": os.path.join(self.tmp.name, "cache2")}), self.assertRaises(Stop):
            scenes.analyze(self.video, W, H, 9.0, "thorough", [], cancel)
        self.assertFalse(os.path.isdir(os.path.join(self.tmp.name, "cache2")) and os.listdir(os.path.join(self.tmp.name, "cache2")))

    def test_api(self) -> None:
        from fastapi.testclient import TestClient

        from app import main

        with mock.patch.object(main, "LOCAL_MODE", True), mock.patch.dict(os.environ, {"WIPECLIP_SCENE_DIR": os.path.join(self.tmp.name, "cache3")}):
            client = TestClient(main.app)
            res = client.post("/api/scene/analyze", data={"path": self.video, "level": "quick", "clicks": "[]"})
            self.assertEqual(res.status_code, 200, res.text[:300])
            self.assertEqual(res.json()["version"], scenes.VERSION)
            self.assertEqual(client.post("/api/scene/analyze", data={"path": self.video, "clicks": "[[1,"}).status_code, 400)
            self.assertEqual(client.post("/api/scene/analyze", data={"path": self.video, "level": "max"}).status_code, 422)
        with mock.patch.object(main, "LOCAL_MODE", False):
            self.assertEqual(TestClient(main.app).post("/api/scene/analyze", data={"path": self.video}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
