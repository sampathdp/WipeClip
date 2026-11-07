"""Scene analysis for screen recordings: what the screen shows and when it
changes, as evidence for the editor's scene understanding
(src/lib/editor/sceneAnalysis.ts turns it into scenes, chapters and
suggestions, together with the recording's input events and transcript).

Built to stay light on ordinary laptops - nothing looks at every frame
with an expensive model:

1. Scan (always): one ffmpeg pass at 1-4 frames per second, decoded straight
   to 160 px grayscale. Per sample: how much changed and where, scrolling
   (phase correlation: the picture moved as a whole) and layout jumps.
   Memory: an 80x45 copy per sample (about 9 MB for 10 minutes).
2. Read (targeted): OCR (ocr.py) only on frames where the screen settles
   after a change - at most 4 a minute ("quick") or 10 ("thorough") - and in
   "quick" only on the part that changed. Plus a small crop around each
   click, to name what was clicked.
3. Describe: per read frame, plain features - headings, a terminal prompt,
   code, a dialog, settings or form words, error or success words, the
   address bar's host. No guessing past that; the editor states what each
   suggestion is based on.
4. Privacy (sensitive.py): every line read is checked; a finding becomes a
   mask suggestion for as long as that patch of screen stays unchanged.

Text kept in the result: short headings, labels and error/success lines (to
title chapters and annotations), never anything a privacy check flagged.
Results are cached per file, size, date, level and clicks. Nothing leaves
the machine.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from app.pipeline import ocr, sensitive, speech
from app.pipeline.video import get_ffmpeg_path

VERSION = 1
LEVELS = {
    # frames read a minute, text width read per frame (ocr.Reader.read),
    # detector size, whole frames or only what changed, clicks named a minute
    "quick": {"per_minute": 4, "budget": 4000, "limit": 960, "full": False, "clicks_per_minute": 4},
    "thorough": {"per_minute": 10, "budget": 12000, "limit": 1280, "full": True, "clicks_per_minute": 20},
}
SCAN_WIDTH = 160
THUMB = (80, 45)
DECODE_THREADS = max(1, min(4, (os.cpu_count() or 2) // 2))
CACHE_FILES = 100

Progress = Callable[[str, float], None]

_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)


# --- 1. scan -----------------------------------------------------------------


def scan_fps(duration: float) -> float:
    return 4.0 if duration <= 15 * 60 else 2.0 if duration <= 45 * 60 else 1.0


@dataclass
class Scan:
    fps: float
    width: int
    height: int
    times: list[float] = field(default_factory=list)
    change: list[float] = field(default_factory=list)  # share of the picture that changed, 0..1
    kind: list[str] = field(default_factory=list)  # still | active | scroll | cut
    boxes: list[tuple[int, int, int, int] | None] = field(default_factory=list)  # changed area, scan pixels
    luma: list[float] = field(default_factory=list)
    thumbs: list[np.ndarray] = field(default_factory=list)


def classify(prev: np.ndarray, cur: np.ndarray) -> tuple[float, str, tuple[int, int, int, int] | None]:
    """How much of `cur` changed from `prev` (both gray, same size), what
    kind of change it is and where."""
    diff = cv2.absdiff(prev, cur)
    changed = (diff > 18).astype(np.uint8)
    frac = float(changed.mean())
    if frac < 0.012:  # nothing, a blinking caret, the pointer moving
        return frac, "still", None
    box = cv2.boundingRect(cv2.findNonZero(changed))
    if frac > 0.03:
        (dx, dy), response = cv2.phaseCorrelate(prev.astype(np.float32), cur.astype(np.float32))
        if response > 0.15 and abs(dy) >= 1 and abs(dx) < 1:
            shifted = np.roll(prev, int(round(dy)), axis=0)
            m = max(1, int(abs(round(dy))))
            rest = (cv2.absdiff(shifted, cur)[m:-m] > 18).mean()
            if rest < 0.4 * frac:
                return frac, "scroll", box
    return frac, ("cut" if frac > 0.45 else "active"), box


def scan(path: str, duration: float, h: int, progress: Progress) -> Scan:
    """Samples of `path`, SCAN_WIDTH x `h` gray (h: the display aspect's height)."""
    fps = scan_fps(duration)
    ffmpeg = get_ffmpeg_path()
    proc = subprocess.Popen(
        [ffmpeg, "-v", "error", "-threads", str(DECODE_THREADS), "-i", path, "-map", "0:v:0", "-an", "-sn",
         "-vf", f"fps={fps},scale={SCAN_WIDTH}:{h}:flags=area,format=gray", "-f", "rawvideo", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=_FLAGS,
    )  # fmt: skip
    out: Scan | None = None
    try:
        prev = None
        i = 0
        last = 0.0
        while True:
            buf = proc.stdout.read(SCAN_WIDTH * h)  # type: ignore[union-attr]
            if len(buf) < SCAN_WIDTH * h:
                break
            cur = np.frombuffer(buf, np.uint8).reshape(h, SCAN_WIDTH)
            if out is None:
                out = Scan(fps, SCAN_WIDTH, h)
            t = i / fps
            if prev is None:
                frac, kind, box = 1.0, "cut", (0, 0, SCAN_WIDTH, h)
            else:
                frac, kind, box = classify(prev, cur)
            out.times.append(round(t, 3))
            out.change.append(round(frac, 4))
            out.kind.append(kind)
            out.boxes.append(box)
            out.luma.append(float(cur.mean()))
            out.thumbs.append(cv2.resize(cur, THUMB, interpolation=cv2.INTER_AREA))
            prev = cur
            i += 1
            now = time.monotonic()
            if now - last > 0.3:
                last = now
                progress("scan", min(1.0, t / max(0.1, duration)))
        proc.wait()
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
    if out is None:
        raise ValueError("No video frames")
    return out


def segments(s: Scan) -> list[dict]:
    """Runs of still / active / scroll, short blips folded into neighbors;
    cuts are listed separately as moments."""
    runs: list[list] = []
    for t, k in zip(s.times, s.kind):
        k = "active" if k == "cut" else k
        if runs and runs[-1][2] == k:
            runs[-1][1] = t
        else:
            runs.append([t, t, k])
    step = 1 / s.fps
    merged: list[list] = []
    for r in runs:
        if merged and (r[1] - r[0] + step) < 0.6 and r[2] != "still":
            merged[-1][1] = r[1]  # a blip of activity inside stillness
        elif merged and merged[-1][2] == r[2]:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return [{"start": round(a, 2), "end": round(b + step, 2), "kind": k} for a, b, k in merged]


# --- 2. which frames to read ---------------------------------------------------


def pick_frames(s: Scan, level: dict) -> list[tuple[int, tuple[int, int, int, int] | None]]:
    """Sample indices where the screen settles after a change (the first
    still sample after activity), each with the area that changed since the
    previous pick (scan pixels; None = most of the frame or the first pick). Near-identical
    screens are skipped; past the per-minute budget the biggest changes win."""
    n = len(s.times)
    cands: list[int] = [0]
    for i in range(1, n):
        if s.kind[i] == "still" and s.kind[i - 1] != "still":
            # Settled: still for half a second (or until the end).
            j = i
            while j + 1 < n and s.kind[j + 1] == "still" and s.times[j + 1] - s.times[i] < 0.5:
                j += 1
            if j + 1 >= n or s.kind[j + 1] == "still":
                cands.append(i)
    if level["full"]:
        # Long busy stretches (a video, a build log) get a look every 30 s.
        last = 0.0
        for i in range(n):
            if s.kind[i] != "still" and s.times[i] - last >= 30:
                cands.append(i)
                last = s.times[i]
            elif s.kind[i] == "still":
                last = s.times[i]
        cands = sorted(set(cands))

    picked: list[tuple[int, float]] = []
    ref = None
    for i in cands:
        d = 255.0 if ref is None else float(cv2.absdiff(ref, s.thumbs[i]).mean())
        if d < 2.5:
            continue
        picked.append((i, d))
        ref = s.thumbs[i]
    duration = s.times[-1] + 1 / s.fps if s.times else 0
    budget = max(3, int(level["per_minute"] * duration / 60 + 1))
    if len(picked) > budget:
        keep = {0} | {i for i, _ in sorted(picked[1:], key=lambda p: -p[1])[: budget - 1]}
        picked = [p for p in picked if p[0] in keep]

    # The area that changed since the previous pick (always: it tells a
    # dialog from a new page); "quick" reads only that.
    out = []
    prev_i = 0
    for k, (i, _) in enumerate(picked):
        region = None
        if k > 0:
            boxes = [b for b in s.boxes[prev_i + 1 : i + 1] if b is not None]
            if boxes:
                x0 = min(b[0] for b in boxes)
                y0 = min(b[1] for b in boxes)
                x1 = max(b[0] + b[2] for b in boxes)
                y1 = max(b[1] + b[3] for b in boxes)
                if (x1 - x0) * (y1 - y0) < 0.4 * s.width * s.height:
                    region = (x0, y0, x1 - x0, y1 - y0)
        out.append((i, region))
        prev_i = i
    return out


# --- frames at full size ----------------------------------------------------------


def grab(path: str, times: list[float]) -> dict[float, np.ndarray]:
    """Full-size frames at `times` (sorted), one decoder, seeking only across
    gaps (short gaps are decoded through, which is cheaper than a seek)."""
    cap = cv2.VideoCapture(path)
    frames: dict[float, np.ndarray] = {}
    try:
        pos = -1.0
        for t in sorted(set(times)):
            if pos < 0 or t < pos or t - pos > 2.0:
                cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            frame = None
            while True:
                ok = cap.grab()
                if not ok:
                    break
                pos = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
                if pos >= t - 0.02:
                    ok, frame = cap.retrieve()
                    break
            if frame is not None:
                frames[t] = frame
    finally:
        cap.release()
    return frames


# --- 3. describe --------------------------------------------------------------------

_PROMPT = re.compile(r"^(?:\$|>|❯|#|PS [A-Za-z]:\\|[A-Za-z]:\\[^>]*>|[\w.-]+@[\w.-]+[:~])\s*\S")
_COMMAND = re.compile(r"^\W{0,3}(?:npm|npx|yarn|pnpm|pip|python|py|node|git|cargo|docker|go|dotnet|make|cd|ls|dir|curl|uv|bun|deno|java|mvn|gradle)\b", re.I)
_CODE = re.compile(r"[{};]\s*$|=>|\b(?:def|function|import|from|const|let|var|return|class|public|private|if|else|for|while)\b.*[(:{=]|</?\w+[^>]*>")
_SETTINGS = re.compile(r"\b(?:settings|preferences|options|configuration|configure|properties|account)\b", re.I)
_FORM = re.compile(r"\b(?:e-?mail|user ?name|password|first name|last name|full name|address|phone|submit|sign ?in|log ?in|sign ?up|register|continue)\b", re.I)
_ERROR = re.compile(r"\b(?:error|errors|failed|failure|exception|traceback|denied|invalid|not found|cannot|can't|unable|fatal|refused|timed out|404|500)\b", re.I)
_SUCCESS = re.compile(r"\b(?:success|successful|successfully|saved|completed?|done|uploaded|created|deployed|published|passed|compiled|installed|ready)\b", re.I)
_HOST = re.compile(r"(?:https?://)?((?:localhost|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d{2,5})?)(?:/|\s|$)", re.I)


def _norm(box: tuple[int, int, int, int], w: int, h: int) -> list[float]:
    x, y, bw, bh = box
    return [round(x / w, 4), round(y / h, 4), round(bw / w, 4), round(bh / h, 4)]


def _letters(text: str) -> float:
    return sum(c.isalpha() for c in text) / max(1, len(text))


def describe(lines: list[ocr.Line], frame_w: int, frame_h: int, region: tuple[int, int, int, int] | None) -> dict:
    """Plain features of a read frame. `lines` are in frame pixels;
    `region`: the part that changed since the previous read frame (None:
    most of it). Lines a privacy check flags are never kept as text."""
    flagged = {id(ln) for ln in lines if sensitive.scan_line(ln.text, ln.box)}
    safe = [ln for ln in lines if id(ln) not in flagged]
    heights = sorted(ln.box[3] for ln in lines) or [0]
    median = heights[len(heights) // 2]
    dialog = False
    if region is not None:
        rx, ry, rw, rh = region
        area = rw * rh / (frame_w * frame_h)
        cx, cy = (rx + rw / 2) / frame_w, (ry + rh / 2) / frame_h
        dialog = 0.03 <= area <= 0.5 and 0.2 <= cx <= 0.8 and 0.15 <= cy <= 0.85

    def titled(ln: ocr.Line) -> bool:
        return 3 <= len(ln.text) <= 60 and _letters(ln.text) >= 0.5

    if dialog and region is not None:
        # A dialog's title: its tallest line, near its top.
        rx, ry, rw, rh = region
        inside = [ln for ln in safe if titled(ln) and rx <= ln.box[0] + ln.box[2] / 2 <= rx + rw and ry <= ln.box[1] + ln.box[3] / 2 <= ry + rh]
        headings = sorted(inside, key=lambda ln: (-ln.box[3], ln.box[1]))[:3]
    else:
        headings = sorted((ln for ln in safe if ln.box[3] >= 1.35 * median and titled(ln)), key=lambda ln: -ln.box[3])[:3]
    labels = [ln for ln in safe if 1 <= len(ln.text) <= 30 and _letters(ln.text) >= 0.5][:40]
    texts = [ln.text for ln in lines]
    prompts = [ln for ln in safe if _PROMPT.match(ln.text) or _COMMAND.match(ln.text)]
    code_lines = sum(1 for t in texts if _CODE.search(t))
    error = next((ln.text[:80] for ln in safe if _ERROR.search(ln.text)), None)
    success = next((ln.text[:80] for ln in safe if _SUCCESS.search(ln.text)), None)
    # An address bar: a host name near the top of the screen.
    host = next((m.group(1).lower() for ln in safe if ln.box[1] < 0.15 * frame_h and (m := _HOST.search(ln.text))), None)
    return {
        "lines": len(lines),
        "headings": [{"text": ln.text, "box": _norm(ln.box, frame_w, frame_h)} for ln in headings],
        "labels": [{"text": ln.text, "box": _norm(ln.box, frame_w, frame_h)} for ln in labels],
        "terminal": len(prompts) >= 1,
        "command": prompts[-1].text[:80] if prompts else None,
        "code": code_lines >= 3,
        "settings": any(_SETTINGS.search(t) for t in texts),
        "form": sum(1 for t in texts if _FORM.search(t)) >= 2,
        "error": error,
        "success": success,
        "host": host,
        "dialog": dialog,
    }


def _preview(frame: np.ndarray) -> str:
    h, w = frame.shape[:2]
    small = cv2.resize(frame, (240, max(2, round(h * 240 / w))), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 60])
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode() if ok else ""


# --- 4. privacy spans ------------------------------------------------------------------


def span(s: Scan, i: int, box: list[float]) -> tuple[float, float]:
    """How long the patch `box` (normalized) of sample i stays as it is:
    the run of samples around i where it barely changes."""
    tw, th = THUMB
    x0 = max(0, int(box[0] * tw))
    y0 = max(0, int(box[1] * th))
    x1 = min(tw, max(x0 + 1, int(np.ceil((box[0] + box[2]) * tw))))
    y1 = min(th, max(y0 + 1, int(np.ceil((box[1] + box[3]) * th))))
    ref = s.thumbs[i][y0:y1, x0:x1].astype(np.int16)

    def same(j: int) -> bool:
        return float(np.abs(s.thumbs[j][y0:y1, x0:x1].astype(np.int16) - ref).mean()) < 8

    a = i
    while a > 0 and same(a - 1):
        a -= 1
    b = i
    while b + 1 < len(s.times) and same(b + 1):
        b += 1
    return s.times[a], s.times[b] + 1 / s.fps


def _iou(a: list[float], b: list[float]) -> float:
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    return inter / max(1e-9, a[2] * a[3] + b[2] * b[3] - inter)


def merge_findings(found: list[dict]) -> list[dict]:
    """One suggestion per patch: same category, overlapping boxes and
    touching time spans are merged (the box grows to cover both)."""
    out: list[dict] = []
    for f in sorted(found, key=lambda f: f["start"]):
        for g in out:
            if g["category"] == f["category"] and _iou(g["box"], f["box"]) > 0.3 and f["start"] <= g["end"] + 1:
                x0, y0 = min(g["box"][0], f["box"][0]), min(g["box"][1], f["box"][1])
                x1 = max(g["box"][0] + g["box"][2], f["box"][0] + f["box"][2])
                y1 = max(g["box"][1] + g["box"][3], f["box"][1] + f["box"][3])
                g["box"] = [round(x0, 4), round(y0, 4), round(x1 - x0, 4), round(y1 - y0, 4)]
                g["end"] = max(g["end"], f["end"])
                g["confidence"] = max(g["confidence"], f["confidence"])
                break
        else:
            out.append(dict(f))
    for k, f in enumerate(out):
        f["id"] = f"p{k + 1}"
    return out


def _pad(box: tuple[int, int, int, int], w: int, h: int) -> list[float]:
    x, y, bw, bh = box
    px, py = bw * 0.08 + 4, bh * 0.25 + 3
    x0, y0 = max(0, x - px), max(0, y - py)
    x1, y1 = min(w, x + bw + px), min(h, y + bh + py)
    return [round(x0 / w, 4), round(y0 / h, 4), round((x1 - x0) / w, 4), round((y1 - y0) / h, 4)]


# --- the whole analysis -------------------------------------------------------------------


def cache_dir() -> Path:
    raw = os.environ.get("WIPECLIP_SCENE_DIR")
    return Path(raw) if raw else speech.models_dir().parent / "scene-cache"


def cache_path(src: str, level: str, clicks: list[list[float]]) -> Path:
    st = os.stat(src)
    key = json.dumps([VERSION, os.path.abspath(src), st.st_size, st.st_mtime_ns, level, clicks])
    return cache_dir() / f"{hashlib.sha256(key.encode()).hexdigest()[:32]}.json"


def analyze(src: str, width: int, height: int, duration: float, level: str, clicks: list[list[float]], progress: Progress) -> dict:
    """The analysis of the video `src` (display size width x height, length
    `duration`) at `level`. `clicks`: [[t, x, y], ...] - recording clicks,
    seconds and fractions of the frame. Cached."""
    out = cache_path(src, level, clicks)
    if out.is_file():
        try:
            return json.loads(out.read_text("utf-8"))
        except (OSError, ValueError):
            pass
    cfg = LEVELS[level]
    started = time.monotonic()
    progress("scan", 0.0)
    s = scan(src, duration, max(2, round(height * SCAN_WIDTH / max(1, width) / 2) * 2), progress)
    scanned = time.monotonic()

    picks = pick_frames(s, cfg)
    # Clicks to name: the frame just before each click, within the budget.
    budget = max(4, int(cfg["clicks_per_minute"] * duration / 60 + 1))
    chosen_clicks = clicks[:: max(1, int(np.ceil(len(clicks) / budget)))] if clicks else []
    times = [s.times[i] for i, _ in picks] + [max(0.0, c[0] - 0.15) for c in chosen_clicks]
    reader = ocr.Reader.get() if (picks or chosen_clicks) else None
    frames = grab(src, times)

    sx = sy = None
    results_frames: list[dict] = []
    found: list[dict] = []
    total = len(picks) + len(chosen_clicks)
    done = 0
    for i, region in picks:
        t = s.times[i]
        frame = frames.get(t)
        done += 1
        progress("read", done / max(1, total))
        if frame is None or reader is None:
            continue
        fh, fw = frame.shape[:2]
        sx, sy = fw / s.width, fh / s.height
        changed = None
        if region is not None:
            x, y, w, h = region
            m = 4
            x0, y0 = max(0, int((x - m) * sx)), max(0, int((y - m) * sy))
            x1, y1 = min(fw, int((x + w + m) * sx)), min(fh, int((y + h + m) * sy))
            if x1 - x0 > 16 and y1 - y0 > 8:
                changed = (x0, y0, x1 - x0, y1 - y0)
        crop_box = None if cfg["full"] else changed
        img = frame if crop_box is None else frame[crop_box[1] : crop_box[1] + crop_box[3], crop_box[0] : crop_box[0] + crop_box[2]]
        lines = reader.read(img, cfg["limit"], cfg["budget"])
        if crop_box:
            lines = [ocr.Line(ln.text, (ln.box[0] + crop_box[0], ln.box[1] + crop_box[1], ln.box[2], ln.box[3]), ln.confidence) for ln in lines]
        info = describe(lines, fw, fh, changed)
        results_frames.append({
            "t": t, "preview": _preview(frame), "region": _norm(crop_box, fw, fh) if crop_box else None, **info,
        })  # fmt: skip
        for f in sensitive.scan([(ln.text, ln.box) for ln in lines], fw):
            box = _pad(f.box, fw, fh)
            a, b = span(s, i, box)
            found.append({"category": f.category, "box": box, "start": round(a, 2), "end": round(b, 2), "confidence": f.confidence, "reason": f.reason, "frame": len(results_frames) - 1})

    named_clicks: list[dict] = []
    for c in chosen_clicks:
        done += 1
        progress("read", done / max(1, total))
        frame = frames.get(max(0.0, c[0] - 0.15))
        if frame is None or reader is None:
            continue
        fh, fw = frame.shape[:2]
        cx, cy = c[1] * fw, c[2] * fh
        hw, hh = max(160, fw * 0.12), max(48, fh * 0.05)
        x0, y0 = int(max(0, cx - hw)), int(max(0, cy - hh))
        x1, y1 = int(min(fw, cx + hw)), int(min(fh, cy + hh))
        if x1 - x0 < 16 or y1 - y0 < 8:
            continue
        lines = reader.read(frame[y0:y1, x0:x1], 640, 1200, focus=(cx - x0, cy - y0))
        lines = [ocr.Line(ln.text, (ln.box[0] + x0, ln.box[1] + y0, ln.box[2], ln.box[3]), ln.confidence) for ln in lines]
        flagged = [ln for ln in lines if sensitive.scan_line(ln.text, ln.box)]
        # The label under the pointer, else the nearest one on its row.
        hit = None
        for ln in lines:
            if ln in flagged:
                continue
            x, y, w, h = ln.box
            inside = x - 6 <= cx <= x + w + 6 and y - 6 <= cy <= y + h + 6
            if inside and len(ln.text) <= 40:
                hit = ln
                break
        named_clicks.append({
            "t": c[0], "x": c[1], "y": c[2],
            "label": hit.text if hit else None, "box": _norm(hit.box, fw, fh) if hit else None,
        })  # fmt: skip

    result = {
        "version": VERSION,
        "level": level,
        "duration": round(duration, 3),
        "width": width,
        "height": height,
        "scanFps": s.fps,
        "segments": segments(s),
        "cuts": [t for t, k in zip(s.times, s.kind) if k == "cut" and t > 0],
        "frames": results_frames,
        "clicks": named_clicks,
        "privacy": merge_findings(found),
        "stats": {
            "scanSeconds": round(scanned - started, 2),
            "readSeconds": round(time.monotonic() - scanned, 2),
            "framesRead": len(results_frames),
            "clicksRead": len(named_clicks),
        },
    }
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_name(out.name + ".part")
        tmp.write_text(json.dumps(result), "utf-8")
        os.replace(tmp, out)
        old = sorted(out.parent.glob("*.json"), key=lambda p: p.stat().st_mtime)
        for p in old[:-CACHE_FILES]:
            p.unlink(missing_ok=True)
    except OSError:
        pass
    return result
