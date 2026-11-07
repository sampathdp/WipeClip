"""Local text reading (OCR) for scene analysis: PaddleOCR's English text
detector and recognizer (PP-OCRv3, Apache-2.0; the ONNX exports published by
RapidOCR, Apache-2.0), run by onnxruntime, which the engine already ships.

Measured on an i7-9750H, a busy 1080p screen (about 60 text lines): finding
the text 0.2 s at 960 px, reading it about 2 s. So scene analysis only reads
a few frames - where the screen settles after a change - and usually only
the part that changed (scenes.py).

Latin script only (the recognizer's 95-character set). Nothing read here is
logged or leaves the machine; callers decide what little of it to keep.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from app.pipeline import matte

_REPO = "https://huggingface.co/SWHL/RapidOCR/resolve/1cfba2e90fc938db55889873735088de210cc173"


@dataclass(frozen=True)
class ModelFile:
    file: str
    url: str
    sha256: str


DETECTOR = ModelFile(
    "en_PP-OCRv3_det_infer.onnx",
    f"{_REPO}/PP-OCRv4/en_PP-OCRv3_det_infer.onnx",
    "f139598bc2af4e4b6fe98dec11574e30edfdd91fc94ac1425c18ace3bd5a866b",
)
RECOGNIZER = ModelFile(
    "en_PP-OCRv3_rec_infer.onnx",
    f"{_REPO}/PP-OCRv3/en_PP-OCRv3_rec_infer.onnx",
    "ef7abd8bd3629ae57ea2c28b425c1bd258a871b93fd2fe7c433946ade9b5d9ea",
)
MODELS = (DETECTOR, RECOGNIZER)

# Few threads: analysis runs while the user keeps editing, and on a 4-core
# laptop the editor's preview needs the rest.
THREADS = max(1, min(4, (os.cpu_count() or 2) // 2))
REC_HEIGHT = 48
REC_MAX_WIDTH = 1280
_MEAN = np.array([0.485, 0.456, 0.406], np.float32)
_STD = np.array([0.229, 0.224, 0.225], np.float32)


def model_file(m: ModelFile, fetch: bool = True) -> Path:
    """Bundled with the engine, else downloaded once and checked (matte.py)."""
    return matte.model_file(m, fetch)  # type: ignore[arg-type]


def models_ready() -> bool:
    try:
        for m in MODELS:
            model_file(m, fetch=False)
        return True
    except FileNotFoundError:
        return False


@dataclass
class Line:
    """One line of text: its box in the frame's pixels (x, y, w, h) and how
    sure the recognizer is (0..1)."""

    text: str
    box: tuple[int, int, int, int]
    confidence: float


class Reader:
    """Loaded once per engine run (about 0.6 s) and reused."""

    _lock = threading.Lock()
    _instance: Reader | None = None

    def __init__(self) -> None:
        import onnxruntime as ort

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = THREADS
        opts.inter_op_num_threads = 1
        self.det = ort.InferenceSession(str(model_file(DETECTOR)), opts, providers=["CPUExecutionProvider"])
        self.rec = ort.InferenceSession(str(model_file(RECOGNIZER)), opts, providers=["CPUExecutionProvider"])
        chars = self.rec.get_modelmeta().custom_metadata_map.get("character", "")
        # Index 0 is the CTC blank; the model's last class is a space.
        self.chars = ["", *chars.splitlines(), " "]

    @classmethod
    def get(cls) -> Reader:
        with cls._lock:
            if cls._instance is None:
                cls._instance = Reader()
            return cls._instance

    # --- finding text ---------------------------------------------------------

    def find(self, img: np.ndarray, limit: int) -> list[tuple[int, int, int, int]]:
        """Line boxes (x, y, w, h) in `img` (BGR), the image scaled to at
        most `limit` px on its long side for the detector. Words close
        together on a row are joined into one line."""
        h, w = img.shape[:2]
        s = min(1.0, limit / max(h, w))
        nh, nw = max(32, round(h * s / 32) * 32), max(32, round(w * s / 32) * 32)
        x = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)[..., ::-1].astype(np.float32) * (1 / 255)
        x = ((x - _MEAN) / _STD).transpose(2, 0, 1)[None]
        prob = self.det.run(None, {self.det.get_inputs()[0].name: x})[0][0, 0]
        mask = (prob > 0.3).astype(np.uint8)
        # Join words of a line: a wide, flat dilation.
        mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_RECT, (7, 1)))
        n, _, stats, _ = cv2.connectedComponentsWithStats(mask)
        fx, fy = w / nw, h / nh
        boxes = []
        for i in range(1, n):
            x0, y0, bw, bh, area = stats[i]
            if area < 12 or bh < 3 or bw < 4:
                continue
            # The detector's boxes are shrunk text cores: grow them back.
            pad = bh * 0.5
            bx0, by0 = max(0, (x0 - pad) * fx), max(0, (y0 - pad) * fy)
            bx1, by1 = min(w, (x0 + bw + pad) * fx), min(h, (y0 + bh + pad) * fy)
            boxes.append((int(bx0), int(by0), max(1, int(bx1 - bx0)), max(1, int(by1 - by0))))
        return boxes

    # --- reading it -------------------------------------------------------------

    def read_boxes(self, img: np.ndarray, boxes: list[tuple[int, int, int, int]]) -> list[Line]:
        crops = []
        for i, (x, y, bw, bh) in enumerate(boxes):
            crop = img[y : y + bh, x : x + bw]
            if crop.size == 0 or bh < 4:
                continue
            ww = int(min(REC_MAX_WIDTH, max(16, round(bw * REC_HEIGHT / bh))))
            c = cv2.resize(crop, (ww, REC_HEIGHT), interpolation=cv2.INTER_AREA if bh > REC_HEIGHT else cv2.INTER_LINEAR)
            crops.append((i, (c.astype(np.float32) * (1 / 127.5) - 1).transpose(2, 0, 1)))
        # Batches of similar width: little padding, so little wasted work.
        crops.sort(key=lambda c: c[1].shape[2])
        found: list[tuple[int, Line]] = []
        for k in range(0, len(crops), 16):
            group = crops[k : k + 16]
            width = max(c.shape[2] for _, c in group)
            batch = np.zeros((len(group), 3, REC_HEIGHT, width), np.float32)
            for j, (_, c) in enumerate(group):
                batch[j, :, :, : c.shape[2]] = c
            probs = self.rec.run(None, {self.rec.get_inputs()[0].name: batch})[0]
            for (i, _), p in zip(group, probs):
                text, conf = self._decode(p)
                if text.strip():
                    found.append((i, Line(text.strip(), boxes[i], conf)))
        # Back in the order the boxes came in.
        return [line for _, line in sorted(found, key=lambda f: f[0])]

    def _decode(self, p: np.ndarray) -> tuple[str, float]:
        """CTC greedy decoding: repeats and blanks dropped."""
        idx = p.argmax(1)
        best = p.max(1)
        chars: list[str] = []
        scores: list[float] = []
        last = 0
        for k, s in zip(idx, best):
            if k != last and k != 0 and k < len(self.chars):
                chars.append(self.chars[k])
                scores.append(float(s))
            last = k
        return "".join(chars), (sum(scores) / len(scores) if scores else 0.0)

    def read(self, img: np.ndarray, limit: int = 960, budget: int = 4000, focus: tuple[float, float] | None = None) -> list[Line]:
        """The text lines of `img` (BGR), in reading order. Reading costs time
        in proportion to the text's width (about 0.23 ms per pixel column at
        the recognizer's 48 px height, 4 threads, i7-9750H), so at most
        `budget` columns are read: tall lines first (headings, dialog
        titles), then short ones (buttons, labels), then the rest - or, with
        `focus` (a point in `img`), the lines nearest it first."""
        boxes = self.find(img, limit)
        tall = sorted((b[3] for b in boxes), reverse=True)
        big = tall[max(0, len(tall) // 5 - 1)] if tall else 0

        def cost(b: tuple[int, int, int, int]) -> int:
            return int(min(REC_MAX_WIDTH, b[2] * REC_HEIGHT / max(1, b[3])))

        if focus is not None:
            fx, fy = focus

            def dist(b: tuple[int, int, int, int]) -> float:
                dx = max(b[0] - fx, 0, fx - (b[0] + b[2]))
                dy = max(b[1] - fy, 0, fy - (b[1] + b[3]))
                return dx * dx + dy * dy

            order = sorted(boxes, key=dist)
        else:
            order = sorted(boxes, key=lambda b: (0 if b[3] >= big else 1, cost(b)))
        chosen, used = [], 0
        for b in order:
            c = cost(b)
            if used + c > budget:
                continue
            chosen.append(b)
            used += c
        # Reading order: rows (about 20 px apart on a 1080p screen), then left to right.
        chosen.sort(key=lambda b: (round((b[1] + b[3] / 2) / max(12, img.shape[0] / 54)), b[0]))
        return [line for line in self.read_boxes(img, chosen) if line.confidence >= 0.5]

if __name__ == "__main__":
    # Build step (desktop.yml): the verified model files next to the code.
    for m in MODELS:
        dest = matte.BUNDLED_DIR / m.file
        if not (dest.is_file() and matte._sha256(dest) == m.sha256):
            matte._download(m, dest)  # type: ignore[arg-type]
        print(f"{dest} ok")

