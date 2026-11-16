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


class ScheduleTest(unittest.TestCase):
    def test_each_sentence_at_its_own_start(self) -> None:
        self.assertEqual(dub.schedule([0.0, 5.0], [3, 2], 10.0), ([(0.0, 1.0), (5.0, 1.0)], 0.0))

    def test_a_long_one_is_sped_up_to_fit(self) -> None:
        ((at, tempo), _), over = dub.schedule([0.0, 4.0], [4.8, 1], 10.0)
        self.assertEqual(at, 0.0)
        self.assertAlmostEqual(tempo, 4.8 / (4.0 - dub._GAP))  # ends a moment before the next starts
        self.assertEqual(over, 0.0)

    def test_what_still_runs_over_pushes_the_next_back(self) -> None:
        (first, second), _ = dub.schedule([0.0, 2.0], [5.2, 1], 10.0)
        self.assertEqual(first[1], dub.MAX_TEMPO)
        self.assertAlmostEqual(second[0], 5.2 / dub.MAX_TEMPO + dub._GAP)

    def test_a_late_one_catches_up_on_the_next(self) -> None:
        # The first runs 1 s over its slot even sped up; the second is sped up
        # so the third still starts on time.
        places, _ = dub.schedule([0.0, 3.0, 8.0], [5.2, 4.0, 1.0], 12.0)
        self.assertEqual(places[2], (8.0, 1.0))

    def test_the_end_moves_earlier_into_silence_instead_of_being_cut(self) -> None:
        # 4 s of speech starting at 8.5 s in a 10 s video: sped up and moved
        # back into the silence after the first sentence.
        places, over = dub.schedule([0.0, 8.5], [3.0, 4.0], 10.0)
        at, tempo = places[1]
        self.assertEqual(over, 0.0)
        self.assertEqual(tempo, dub.MAX_TEMPO)
        self.assertAlmostEqual(at + 4.0 / tempo, 10.0)
        self.assertGreaterEqual(at, 3.0)

    def test_earlier_sentences_make_room_at_the_end(self) -> None:
        places, over = dub.schedule([0.0, 4.0, 8.0], [3.0, 3.0, 4.0], 10.0)
        self.assertEqual(over, 0.0)
        ends = [a + l / t for (a, t), l in zip(places, [3.0, 3.0, 4.0])]
        self.assertLessEqual(ends[-1], 10.0 + 1e-9)
        self.assertTrue(all(ends[i] <= places[i + 1][0] for i in range(2)))  # no overlap

    def test_what_cannot_fit_is_reported(self) -> None:
        places, over = dub.schedule([0.0], [20.0], 10.0)
        self.assertEqual(places, [(0.0, dub.MAX_TEMPO)])
        self.assertAlmostEqual(over, 20.0 / dub.MAX_TEMPO - 10.0)


class LoudnessTest(unittest.TestCase):
    def test_speech_level_ignores_pauses(self) -> None:
        a = np.concatenate([tone(1, 0.1), silence(3)])
        self.assertAlmostEqual(dub.active_rms(a, RATE), 0.1 / np.sqrt(2), places=3)

    def test_a_badly_separated_sentence_is_not_made_near_silent(self) -> None:
        levels = dub.sentence_levels([0.1, 0.1, 0.005, 0.1, 0.1])
        self.assertGreaterEqual(20 * np.log10(levels[2] / 0.1), -dub._BELOW_DB - 1e-6)

    def test_neighbours_differ_by_at_most_three_db(self) -> None:
        levels = dub.sentence_levels([0.05, 0.2, 0.05, 0.0, 0.2])
        steps = [abs(20 * np.log10(b / a)) for a, b in zip(levels, levels[1:])]
        self.assertTrue(all(s <= dub._STEP_DB + 1e-6 for s in steps), steps)

    def test_no_voice_at_all_gets_a_default_level(self) -> None:
        self.assertEqual(len(set(dub.sentence_levels([0.0, 0.0]))), 1)


class TextTest(unittest.TestCase):
    def test_source_cleanup_is_light(self) -> None:
        self.assertEqual(dub.normalize_source("බිලියන 6 .35 ක්"), "බිලියන 6.35 ක්")
        self.assertEqual(dub.normalize_source("a� b"), "a b")
        self.assertEqual(dub.normalize_source("ok ok ok ok fine"), "ok fine")
        self.assertEqual(dub.normalize_source("very very good"), "very very good")  # twice is speech
        self.assertEqual(dub.normalize_source("go to it go to it go to it now"), "go to it now")

    def test_english_spacing_and_entities(self) -> None:
        self.assertEqual(dub.clean_english("There &apos;s no shock , which means they do n't ."), "There's no shock, which means they don't.")
        self.assertEqual(dub.clean_english("( a ) &quot;b&quot;"), '(a) "b"')

    def test_checks(self) -> None:
        ratio = (0.5, 2.5)
        self.assertEqual(dub.check_translation("ලොව 6.35 digital", "The world lost 6.35 in digital.", ratio), [])
        self.assertEqual(dub.check_translation("a b c d", "  ", ratio), ["empty"])
        self.assertIn("number", dub.check_translation("ලොව 6.35 ක්", "The world.", ratio))
        self.assertIn("term", dub.check_translation("laptop එකක්", "A computer.", ratio))
        self.assertEqual(dub.check_translation("dollar බිලියන 182.8", "$182.8 billion.", ratio), [])  # a symbol for the word
        self.assertEqual(dub.check_translation("laptops දෙකක්", "Two laptop computers.", ratio), [])
        self.assertIn("untranslated", dub.check_translation("ලොව විශාලතම", "ලොව විශාලතම", ratio))
        self.assertIn("repeated", dub.check_translation("a b c d e", "the cat sat the cat sat the cat sat", (0.1, 9)))
        self.assertIn("short", dub.check_translation("a b c d e f g h i j", "One.", ratio))
        self.assertIn("long", dub.check_translation("a b c d", " ".join(["word"] * 3 + ["x", "y", "z", "w", "v", "u", "t", "s"]), ratio))
        self.assertIn("glossary", dub.check_translation("WipeClip එක", "WipeClip app.", ratio, [{"source": "එක", "target": "one"}]))

    def test_only_suspicious_translations_are_tried_again(self) -> None:
        calls = []

        class FakeModel:
            def translate_batch(self, tokens, beam_size, **kw):
                calls.append((len(tokens), beam_size))
                out = []
                for t in tokens:
                    text = "".join(t).replace("<2en>", "").strip()
                    word = "" if text == "හිස්" and beam_size == dub._BEAM else "Fine words here."
                    out.append(mock.Mock(hypotheses=[[word]]))
                return out

        class FakeTokenizer:
            def encode(self, text):
                return mock.Mock(tokens=[text])

            def token_to_id(self, t):
                return t

            def decode(self, ids, skip_special_tokens=True):
                return "".join(ids)

        with mock.patch.object(dub, "_load_translator", lambda: (FakeModel(), FakeTokenizer())):
            res = dub.translate(["හොඳයි", "හිස්"], lambda v: None)
        self.assertEqual([r.text for r in res], ["Fine words here.", "Fine words here."])
        self.assertTrue(res[1].retried and not res[0].retried)
        self.assertEqual(calls, [(2, dub._BEAM), (1, dub._RETRY_BEAM)])

    def test_context_reads_the_sentence_before_and_keeps_its_english(self) -> None:
        seen = []

        class FakeModel:
            def translate_batch(self, tokens, beam_size, target_prefix=None, **kw):
                seen.append((tokens, target_prefix))
                out = []
                for k, t in enumerate(tokens):
                    pre = (target_prefix or [None] * len(tokens))[k] or []
                    src = t[0].replace("<2en> ", "")
                    english = {"පළමු": ["First", "one."], "දෙවන": ["Second", "one."], "පළමු දෙවන": ["First", "one.", "Then", "the", "second."]}[src]
                    out.append(mock.Mock(hypotheses=[english if not pre else pre + english[len(pre) :]]))
                return out

        tokenizer = mock.Mock(encode=lambda text: mock.Mock(tokens=[text]), token_to_id=lambda t: t, decode=lambda ids, skip_special_tokens=True: " ".join(ids))
        with mock.patch.object(dub, "_load_translator", lambda: (FakeModel(), tokenizer)):
            res = dub.translate(["පළමු", "දෙවන"], lambda v: None, context=[None, 0], retry=False)
        self.assertEqual([r.text for r in res], ["First one.", "Then the second."])
        tokens, prefix = seen[1]
        self.assertEqual(tokens, [["<2en> පළමු දෙවන"]])
        self.assertEqual(prefix, [["First", "one."]])  # the first sentence's English, as it came


class EmbeddingTest(unittest.TestCase):
    """The voice model's embedding takes its text table or its speech-token
    table by the last id it's given (seen in its ONNX export): a text's ids,
    ending in end-of-text, must go in whole, and speech ids as one-token rows."""

    class FakeEmbed:
        def __init__(self) -> None:
            self.calls = []

        def run(self, _names, feed):
            ids = feed["input_ids"]
            self.calls.append(ids.shape)
            out = np.zeros(ids.shape + (4,), np.float32)
            for r in range(ids.shape[0]):
                text = ids[r, -1] >= 6563
                if not text and ids[r].max() >= 6563:
                    raise RuntimeError("indices element out of data bounds")
                out[r, :, 0] = ids[r] + (100000 if text else 0)
            return [out]

    def voice(self) -> dub.Voice:
        v = dub.Voice.__new__(dub.Voice)
        v.embed = self.FakeEmbed()
        v.tokenizer = mock.Mock(encode=lambda text: mock.Mock(ids=[4366, 17745, 13, 50256, 50256]))
        v._vectors = {}
        return v

    def test_text_goes_in_whole(self) -> None:
        v = self.voice()
        np.testing.assert_array_equal(v._text("Some molecules.")[:, 0], np.array([4366, 17745, 13, 50256, 50256]) + 100000)

    def test_speech_tokens_are_kept_once_worked_out(self) -> None:
        v = self.voice()
        np.testing.assert_array_equal(v._speech([12, 5, 12])[:, 0], [12, 5, 12])
        v._speech([5, 12])
        self.assertEqual(v.embed.calls, [(2, 1)])  # one run, for the two new ids


class KeptSessionsTest(unittest.TestCase):
    """The voice and separator sessions stay loaded between jobs only while
    memory allows, and a timer lets them go."""

    def setUp(self) -> None:
        dub.release_sessions()
        self.loads = []
        patches = [
            mock.patch.object(dub, "_session", lambda path, threads: self.loads.append(str(path)) or object()),
            mock.patch.object(dub, "_KEEP_SECONDS", 0.05),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(dub.release_sessions)

    def test_reused_while_kept(self) -> None:
        with mock.patch.object(dub, "available_memory", lambda: 8 << 30):
            a = dub._kept_session("m.onnx", 4)
            dub._keep()
            self.assertIs(dub._kept_session("m.onnx", 4), a)  # the next job, within the time
        self.assertEqual(self.loads, ["m.onnx"])

    def test_let_go_after_the_time(self) -> None:
        import time

        with mock.patch.object(dub, "available_memory", lambda: 8 << 30):
            dub._kept_session("m.onnx", 4)
            dub._keep()
            time.sleep(0.3)
            dub._kept_session("m.onnx", 4)
        self.assertEqual(len(self.loads), 2)

    def test_let_go_at_once_when_memory_is_short(self) -> None:
        with mock.patch.object(dub, "available_memory", lambda: 1 << 30):
            dub._kept_session("m.onnx", 4)
            dub._keep()
            dub._kept_session("m.onnx", 4)
        self.assertEqual(len(self.loads), 2)


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

    def test_halves_cut_near_the_middle_at_a_boundary(self) -> None:
        self.assertEqual(dub._halves("One two three. Four five six."), ["One two three.", "Four five six."])
        self.assertEqual(dub._halves("one, two three four five six"), ["one, two three", "four five six"])
        self.assertEqual(dub._halves("word"), ["word"])

    def test_speech_length_check(self) -> None:
        text = "x" * 180  # about 10 s of speech
        self.assertFalse(dub._bad_length(text, 9.0))
        self.assertTrue(dub._bad_length(text, 3.0))  # words missing
        self.assertTrue(dub._bad_length(text, 40.0))  # babbling
        self.assertFalse(dub._bad_length("Hi.", 0.2))  # too short to judge missing words
        self.assertTrue(dub._bad_length("A", 2.8))  # but not babbling (a cut-off word, seen)

    def test_babble_is_cut_at_a_pause(self) -> None:
        r = dub.VOICE_RATE
        t = np.arange(r) / r
        word = (0.2 * np.sin(2 * np.pi * 200 * t)).astype(np.float32)
        wav = np.concatenate([word, np.zeros(r // 5, np.float32), word, word])  # 3.2 s, a pause at 1.0-1.2 s
        cut = dub._trim(wav, 1.5)
        self.assertLessEqual(len(cut), int(1.5 * r))
        self.assertAlmostEqual(len(cut) / r, 1.1, delta=0.1)  # in the pause
        self.assertEqual(float(cut[-1]), 0.0)
        self.assertIs(dub._trim(wav, 5.0), wav)


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
        sample, seconds_used = dub.voice_sample(voice, [(0, 2), (3, 9), (10, 13)])
        self.assertAlmostEqual(seconds_used, len(sample) / RATE - dub._TAIL, places=2)
        seconds = len(sample) / RATE
        self.assertLessEqual(seconds, dub.SAMPLE_SECONDS + dub._TAIL + 0.5)
        self.assertGreater(seconds, 8.5)  # the 6 s one and the 3 s one, not the 2 s one
        self.assertTrue(np.all(sample[-int(0.25 * RATE) :] == 0))  # ends in silence

    def test_a_too_long_sentence_is_cut_at_a_pause(self) -> None:
        voice = np.concatenate([tone(7), silence(0.3), tone(8)])
        sample, _ = dub.voice_sample(voice, [(0, 15.3)])
        self.assertLessEqual(len(sample) / RATE, dub.SAMPLE_SECONDS + dub._TAIL)
        self.assertAlmostEqual(len(sample) / RATE - dub._TAIL, 7.15, delta=0.2)  # cut in the 0.3 s pause

    def test_noisy_sentences_are_left_out_when_there_are_clear_ones(self) -> None:
        # Three 3 s sentences; the longest-first choice would take the 4 s
        # one, but music under it is as loud as the voice.
        voice = np.concatenate([tone(4), silence(1), tone(3), silence(1), tone(3), silence(1)])
        background = np.concatenate([tone(4, 0.1), silence(9)])
        sample, used = dub.voice_sample(voice, [(0, 4), (5, 8), (9, 12)], background)
        # The two clear 3 s ones (each edge moved to the pause nearby) and a gap.
        self.assertGreater(used, 5.5)
        self.assertLess(used, 7.5)
        noisy, _ = dub.voice_sample(voice, [(0, 4), (5, 8), (9, 12)])
        self.assertGreater(len(noisy), len(sample))  # without the background: longest first, as before

    def test_too_little_clear_speech_falls_back_to_all(self) -> None:
        voice = np.concatenate([tone(3), silence(1), tone(3), silence(1)])
        background = np.concatenate([tone(3, 0.1), silence(1), silence(4)])
        _, used = dub.voice_sample(voice, [(0, 3), (4, 7)], background)
        self.assertGreater(used, 5.5)


class EndpointTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(main.app)
        self.headers = {"X-Local-Token": main.LOCAL_TOKEN}

    def post(self, audio: bytes, sentences, **extra) -> object:
        return self.client.post(
            "/api/dub/render",
            files={"audio": ("a.f32", audio)},
            data={"sentences": json.dumps(sentences), "job_id": "dub-test-00000000001", **extra},
            headers=self.headers,
        )

    @staticmethod
    def report(**over) -> dict:
        return {"sentences": 2, "spoken": 2, "empty": [], "flagged": [], "shortSpeech": [], "spedUp": 0, "overflowSeconds": 0.0, "sampleSeconds": 9.0, **over}

    def test_refused_by_the_cloud_backend(self) -> None:
        with mock.patch.object(main, "LOCAL_MODE", False):
            self.assertEqual(self.client.get("/api/dub/models").status_code, 404)
            self.assertEqual(self.post(b"\0" * 8, [{"start": 0, "end": 1, "text": "a"}]).status_code, 404)

    def test_answers_the_voice_and_background_as_three_channels(self) -> None:
        mix = np.stack([tone(2), tone(2, 0.05)])
        seen = {}

        def fake(m, sentences, progress, language=None, glossary=None):
            seen["mix"], seen["sentences"], seen["language"] = m, sentences, language
            progress("speak", 0.5)
            return np.full(m.shape[1], 0.25, np.float32), m, self.report()

        with mock.patch.object(main, "LOCAL_MODE", True), mock.patch.object(dub, "render", fake):
            res = self.post(mix.T.astype("<f4").tobytes(), [{"start": 1.0, "end": 1.8, "text": "Two"}, {"start": 0.1, "end": 0.9, "text": "One"}], language="si")
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(seen["language"], "si")
        self.assertEqual(json.loads(res.headers["X-Dub-Report"])["spoken"], 2)
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

    def test_report_counts_sentences_as_the_editor_sent_them(self) -> None:
        # Sent out of time order, with one past the end that's dropped: the
        # engine's numbers (time order, valid only) are mapped back.
        def fake(m, sentences, progress, language=None, glossary=None):
            self.assertEqual([s["text"] for s in sentences], ["first", "second"])
            return np.zeros(m.shape[1], np.float32), m, self.report(empty=[0], flagged=[{"index": 1, "flags": ["number"]}], shortSpeech=[1])

        sent = [{"start": 1.0, "end": 1.5, "text": "second"}, {"start": 9, "end": 10, "text": "past the end"}, {"start": 0.1, "end": 0.5, "text": "first"}]
        with mock.patch.object(main, "LOCAL_MODE", True), mock.patch.object(dub, "render", fake):
            res = self.post(np.zeros((2, 2 * RATE), np.float32).T.tobytes(), sent)
        report = json.loads(res.headers["X-Dub-Report"])
        self.assertEqual(report["sentences"], 3)
        self.assertEqual(report["empty"], [2])
        self.assertEqual(report["flagged"], [{"index": 0, "flags": ["number"]}])
        self.assertEqual(report["shortSpeech"], [0])

    def test_unsupported_language_and_glossary(self) -> None:
        seen = {}

        def fake(m, sentences, progress, language=None, glossary=None):
            seen["glossary"] = glossary
            return np.zeros(m.shape[1], np.float32), m, self.report()

        audio = np.zeros((2, RATE), np.float32).T.tobytes()
        with mock.patch.object(main, "LOCAL_MODE", True), mock.patch.object(dub, "render", fake):
            self.assertEqual(self.post(audio, [{"start": 0, "end": 1, "text": "a"}], language="fr").status_code, 400)
            res = self.post(audio, [{"start": 0, "end": 1, "text": "a"}], glossary=json.dumps([{"source": "ලංකා", "target": "Lanka"}]))
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(seen["glossary"], [{"source": "ලංකා", "target": "Lanka"}])

    def test_a_failing_model_says_which_step(self) -> None:
        def broken(m, sentences, progress, language=None, glossary=None):
            progress("separate", 0.2)
            raise RuntimeError("onnxruntime: bad allocation")

        with mock.patch.object(main, "LOCAL_MODE", True), mock.patch.object(dub, "render", broken), mock.patch("traceback.print_exc"):
            res = self.post(np.zeros((2, RATE), np.float32).T.tobytes(), [{"start": 0, "end": 1, "text": "a"}])
        self.assertEqual(res.status_code, 500)
        self.assertIn("separating the voice", res.json()["detail"]["message"])

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
