"""Speech-to-text for the editor's auto captions.

The browser mixes the timeline's own speech (the clips' sound, already in
timeline time) down to a 16 kHz mono WAV and uploads that, so the word
timestamps returned here are timeline seconds the editor can place text
layers at directly - no per-clip mapping on this side.

Transcription is faster-whisper (CTranslate2 Whisper) on CPU with int8
weights. The model is loaded once per process and reused; its first load
downloads it from Hugging Face into the default cache, so a fresh server
should warm it up (or pre-download it) before taking traffic.
"""

from __future__ import annotations

import threading
import wave

import numpy as np

from app.config import CAPTIONS_MODEL

_model = None
_model_lock = threading.Lock()

# ISO 639-1 codes the editor offers; anything else is rejected by main.py.
LANGUAGES = (
    "en", "es", "fr", "de", "it", "pt", "nl", "ru", "uk", "pl", "tr", "ar", "hi", "si", "ta",
    "bn", "ur", "id", "ms", "th", "vi", "zh", "ja", "ko",
)


def _get_model():
    global _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel  # heavy import, only when used

            _model = WhisperModel(CAPTIONS_MODEL, device="cpu", compute_type="int8")
        return _model


SAMPLE_RATE = 16000  # what Whisper takes; the browser mixes to this


def wav_duration(path: str) -> float:
    """Length in seconds of the 16 kHz mono 16-bit PCM WAV the editor sends.

    Raises:
        ValueError: for anything else.
    """
    try:
        with wave.open(path, "rb") as w:
            if w.getsampwidth() != 2 or w.getnchannels() != 1 or w.getframerate() != SAMPLE_RATE:
                raise ValueError("Expected 16 kHz mono 16-bit PCM audio")
            return w.getnframes() / float(SAMPLE_RATE)
    except (wave.Error, EOFError) as exc:
        raise ValueError("Not a WAV file") from exc


def _load_wav(path: str) -> np.ndarray:
    # Read directly rather than letting faster-whisper decode the file: its
    # PyAV path is sensitive to the installed av version, and the input is
    # already exactly the float32 16 kHz mono it wants.
    with wave.open(path, "rb") as w:
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    return pcm.astype(np.float32) / 32768.0


def transcribe(path: str, language: str | None) -> dict:
    """Word-level transcript of `path`.

    Returns {"language": code, "words": [{"start", "end", "text"}]}, words in
    order, times in seconds. `language` None auto-detects.
    """
    segments, info = _get_model().transcribe(
        _load_wav(path),
        language=language,
        word_timestamps=True,
        # Skip silence/music stretches - Whisper hallucinates text in them.
        vad_filter=True,
        beam_size=5,
        condition_on_previous_text=False,
    )
    words: list[dict] = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if text and w.end > w.start:
                words.append({"start": round(w.start, 3), "end": round(w.end, 3), "text": text})
    return {"language": info.language, "words": words}
