"""Voice translation in the desktop engine (app/pipeline/dub.py): fitting
the English sentences into the original's time, the speaker sample, text
pieces, and the endpoints. The models themselves aren't downloaded here.

Run from the backend folder:  python -m unittest tests.test_dub
"""

from __future__ import annotations

import io
import json
import unittest
import wave
from unittest import mock

import numpy as np
from fastapi.testclient import TestClient

from app import main
from app.pipeline import dub

RATE = dub.RATE


def tone(seconds: float, level: float = 0.1) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    return (level * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * RATE), np.float32)


class FitTest(unittest.TestCase):
    def spoken(self, seconds: float) -> np.ndarray:
        return np.zeros(int(seconds * dub.VOICE_RATE), np.float32)

    def test_each_sentence_at_its_own_start(self) -> None:
        self.assertEqual(dub.fit([0.0, 5.0], [self.spoken(3), self.spoken(2)], 10.0), [(0.0, 1.0), (5.0, 1.0)])

    def test_a_long_one_is_sped_up_to_fit(self) -> None:
        (at, tempo), _ = dub.fit([0.0, 4.0], [self.spoken(4.8), self.spoken(1)], 10.0)
        self.assertEqual(at, 0.0)
        self.assertAlmostEqual(tempo, 1.2)

    def test_what_still_runs_over_pushes_the_next_back(self) -> None:
        first, second = dub.fit([0.0, 2.0], [self.spoken(5.2), self.spoken(1)], 10.0)
        self.assertEqual(first[1], dub.MAX_TEMPO)
        self.assertAlmostEqual(second[0], 5.2 / dub.MAX_TEMPO + 0.05)


class PiecesTest(unittest.TestCase):
    def test_short_text_is_one_piece(self) -> None:
        self.assertEqual(dub._pieces("  Hello   there. "), ["Hello there."])

    def test_long_text_is_cut_after_sentences_then_commas(self) -> None:
        text = ("This is a sentence that goes on for a while. " * 8).strip()
        pieces = dub._pieces(text)
        self.assertTrue(all(len(p) <= dub._MAX_CHARS for p in pieces))
        self.assertTrue(all(p.endswith(".") for p in pieces))
        self.assertEqual(" ".join(pieces), text)
        commas = ", ".join(["and then some more words"] * 15)
        self.assertTrue(all(len(p) <= dub._MAX_CHARS for p in dub._pieces(commas)))


class SampleTest(unittest.TestCase):
    """The voice model reads the speaker's sample: whole sentences only, at
    most 9.5 s, ending in a pause (else it says the sample's words)."""

    def setUp(self) -> None:
        patcher = mock.patch.object(dub, "_ffmpeg", lambda samples, rate, out_rate, **kw: samples)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_whole_sentences_longest_first(self) -> None:
        # Sentences of 2 s, 6 s and 3 s, with pauses between.
        voice = np.concatenate([tone(2), silence(1), tone(6), silence(1), tone(3), silence(1)])
        sample = dub.voice_sample(voice, [(0, 2), (3, 9), (10, 13)])
        seconds = len(sample) / RATE
        self.assertLessEqual(seconds, dub.SAMPLE_SECONDS + dub._TAIL + 0.5)
        self.assertGreater(seconds, 8.5)  # the 6 s one and the 3 s one, not the 2 s one
        self.assertTrue(np.all(sample[-int(0.25 * RATE) :] == 0))  # ends in silence

    def test_a_too_long_sentence_is_cut_at_a_pause(self) -> None:
        voice = np.concatenate([tone(7), silence(0.3), tone(8)])
        sample = dub.voice_sample(voice, [(0, 15.3)])
        self.assertLessEqual(len(sample) / RATE, dub.SAMPLE_SECONDS + dub._TAIL)
        self.assertAlmostEqual(len(sample) / RATE - dub._TAIL, 7.15, delta=0.2)  # cut in the 0.3 s pause


class EndpointTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(main.app)
        self.headers = {"X-Local-Token": main.LOCAL_TOKEN}

    def post(self, audio: bytes, sentences) -> object:
        return self.client.post(
            "/api/dub/render",
            files={"audio": ("a.f32", audio)},
            data={"sentences": json.dumps(sentences), "job_id": "dub-test-00000000001"},
            headers=self.headers,
        )

    def test_refused_by_the_cloud_backend(self) -> None:
        with mock.patch.object(main, "LOCAL_MODE", False):
            self.assertEqual(self.client.get("/api/dub/models").status_code, 404)
            self.assertEqual(self.post(b"\0" * 8, [{"start": 0, "end": 1, "text": "a"}]).status_code, 404)

    def test_answers_the_voice_and_background_as_three_channels(self) -> None:
        mix = np.stack([tone(2), tone(2, 0.05)])
        seen = {}

        def fake(m, sentences, progress):
            seen["mix"], seen["sentences"] = m, sentences
            progress("speak", 0.5)
            return np.full(m.shape[1], 0.25, np.float32), m

        with mock.patch.object(main, "LOCAL_MODE", True), mock.patch.object(dub, "render", fake):
            res = self.post(mix.T.astype("<f4").tobytes(), [{"start": 1.0, "end": 1.8, "text": "Two"}, {"start": 0.1, "end": 0.9, "text": "One"}])
        self.assertEqual(res.status_code, 200, res.text)
        np.testing.assert_allclose(seen["mix"], mix)
        self.assertEqual([s["text"] for s in seen["sentences"]], ["One", "Two"])  # in time order
        with wave.open(io.BytesIO(res.content)) as w:
            self.assertEqual((w.getnchannels(), w.getframerate(), w.getnframes()), (3, RATE, mix.shape[1]))
            pcm = np.frombuffer(w.readframes(w.getnframes()), "<i2").reshape(-1, 3) / 32767
        self.assertAlmostEqual(float(pcm[100, 0]), 0.25, places=3)
        np.testing.assert_allclose(pcm[:, 1], mix[0], atol=1e-4)

    def test_rejects_bad_input(self) -> None:
        with mock.patch.object(main, "LOCAL_MODE", True), mock.patch.object(dub, "render", lambda *a: None):
            good = np.zeros((2, RATE), np.float32).T.tobytes()
            for audio, sentences in (
                (b"\0" * 12, [{"start": 0, "end": 1, "text": "a"}]),  # not whole stereo frames
                (good, [{"start": 0, "end": 1}]),  # no text
                (good, [{"start": 5, "end": 6, "text": "past the end"}]),
                (good, []),
            ):
                with self.subTest(sentences=sentences):
                    self.assertEqual(self.post(audio, sentences).status_code, 400)

    def test_models_status(self) -> None:
        with mock.patch.object(main, "LOCAL_MODE", True), mock.patch.object(dub.speech, "is_ready", lambda m: m.key == "separator"):
            res = self.client.get("/api/dub/models", headers=self.headers)
        self.assertEqual(res.json(), {"ready": False, "sizeMb": dub.VOICE.size_mb + dub.TRANSLATOR.size_mb})

    def test_an_empty_translation_says_so(self) -> None:
        def nothing(*_):
            raise dub.NothingToSay()

        with mock.patch.object(main, "LOCAL_MODE", True), mock.patch.object(dub, "render", nothing):
            res = self.post(np.zeros((2, RATE), np.float32).T.tobytes(), [{"start": 0, "end": 1, "text": "a"}])
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()["detail"]["code"], "nothing_to_say")


if __name__ == "__main__":
    unittest.main()
