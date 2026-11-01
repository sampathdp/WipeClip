"""Speech recognition in the desktop engine (app/pipeline/speech.py): the
clips it transcribes, the loop clean-up, the model per language, and the
endpoints. The models themselves aren't downloaded here.

Run from the backend folder:  python -m unittest tests.test_speech
"""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

import numpy as np
from fastapi.testclient import TestClient

from app import main
from app.pipeline import speech

RATE = speech.RATE


def tone(seconds: float, level: float = 0.1) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    return (level * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * RATE), np.float32)


class ClipsTest(unittest.TestCase):
    def test_cuts_in_the_quiet_near_each_end(self) -> None:
        # 10 s of sound, 1 s pause, 10 s of sound: a 12 s limit cuts in the pause.
        audio = np.concatenate([tone(10), silence(1), tone(10)])
        clips = speech.speech_clips(audio, 12 * RATE)
        self.assertEqual(len(clips), 2)
        cut = clips[0][1] / RATE
        self.assertTrue(10 <= cut <= 11, cut)
        self.assertEqual(clips[1], (clips[0][1], len(audio)))

    def test_no_clip_is_longer_than_asked(self) -> None:
        clips = speech.speech_clips(tone(65), 28 * RATE)
        self.assertTrue(all(b - a <= 28 * RATE for a, b in clips))
        self.assertEqual(clips[-1][1], 65 * RATE)

    def test_silence_is_skipped(self) -> None:
        self.assertEqual(speech.speech_clips(silence(30), 12 * RATE), [])
        audio = np.concatenate([silence(20), tone(5)])
        clips = speech.speech_clips(audio, 12 * RATE)
        self.assertTrue(clips and clips[0][0] >= 10 * RATE)


class LoopsTest(unittest.TestCase):
    def test_drops_what_a_loop_leaves(self) -> None:
        w = lambda text: {"start": 0.0, "end": 0.1, "text": text}  # noqa: E731
        words = [w("පාඨක"), w("ඵ" + "ත්" * 40), w("the"), w("the"), w("the"), w("the"), w("the"), w("කට්ටිය")]
        self.assertEqual([x["text"] for x in speech.drop_loops(words)], ["පාඨක", "the", "the", "the", "කට්ටිය"])

    def test_keeps_real_speech(self) -> None:
        text = "අ.ඩො.බි. 3කට අධික වත්කම් භාවිතය අවහිර කරයි very very good".split()
        words = [{"start": i, "end": i + 0.5, "text": t} for i, t in enumerate(text)]
        self.assertEqual(speech.drop_loops(words), words)


class ModelsTest(unittest.TestCase):
    def test_sinhala_has_its_own_model(self) -> None:
        self.assertEqual(speech.model_for("si").key, "si")
        for lang in ("en", "ta", "auto"):
            self.assertEqual(speech.model_for(lang).key, "general")

    def test_ready_only_after_the_marker(self) -> None:
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {"WIPECLIP_MODELS_DIR": d}):
            model = speech.MODELS["si"]
            os.makedirs(os.path.join(d, "si"))
            self.assertFalse(speech.is_ready(model))
            open(os.path.join(d, "si", "ready"), "w").close()
            self.assertTrue(speech.is_ready(model))


class EndpointTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(main.app)
        self.headers = {"X-Local-Token": main.LOCAL_TOKEN}

    def test_refused_by_the_cloud_backend(self) -> None:
        with mock.patch.object(main, "LOCAL_MODE", False):
            res = self.client.post("/api/speech/transcribe", files={"audio": ("a.f32", b"\0" * 16)})
            self.assertEqual(res.status_code, 404)
            self.assertEqual(self.client.get("/api/speech/model").status_code, 404)

    def test_transcribes_the_samples_sent(self) -> None:
        samples = tone(1)
        seen = {}

        def fake(audio, language, progress):
            seen["audio"], seen["language"] = audio, language
            progress("transcribe", 0.5)
            return {"language": language, "words": [{"start": 0.1, "end": 0.4, "text": "hello"}]}

        with mock.patch.object(main, "LOCAL_MODE", True), mock.patch.object(speech, "transcribe", fake):
            res = self.client.post(
                "/api/speech/transcribe",
                files={"audio": ("a.f32", samples.astype("<f4").tobytes())},
                data={"language": "si", "job_id": "speech-test-0000000001"},
                headers=self.headers,
            )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["words"][0]["text"], "hello")
        self.assertEqual(seen["language"], "si")
        np.testing.assert_array_equal(seen["audio"], samples)

    def test_rejects_bad_input(self) -> None:
        with mock.patch.object(main, "LOCAL_MODE", True), mock.patch.object(speech, "transcribe", lambda *a: {}):
            for files, data in (
                ({"audio": ("a.f32", b"\0" * 7)}, {"language": "en"}),  # not whole float32s
                ({"audio": ("a.f32", b"\0" * 8)}, {"language": "../x"}),
            ):
                with self.subTest(data=data):
                    res = self.client.post("/api/speech/transcribe", files=files, data=data, headers=self.headers)
                    self.assertEqual(res.status_code, 400)

    def test_cancel_answers_409(self) -> None:
        def cancelled(audio, language, progress):
            main.progress.get("speech-test-0000000002").cancel.set()
            progress("transcribe", 0.1)
            return {}

        with mock.patch.object(main, "LOCAL_MODE", True), mock.patch.object(speech, "transcribe", cancelled):
            res = self.client.post(
                "/api/speech/transcribe",
                files={"audio": ("a.f32", tone(0.5).tobytes())},
                data={"language": "en", "job_id": "speech-test-0000000002"},
                headers=self.headers,
            )
        self.assertEqual(res.status_code, 409)

    def test_model_status(self) -> None:
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {"WIPECLIP_MODELS_DIR": d}), mock.patch.object(main, "LOCAL_MODE", True):
            res = self.client.get("/api/speech/model?language=si", headers=self.headers)
        self.assertEqual(res.json(), {"ready": False, "sizeMb": speech.MODELS["si"].size_mb})


if __name__ == "__main__":
    unittest.main()
