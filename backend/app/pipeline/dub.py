"""Voice translation for the desktop app: the speech of a video said again in
English, in the speaker's own voice, over the video's own background sound.
Runs entirely in the engine on the user's machine, the translation of the
transcript's text included. Design notes and measurements:
docs/desktop/DUB.md; benchmark: bench/dub_bench.py.

Three models (the voice one of two), downloaded once after the editor asks,
into WIPECLIP_MODELS_DIR, each file pinned to a revision and checked against
its published hash:

- translator: Google's MADLAD-400 3B MT (Apache-2.0), as CTranslate2 int8.
  Text from Sinhala, Tamil, Hindi, Kannada or Telugu to English, one
  transcript sentence at a time. Each translation is checked (empty, left in
  the source script, repeated, unusually short or long, a number or a
  Latin-script term lost) and only the suspicious ones are tried again with
  a wider beam.
- separator: Meta's HT-Demucs (fine-tuned) vocals model (MIT), as ONNX. It
  takes the voice out; the background is what's left (voice + background =
  the mix, exactly).
- voice, one of two (VOICES), English speech in the voice of a ~10 s sample:
  - "accurate": Resemble AI's Chatterbox Turbo (MIT), as ONNX. Its
    language model in full precision, the rest 4-bit (all-4-bit dropped and
    changed words; 8-bit ran ten times slower on an i7-9750H). 1.7 GB.
  - "fast": Kyutai's Pocket TTS (weights CC-BY-4.0), as ONNX. 212 MB, about
    ten times faster, the same words; less close to the speaker.
  The editor offers the one recommended_voice() picks for the machine.

The translator runs on CTranslate2, the others on onnxruntime with numpy;
resampling and tempo changes go through the bundled ffmpeg. Nothing is
uploaded.
"""

from __future__ import annotations

import html
import os
import re
import subprocess
import sys
import threading
import unicodedata
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from . import numbers, speech
from .speech import Download, Progress, SpeechModel

RATE = 44100  # what the separator takes, and what's handed back
VOICE_RATE = 24000  # what the voice model takes and makes

_DEMUCS = ("StemSplitio/htdemucs-ft-vocals-onnx", "2ef0d757d3e226d0da85fb8c71514f464fcabdd0")
_CHATTERBOX = ("ResembleAI/chatterbox-turbo-ONNX", "d21799bd0354adb85e348b8a0442a8405110a2cf")
_MADLAD = ("Nextcloud-AI/madlad400-3b-mt-ct2-int8", "aa32bbdeba7880eff2096ec044cb155a340a9400")

# sha256 of each Git LFS file, git blob ids of the small ones (the repos'
# own records at these revisions).
SEPARATOR = SpeechModel(
    "separator",
    (Download(*_DEMUCS, "htdemucs_ft_vocals_fp16weights.onnx", 165_612_636, sha256="0cbe651f535415c9d26a7bb614f7d322dd5a080fa0298f2e50f478030a994dce"),),
    converted=False,
)
VOICE = SpeechModel(
    "voice",
    (
        Download(*_CHATTERBOX, "tokenizer.json", 3_562_272, git_oid="60a713d7e79174874affd0c1d07e28feeb34da92"),
        Download(*_CHATTERBOX, "onnx/language_model.onnx", 207_266, sha256="c12e31df78c74f9589b165c8d51e65171f5028b77b7fedb41900f55f7f410dc8"),
        Download(*_CHATTERBOX, "onnx/language_model.onnx_data", 1_269_724_812, sha256="67db106868f5354b2e425651f1791aef36ae3e6f00ac5e1d91e32c985cad6b39"),
        Download(*_CHATTERBOX, "onnx/speech_encoder_q4.onnx", 1_200_346, sha256="37956c20b67bed85a0da4bc83509d67b5969a1b257d1c546516a5236a17ad71e"),
        Download(*_CHATTERBOX, "onnx/speech_encoder_q4.onnx_data", 229_560_112, sha256="58956db217c6443e49c91bdd54d7cf76b4a243f225c748b7bf746459fc27bc7d"),
        Download(*_CHATTERBOX, "onnx/embed_tokens_q4.onnx", 2_844, sha256="fd6ba1d22902e8f539d3dd6d7c1c44b98ebb4c84ebbb5e47fcb826ddcf667561"),
        Download(*_CHATTERBOX, "onnx/embed_tokens_q4.onnx_data", 37_286_384, sha256="f54a51e234b509b64c3a03bb79e1149fba7e2eba6c2d9c222f18883379e1f5d8"),
        Download(*_CHATTERBOX, "onnx/conditional_decoder_q4.onnx", 2_179_022, sha256="dccb7a6cea3472dc7f7d070eeb70ade18e6327fb4ec61a3d62cf211bfed90ea2"),
        Download(*_CHATTERBOX, "onnx/conditional_decoder_q4.onnx_data", 246_397_384, sha256="b5c5317e0b79a1a19dd3d5e2b2091ea06b15716716ab801a54eaeb906c6971ec"),
    ),
    converted=False,
)
TRANSLATOR = SpeechModel(
    "translator",
    (
        Download(*_MADLAD, "config.json", 224, git_oid="582af3144634f98327a9c4c4187fd7aa034d7c7f"),
        Download(*_MADLAD, "shared_vocabulary.json", 5_477_099, git_oid="2a0954b3566298446fcd39a117e8a3a860bf525a"),
        Download(*_MADLAD, "tokenizer.json", 16_629_031, sha256="a2799ccc696b752ba00c34f58726bfe253a04921ceb6cfc620400f560474790b"),
        Download(*_MADLAD, "model.bin", 2_950_208_329, sha256="77b9fd9ab97c1259d07089b5f854393dad81bc5fb5647d3f9a5d101c94f40daa"),
    ),
    converted=False,
)
_POCKET = ("stephvax/pocket-tts-onnx", "9dd58b75ba672bb75df1c62a493f6db7c80de6d1")
# The fast voice: Kyutai's Pocket TTS (weights CC-BY-4.0; ONNX conversion
# made with PocketTTS.cpp), one model per language it speaks. English is the
# 6-layer 2026-10 model (212 MB); the others are 24-layer (440 MB each).
# Per file: (size, sha256 of a Git LFS file or git blob id of a small one).
_POCKET_FILES = {
    "en": ("english_2026-10", {
        "bundle.json": (680, "09d63efaf06e27e28aaf76d8c352590f241ef2a1"),
        "tokenizer.model": (59_339, "d461765ae179566678c93091c5fa6f2984c31bbe990bf1aa62d92c64d91bc3f6"),
        "bos_before_voice.npy": (4_224, "ba091d858b647e7a1d7e57f3436ecbb03d97bb250fdeae61368d4cd1b6f3d5ea"),
        "text_conditioner.onnx": (16_388_310, "3573df3fe6d0b1e72588ed5b021ab11514e67a4432c20a2bea783170260f5020"),
        "mimi_encoder.onnx": (39_269_324, "27a8ae66061b389bab09f18083005c2e4d5be6f4eaa34c8db8988f52fd6acc55"),
        "flow_lm_main_int8.onnx": (75_865_936, "2a14cf05cac01461aa596229a05bda4378b135004048ef1ec1db728b4d1ab958"),
        "flow_lm_flow.onnx": (39_081_891, "91f757089899345b548ed9d99bcf07988fe544cf4e9466a85d9ff4a0fbfd0489"),
        "mimi_decoder.onnx": (41_422_037, "4fb0145caba7e554419426a68535e3b411c1ed0e182057186770c924d71ad4d1"),
    }),
    "fr": ("french_24l", {
        "bundle.json": (979, "9b3f4a4610b9c0fb1a01d52eb15fb2ac4223a150"),
        "tokenizer.model": (60_690, "dd8dc8cfad3c4b3711a8629ede27d5be934eb98bcb00462bf91ed40fb8f6f38a"),
        "bos_before_voice.npy": (4_224, "6090fda20037a969d94aadfead53d29cf7bdb088365f548dfd4715f046a4441b"),
        "text_conditioner.onnx": (16_388_310, "d5bcb347e0dfde1a7a196b18e6640b71505a0717f2ce5167b3d6f9744ab85d4a"),
        "mimi_encoder.onnx": (39_261_982, "4165b6a1b83ca22f73f2f82433dac5bb3cb4b78e49da95f1a4f139c3d9ce2aae"),
        "flow_lm_main_int8.onnx": (303_347_168, "30c9c88bc82e7d69c09400c6c8f0c9fc80c7dfc1b7acc401a38f61075e12e549"),
        "flow_lm_flow.onnx": (39_081_891, "75c829d567a0195e1fd66367af1652b03a991411db257bec64fef5a63ea9b126"),
        "mimi_decoder.onnx": (41_414_681, "dc65d4f0a1fa2ff2b9892efbce1f277222886a889ba73780ee180ccdb4c00d85"),
    }),
    "de": ("german_24l", {
        "bundle.json": (1_003, "1623b960b7c74e34cb717a89a0151f3ae371e872"),
        "tokenizer.model": (60_347, "b3d6fb751a0bbc0b18df78687a03c11e4f2fbb0fa4b8f85e83064cd9d80ee34b"),
        "bos_before_voice.npy": (4_224, "39694b2b0fe32e4a1f61190b2b0630f4cbcd5065c37078132765166bc783966d"),
        "text_conditioner.onnx": (16_388_310, "73140539231ef523105d5d3ea7f008c0d1863ee195eae53199281b4350d9c4a9"),
        "mimi_encoder.onnx": (39_269_324, "b4fcaeab1c4c41793a58825098d5f34e958d128ef4cbdd151bef0f579ecbf3a4"),
        "flow_lm_main_int8.onnx": (303_347_168, "769378926449ba8dc8a797e4d1e2478c306d1e9cad8323e2d4721d5902a8f639"),
        "flow_lm_flow.onnx": (39_081_891, "8cc94022cb47d3bc1dde7e2c002a40bbc158daefec2e12fb4116a1ea4bc8d3c3"),
        "mimi_decoder.onnx": (41_422_037, "f4d0a2d56bb2956ae19ae492b4dbda7cf6c1f4c306f3cff1c9614285e4efdbfd"),
    }),
    "es": ("spanish_24l", {
        "bundle.json": (1_023, "ead01ce82f3a7a9c5279b5bea8cb119a54245430"),
        "tokenizer.model": (61_063, "9714c8ce180d8147ab4c1406cd759619828f95d7000c87c41dc9ccec527a3e89"),
        "bos_before_voice.npy": (4_224, "c99a5035f90cd31d3e16cbbc51ed101c67a237a15002ccc59326bb21f1bc1b25"),
        "text_conditioner.onnx": (16_388_310, "f082f15f915e3ab948c2e092a9ea4b5ee22e036b375566bc91d2c28903ec7764"),
        "mimi_encoder.onnx": (39_269_324, "c0bb4491187c0c6314aa6a8c6ab734106a7aba4257e3bef81c1a10f3e4063641"),
        "flow_lm_main_int8.onnx": (303_347_168, "b751f3a068fe8255bb060efcd5afd53be8ad11e6f4a72b80686ab42068b6558b"),
        "flow_lm_flow.onnx": (39_081_891, "4722755c7aad8bf4ba6ce4edca6956db3d2d8bcb8412527031ddb4a14bab958a"),
        "mimi_decoder.onnx": (41_422_037, "43805c76c0366e052ac1036427ee0ead58f80b398c91a47859b232ad3a779cd6"),
    }),
    "it": ("italian_24l", {
        "bundle.json": (987, "58568efd7c7d71495d8662dc0892d1cd0358ccd6"),
        "tokenizer.model": (60_905, "1ef32ed65d0264239fb9d9ecb36a089a637f6e6c5c5a1a8e7df37ce486ec21da"),
        "bos_before_voice.npy": (4_224, "e8daccbcd0783e66684ff51e9cc20928704408aa1b7261de16815cbaffde3444"),
        "text_conditioner.onnx": (16_388_310, "ec34e6160521f8e72b10b820018a1262a9ec78eb8cbf3f87871035936aab5bc6"),
        "mimi_encoder.onnx": (39_269_324, "da2fb72ad85db311c21316d416d516297853c025c8ff0abdc26e007d633c2600"),
        "flow_lm_main_int8.onnx": (303_347_168, "7ed90dafce36b4d0553dcdf749f30356a67b85418b16e13b3a512400a3a2e2af"),
        "flow_lm_flow.onnx": (39_081_891, "8b4668cfe0f97801083dd6c3cbf7ede88a95ecfd377ab6f7247c89613f8b875b"),
        "mimi_decoder.onnx": (41_422_037, "6b203a81b4150a27e7689d0d7bf9a2a808ae3eabbf8c2a0d9e2ad9afed3041bb"),
    }),
}  # fmt: skip


def _pocket(lang: str) -> SpeechModel:
    folder, files = _POCKET_FILES[lang]
    return SpeechModel(
        "voice-fast" if lang == "en" else f"voice-fast-{lang}",
        tuple(
            Download(*_POCKET, f"onnx/{folder}/{name}", size, **{"git_oid" if len(digest) == 40 else "sha256": digest})
            for name, (size, digest) in files.items()
        ),
        converted=False,
    )


def pocket_dir(lang: str) -> str:
    """The fast voice's folder for `lang` inside its model folder."""
    return f"onnx/{_POCKET_FILES[lang][0]}/"


FAST_VOICES = {lang: _pocket(lang) for lang in _POCKET_FILES}
FAST_VOICE = FAST_VOICES["en"]
# The voices the editor can pick, by the languages they speak: "accurate"
# (Chatterbox Turbo, English only) or "fast" (every target).
VOICES: dict[str, dict[str, SpeechModel]] = {"accurate": {"en": VOICE}, "fast": FAST_VOICES}
# The languages the transcript can be translated from (the editor's
# DUB_FROM), and into (DUB_TO). The European ones are written in Latin script.
EUROPEAN = {"en", "fr", "de", "es", "it"}
FROM_LANGUAGES = {"si", "ta", "hi", "kn", "te"} | EUROPEAN
TO_LANGUAGES = set(FAST_VOICES)


def _models(voice: str, target: str = "en") -> tuple[SpeechModel, ...]:
    return (TRANSLATOR, SEPARATOR, VOICES[voice][target])


def voice_for(voice: str | None, target: str) -> str:
    """`voice` if it speaks `target`, else the recommended one if it does,
    else the fast one (which speaks every target)."""
    for v in (voice, recommended_voice()):
        if v in VOICES and target in VOICES[v]:
            return v
    return "fast"


def recommended_voice() -> str:
    """The voice to offer first on this machine: see _ACCURATE_NEEDS."""
    memory = total_memory()
    if memory is not None and memory < _ACCURATE_NEEDS[0]:
        return "fast"
    if speech._cpu_threads() < _ACCURATE_NEEDS[1]:
        return "fast"
    return "accurate"


def models_status(voice: str | None = None, target: str = "en") -> dict:
    """Whether the models for `voice` (default: the recommended one) saying
    `target` are here and what's left to download, and the same for each
    voice that speaks `target`."""
    target = target if target in TO_LANGUAGES else "en"
    voice = voice_for(voice, target)

    def status(v: str) -> dict:
        ms = _models(v, target)
        return {"ready": all(speech.is_ready(m) for m in ms), "sizeMb": sum(m.size_mb for m in ms if not speech.is_ready(m))}

    return {
        **status(voice),
        "voice": voice,
        "target": target,
        "recommended": voice_for(None, target),
        "voices": {v: status(v) for v in VOICES if target in VOICES[v]},
    }


def _download_all(progress: Progress, voice: str = "accurate", target: str = "en") -> None:
    """Every model `voice` needs to say `target`, with one download progress
    across them."""
    missing = [m for m in _models(voice, target) if not speech.is_ready(m)]
    total = sum(m.size_mb for m in missing) or 1
    done = 0
    for m in missing:
        speech.ensure_model(m, lambda stage, v, m=m, done=done: progress(stage, (done + v * m.size_mb) / total))
        done += m.size_mb


# The accurate voice is offered first with 12 GB of memory installed and 6
# physical cores; otherwise the fast one is. On an i7-9750H (6 cores) the
# accurate voice speaks at 3.6x real time and the fast one at 0.35x, so a
# 49 s video took 206 s against 88 s in all (docs/desktop/DUB.md). Peak
# memory is the same (5.3 GB, the translator), but the accurate voice's
# sessions hold 2.2 GB while kept.
_ACCURATE_NEEDS = (12 << 30, 6)


def _session(path, threads: int):
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = threads
    return ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])


# --- Sessions kept between jobs ----------------------------------------------
#
# Loading the voice model's four parts and the separator took 14-32 s a job
# in the benchmark. They're kept for _KEEP_SECONDS after a job when the
# machine has memory to spare (they hold about 2 GB), and released by a timer
# - or at once when memory is short, or before the ~3 GB translator loads
# into too little. The translator itself is never kept.

_KEEP_SECONDS = 300.0
_KEEP_MIN_FREE = 4 << 30  # RAM that must still be free to keep them
_TRANSLATOR_ROOM = 5 << 30  # RAM wanted free before the translator loads
_kept: dict = {}
_kept_lock = threading.Lock()
_release_timer: threading.Timer | None = None


def available_memory() -> int | None:
    """Physical memory free now, in bytes, or None if it can't be told."""
    return _memory(total=False)


def total_memory() -> int | None:
    """Physical memory installed, in bytes, or None if it can't be told."""
    return _memory(total=True)


def _memory(total: bool) -> int | None:
    if sys.platform == "win32":
        import ctypes

        class _Status(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong)] + [
                (n, ctypes.c_ulonglong)
                for n in ("ullTotalPhys", "ullAvailPhys", "ullTotalPageFile", "ullAvailPageFile", "ullTotalVirtual", "ullAvailVirtual", "ullAvailExtendedVirtual")
            ]

        st = _Status()
        st.dwLength = ctypes.sizeof(st)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st)):
            return None
        return int(st.ullTotalPhys if total else st.ullAvailPhys)
    try:
        return os.sysconf("SC_PHYS_PAGES" if total else "SC_AVPHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")
    except (ValueError, OSError, AttributeError):
        return None


def _kept_session(path, threads: int):
    """The session for `path`, loaded once and kept (see _keep)."""
    global _release_timer
    key = (str(path), threads)
    with _kept_lock:
        if _release_timer is not None:
            _release_timer.cancel()
            _release_timer = None
        if key not in _kept:
            _kept[key] = _session(path, threads)
        return _kept[key]


def _keep() -> None:
    """After a job: keep the sessions for _KEEP_SECONDS if memory allows,
    else release them now."""
    global _release_timer
    free = available_memory()
    with _kept_lock:
        if _release_timer is not None:
            _release_timer.cancel()
            _release_timer = None
        if not _kept:
            return
        if free is None or free < _KEEP_MIN_FREE:
            _kept.clear()
            return
        _release_timer = threading.Timer(_KEEP_SECONDS, release_sessions)
        _release_timer.daemon = True
        _release_timer.start()


def release_sessions() -> None:
    """Drop the kept sessions (a job still running keeps its own)."""
    global _release_timer
    with _kept_lock:
        if _release_timer is not None:
            _release_timer.cancel()
            _release_timer = None
        _kept.clear()


# --- translation: the transcript's sentences in English ---------------------

_TRANSLATE_BATCH = 8
_BEAM = 2
_RETRY_BEAM = 4
# English words per source word, outside which a translation is checked
# again. MADLAD's own output on 40 FLORES-200 devtest sentences per language
# (bench/dub_bench.py translate) ran from si 0.79-1.39, hi 0.46-1.02,
# kn 0.87-1.60, ta 0.95-1.76, te 0.76-1.52 (1st-99th percentile); each
# range widened by a quarter below and 30% above.
_WORD_RATIO = {"si": (0.59, 1.81), "hi": (0.35, 1.33), "kn": (0.65, 2.08), "ta": (0.71, 2.29), "te": (0.57, 1.98)}
_ANY_RATIO = (0.35, 2.29)
# The same for European pairs (source, target), from MADLAD's output on 40
# FLORES-200 devtest sentences per pair (bench/dub_bench.py translate,
# retries off; chrF++ 53.5-72.1, docs/desktop/DUB.md), each range widened
# as above. Other European pairs: the widest of these.
_PAIR_RATIO: dict[tuple[str, str], tuple[float, float]] = {
    ("fr", "en"): (0.49, 1.39), ("en", "fr"): (0.68, 1.89), ("de", "en"): (0.58, 1.60), ("en", "de"): (0.56, 1.57),
    ("es", "en"): (0.52, 1.30), ("en", "es"): (0.61, 1.98), ("it", "en"): (0.54, 1.40), ("en", "it"): (0.64, 1.90),
    ("fr", "de"): (0.45, 1.44), ("de", "fr"): (0.64, 1.81), ("fr", "es"): (0.49, 1.47), ("es", "fr"): (0.56, 1.89),
    ("fr", "it"): (0.52, 1.42), ("it", "fr"): (0.62, 1.53),
}  # fmt: skip
_EUROPEAN_RATIO = (0.45, 1.98)
# Beam 2, retries at beam 4 (FLORES-200, 40 sentences x 5 languages, chrF++
# against the human English): beam 1 scored 59.6 in 0.76 of the time, beam
# 2 60.0 (with retries 60.2), beam 4 60.6 in 1.4 times the time; reading
# each sentence with the one before (`context`) 60.4 but Sinhala 0.7 lower,
# in 2.7 times the time - so it's off.


class NothingToSay(Exception):
    """Every sentence translated to nothing."""


@dataclass
class Translation:
    text: str
    flags: list[str] = field(default_factory=list)  # what still looks wrong (check_translation)
    retried: bool = False


def normalize_source(text: str) -> str:
    """What the translator is given for one transcript sentence; the
    transcript itself is unchanged. Undecodable and control characters
    removed, numbers split by recognition joined ("6 .35" -> "6.35"), and a
    word or phrase said three or more times in a row (a speech model's loop)
    said once."""
    t = "".join(ch for ch in text if ch != "�" and (unicodedata.category(ch)[0] != "C" or ch in "‌‍"))
    t = re.sub(r"(\d)\s*([.,])\s+(\d)|(\d)\s+([.,])\s*(\d)", lambda m: "".join(x for x in m.groups() if x), t)
    words = t.split()
    for n in (1, 2, 3, 4):
        out, i = [], 0
        while i < len(words):
            gram, j, reps = words[i : i + n], i + n, 1
            while len(gram) == n and words[j : j + n] == gram:
                reps, j = reps + 1, j + n
            if reps >= 3:
                out += gram
                i = j
            else:
                out.append(words[i])
                i += 1
        words = out
    return " ".join(words)


def clean_english(text: str) -> str:
    """MADLAD writes some of its English the way its training text was
    tokenized: "&apos;s", "nuclei ,", "do n't". Said by the voice model as
    written, so put back as plain English."""
    return clean_output(text, "en")


def clean_output(text: str, target: str) -> str:
    """A translation as plain text: entities decoded, no space before
    punctuation or inside brackets; in English, contractions joined ("do
    n't"); in French and Italian, elisions ("l' homme")."""
    t = html.unescape(html.unescape(text))
    t = re.sub(r"\s+([.,!?;:%)\]}])", r"\1", t)
    t = re.sub(r"([(\[{])\s+", r"\1", t)
    if target == "en":
        t = re.sub(r"(\w)\s+'(s|re|ve|ll|d|m|t)\b", r"\1'\2", t)
        t = re.sub(r"(\w)\s+n't\b", r"\1n't", t)
    elif target in ("fr", "it"):
        t = re.sub(r"\b(\w{1,5})\s*['’]\s+(?=\w)", r"\1'", t)
    return " ".join(t.split())


_NUM = re.compile(r"\d+(?:[.,]\d+)*")
_LATIN_WORD = re.compile(r"(?<![A-Za-z])[A-Za-z][A-Za-z0-9+#_.-]*[A-Za-z0-9+#]")


def check_translation(src: str, out: str, ratio: tuple[float, float], glossary: list[dict] | None = None, latin_source: bool = False) -> list[str]:
    """What looks wrong with one translation, from evidence in the two
    texts: "empty"; "encoding" (an undecodable character); "untranslated"
    (over a fifth of its letters not Latin; from a Latin-script source
    (`latin_source`), 80% of its words, of 5 or more, the source's own);
    "repeated" (a phrase three times, or a word four times in a row);
    "short"/"long" (words per source word outside `ratio`, for sources of 4
    words or more); "number" (a number in the source missing); "term" (from
    a non-Latin source only: a Latin-script word of 3+ letters in the source
    missing); "glossary" (a glossary entry whose source term is in the
    sentence, without its translation)."""
    o = out.strip()
    if not o:
        return ["empty"]
    flags = []
    if "�" in o:
        flags.append("encoding")
    if latin_source:
        own, said = set(re.findall(r"\w+", src.lower())), re.findall(r"\w+", o.lower())
        if len(said) >= 5 and sum(1 for w in said if w in own) / len(said) >= 0.8:
            flags.append("untranslated")
    else:
        letters = [ch for ch in o if ch.isalpha()]
        if letters and sum(1 for ch in letters if not _is_latin(ch)) / len(letters) > 0.2:
            flags.append("untranslated")
    words = re.findall(r"\w+", o.lower())
    grams = [tuple(words[i : i + 3]) for i in range(len(words) - 2)]
    if any(c >= 3 for c in _counts(grams)) or re.search(r"\b(\w+)(\W+\1\b){3,}", o.lower()):
        flags.append("repeated")
    n_src = len(src.split())
    if n_src >= 4:
        r = len(o.split()) / n_src
        if r < ratio[0]:
            flags.append("short")
        elif r > ratio[1]:
            flags.append("long")
    have = {re.sub(r"[.,]", "", x) for x in _NUM.findall(o)}
    if any(re.sub(r"[.,]", "", x) not in have for x in _NUM.findall(src)):
        flags.append("number")
    low = o.lower()
    if not latin_source and any(len(w) >= 3 and not _term_kept(w, low) for w in _LATIN_WORD.findall(src)):
        flags.append("term")
    for g in glossary or ():
        if g.get("source") and g.get("target") and g["source"].lower() in src.lower() and g["target"].lower() not in low:
            flags.append("glossary")
            break
    return flags


# English words a translation may write as a symbol instead ("dollar
# බිලියන 182.8" -> "$182.8 billion", seen).
_TERM_SYMBOLS = {"dollar": ("$",), "rupee": ("rs", "₹"), "euro": ("€",), "pound": ("£",), "percent": ("%",), "yen": ("¥",)}


def _term_kept(word: str, english: str) -> bool:
    """Whether the Latin-script `word` of a source sentence is in its
    `english` (lower case): as written, singular or plural, or as its
    symbol."""
    w = word.lower()
    stem = w[:-1] if w.endswith("s") and len(w) > 3 else w
    return w in english or stem in english or any(sym in english for sym in _TERM_SYMBOLS.get(stem, ()))


def _is_latin(ch: str) -> bool:
    return ("a" <= ch.lower() <= "z") or unicodedata.name(ch, "").startswith("LATIN")


def _counts(items) -> list[int]:
    seen: dict = {}
    for x in items:
        seen[x] = seen.get(x, 0) + 1
    return list(seen.values())


def _load_translator():
    """(CTranslate2 translator, its tokenizer): ~3 GB, loaded per job."""
    import ctranslate2
    from tokenizers import Tokenizer

    path = speech.ensure_model(TRANSLATOR, lambda *_: None)
    free = available_memory()
    if free is not None and free < _TRANSLATOR_ROOM:
        release_sessions()  # kept from the last job: room for this one first
    tokenizer = Tokenizer.from_file(str(path / "tokenizer.json"))
    return ctranslate2.Translator(str(path), device="cpu", compute_type="int8", intra_threads=speech._cpu_threads()), tokenizer


def translate(
    texts: list[str],
    progress: Callable[[float], None],
    language: str | None = None,
    glossary: list[dict] | None = None,
    beam: int = _BEAM,
    batch: int = _TRANSLATE_BATCH,
    retry: bool = True,
    context: list[int | None] | None = None,
    loaded: Callable[[], None] = lambda: None,
    target: str = "en",
) -> list[Translation]:
    """Each text in `target` (English by default), same order, by
    MADLAD-400 on the CPU. The source language needs no tag: the model tells
    it from the text (`language` sets what counts as an unusual length). Translations that
    look wrong (check_translation) are tried again with a wider beam and a
    stronger repetition penalty; the attempt with fewer problems is kept,
    the first one on a tie.

    `context`: for each text, the index of the sentence before it to read
    it with, or None. That sentence and this one are translated together,
    with the earlier one's English given as the start of the output
    (CTranslate2's target prefix), so only this sentence's English is new -
    and it is kept unless it looks worse than the one translated alone."""
    model, tokenizer = _load_translator()
    loaded()
    ratio = _WORD_RATIO.get(language or "", _ANY_RATIO) if target == "en" else _ANY_RATIO
    latin = language in EUROPEAN
    ratio = _PAIR_RATIO.get((language or "", target)) or (_EUROPEAN_RATIO if latin else ratio)
    sources = [normalize_source(t) for t in texts]
    steps = 2 if context else 1

    def run(items: list[tuple[str, list[str] | None]], beam_size: int, penalty: float, ngram: int, done: Callable[[int], None]) -> list[tuple[str, list[str]]]:
        """(English, its tokens) of each (source, target prefix tokens)."""
        out = []
        for i in range(0, len(items), batch):
            part = items[i : i + batch]
            tokens = [tokenizer.encode(f"<2{target}> " + t).tokens for t, _ in part]
            prefixes = [pre for _, pre in part]
            results = model.translate_batch(
                tokens,
                target_prefix=prefixes if any(prefixes) else None,
                beam_size=beam_size,
                max_decoding_length=256 + max((len(pre or []) for pre in prefixes), default=0),
                repetition_penalty=penalty,
                no_repeat_ngram_size=ngram,
            )
            for (_, pre), r in zip(part, results):
                hyp = r.hypotheses[0][len(pre or []) :]
                ids = [tokenizer.token_to_id(t) for t in hyp]
                out.append((clean_output(tokenizer.decode([x for x in ids if x is not None], skip_special_tokens=True), target), hyp))
            done(i + len(part))
        return out

    def better(i: int, text: str) -> bool:
        flags = check_translation(sources[i], text, ratio, glossary, latin)
        if len(flags) < len(res[i].flags) or (prefer_new and len(flags) == len(res[i].flags)):
            res[i] = Translation(text, flags, res[i].retried)
            return True
        return False

    try:
        todo = [i for i, s in enumerate(sources) if s]
        first = run([(sources[i], None) for i in todo], beam, 1.1, 4, lambda n: progress(0.9 / steps * n / max(1, len(todo))))
        res = [Translation("", ["empty"]) for _ in sources]
        tokens: list[list[str]] = [[] for _ in sources]
        for i, (text, toks) in zip(todo, first):
            res[i] = Translation(text, check_translation(sources[i], text, ratio, glossary, latin))
            tokens[i] = toks
        if context:
            # Both sentences together stay well inside what the model reads.
            pairs = [(i, j) for i, j in enumerate(context) if j is not None and sources[i] and res[j].text and len(sources[j]) + len(sources[i]) < 600]
            if pairs:
                with_context = run([(sources[j] + " " + sources[i], tokens[j]) for i, j in pairs], beam, 1.1, 4, lambda n: progress(0.45 + 0.45 * n / len(pairs)))
                prefer_new = True
                for (i, _), (text, _) in zip(pairs, with_context):
                    better(i, text)
        again = [i for i, t in enumerate(res) if t.flags and sources[i]] if retry else []
        if again:
            second = run([(sources[i], None) for i in again], _RETRY_BEAM, 1.2, 3, lambda n: progress(0.9 + 0.1 * n / len(again)))
            prefer_new = False
            for i, (text, _) in zip(again, second):
                better(i, text)
                res[i].retried = True
    finally:
        del model  # ~3 GB: gone before the voice models load
    progress(1.0)
    return res


# --- ffmpeg: resampling and tempo -------------------------------------------


def _ffmpeg(samples: np.ndarray, rate: int, out_rate: int, channels: int = 1, tempo: float = 1.0) -> np.ndarray:
    """float32 samples (channels interleaved) at `rate` as float32 at
    `out_rate`, `tempo` times as fast with the pitch kept (atempo)."""
    import imageio_ffmpeg

    filters = [f"atempo={tempo:.4f}"] if abs(tempo - 1) > 1e-3 else []
    filters.append(f"aresample={out_rate}:resampler=soxr" if _has_soxr() else f"aresample={out_rate}")
    cmd = [
        imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-f", "f32le", "-ar", str(rate), "-ac", str(channels), "-i", "pipe:0",
        "-af", ",".join(filters), "-f", "f32le", "-ar", str(out_rate), "-ac", str(channels), "pipe:1",
    ]  # fmt: skip
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    out = subprocess.run(cmd, input=np.ascontiguousarray(samples, "<f4").tobytes(), capture_output=True, check=True, creationflags=flags)
    return np.frombuffer(out.stdout, "<f4").copy()


_soxr: bool | None = None


def _has_soxr() -> bool:
    global _soxr
    if _soxr is None:
        import imageio_ffmpeg

        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        res = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-buildconf"], capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=flags)
        _soxr = "--enable-libsoxr" in res.stdout
    return _soxr


# --- Taking the voice out ----------------------------------------------------

_CHUNK = int(7.8 * RATE)  # the separator's fixed input length
# An eighth of each chunk overlaps the next (a quarter until 2.0): 21% less
# separating, and on a speech-over-music test the background was as close to
# the true music at the chunk joins as elsewhere (-11.6 dB error there,
# -8.7 dB between; a quarter: -8.0 and -8.6) and overall 0.2 dB closer.
_OVERLAP = 8


def separate(mix: np.ndarray, progress: Callable[[float], None]) -> np.ndarray:
    """The voice in `mix` (2, n) at 44.1 kHz, the same shape: the model's
    vocals output, chunk by chunk with an eighth overlapping, cross-faded."""
    session = _kept_session(speech._model_path(SEPARATOR) / SEPARATOR.files[0].name, speech._cpu_threads())
    total = mix.shape[1]
    overlap = _CHUNK // _OVERLAP
    stride = _CHUNK - overlap
    fade = np.linspace(0, 1, overlap, dtype=np.float32)
    window = np.ones(_CHUNK, np.float32)
    window[:overlap], window[-overlap:] = fade, fade[::-1]
    voice = np.zeros_like(mix)
    weight = np.zeros(total, np.float32)
    try:
        for start in range(0, total, stride):
            end = min(start + _CHUNK, total)
            n = end - start
            chunk = np.pad(mix[:, start:end], ((0, 0), (0, _CHUNK - n)))
            stems = session.run(["stems"], {"mix": chunk[None].astype(np.float32)})[0][0]
            voice[:, start:end] += stems[3, :, :n] * window[:n]  # drums, bass, other, vocals
            weight[start:end] += window[:n]
            progress(end / total)
            if end == total:
                break
    finally:
        _keep()  # on its own (background removal) the session is let go later too
    return voice / np.maximum(weight, 1e-8)


# --- The speaker's voice -----------------------------------------------------

# The voice model's encoder takes at most 10 s (a 10.8 s sample made it
# babble instead of reading the text). The sample must also end in a pause:
# one cut mid-word made it carry on saying the sample's own (Sinhala) words.
SAMPLE_SECONDS = 9.5
_TAIL = 0.3  # silence after the sample
_CLEAR_DB = 10.0  # voice this far over the background in a sentence: clear
_CLEAR_ENOUGH = 4.0  # seconds of clear sentences that make a sample on their own


def voice_sample(voice: np.ndarray, spans: list[tuple[float, float]], background: np.ndarray | None = None) -> tuple[np.ndarray, float]:
    """Up to 9.5 s of the speaker at the voice model's rate, and how many
    seconds of speech that is: whole sentences of the separated voice (mono,
    44.1 kHz), longest first - whole sentences sound most like the speaker.
    With `background` (mono): only sentences where the voice is clear of it
    (10 dB over it) and the recording isn't clipped, when there are 4 s of
    those. A first sentence longer than 9.5 s is cut at its quietest moment
    before that."""
    gap = np.zeros(int(0.15 * RATE), np.float32)
    total = len(voice) / RATE
    # Word timings can end before the word does: each edge moved to the
    # nearest pause.
    spans = [(_quietest(voice, max(0.0, a - 0.4), a + 0.2), _quietest(voice, b - 0.2, min(total, b + 0.6))) for a, b in spans]
    spans = [(a, b) for a, b in spans if b - a >= 0.8]
    if background is not None and spans:
        clear = []
        for a, b in spans:
            v, g = voice[int(a * RATE) : int(b * RATE)], background[int(a * RATE) : int(b * RATE)]
            level = 20 * np.log10(max(active_rms(v, RATE), 1e-9) / max(float(np.sqrt(np.mean(g**2))) if len(g) else 0.0, 1e-9))
            clipped = float(np.mean(np.abs(v + g) > 0.98)) if len(v) else 0.0
            if level >= _CLEAR_DB and clipped < 1e-3:
                clear.append((a, b))
        if sum(min(b - a, SAMPLE_SECONDS) for a, b in clear) >= _CLEAR_ENOUGH:
            spans = clear
    parts, have = [], 0.0
    for a, b in sorted(spans, key=lambda s: s[0] - s[1]):
        length = b - a
        if length > SAMPLE_SECONDS - have:
            if parts:
                continue
            b = _quietest(voice, a + SAMPLE_SECONDS * 0.6, a + SAMPLE_SECONDS)
            length = b - a
        parts += [voice[int(a * RATE) : int(b * RATE)], gap]
        have += length + 0.15
        if have >= SAMPLE_SECONDS - 0.8:
            break
    if not parts:  # no sentence times: the loudest stretch, cut at pauses
        n = int(SAMPLE_SECONDS * RATE)
        start = int(np.argmax(np.convolve(voice**2, np.ones(RATE), "same")[: max(1, len(voice) - n)])) if len(voice) > n else 0
        a = start / RATE
        parts = [voice[start : int(_quietest(voice, a + SAMPLE_SECONDS * 0.6, a + SAMPLE_SECONDS) * RATE)], gap]
    sample = np.concatenate(parts[:-1])
    seconds = len(sample) / RATE
    sample = np.concatenate([sample, np.zeros(int(_TAIL * RATE), np.float32)])
    return _ffmpeg(sample, RATE, VOICE_RATE), seconds


def _quietest(voice: np.ndarray, a: float, b: float) -> float:
    """The time of the quietest 100 ms in a..b seconds of `voice`."""
    frame = RATE // 10
    lo, hi = int(a * RATE), min(len(voice), int(b * RATE))
    if hi - lo < frame:
        return b
    levels = [float(np.mean(voice[i : i + frame] ** 2)) for i in range(lo, hi - frame, frame)]
    return (lo + int(np.argmin(levels)) * frame + frame // 2) / RATE


_START, _STOP, _SILENCE = 6561, 6562, 4299
_REPETITION_PENALTY = 1.2
# Longer text is said in pieces. 160 (240 until 2.0): on six long FLORES
# sentences (180-330 characters) the voice left out 11.3% of the words with
# pieces of up to 240, 1.0% with 160 or 120, and 160 was the fastest (179 s
# against 254 s at 240 and 191 s at 120).
_MAX_CHARS = 160
# Texts decoded together. 1: this export of the language model doesn't honour
# its attention mask - padding a shorter text changed its first logits by up
# to 5 and, decoded in batches of 2-8, made 4-7 of 8 texts come out different
# (up to 16 s longer). Rows of one length batch exactly; texts rarely do.
_VOICE_BATCH = 1
_LM_THREADS = 4
# The voice says about 18 characters of English a second (measured on the
# FLEURS and Sinhala cases); speech under 0.55 of that is missing words,
# over 2.5 times it (plus 1.5 s) is babbling.
_CHARS_PER_SECOND = 18.0


def _expected_seconds(text: str) -> float:
    return len(text) / _CHARS_PER_SECOND


def _longest(text: str) -> float:
    """The most seconds `text` can take before it's babbling."""
    return 2.5 * _expected_seconds(text) + 1.5


def _bad_length(text: str, seconds: float) -> bool:
    """Too short to hold all its words (texts of 20+ characters: shorter
    ones vary too much to judge), or babbling - checked for any text: a lone
    "A" (from a word cut off at the end of the video) came out as 2.8 s of
    noise."""
    return (len(text) >= 20 and seconds < 0.55 * _expected_seconds(text)) or seconds > _longest(text)


def _trim(wav: np.ndarray, seconds: float) -> np.ndarray:
    """`wav` (24 kHz) cut to at most `seconds`, at its quietest 100 ms in
    the last 30% of that."""
    n = int(seconds * VOICE_RATE)
    if len(wav) <= n:
        return wav
    frame = VOICE_RATE // 10
    lo = int(0.7 * n)
    levels = [float(np.mean(wav[i : i + frame] ** 2)) for i in range(lo, n - frame, frame)]
    cut = lo + int(np.argmin(levels)) * frame + frame // 2 if levels else n
    fade = min(cut, VOICE_RATE // 50)
    out = wav[:cut].copy()
    out[cut - fade :] *= np.linspace(1, 0, fade, dtype=np.float32)
    return out


class _Speaker:
    """What both voices share: texts said in pieces, checked for length and
    said again in halves. A voice gives `_speak`: texts (a batch of
    _VOICE_BATCH at most) to waveforms at VOICE_RATE."""

    def _speak(self, texts: list[str], cancelled: Callable[[], None]) -> list[np.ndarray]:
        raise NotImplementedError

    def say(self, text: str, cancelled: Callable[[], None]) -> np.ndarray:
        """`text` spoken, at 24 kHz."""
        return self.say_all([text], cancelled)[0][0]

    def say_all(self, texts: list[str], cancelled: Callable[[], None], progress: Callable[[float], None] = lambda v: None) -> tuple[list[np.ndarray], list[int]]:
        """Each text spoken at 24 kHz, and the indices of those that still
        came out too short or too long after one retry (in two halves); what
        is still too long is cut at a pause.
        Texts over _MAX_CHARS are said in pieces; pieces are decoded
        _VOICE_BATCH at a time, those of similar length together."""
        pieces = [(i, p) for i, t in enumerate(texts) for p in _pieces(t)]
        order = sorted(range(len(pieces)), key=lambda k: len(pieces[k][1]))
        wavs: list[np.ndarray | None] = [None] * len(pieces)
        done = 0
        for g in range(0, len(order), _VOICE_BATCH):
            group = order[g : g + _VOICE_BATCH]
            for k, wav in zip(group, self._speak([pieces[k][1] for k in group], cancelled)):
                wavs[k] = wav
            done += sum(len(pieces[k][1]) for k in group)
            progress(done / max(1, sum(len(p) for _, p in pieces)))
        bad = set()
        for k, (i, text) in enumerate(pieces):
            if not _bad_length(text, len(wavs[k]) / VOICE_RATE):
                continue
            halves = _halves(text)
            if len(halves) == 2:
                # Each on its own: decoded together they'd be padded (_VOICE_BATCH).
                again = [self._speak([t], cancelled)[0] for t in halves]
                gap = np.zeros(int(0.12 * VOICE_RATE), np.float32)
                joined = np.concatenate([again[0], gap, again[1]])
                if not _bad_length(text, len(joined) / VOICE_RATE) or abs(len(joined) / VOICE_RATE - _expected_seconds(text)) < abs(len(wavs[k]) / VOICE_RATE - _expected_seconds(text)):
                    wavs[k] = joined
            if _bad_length(text, len(wavs[k]) / VOICE_RATE):
                bad.add(i)
                wavs[k] = _trim(wavs[k], _longest(text))  # a babbling tail cut off at a pause
        gap = np.zeros(int(0.12 * VOICE_RATE), np.float32)
        out = []
        for i in range(len(texts)):
            mine = [wavs[k] for k, (j, _) in enumerate(pieces) if j == i]
            out.append(np.concatenate([x for w in mine for x in (w, gap)][:-1]) if mine else np.zeros(0, np.float32))
        return out, sorted(bad)


class Voice(_Speaker):
    """The accurate voice (Chatterbox Turbo), conditioned once on a speaker
    sample."""

    def __init__(self, sample: np.ndarray, target: str = "en") -> None:
        if target != "en":
            raise ValueError("the accurate voice speaks English only")
        from tokenizers import Tokenizer

        path = speech._model_path(VOICE)
        threads = speech._cpu_threads()
        self.encoder = _kept_session(path / "onnx/speech_encoder_q4.onnx", threads)
        self.embed = _kept_session(path / "onnx/embed_tokens_q4.onnx", threads)
        # The language model is bound by memory speed, not cores: 4 threads
        # spoke as fast as 6 (10.8 and 10.7 tokens/s, the same tokens, on an
        # i7-9750H), and leave the editor two cores.
        self.lm = _kept_session(path / "onnx/language_model.onnx", min(threads, _LM_THREADS))
        self.decoder = _kept_session(path / "onnx/conditional_decoder_q4.onnx", threads)
        self.tokenizer = Tokenizer.from_file(str(path / "tokenizer.json"))
        self.cond, self.prompt, self.speaker, self.features = self.encoder.run(None, {"audio_values": sample[None].astype(np.float32)})
        self._kv = {i.name: (np.float16 if i.type == "tensor(float16)" else np.float32) for i in self.lm.get_inputs() if "past_key_values" in i.name}
        self._vectors: dict[int, np.ndarray] = {}

    def _text(self, text: str) -> np.ndarray:
        """The embeddings of `text`'s tokens (n, 1024). The embedding model
        holds a text table and a speech-token table and takes the one its
        input's last id belongs to; a text's ids end in the tokenizer's
        end-of-text, so they're embedded whole, in one run, as they come."""
        return self.embed.run(None, {"input_ids": np.array([self.tokenizer.encode(text).ids], np.int64)})[0][0]

    def _speech(self, ids: list[int]) -> np.ndarray:
        """The embeddings of speech tokens `ids` (n, 1024). Each id's vector
        is the same wherever it stands, so each is worked out once - as a
        batch of one-token rows, which the model reads as speech tokens -
        and kept."""
        missing = sorted({i for i in ids if i not in self._vectors})
        if missing:
            vectors = self.embed.run(None, {"input_ids": np.array(missing, np.int64)[:, None]})[0][:, 0]
            self._vectors.update(zip(missing, vectors))
        return np.stack([self._vectors[i] for i in ids])

    def _speak(self, texts: list[str], cancelled: Callable[[], None]) -> list[np.ndarray]:
        return [self._wave(tokens) for tokens in self._tokens(texts, cancelled)]

    def _tokens(self, texts: list[str], cancelled: Callable[[], None]) -> list[list[int]]:
        """Speech tokens for each text, decoded together: greedy, with the
        repetition penalty of the model card, until the stop token or three
        times a slow reading of the text. Each row is left-padded and masked,
        with its own positions, so it reads what it would alone."""
        rows = [np.concatenate([self.cond[0], self._text(t)]) for t in texts]
        n, width = max(len(r) for r in rows), rows[0].shape[1]
        embeds = np.zeros((len(rows), n, width), np.float32)
        mask = np.zeros((len(rows), n), np.int64)
        pos = np.zeros((len(rows), n), np.int64)
        for b, r in enumerate(rows):
            embeds[b, n - len(r) :] = r
            mask[b, n - len(r) :] = 1
            pos[b, n - len(r) :] = np.arange(len(r))
        past = {k: np.zeros([len(rows), 16, 0, 64], t) for k, t in self._kv.items()}
        # Speech tokens come 25 a second; a runaway is cut at three times a
        # slow reading of the text.
        limits = [int(25 * (3 + 0.25 * len(t.split()) * 3)) for t in texts]
        tokens = [[_START] for _ in texts]
        live = list(range(len(texts)))
        for step in range(max(limits)):
            cancelled()
            logits, *present = self.lm.run(None, dict(inputs_embeds=embeds, attention_mask=mask, position_ids=pos, **past))
            keep, chosen = [], []
            for row, i in enumerate(live):
                lg = logits[row, -1].copy()
                seen = np.unique(tokens[i])
                s = lg[seen]
                lg[seen] = np.where(s < 0, s * _REPETITION_PENALTY, s / _REPETITION_PENALTY)
                token = int(np.argmax(lg))
                if token == _STOP:
                    continue
                tokens[i].append(token)
                if step + 1 < limits[i]:
                    keep.append(row)
                    chosen.append(token)
            if not keep:
                break
            past = dict(zip(past, present))
            if len(keep) < len(live):
                past = {k: np.ascontiguousarray(v[keep]) for k, v in past.items()}
                mask, pos = mask[keep], pos[keep]
                live = [live[r] for r in keep]
            embeds = self._speech(chosen)[:, None, :]
            mask = np.concatenate([mask, np.ones((len(live), 1), np.int64)], axis=1)
            pos = pos[:, -1:] + 1
        return [t[1:] for t in tokens]

    def _wave(self, tokens: list[int]) -> np.ndarray:
        speech_tokens = np.concatenate([self.prompt, np.array([tokens], np.int64), np.full((1, 3), _SILENCE, np.int64)], axis=1)
        wav = self.decoder.run(None, dict(speech_tokens=speech_tokens, speaker_embeddings=self.speaker, speaker_features=self.features))[0]
        return np.asarray(wav, np.float32).reshape(-1)


# The fast voice's own settings, from its export's bundle.json and the
# reference wrapper: an end-of-speech logit over -4 ends the text, decoding
# stops 3 steps later (that frame and 2 more kept, 0.24 s), and latents are
# sampled at temperature 0.3 with one flow step.
_FAST_EOS = -4.0
_FAST_AFTER_EOS = 3
_FAST_DECODE = 12  # latent frames decoded per run
_FAST_THREADS = 2


class FastVoice(_Speaker):
    """The fast voice (Pocket TTS): a 100M-parameter model whose language
    model predicts one 32-number latent per 80 ms frame, which a flow step
    samples and the audio codec's decoder turns into 24 kHz sound. Its state
    (attention caches, codec buffers) has a fixed size, given by the graphs'
    inputs: flags start true, the rest at zero. The speaker sample is read
    once into that state, which each text starts from."""

    def __init__(self, sample: np.ndarray, target: str = "en") -> None:
        import json

        import sentencepiece

        self.target = target
        path = speech._model_path(FAST_VOICES[target]) / pocket_dir(target)
        self.bundle = json.loads((path / "bundle.json").read_text(encoding="utf-8"))
        threads = speech._cpu_threads()
        self.encoder = _kept_session(path / "mimi_encoder.onnx", threads)
        self.text = _kept_session(path / "text_conditioner.onnx", threads)
        # Run frame by frame on tiny inputs: 2 threads spoke at 0.37x real
        # time, 4 at 0.35x (i7-9750H), so it leaves the editor the rest.
        self.lm = _kept_session(path / "flow_lm_main_int8.onnx", min(threads, _FAST_THREADS))
        self.flow = _kept_session(path / "flow_lm_flow.onnx", min(threads, _FAST_THREADS))
        self.decoder = _kept_session(path / "mimi_decoder.onnx", threads)
        self.tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(path / self.bundle["tokenizer_file"]))
        self.latent, self.width = int(self.bundle["latent_dim"]), int(self.bundle["conditioning_dim"])
        self.lm_state = [i.name for i in self.lm.get_inputs()[2:]]
        self.dec_state = [i.name for i in self.decoder.get_inputs()[1:]]
        voice = self.encoder.run(None, {"audio": sample.astype(np.float32)[None, None]})[0].reshape(1, -1, self.width)
        if self.bundle.get("insert_bos_before_voice"):
            bos = np.load(path / self.bundle["bos_before_voice_file"]).astype(np.float32).reshape(1, 1, -1)
            voice = np.concatenate([bos, voice], axis=1)
        _, _, self.base = self._step(np.zeros((1, 0, self.latent), np.float32), voice, _fresh(self.lm, 2))

    def _step(self, sequence: np.ndarray, text: np.ndarray, state: dict) -> tuple[np.ndarray, float, dict]:
        out = self.lm.run(None, {"sequence": sequence, "text_embeddings": text, **state})
        return out[0], float(np.asarray(out[1]).reshape(-1)[0]), dict(zip(self.lm_state, out[2:]))

    def _prepare(self, text: str) -> str:
        # The French, German, Spanish and Italian voices say digits as noise
        # ("250 euros" said wrong by all 6 test speakers, measured).
        text = numbers.spell_numbers(" ".join(text.split()), getattr(self, "target", "en"))
        for a, b in self.bundle.get("replace_characters", {}).items():
            text = text.replace(a, b)
        if self.bundle.get("remove_semicolons"):
            text = text.replace(";", ",")
        text = " ".join(text.split())
        if text:
            text = text[0].upper() + text[1:]
            if text[-1].isalnum():
                text += "."
        return text

    def _speak(self, texts: list[str], cancelled: Callable[[], None]) -> list[np.ndarray]:
        return [self._one(t, cancelled) for t in texts]

    def _one(self, text: str, cancelled: Callable[[], None]) -> np.ndarray:
        import zlib

        text = self._prepare(text)
        ids = self.tokenizer.encode(text)
        if len(ids) > int(self.bundle.get("max_token_per_chunk") or 50) and len(halves := _halves(text)) == 2:
            gap = np.zeros(int(0.12 * VOICE_RATE), np.float32)
            return np.concatenate([self._one(halves[0], cancelled), gap, self._one(halves[1], cancelled)])
        # The same text says the same thing every time.
        rng = np.random.default_rng(zlib.crc32(text.encode("utf-8")))
        embedded = self.text.run(None, {"token_ids": np.array([ids], np.int64)})[0]
        _, _, state = self._step(np.zeros((1, 0, self.latent), np.float32), embedded, dict(self.base))
        no_text = np.zeros((1, 0, self.width), np.float32)
        frame = np.full((1, 1, self.latent), np.nan, np.float32)  # the start
        temperature = float(self.bundle.get("default_temperature") or 0.3)
        limit = int((len(ids) / 3.0 + 2.0) * float(self.bundle["frame_rate"]))
        frames, ended = [], None
        zero, one = np.zeros((1, 1), np.float32), np.ones((1, 1), np.float32)
        for step in range(limit):
            cancelled()
            cond, eos, state = self._step(frame, no_text, state)
            if ended is None and eos > _FAST_EOS:
                ended = step
            if ended is not None and step >= ended + _FAST_AFTER_EOS:
                break
            x = rng.normal(0, np.sqrt(temperature), (1, self.latent)).astype(np.float32)
            x = x + self.flow.run(None, {"c": cond.reshape(-1).astype(np.float32), "s": zero, "t": one, "x": x})[0]
            frame = x.reshape(1, 1, self.latent)
            frames.append(frame)
        codec = _fresh(self.decoder, 1)
        audio = []
        for g in range(0, len(frames), _FAST_DECODE):
            out = self.decoder.run(None, {"latent": np.concatenate(frames[g : g + _FAST_DECODE], axis=1), **codec})
            audio.append(np.asarray(out[0], np.float32).reshape(-1))
            codec = dict(zip(self.dec_state, out[1:]))
        return np.concatenate(audio) if audio else np.zeros(0, np.float32)


def _fresh(session, skip: int) -> dict:
    """A graph's state inputs (all but its first `skip`) at their start:
    flags true, everything else zero."""
    state = {}
    for i in session.get_inputs()[skip:]:
        dtype = {"tensor(bool)": bool, "tensor(int64)": np.int64, "tensor(float16)": np.float16}.get(i.type, np.float32)
        state[i.name] = np.ones(i.shape, bool) if dtype is bool else np.zeros(i.shape, dtype)
    return state


def _pieces(text: str) -> list[str]:
    """`text` in pieces of at most _MAX_CHARS, cut after sentence ends, then
    commas, then spaces."""
    text = " ".join(text.split())
    out = []
    while len(text) > _MAX_CHARS:
        head = text[:_MAX_CHARS]
        cut = max((m.end() for m in re.finditer(r"[.!?;:](\s|$)", head)), default=0) or max(
            (m.end() for m in re.finditer(r",\s", head)), default=0
        )
        cut = cut or head.rfind(" ") + 1 or _MAX_CHARS
        out.append(text[:cut].strip())
        text = text[cut:].strip()
    return [p for p in out + [text] if p]


def _halves(text: str) -> list[str]:
    """`text` in two at the sentence end, else comma, else space nearest
    its middle; one piece when it has no space."""
    mid = len(text) / 2
    for pattern in (r"[.!?;:]\s", r",\s", r"\s"):
        cuts = [m.end() for m in re.finditer(pattern, text)]
        if cuts:
            c = min(cuts, key=lambda x: abs(x - mid))
            if 0.2 * len(text) <= c <= 0.8 * len(text) or pattern == r"\s":
                a, b = text[:c].strip(), text[c:].strip()
                return [x for x in (a, b) if x]
    return [text]


# --- Timing ----------------------------------------------------------------------

MAX_TEMPO = 1.3  # faster than this sounds rushed
_GAP = 0.05


def schedule(starts: list[float], lengths: list[float], total: float) -> tuple[list[tuple[float, float]], float]:
    """Where each sentence goes and how much faster it's said: (start,
    tempo) each, and the seconds of speech that still run past `total`.

    Forward: each at its own start (or once the one before has ended), sped
    up (to MAX_TEMPO) to end before the next one's start; running late,
    the next is sped up to catch up. Backward, only when the last ones would
    run past the end: from the last back, each is sped up, then moved
    earlier into the silence before it, until all of it ends by `total`."""
    n = len(starts)
    at, tempo = [0.0] * n, [1.0] * n
    free = 0.0
    for i in range(n):
        at[i] = max(starts[i], free)
        slot = (starts[i + 1] - _GAP if i + 1 < n else total) - at[i]
        tempo[i] = min(MAX_TEMPO, max(1.0, lengths[i] / slot)) if slot > 0 else MAX_TEMPO
        free = at[i] + lengths[i] / tempo[i] + _GAP
    bound = total
    for i in range(n - 1, -1, -1):
        if at[i] + lengths[i] / tempo[i] <= bound:
            break
        tempo[i] = MAX_TEMPO if at[i] + lengths[i] / MAX_TEMPO > bound else max(tempo[i], lengths[i] / (bound - at[i]))
        at[i] = max(0.0, min(at[i], bound - lengths[i] / tempo[i]))
        bound = at[i] - _GAP
    free = 0.0
    for i in range(n):  # what couldn't move far enough back overlaps nothing
        at[i] = max(at[i], free)
        free = at[i] + lengths[i] / tempo[i] + _GAP
    over = max(0.0, max((a + l / t for a, l, t in zip(at, lengths, tempo)), default=0.0) - total)
    return list(zip(at, tempo)), over


# --- Loudness ----------------------------------------------------------------------


def active_rms(a: np.ndarray, rate: int) -> float:
    """RMS over the 20 ms frames within 20 dB of the loudest: the level of
    the speech, not of its pauses."""
    frame = rate // 50
    n = len(a) // frame
    if n == 0:
        return float(np.sqrt(np.mean(a**2))) if len(a) else 0.0
    p = np.mean(a[: n * frame].reshape(n, frame) ** 2, axis=1)
    on = p[p >= p.max() * 0.01]
    return float(np.sqrt(np.mean(on))) if len(on) else 0.0


_BELOW_DB, _ABOVE_DB, _STEP_DB = 4.0, 3.0, 3.0
_PEAK = 0.89  # -1 dBFS


def sentence_levels(targets: list[float], fallback: float = 0.1) -> list[float]:
    """Each sentence's level (RMS): the speaker's own level in it, kept
    within 4 dB under / 3 dB over their median level - a sentence where the
    voice barely separated isn't made near silent - and within 3 dB of the
    sentences either side."""
    valid = [t for t in targets if t > 1e-4]
    ref = float(np.median(valid)) if valid else fallback
    lo, hi = ref * 10 ** (-_BELOW_DB / 20), ref * 10 ** (_ABOVE_DB / 20)
    d = [20 * np.log10(min(max(t if t > 1e-4 else ref, lo), hi)) for t in targets]
    for i in range(1, len(d)):
        d[i] = min(max(d[i], d[i - 1] - _STEP_DB), d[i - 1] + _STEP_DB)
    for i in range(len(d) - 2, -1, -1):
        d[i] = min(max(d[i], d[i + 1] - _STEP_DB), d[i + 1] + _STEP_DB)
    return [float(10 ** (x / 20)) for x in d]


# --- Putting it together -----------------------------------------------------

_lock = threading.Lock()


def render(
    mix: np.ndarray,
    sentences: list[dict],
    progress: Progress,
    language: str | None = None,
    glossary: list[dict] | None = None,
    voice: str = "accurate",
    target: str = "en",
) -> tuple[np.ndarray, np.ndarray, dict]:
    """English voice (mono) and background (stereo) for `mix` (2, n) at 44.1
    kHz, and a report (the editor's DubReport). `sentences`: [{start, end,
    text}] - the source sentence's times (seconds of `mix`) and its text in
    the source language; report indices count them in this order. Progress
    stages: "download", "load", "translate", "separate", "voice", "speak",
    "fit". `voice`: "accurate" or "fast" (VOICES); `target`: the language
    said (TO_LANGUAGES), which the voice must speak."""
    if target not in TO_LANGUAGES or target not in VOICES.get(voice, {}):
        raise ValueError(f"no {voice!r} voice for {target!r}")
    with _lock:
        try:
            return _render(mix, sentences, progress, language, glossary, voice, target)
        finally:
            _keep()  # also after a failure or a cancel


def _render(
    mix: np.ndarray, sentences: list[dict], progress: Progress, language: str | None, glossary: list[dict] | None, speaker: str, target: str
) -> tuple[np.ndarray, np.ndarray, dict]:
    """render() under its lock; `speaker`: render()'s `voice`."""
    _download_all(progress, speaker, target)
    progress("load", 0.0)
    found = translate(
        [s["text"] for s in sentences], lambda v: progress("translate", v), language=language, glossary=glossary, loaded=lambda: progress("translate", 0.0), target=target
    )
    said = [i for i, t in enumerate(found) if t.text]
    if not said:
        raise NothingToSay()
    progress("separate", 0.0)
    voice = separate(mix, lambda v: progress("separate", v))
    background = mix - voice
    mono = voice.mean(axis=0)
    total = mix.shape[1] / RATE

    progress("voice", 0.0)
    spans = [(float(sentences[i]["start"]), float(sentences[i]["end"])) for i in said]
    sample, sample_seconds = voice_sample(mono, spans, background.mean(axis=0))
    model = (FastVoice if speaker == "fast" else Voice)(sample, target)
    progress("speak", 0.0)
    last = [0.0]

    def speaking(v: float) -> None:
        last[0] = v
        progress("speak", v)

    # progress() raises when the job is cancelled: checked every step.
    spoken, short = model.say_all([found[i].text for i in said], lambda: progress("speak", last[0]), speaking)
    del model

    progress("fit", 0.0)
    lengths = [len(w) / VOICE_RATE for w in spoken]
    places, over = schedule([a for a, _ in spans], lengths, total)
    targets = [active_rms(mono[int(a * RATE) : int(b * RATE)], RATE) for a, b in spans]
    levels = sentence_levels(targets)
    english = np.zeros(mix.shape[1], np.float32)
    for k, (wav, (at, tempo), level) in enumerate(zip(spoken, places, levels)):
        progress("fit", k / len(spoken))
        if not len(wav):
            continue
        out = _ffmpeg(wav, VOICE_RATE, RATE, tempo=tempo)
        own = active_rms(out, RATE)
        if own > 0:
            out *= level / own
        peak = float(np.max(np.abs(out)))
        if peak > _PEAK:
            out *= _PEAK / peak
        at_n = int(at * RATE)
        n = min(len(out), len(english) - at_n)
        if n > 0:
            english[at_n : at_n + n] += out[:n]
    progress("fit", 1.0)
    report = {
        "sentences": len(sentences),
        "spoken": len(said),
        "empty": [i for i, t in enumerate(found) if not t.text],
        "flagged": [{"index": i, "flags": t.flags} for i, t in enumerate(found) if t.text and t.flags],
        "shortSpeech": [said[k] for k in short],
        "spedUp": sum(1 for _, t in places if t > 1.001),
        "overflowSeconds": round(over, 2),
        "sampleSeconds": round(sample_seconds, 1),
        "voice": speaker,
        "target": target,
    }
    return np.clip(english, -1, 1), background, report
