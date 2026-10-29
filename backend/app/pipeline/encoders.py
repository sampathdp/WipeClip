"""Video encoder choice, output checks and disk space for the editor export.

Encoders: the desktop engine uses NVIDIA's hardware H.264 encoder (NVENC)
when it actually works, and libx264 otherwise. Intel Quick Sync is
supported but not picked automatically: measured on an i7-9750H it was
between 9% slower and 11% faster than libx264 for files 1.2-2x larger at
the same quality, while NVENC was 1.4-1.5x faster (docs/desktop/RELEASE.md,
Export). "Works" is tested, not assumed: on first use each candidate
encodes a short test clip, and the first that succeeds is kept for the
engine's lifetime. If a real export still fails with it (driver trouble,
a size it refuses), the export is rendered again with libx264 and the
hardware encoder isn't used again in that session. The cloud backend has no
GPU and always uses libx264. `WIPECLIP_ENCODER` forces one (tests,
diagnosis). AMD AMF and Media Foundation aren't candidates: neither could
be tested here (no AMD GPU; Media Foundation's H.264 refused the frames).

These are the encoders the bundled ffmpeg already contains (gyan.dev
build); nothing about the build or its licensing changes.

Quality: each hardware encoder's quality setting is offset from libx264's
CRF so the output has at least the same SSIM on a screen recording and on
high-motion 1440p60 footage (measured,
see docs/desktop/RELEASE.md, Export).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile

from app.config import LOCAL_MODE, VIDEO_ENCODE_PRESET
from app.pipeline.video import get_ffmpeg_path

SOFTWARE = "libx264"
# Tried in order by pick_encoder; h264_qsv only when forced.
HARDWARE = ("h264_nvenc",)
SUPPORTED = (*HARDWARE, "h264_qsv")
# Added to libx264's CRF for the hardware encoders' constant-quality
# setting (NVENC -cq, Quick Sync -global_quality): same SSIM, measured.
NVENC_CQ_OFFSET = 6
QSV_QUALITY_OFFSET = -4


def encoder_args(name: str, crf: int) -> list[str]:
    if name == "h264_nvenc":
        return ["-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", str(crf + NVENC_CQ_OFFSET), "-b:v", "0", "-pix_fmt", "yuv420p"]
    if name == "h264_qsv":
        return ["-c:v", "h264_qsv", "-preset", "medium", "-global_quality", str(crf + QSV_QUALITY_OFFSET), "-pix_fmt", "nv12"]
    if name == SOFTWARE:
        return ["-c:v", SOFTWARE, "-preset", VIDEO_ENCODE_PRESET, "-crf", str(crf), "-pix_fmt", "yuv420p"]
    # Anything else (WIPECLIP_ENCODER) goes to ffmpeg as named, so a wrong
    # name fails - and falls back - instead of quietly becoming libx264.
    return ["-c:v", name, "-pix_fmt", "yuv420p"]


_chosen: str | None = None


def _works(name: str) -> bool:
    """Encodes one second of a test pattern with `name`; True if that
    produced a non-empty file."""
    fd, out = tempfile.mkstemp(suffix=".mp4", prefix="wipeclip-enc-")
    os.close(fd)
    try:
        proc = subprocess.run(
            [get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=1", *encoder_args(name, 23), out],
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=30,
        )
        return proc.returncode == 0 and os.path.getsize(out) > 1000
    except (OSError, subprocess.SubprocessError):
        return False
    finally:
        try:
            os.remove(out)
        except OSError:
            pass


def pick_encoder() -> str:
    """The encoder for the next export (see the module doc)."""
    global _chosen
    forced = os.environ.get("WIPECLIP_ENCODER", "auto")
    if forced != "auto":
        return forced
    if not LOCAL_MODE:
        return SOFTWARE
    if _chosen is None:
        _chosen = next((e for e in HARDWARE if _works(e)), SOFTWARE)
        print(f"export: encoder {_chosen}", file=sys.stderr)
    return _chosen


def give_up_hardware() -> None:
    """After a failed hardware export: libx264 for the rest of the session."""
    global _chosen
    _chosen = SOFTWARE


# --- output check -------------------------------------------------------------

_DURATION = re.compile(r"Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)")
_VIDEO = re.compile(r"Stream #\d+:\d+.*?: Video: (\w+).*?, (\d{2,5})x(\d{2,5})")
_AUDIO = re.compile(r"Stream #\d+:\d+.*?: Audio: (\w+)")


class OutputInvalid(RuntimeError):
    pass


def probe_output(path: str) -> dict:
    """What ffmpeg sees in a finished file: duration, video codec and size,
    audio codec (None when absent)."""
    proc = subprocess.run([get_ffmpeg_path(), "-hide_banner", "-i", path], capture_output=True, stdin=subprocess.DEVNULL)
    text = proc.stderr.decode(errors="replace")
    d = _DURATION.search(text)
    v = _VIDEO.search(text)
    a = _AUDIO.search(text)
    return {
        "duration": int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3)) if d else None,
        "video": (v.group(1), int(v.group(2)), int(v.group(3))) if v else None,
        "audio": a.group(1) if a else None,
    }


def validate_output(path: str, *, duration: float, width: int | None, height: int | None, video: bool, audio: bool, fps: float) -> dict:
    """Raises OutputInvalid unless the file has the expected streams, size
    and length and its last second decodes (a cut-off file fails there)."""
    if not os.path.isfile(path) or os.path.getsize(path) == 0:
        raise OutputInvalid("The export produced no file.")
    info = probe_output(path)
    if info["duration"] is None:
        raise OutputInvalid("The exported file can't be read.")
    if abs(info["duration"] - duration) > max(0.3, 3.0 / max(1.0, fps)):
        raise OutputInvalid(f"The exported file is {info['duration']:.2f} s long instead of {duration:.2f} s.")
    if video:
        if info["video"] is None:
            raise OutputInvalid("The exported file has no picture.")
        if width is not None and (info["video"][1], info["video"][2]) != (width, height):
            raise OutputInvalid(f"The exported picture is {info['video'][1]}x{info['video'][2]} instead of {width}x{height}.")
    if audio and info["audio"] is None:
        raise OutputInvalid("The exported file has no sound.")
    tail = subprocess.run(
        [get_ffmpeg_path(), "-hide_banner", "-v", "error", "-sseof", "-1.5", "-i", path, "-f", "null", "-"],
        capture_output=True,
        stdin=subprocess.DEVNULL,
    )
    if tail.returncode != 0 or tail.stderr.strip():
        raise OutputInvalid("The end of the exported file doesn't decode.")
    return info


# --- disk space -----------------------------------------------------------------


class DiskFull(RuntimeError):
    def __init__(self, needed: int | None, free: int | None):
        self.needed, self.free = needed, free
        super().__init__("Not enough disk space.")


def estimate_bytes(width: int, height: int, fps: float, seconds: float) -> int:
    """Generous upper estimate of an export's size: 0.15 bits per pixel per
    frame (screen recordings at the default quality measured 0.02-0.1),
    plus room for the encoder's temporary data."""
    return int(width * height * fps * seconds * 0.15 / 8) + 200 * 1024 * 1024


def check_space(folder: str, needed: int) -> None:
    free = shutil.disk_usage(folder).free
    if free < needed:
        raise DiskFull(needed, free)


def is_disk_full(message: str) -> bool:
    """ffmpeg's error text for a full disk (ENOSPC), on Windows and POSIX."""
    return "No space left on device" in message or "There is not enough space on the disk" in message
