"""Voice translation for the desktop app: the speech of a video said again in
English, in the speaker's own voice, over the video's own background sound.
Runs in the engine on the user's machine; the English text comes from the
editor (translated online, text only - src/app/api/translate).

Two models, downloaded once after the editor asks, into WIPECLIP_MODELS_DIR:

- separator: Meta's HT-Demucs (fine-tuned) vocals model (MIT), as ONNX. It
  takes the voice out; the background is what's left. On the 60 s test (a
  Sinhala news report) the voice kept all 130 recognized words and the
  background 4 faint ones.
- voice: Resemble AI's Chatterbox Turbo (MIT), as ONNX: English speech in
  the voice of a ~10 s sample. Its language model in full precision, the
  rest 4-bit: the all-4-bit set dropped and changed words ("Binance",
  "theft" as "debt"); 8-bit ran ten times slower on an i7-9750H. That mix
  says 7.5 s of speech in about 31 s on its 6 cores.

Both run on onnxruntime with numpy; resampling and tempo changes go through
the bundled ffmpeg. Nothing is uploaded.
"""

from __future__ import annotations

import re
import subprocess
import threading
from typing import Callable

import numpy as np

from . import speech
from .speech import Download, Progress, SpeechModel

RATE = 44100  # what the separator takes, and what's handed back
VOICE_RATE = 24000  # what the voice model takes and makes

_DEMUCS = ("StemSplitio/htdemucs-ft-vocals-onnx", "2ef0d757d3e226d0da85fb8c71514f464fcabdd0")
_CHATTERBOX = ("ResembleAI/chatterbox-turbo-ONNX", "d21799bd0354adb85e348b8a0442a8405110a2cf")

SEPARATOR = SpeechModel(
    "separator",
    (Download(*_DEMUCS, "htdemucs_ft_vocals_fp16weights.onnx", 165_612_636),),
    converted=False,
)
VOICE = SpeechModel(
    "voice",
    (
        Download(*_CHATTERBOX, "tokenizer.json", 3_562_272),
        Download(*_CHATTERBOX, "onnx/language_model.onnx", 207_266),
        Download(*_CHATTERBOX, "onnx/language_model.onnx_data", 1_269_724_812),
        Download(*_CHATTERBOX, "onnx/speech_encoder_q4.onnx", 1_200_346),
        Download(*_CHATTERBOX, "onnx/speech_encoder_q4.onnx_data", 229_560_112),
        Download(*_CHATTERBOX, "onnx/embed_tokens_q4.onnx", 2_844),
        Download(*_CHATTERBOX, "onnx/embed_tokens_q4.onnx_data", 37_286_384),
        Download(*_CHATTERBOX, "onnx/conditional_decoder_q4.onnx", 2_179_022),
        Download(*_CHATTERBOX, "onnx/conditional_decoder_q4.onnx_data", 246_397_384),
    ),
    converted=False,
)
MODELS = (SEPARATOR, VOICE)


def models_status() -> dict:
    return {
        "ready": all(speech.is_ready(m) for m in MODELS),
        "sizeMb": sum(m.size_mb for m in MODELS if not speech.is_ready(m)),
    }


def _download_all(progress: Progress) -> None:
    """Every model, with one download progress across them."""
    missing = [m for m in MODELS if not speech.is_ready(m)]
    total = sum(m.size_mb for m in missing) or 1
    done = 0
    for m in missing:
        speech.ensure_model(m, lambda stage, v, m=m, done=done: progress(stage, (done + v * m.size_mb) / total))
        done += m.size_mb


def _session(path, threads: int):
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = threads
    return ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])


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


def separate(mix: np.ndarray, progress: Callable[[float], None]) -> np.ndarray:
    """The voice in `mix` (2, n) at 44.1 kHz, the same shape: the model's
    vocals output, chunk by chunk with a quarter overlapping, cross-faded."""
    session = _session(speech._model_path(SEPARATOR) / SEPARATOR.files[0].name, speech._cpu_threads())
    total = mix.shape[1]
    overlap = _CHUNK // 4
    stride = _CHUNK - overlap
    fade = np.linspace(0, 1, overlap, dtype=np.float32)
    window = np.ones(_CHUNK, np.float32)
    window[:overlap], window[-overlap:] = fade, fade[::-1]
    voice = np.zeros_like(mix)
    weight = np.zeros(total, np.float32)
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
    return voice / np.maximum(weight, 1e-8)


# --- The speaker's voice -----------------------------------------------------

# The voice model's encoder takes at most 10 s (a 10.8 s sample made it
# babble instead of reading the text). The sample must also end in a pause:
# one cut mid-word made it carry on saying the sample's own (Sinhala) words.
SAMPLE_SECONDS = 9.5
_TAIL = 0.3  # silence after the sample


def voice_sample(voice: np.ndarray, spans: list[tuple[float, float]]) -> np.ndarray:
    """Up to 9.5 s of the speaker, at the voice model's rate: whole
    sentences of the separated voice (mono, 44.1 kHz), longest first -
    whole sentences sound most like the speaker, and the separated voice has
    no music under it. A first sentence longer than that is cut at its
    quietest moment before 9.5 s."""
    gap = np.zeros(int(0.15 * RATE), np.float32)
    parts, have = [], 0.0
    total = len(voice) / RATE
    # Word timings can end before the word does: each edge moved to the
    # nearest pause.
    spans = [(_quietest(voice, max(0.0, a - 0.4), a + 0.2), _quietest(voice, b - 0.2, min(total, b + 0.6))) for a, b in spans]
    for a, b in sorted(spans, key=lambda s: s[0] - s[1]):
        length = b - a
        if length < 0.8:
            continue
        if length > SAMPLE_SECONDS - have:
            if parts:
                continue
            b = a + _quietest(voice, a + SAMPLE_SECONDS * 0.6, a + SAMPLE_SECONDS) - a
            length = b - a
        parts += [voice[int(a * RATE) : int(b * RATE)], gap]
        have += length + 0.15
        if have >= SAMPLE_SECONDS - 0.8:
            break
    if not parts:  # no sentence times: the loudest stretch, cut at pauses
        n = int(SAMPLE_SECONDS * RATE)
        start = int(np.argmax(np.convolve(voice**2, np.ones(RATE), "same")[: max(1, len(voice) - n)])) if len(voice) > n else 0
        a = start / RATE
        parts = [voice[start : int(_quietest(voice, a + SAMPLE_SECONDS * 0.6, a + SAMPLE_SECONDS) * RATE)]]
    sample = np.concatenate(parts[:-1] if len(parts) > 1 else parts)
    sample = np.concatenate([sample, np.zeros(int(_TAIL * RATE), np.float32)])
    return _ffmpeg(sample, RATE, VOICE_RATE)


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
_MAX_CHARS = 240  # longer text is said in pieces


class Voice:
    """The voice model, conditioned once on a speaker sample."""

    def __init__(self, sample: np.ndarray) -> None:
        from tokenizers import Tokenizer

        path = speech._model_path(VOICE)
        threads = speech._cpu_threads()
        self.encoder = _session(path / "onnx/speech_encoder_q4.onnx", threads)
        self.embed = _session(path / "onnx/embed_tokens_q4.onnx", threads)
        self.lm = _session(path / "onnx/language_model.onnx", threads)
        self.decoder = _session(path / "onnx/conditional_decoder_q4.onnx", threads)
        self.tokenizer = Tokenizer.from_file(str(path / "tokenizer.json"))
        self.cond, self.prompt, self.speaker, self.features = self.encoder.run(None, {"audio_values": sample[None].astype(np.float32)})

    def say(self, text: str, cancelled: Callable[[], None]) -> np.ndarray:
        """`text` spoken, at 24 kHz."""
        pieces = [self._say(p, cancelled) for p in _pieces(text)]
        gap = np.zeros(int(0.12 * VOICE_RATE), np.float32)
        return np.concatenate([x for p in pieces for x in (p, gap)][:-1]) if pieces else np.zeros(0, np.float32)

    def _say(self, text: str, cancelled: Callable[[], None]) -> np.ndarray:
        ids = np.array([self.tokenizer.encode(text).ids], np.int64)
        embeds = np.concatenate([self.cond, self.embed.run(None, {"input_ids": ids})[0]], axis=1)
        past = {
            i.name: np.zeros([1, 16, 0, 64], np.float16 if i.type == "tensor(float16)" else np.float32)
            for i in self.lm.get_inputs()
            if "past_key_values" in i.name
        }
        n = embeds.shape[1]
        mask = np.ones((1, n), np.int64)
        pos = np.arange(n, dtype=np.int64)[None]
        tokens = [_START]
        # Speech tokens come 25 a second; a runaway is cut at three times a
        # slow reading of the text.
        limit = int(25 * (3 + 0.25 * len(text.split()) * 3))
        for _ in range(limit):
            cancelled()
            logits, *present = self.lm.run(None, dict(inputs_embeds=embeds, attention_mask=mask, position_ids=pos, **past))
            logits = logits[0, -1].copy()
            seen = np.unique(tokens)
            s = logits[seen]
            logits[seen] = np.where(s < 0, s * _REPETITION_PENALTY, s / _REPETITION_PENALTY)
            token = int(np.argmax(logits))
            if token == _STOP:
                break
            tokens.append(token)
            embeds = self.embed.run(None, {"input_ids": np.array([[token]], np.int64)})[0]
            mask = np.concatenate([mask, np.ones((1, 1), np.int64)], axis=1)
            pos = pos[:, -1:] + 1
            past = dict(zip(past, present))
        speech_tokens = np.concatenate(
            [self.prompt, np.array([tokens[1:]], np.int64), np.full((1, 3), _SILENCE, np.int64)], axis=1
        )
        wav = self.decoder.run(None, dict(speech_tokens=speech_tokens, speaker_embeddings=self.speaker, speaker_features=self.features))[0]
        return np.asarray(wav, np.float32).reshape(-1)


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


# --- Putting it together -----------------------------------------------------

MAX_TEMPO = 1.3  # faster than this sounds rushed
_lock = threading.Lock()


def fit(starts: list[float], spoken: list[np.ndarray], total: float) -> list[tuple[float, float]]:
    """Where each sentence goes and how much faster it's said: at its own
    start, sped up (to MAX_TEMPO) to end before the next one starts; what
    still runs over pushes the next one back. Returns (start, tempo)."""
    out = []
    free = 0.0
    for i, (start, wav) in enumerate(zip(starts, spoken)):
        at = max(start, free)
        slot = (starts[i + 1] if i + 1 < len(starts) else total) - at
        length = len(wav) / VOICE_RATE
        tempo = min(MAX_TEMPO, max(1.0, length / slot)) if slot > 0 else MAX_TEMPO
        out.append((at, tempo))
        free = at + length / tempo + 0.05
    return out


def render(mix: np.ndarray, sentences: list[dict], progress: Progress) -> tuple[np.ndarray, np.ndarray]:
    """English voice (mono) and background (stereo) for `mix` (2, n) at 44.1
    kHz. `sentences`: [{start, end, text}] - the source sentence's times
    (seconds of `mix`) and its English text. Progress stages: "download",
    "separate", "voice", "speak"."""
    with _lock:
        _download_all(progress)
        progress("separate", 0.0)
        voice = separate(mix, lambda v: progress("separate", v))
        background = mix - voice
        mono = voice.mean(axis=0)
        total = mix.shape[1] / RATE

        progress("voice", 0.0)
        spans = [(float(s["start"]), float(s["end"])) for s in sentences]
        model = Voice(voice_sample(mono, spans))
        spoken = []
        for i, s in enumerate(sentences):
            progress("speak", i / len(sentences))
            spoken.append(model.say(s["text"], lambda: progress("speak", i / len(sentences))))

        english = np.zeros(mix.shape[1], np.float32)
        for s, wav, (at, tempo) in zip(sentences, spoken, fit([a for a, _ in spans], spoken, total)):
            if not len(wav):
                continue
            out = _ffmpeg(wav, VOICE_RATE, RATE, tempo=tempo)
            # As loud as the speaker was in that sentence.
            a, b = int(float(s["start"]) * RATE), int(float(s["end"]) * RATE)
            target = float(np.sqrt(np.mean(mono[a:b] ** 2))) if b > a else 0.0
            level = float(np.sqrt(np.mean(out**2)))
            if target > 0 and level > 0:
                out *= min(4.0, target / level)
            at_n = int(at * RATE)
            n = min(len(out), len(english) - at_n)
            if n > 0:
                english[at_n : at_n + n] += out[:n]
        progress("speak", 1.0)
        return np.clip(english, -1, 1), background
