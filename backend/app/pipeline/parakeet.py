"""Speech recognition for European languages in the desktop engine: NVIDIA's
Parakeet TDT 0.6B v3 (CC-BY-4.0; 25 European languages, with punctuation and
capitals), in Ilya Stupakov's ONNX export with an 8-bit encoder, run with
numpy and onnxruntime. speech.py uses it for EUROPEAN languages; see
docs/desktop/SPEECH.md for how it measured against Whisper large-v3-turbo.

How it decodes, the way onnx-asr (MIT) does it:
1. 16 kHz audio -> 128 log-mel bands every 10 ms (the export's own
   nemo128.onnx).
2. The FastConformer encoder makes one vector per 80 ms frame.
3. Greedy token-and-duration (TDT) decoding: at each frame the joint network
   gives a token (or blank) and how many frames to move on (0-4); at most 10
   tokens per frame. Its prediction network's state moves only on a token.
4. A token starting with "▁" starts a word; a word runs from its first
   token's frame to the end of its last.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

FRAME = 0.08  # seconds per encoder frame: a 10 ms hop, subsampled 8 times
_MAX_TOKENS_PER_FRAME = 10

# The languages it was trained on (its model card).
LANGUAGES = {
    "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it",
    "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk",
}  # fmt: skip


class Parakeet:
    def __init__(self, folder: Path, threads: int) -> None:
        import onnxruntime as ort

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads

        def load(name: str):
            return ort.InferenceSession(str(folder / name), opts, providers=["CPUExecutionProvider"])

        self.features = load("nemo128.onnx")
        self.encoder = load("encoder-model.int8.onnx")
        self.decoder = load("decoder_joint-model.int8.onnx")
        self.vocab: dict[int, str] = {}
        for line in (folder / "vocab.txt").read_text(encoding="utf-8").splitlines():
            token, index = line.rsplit(" ", 1)
            self.vocab[int(index)] = token.replace("▁", " ")
        self.blank = next(i for i, t in self.vocab.items() if t == "<blk>")
        self.size = len(self.vocab)
        shape = self.decoder.get_inputs()[3].shape  # [2, batch, 640]
        self.state = (shape[0], 1, shape[2])

    def words(self, audio: np.ndarray, cancelled=lambda: None) -> list[dict]:
        """[{start, end, text}] of 16 kHz mono `audio` (a clip of some
        seconds), times in seconds from its start."""
        if len(audio) < 1600:
            return []
        feats, n_feats = self.features.run(None, {"waveforms": audio[None].astype(np.float32), "waveforms_lens": np.array([len(audio)], np.int64)})
        frames, n_frames = self.encoder.run(None, {"audio_signal": feats, "length": n_feats})
        frames = frames[0].T  # (frames, 1024)
        tokens, times = self._decode(frames, int(n_frames[0]), cancelled)
        out: list[dict] = []
        for token, t in zip(tokens, times):
            piece = self.vocab[token]
            if piece.startswith(" ") or not out:
                out.append({"start": t * FRAME, "end": (t + 1) * FRAME, "text": piece.strip()})
            else:
                out[-1]["text"] += piece
                out[-1]["end"] = (t + 1) * FRAME
        return [w for w in out if w["text"]]

    def _decode(self, frames: np.ndarray, n: int, cancelled) -> tuple[list[int], list[int]]:
        s1 = np.zeros(self.state, np.float32)
        s2 = np.zeros(self.state, np.float32)
        tokens: list[int] = []
        times: list[int] = []
        t = emitted = 0
        length = np.array([1], np.int32)
        while t < n:
            cancelled()
            out, _, n1, n2 = self.decoder.run(
                None,
                {
                    "encoder_outputs": frames[t][None, :, None],
                    "targets": np.array([[tokens[-1] if tokens else self.blank]], np.int32),
                    "target_length": length,
                    "input_states_1": s1,
                    "input_states_2": s2,
                },
            )
            out = out.reshape(-1)
            token = int(out[: self.size].argmax())
            step = int(out[self.size :].argmax())
            if token != self.blank:
                s1, s2 = n1, n2
                tokens.append(token)
                times.append(t)
                emitted += 1
            if step > 0:
                t += step
                emitted = 0
            elif token == self.blank or emitted == _MAX_TOKENS_PER_FRAME:
                t += 1
                emitted = 0
        return tokens, times
