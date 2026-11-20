"""The European speech model's decoding (app/pipeline/parakeet.py) on
stand-in graphs, and how speech.py routes European languages to it."""

import unittest
from unittest import mock

import numpy as np

from app.pipeline import parakeet, speech

BLANK = 5  # vocab: 0-4 tokens, 5 blank; then 5 durations (0-4 frames)


class FakeDecoder:
    """Answers (token, frames to move) from a script, one per call, and
    records which state and previous token each call was given."""

    def __init__(self, script):
        self.script, self.calls = list(script), []

    def get_inputs(self):
        return [None, None, None, mock.Mock(shape=[2, "b", 3])]

    def run(self, _, feed):
        token, step = self.script.pop(0)
        self.calls.append((int(feed["targets"][0][0]), float(feed["input_states_1"][0, 0, 0])))
        out = np.full(11, -9.0, np.float32)
        out[token] = 1.0
        out[6 + step] = 1.0
        state = np.full((2, 1, 3), len(self.calls), np.float32)
        return [out, None, state, state]


def model(script, frames: int) -> parakeet.Parakeet:
    m = parakeet.Parakeet.__new__(parakeet.Parakeet)
    m.vocab = {0: "<unk>", 1: " Bon", 2: "jour", 3: " à", 4: " tous", 5: "<blk>"}
    m.blank, m.size, m.state = BLANK, 6, (2, 1, 3)
    m.decoder = FakeDecoder(script)
    m.features = mock.Mock(run=lambda _, feed: [np.zeros((1, 128, 10), np.float32), np.array([10])])
    m.encoder = mock.Mock(run=lambda _, feed: [np.zeros((1, 1024, frames), np.float32), np.array([frames])])
    return m


class DecodeTest(unittest.TestCase):
    def test_tokens_durations_and_words(self) -> None:
        # frame 0: " Bon" (stay), "jour" (move 2); frame 2: blank (move 1);
        # frame 3: " à" (move 1); frame 4: " tous" (move 1): done at 5.
        m = model([(1, 0), (2, 2), (BLANK, 1), (3, 1), (4, 1)], frames=5)
        words = m.words(np.zeros(16000, np.float32))
        self.assertEqual([w["text"] for w in words], ["Bonjour", "à", "tous"])
        self.assertEqual([(round(w["start"], 2), round(w["end"], 2)) for w in words], [(0.0, 0.08), (0.24, 0.32), (0.32, 0.4)])
        # Each call is given the last token (blank at first) and the state
        # of the last call that made a token - a blank doesn't move it.
        self.assertEqual([c[0] for c in m.decoder.calls], [BLANK, 1, 2, 2, 3])
        self.assertEqual([c[1] for c in m.decoder.calls], [0, 1, 2, 2, 4])

    def test_at_most_ten_tokens_per_frame(self) -> None:
        m = model([(1, 0)] * 10 + [(BLANK, 1)], frames=2)
        tokens, times = m._decode(np.zeros((2, 1024), np.float32), 2, lambda: None)
        self.assertEqual(len(tokens), 10)
        self.assertEqual(times, [0] * 10)  # then frame 1 gave a blank

    def test_too_short_audio(self) -> None:
        self.assertEqual(model([], frames=0).words(np.zeros(800, np.float32)), [])


class RoutingTest(unittest.TestCase):
    def test_european_languages_use_it(self) -> None:
        for lang in speech.EUROPEAN:
            self.assertIs(speech.model_for(lang), speech.EUROPE)
        self.assertIs(speech.model_for("si"), speech.MODELS["si"])
        self.assertTrue(speech.EUROPEAN <= parakeet.LANGUAGES)

    def test_transcribes_in_long_clips_with_audio_times(self) -> None:
        rate = speech.RATE
        audio = np.zeros(70 * rate, np.float32)
        seen = []

        class Fake:
            def words(self, clip):
                seen.append(len(clip) / rate)
                return [{"start": 0.5, "end": 0.9, "text": "Bonjour"}]

        lang = sorted(speech.EUROPEAN)[0]
        with mock.patch.object(speech, "speech_clips", lambda a, length: [(0, length), (length, 2 * length)]), mock.patch.object(speech, "_parakeet", lambda p: Fake()):
            out = speech._transcribe(audio, lang, lambda *a: None, gpu=False)
        self.assertEqual(seen, [speech._EUROPE_CLIP_SECONDS, speech._EUROPE_CLIP_SECONDS])
        self.assertEqual([w["start"] for w in out["words"]], [0.5, speech._EUROPE_CLIP_SECONDS + 0.5])
        self.assertEqual(out["language"], lang)


if __name__ == "__main__":
    unittest.main()
