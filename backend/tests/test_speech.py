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


    def test_quiet_speech_is_kept_and_a_steady_hum_skipped(self) -> None:
        # Sentences peaking around 0.0007 RMS, as quiet as some real recordings.
        audio = np.concatenate([tone(4, 0.001), silence(1), tone(4, 0.001)])
        self.assertEqual(speech.speech_clips(audio, 12 * RATE), [(0, len(audio))])
        self.assertEqual(speech.speech_clips(tone(10, 0.002), 12 * RATE), [])


class CheckpointTest(unittest.TestCase):
    """pytorch_model.bin read without PyTorch, and only tensors."""

    @staticmethod
    def write(path: str, payload) -> None:
        import pickle
        import sys
        import types
        import zipfile

        storages = {}

        class Storage:
            def __init__(self, key, array):
                self.key, self.array = key, array

        def rebuild(*args):
            raise AssertionError

        rebuild.__module__, rebuild.__qualname__ = "torch._utils", "_rebuild_tensor_v2"

        class FloatStorage:
            pass

        FloatStorage.__module__, FloatStorage.__qualname__ = "torch", "FloatStorage"
        fake_torch = types.ModuleType("torch")
        fake_torch.FloatStorage = FloatStorage
        fake_utils = types.ModuleType("torch._utils")
        fake_utils._rebuild_tensor_v2 = rebuild

        class Tensor:
            def __init__(self, array):
                self.storage = Storage(str(len(storages)), array)
                storages[self.storage.key] = array

            def __reduce__(self):
                a = self.storage.array
                return rebuild, (self.storage, 0, a.shape, tuple(st // 4 for st in a.strides), False, {})

        class Pickler(pickle.Pickler):
            def persistent_id(self, obj):
                if isinstance(obj, Storage):
                    return ("storage", FloatStorage, obj.key, "cpu", obj.array.size)
                return None

        import io

        buf = io.BytesIO()
        with mock.patch.dict(sys.modules, {"torch": fake_torch, "torch._utils": fake_utils}):
            Pickler(buf, protocol=2).dump(payload(Tensor))
        with zipfile.ZipFile(path, "w") as z:
            z.writestr("archive/data.pkl", buf.getvalue())
            for key, array in storages.items():
                z.writestr(f"archive/data/{key}", array.astype("<f4").tobytes())

    def test_reads_the_tensors(self) -> None:
        import collections

        a = np.arange(6, dtype=np.float32).reshape(2, 3)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "pytorch_model.bin")
            self.write(path, lambda T: collections.OrderedDict(w=T(a), b=T(np.ones(3, np.float32))))
            out = speech._load_pytorch(speech.Path(path))
        np.testing.assert_array_equal(out["w"], a)
        np.testing.assert_array_equal(out["b"], np.ones(3))
        out["w"] *= 2  # writable: quantizing scales in place

    def test_refuses_anything_else(self) -> None:
        import pickle

        class Evil:
            def __reduce__(self):
                return (os.getcwd, ())

        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "pytorch_model.bin")
            self.write(path, lambda T: {"w": Evil()})
            with self.assertRaises(pickle.UnpicklingError):
                speech._load_pytorch(speech.Path(path))


class FetchTest(unittest.TestCase):
    def test_a_download_that_breaks_off_is_carried_on(self) -> None:
        import io

        body = bytes(range(256)) * 40
        seen = []

        class Response(io.BytesIO):
            def __init__(self, data, status, headers):
                super().__init__(data)
                self.status, self.headers = status, headers

        def urlopen(req, timeout):
            rng = req.headers.get("Range")
            seen.append(rng)
            if rng is None:  # breaks off after 1000 bytes, without an error
                return Response(body[:1000], 200, {"Content-Length": str(len(body))})
            start = int(rng.split("=")[1].rstrip("-"))
            return Response(body[start:], 206, {"Content-Range": f"bytes {start}-{len(body) - 1}/{len(body)}"})

        with tempfile.TemporaryDirectory() as d, mock.patch.object(speech.urllib.request, "urlopen", urlopen):
            dest = speech.Path(d) / "model.bin"
            got = []
            speech._fetch(speech.Download("r", "v", "model.bin", len(body)), dest, got.append)
            self.assertEqual(dest.read_bytes(), body)
        self.assertEqual(seen, [None, "bytes=1000-"])
        self.assertEqual(sum(got), len(body))


class IntegrityTest(unittest.TestCase):
    """Pinned model files are checked against the hashes their revision
    published; a damaged one is deleted, not kept."""

    def test_sha256_and_git_blob_ids(self) -> None:
        import hashlib

        body = b"model weights" * 100
        sha = hashlib.sha256(body).hexdigest()
        oid = hashlib.sha1(b"blob %d\0" % len(body) + body).hexdigest()
        with tempfile.TemporaryDirectory() as d:
            path = speech.Path(d) / "f.bin"
            for good in (speech.Download("r", "v", "f.bin", len(body), sha256=sha), speech.Download("r", "v", "f.bin", len(body), git_oid=oid)):
                path.write_bytes(body)
                speech._check_file(good, path)  # no error
                self.assertTrue(path.is_file())
            path.write_bytes(body[:-1] + b"X")
            with self.assertRaises(speech.DownloadDamaged):
                speech._check_file(speech.Download("r", "v", "f.bin", len(body), sha256=sha), path)
            self.assertFalse(path.exists())

    def test_ready_needs_every_file_at_its_size(self) -> None:
        model = speech.SpeechModel("t", (speech.Download("r", "v", "a.bin", 4, sha256="x" * 64),), converted=False)
        with tempfile.TemporaryDirectory() as d, mock.patch.object(speech, "models_dir", lambda: speech.Path(d)):
            folder = speech.Path(d) / "t"
            folder.mkdir()
            (folder / "ready").write_text("1")
            self.assertFalse(speech.is_ready(model))  # the file is missing
            (folder / "a.bin").write_bytes(b"abc")
            self.assertFalse(speech.is_ready(model))  # cut short
            (folder / "a.bin").write_bytes(b"abcd")
            self.assertTrue(speech.is_ready(model))

    def test_too_little_disk_space_is_said_before_downloading(self) -> None:
        model = speech.SpeechModel("t", (speech.Download("r", "v", "a.bin", 4_000_000_000),), converted=False)
        free = mock.Mock(free=1_000_000_000)
        with tempfile.TemporaryDirectory() as d, mock.patch.object(speech, "models_dir", lambda: speech.Path(d)), mock.patch.object(
            speech.shutil, "disk_usage", lambda p: free
        ), mock.patch.object(speech, "_fetch") as fetch:
            with self.assertRaises(speech.NotEnoughSpace) as ctx:
                speech.ensure_model(model, lambda *a: None)
        fetch.assert_not_called()
        self.assertIn("5 GB", str(ctx.exception))


class LoopsTest(unittest.TestCase):
    def test_drops_what_a_loop_leaves(self) -> None:
        w = lambda text: {"start": 0.0, "end": 0.1, "text": text}  # noqa: E731
        words = [w("පාඨක"), w("ඵ" + "ත්" * 40), w("the"), w("the"), w("the"), w("the"), w("the"), w("කට්ටිය")]
        self.assertEqual([x["text"] for x in speech.drop_loops(words)], ["පාඨක", "the", "the", "the", "කට්ටිය"])

    def test_drops_a_looped_phrase(self) -> None:
        w = lambda text: {"start": 0.0, "end": 0.1, "text": text}  # noqa: E731
        words = [w("so")] + [w(t) for _ in range(20) for t in ("For", "example,")] + [w("done")]
        self.assertEqual([x["text"] for x in speech.drop_loops(words)], ["so"] + ["For", "example,"] * 3 + ["done"])

    def test_keeps_real_speech(self) -> None:
        text = "අ.ඩො.බි. 3කට අධික වත්කම් භාවිතය අවහිර කරයි very very good".split()
        words = [{"start": i, "end": i + 0.5, "text": t} for i, t in enumerate(text)]
        self.assertEqual(speech.drop_loops(words), words)


class UnfinishedTest(unittest.TestCase):
    def test_speech_after_the_last_word_is_decoded_again(self) -> None:
        audio = tone(12)
        clips = [(0, 12 * RATE)]
        words = [{"start": 0.2, "end": 0.6, "text": "a"}, {"start": 0.7, "end": 2.4, "text": "b"}]
        rest = speech.unfinished(audio, clips, words)
        self.assertEqual(len(rest), 1)
        self.assertAlmostEqual(rest[0][0] / RATE, 2.5, places=2)
        self.assertEqual(rest[0][1], 12 * RATE)

    def test_finished_and_quiet_clips_are_left(self) -> None:
        audio = np.concatenate([tone(5), silence(5)])
        words = [{"start": 0.2, "end": 4.8, "text": "a"}]
        self.assertEqual(speech.unfinished(audio, [(0, 10 * RATE)], words), [])  # only silence after
        self.assertEqual(speech.unfinished(audio, [(0, 10 * RATE)], []), [])  # no words: not speech


class LanguageTest(unittest.TestCase):
    """Turbo can't tell Sinhala, Kannada or Telugu from Tamil; the
    languages' own models, where downloaded, settle it."""

    def detect(self, guesses, ready=("si",), own=None) -> str:
        calls = iter(guesses)
        general = mock.Mock(detect_language=lambda audio: (None, None, next(calls)))
        own = own or {}
        clips = [(i * RATE, (i + 1) * RATE) for i in range(3)]
        with (
            mock.patch.object(speech, "_whisper", lambda model, progress, gpu: general if model.key == "general" else model.key),
            mock.patch.object(speech, "is_ready", lambda model: model.key in ready),
            mock.patch.object(speech, "_confidence", lambda model, audio, clips, language: own.get(model, -0.2)),
        ):
            return speech.detect_language(tone(3), clips, lambda *a: None, False)

    def test_clear_languages_skip_the_checks(self) -> None:
        self.assertEqual(self.detect([[("en", 0.9)]], own={"si": -0.01}), "en")

    def test_the_most_confident_language_model_wins(self) -> None:
        unsure = [[("ta", 0.39)], [("ta", 0.4)], [("ta", 0.38)]]
        self.assertEqual(self.detect(unsure, ready=("si", "kn", "te"), own={"si": -0.049, "kn": -0.014, "te": -0.07}), "kn")
        self.assertEqual(self.detect(unsure, ready=("si", "kn"), own={"si": -0.024, "kn": -0.11}), "si")
        # Even when turbo is sure of its (wrong) guess.
        self.assertEqual(self.detect([[("ta", 0.89)]], own={"si": -0.02}), "si")

    def test_no_confident_model_keeps_a_sure_guess(self) -> None:
        self.assertEqual(self.detect([[("ta", 0.87)]], ready=("si", "ta"), own={"si": -0.09, "ta": -0.047}), "ta")
        self.assertEqual(self.detect([[("hi", 0.93)]], ready=()), "hi")

    def test_unsure_without_the_sinhala_model_asks_for_it(self) -> None:
        self.assertEqual(self.detect([[("ta", 0.3)], [("ta", 0.4)], [("ta", 0.3)]], ready=()), "si")

    def test_unsure_and_unchecked_is_unclear(self) -> None:
        with self.assertRaises(speech.LanguageUnclear):
            self.detect([[("ta", 0.3)], [("ta", 0.4)], [("ta", 0.3)]], ready=("si",), own={"si": -0.049})


class ModelsTest(unittest.TestCase):
    def test_some_languages_have_their_own_model(self) -> None:
        for lang in ("si", "kn", "ta", "te", "hi"):
            self.assertEqual(speech.model_for(lang).key, lang)
        for lang in ("en", "ml", "auto"):
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

        def fake(audio, language, progress, gpu, hint, accurate):
            seen["audio"], seen["language"], seen["gpu"] = audio, language, gpu
            seen["hint"], seen["accurate"] = hint, accurate
            progress("transcribe", 0.5)
            return {"language": language, "words": [{"start": 0.1, "end": 0.4, "text": "hello"}]}

        with mock.patch.object(main, "LOCAL_MODE", True), mock.patch.object(speech, "transcribe", fake):
            res = self.client.post(
                "/api/speech/transcribe",
                files={"audio": ("a.f32", samples.astype("<f4").tobytes())},
                data={"language": "si", "gpu": "true", "job_id": "speech-test-0000000001", "hint": "Ruwan, Kandy", "accurate": "true"},
                headers=self.headers,
            )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["words"][0]["text"], "hello")
        self.assertEqual(seen["language"], "si")
        self.assertTrue(seen["gpu"])
        self.assertEqual(seen["hint"], "Ruwan, Kandy")
        self.assertTrue(seen["accurate"])
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
        def cancelled(audio, language, progress, gpu, *_):
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
        gpu = {"available": True, "ready": False, "sizeMb": speech.GPU_DOWNLOAD_MB}
        with (
            tempfile.TemporaryDirectory() as d,
            mock.patch.dict(os.environ, {"WIPECLIP_MODELS_DIR": d}),
            mock.patch.object(main, "LOCAL_MODE", True),
            mock.patch.object(speech, "gpu_status", lambda: gpu),
        ):
            res = self.client.get("/api/speech/model?language=si", headers=self.headers)
        self.assertEqual(res.json(), {"ready": False, "sizeMb": speech.MODELS["si"].size_mb, "gpu": gpu, "own": True})

    def test_model_needed_answers_409(self) -> None:
        def needed(audio, language, progress, gpu, *_):
            raise speech.ModelNeeded("si", speech.MODELS["si"])

        with mock.patch.object(main, "LOCAL_MODE", True), mock.patch.object(speech, "transcribe", needed):
            res = self.client.post(
                "/api/speech/transcribe", files={"audio": ("a.f32", tone(0.5).tobytes())}, data={"language": "auto"}, headers=self.headers
            )
        self.assertEqual(res.status_code, 409)
        detail = res.json()["detail"]
        self.assertEqual((detail["code"], detail["language"]), ("model_needed", "si"))


if __name__ == "__main__":
    unittest.main()


class DecodingOptionsTest(unittest.TestCase):
    def test_greedy_without_settings(self) -> None:
        self.assertEqual(speech._decoding(speech.MODELS["general"], "", False), {})

    def test_accurate_uses_beam_search(self) -> None:
        self.assertEqual(speech._decoding(speech.MODELS["general"], "", True)["beam_size"], speech._BEAM)

    def test_hint_is_the_general_models_prompt(self) -> None:
        opts = speech._decoding(speech.MODELS["general"], "  Ruwan,\n Kandy  ", False)
        self.assertEqual(opts["initial_prompt"], "Ruwan, Kandy")

    def test_no_prompt_for_a_languages_own_model(self) -> None:
        self.assertNotIn("initial_prompt", speech._decoding(speech.MODELS["si"], "Ruwan", False))

    def test_long_hint_is_cut(self) -> None:
        opts = speech._decoding(speech.MODELS["general"], "word " * 500, False)
        self.assertLessEqual(len(opts["initial_prompt"]), speech._MAX_HINT_CHARS)
