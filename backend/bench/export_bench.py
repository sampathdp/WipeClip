"""Export benchmark: renders representative projects through the real export
graph (editor.build_export_args) with each encoder and measures time, peak
memory, CPU, GPU encoder use, size, quality (SSIM against a near-lossless
render of the same graph) and, for the sync project, audio/video offset.

Not a test (minutes of rendering, needs media). Run from the backend folder:

    python bench/export_bench.py MEDIA_DIR OUT_DIR [--encoders libx264,h264_nvenc,h264_qsv]
        [--only short,long,...] [--calibrate]

MEDIA_DIR must contain (see docs/desktop/RELEASE.md, Export benchmark):
    desktop1080p30.mp4 + desktop-audio.m4a  a real 1080p30 screen recording (>= 300 s)
    game1440p60.mp4                         2560x1440 at 60 fps, high motion (>= 60 s)
    sync1080p30.mp4                         white frame + 1 kHz beep every 5 s (60 s)
    mic.m4a                                 600 Hz beep every 5 s from 2.5 s (60 s)

Windows only for the memory/CPU numbers (GetProcessMemoryInfo/GetProcessTimes
on the ffmpeg process); GPU encoder use from nvidia-smi (NVIDIA) and the
"GPU Engine" VideoEncode counter (any GPU, via typeperf).
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from ctypes import wintypes

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from app.pipeline import editor, encoders  # noqa: E402
from app.pipeline.video import get_ffmpeg_path  # noqa: E402

FF = get_ffmpeg_path()


# --- process measurements (Windows) ------------------------------------------------


class PMC(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


def proc_stats(handle: int) -> tuple[float, float]:
    """(peak working set MB, CPU seconds) of a finished process."""
    pmc = PMC()
    pmc.cb = ctypes.sizeof(PMC)
    ctypes.windll.psapi.GetProcessMemoryInfo(wintypes.HANDLE(handle), ctypes.byref(pmc), pmc.cb)
    c, e, k, u = (wintypes.FILETIME() for _ in range(4))
    ctypes.windll.kernel32.GetProcessTimes(wintypes.HANDLE(handle), ctypes.byref(c), ctypes.byref(e), ctypes.byref(k), ctypes.byref(u))
    ft = lambda f: ((f.dwHighDateTime << 32) | f.dwLowDateTime) / 1e7  # noqa: E731
    return pmc.PeakWorkingSetSize / 1e6, ft(k) + ft(u)


class GpuSampler:
    """Max video-encode engine utilization while running: nvidia-smi's
    encoder % (NVIDIA) and the GPU Engine VideoEncode counter (all GPUs)."""

    def __init__(self) -> None:
        self.nv: list[float] = []
        self.engine: list[float] = []
        self._stop = threading.Event()

    def __enter__(self):
        self.t1 = threading.Thread(target=self._nvidia, daemon=True)
        self.t2 = threading.Thread(target=self._counter, daemon=True)
        self.t1.start()
        self.t2.start()
        return self

    def __exit__(self, *a):
        self._stop.set()
        self.t1.join(3)
        self.t2.join(5)

    def _nvidia(self) -> None:
        while not self._stop.is_set():
            try:
                out = subprocess.run(["nvidia-smi", "--query-gpu=utilization.encoder", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=5).stdout
                self.nv.append(float(out.strip().splitlines()[0]))
            except (OSError, ValueError, IndexError, subprocess.SubprocessError):
                return
            self._stop.wait(0.5)

    def _counter(self) -> None:
        while not self._stop.is_set():
            try:
                out = subprocess.run(
                    ["typeperf", r"\GPU Engine(*engtype_VideoEncode)\Utilization Percentage", "-sc", "1"], capture_output=True, text=True, timeout=10
                ).stdout
                rows = [line for line in out.splitlines() if line.startswith('"') and "/" in line[:15]]
                if rows:
                    vals = [float(v.strip('"')) for v in rows[-1].split(",")[1:] if v.strip('"')]
                    self.engine.append(max(vals) if vals else 0.0)
            except (OSError, ValueError, subprocess.SubprocessError):
                return


def run_ffmpeg(args: list[str]) -> dict:
    t0 = time.perf_counter()
    with GpuSampler() as gpu:
        p = subprocess.Popen([FF, "-loglevel", "error", *args], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL)
        _, err = p.communicate()
        wall = time.perf_counter() - t0
        peak, cpu = proc_stats(int(p._handle))  # type: ignore[attr-defined]
    if p.returncode != 0:
        raise RuntimeError(err.decode(errors="replace")[-800:])
    return {
        "seconds": round(wall, 2),
        "peak_mb": round(peak),
        "cpu_cores": round(cpu / wall, 1),
        "nvenc_max_pct": max(gpu.nv) if gpu.nv else None,
        "video_engine_max_pct": round(max(gpu.engine), 1) if gpu.engine else None,
    }


# --- media facts ------------------------------------------------------------------------


def probe(path: str) -> tuple[int, int, float, float]:
    text = subprocess.run([FF, "-hide_banner", "-i", path], capture_output=True, text=True).stderr
    w, h = map(int, re.search(r"Video: .*?, (\d{2,5})x(\d{2,5})", text).groups())
    fps = float(re.search(r"([\d.]+) fps", text).group(1))
    d = re.search(r"Duration: (\d+):(\d\d):([\d.]+)", text)
    return w, h, fps, int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3))


def ssim(a: str, b: str) -> float:
    text = subprocess.run([FF, "-hide_banner", "-i", a, "-i", b, "-lavfi", "[0:v][1:v]ssim", "-f", "null", "-"], capture_output=True, text=True).stderr
    return float(re.search(r"All:([\d.]+)", text).group(1))


def sync_offsets(path: str, fps: float) -> dict:
    """Flash frames vs the 1 kHz beeps (the clip's own sound) and the 600 Hz
    beeps (the separate microphone track, 2.5 s later), in ms."""
    raw = subprocess.run([FF, "-v", "error", "-i", path, "-vf", "scale=32:18,format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
    luma = np.frombuffer(raw, np.uint8).reshape(-1, 32 * 18).mean(axis=1)
    flashes = [i / fps for i in range(1, len(luma)) if luma[i] > 128 and luma[i - 1] <= 128]
    pcm = np.frombuffer(subprocess.run([FF, "-v", "error", "-i", path, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], capture_output=True).stdout, np.float32)

    def onsets(freq: float) -> list[float]:
        win = 480  # 10 ms
        n = len(pcm) // win
        t = np.arange(win) / 48000
        ref = np.exp(-2j * np.pi * freq * t)
        e = np.abs((pcm[: n * win].reshape(n, win) * ref).sum(axis=1)) / win
        hit = e > 0.05
        return [i * win / 48000 for i in range(1, n) if hit[i] and not hit[i - 1]]

    clip = onsets(1000)
    mic = onsets(600)
    near = lambda xs, t: min(xs, key=lambda x: abs(x - t)) if xs else None  # noqa: E731
    d_clip = [abs(near(clip, f) - f) * 1000 for f in flashes if near(clip, f) is not None]
    d_mic = [abs(near(mic, f + 2.5) - (f + 2.5)) * 1000 for f in flashes if near(mic, f + 2.5) is not None]
    return {
        "flashes": len(flashes),
        "clip_beeps": len(clip),
        "mic_beeps": len(mic),
        "max_av_offset_ms": round(max(d_clip), 1) if d_clip else None,
        "max_mic_offset_ms": round(max(d_mic), 1) if d_mic else None,
    }


# --- projects ---------------------------------------------------------------------------


def clip(path: str, start: float, dur: float, **kw) -> editor.PlanClip:
    w, h, _, _ = probe(path)
    return editor.PlanClip(source_path=path, source_has_audio=kw.pop("audio", False), source_width=w, source_height=h, start=start, duration=dur, **kw)


def text_png(folder: str, i: int, text: str) -> str:
    img = Image.new("RGBA", (900, 120), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, 899, 119), 24, fill=(0, 0, 0, 170))
    d.text((40, 30), text, fill=(255, 255, 255, 255), font=ImageFont.load_default(size=56))
    p = os.path.join(folder, f"text{i}.png")
    img.save(p)
    return p


def projects(media: str, work: str) -> dict:
    m = lambda n: os.path.join(media, n)  # noqa: E731
    desk, game, sync = m("desktop1080p30.mp4"), m("game1440p60.mp4"), m("sync1080p30.mp4")
    sys_audio = m("desktop-audio.m4a")
    out: dict = {}

    out["short"] = editor.ExportPlan(
        width=1920, height=1080, fps=30, with_audio=True, clips=[clip(desk, 0, 60)],
        audio=[editor.PlanAudio(path=sys_audio, start=0, offset=0, duration=60)],
    )  # fmt: skip
    out["long"] = editor.ExportPlan(
        width=1920, height=1080, fps=30, with_audio=True, clips=[clip(desk, 0, 300)],
        audio=[editor.PlanAudio(path=sys_audio, start=0, offset=0, duration=300)],
    )  # fmt: skip
    out["gameplay"] = editor.ExportPlan(width=2560, height=1440, fps=60, with_audio=True, clips=[clip(game, 0, 60, audio=True)])
    out["multi_audio"] = editor.ExportPlan(
        width=1920, height=1080, fps=30, with_audio=True, clips=[clip(sync, 0, 60, audio=True)],
        audio=[
            editor.PlanAudio(path=m("mic.m4a"), start=0, offset=0, duration=60),
            editor.PlanAudio(path=sys_audio, start=0, offset=30, duration=60, volume=0.3),
        ],
    )  # fmt: skip
    # 40 pieces of 5 s (every 7.5 s of the recording), each with a zoom in and out.
    cuts = []
    for i in range(40):
        cam = [(0.0, 0.0, 0.0, 1.0), (0.6, 0.15, 0.1, 0.55), (4.0, 0.15, 0.1, 0.55), (4.6, 0.0, 0.0, 1.0)]
        cuts.append(clip(desk, i * 7.5, 5.0, camera=cam))
    out["cuts_zooms"] = editor.ExportPlan(width=1920, height=1080, fps=30, with_audio=False, clips=cuts)
    # 6 pieces with transitions, 12 caption/text layers.
    pieces = [clip(desk, i * 20, 20, transition="crossfade" if i < 5 else None, transition_duration=0.6 if i < 5 else 0.0) for i in range(6)]
    overlays = []
    for i in range(12):
        p = text_png(work, i, f"Step {i + 1}: caption over the recording")
        overlays.append(editor.PlanOverlay(image_path=p, image_width=900, image_height=120, start=i * 9.5, end=i * 9.5 + 8, x=0.5, y=0.88, width=0.47, rotation=0, anim_in="fade", anim_out="fade"))
    out["transitions_overlays"] = editor.ExportPlan(
        width=1920, height=1080, fps=30, with_audio=True, clips=pieces, overlays=overlays,
        audio=[editor.PlanAudio(path=sys_audio, start=0, offset=0, duration=117)],
    )  # fmt: skip
    return out


def render(plan: editor.ExportPlan, out: str, enc: str, work: str, crf: int | None = None) -> dict:
    if crf is not None:
        plan.crf = crf
    args = editor.build_export_args(plan, out, work, enc)
    return run_ffmpeg(args)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("media")
    ap.add_argument("out")
    ap.add_argument("--encoders", default="libx264,h264_nvenc,h264_qsv")
    ap.add_argument("--only", default="")
    ap.add_argument("--calibrate", action="store_true", help="SSIM/size of each hardware quality step vs libx264 CRF 20 (short and gameplay)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    work = tempfile.mkdtemp(dir=a.out, prefix="work-")
    results = []

    if a.calibrate:
        for name in [n for n in ("short", "gameplay") if not a.only or n in a.only.split(",")]:
            ref = os.path.join(a.out, f"{name}-ref.mp4")
            if not os.path.exists(ref):
                render(projects(a.media, work)[name], ref, "libx264", work, crf=8)
            x = os.path.join(a.out, f"{name}-x264.mp4")
            render(projects(a.media, work)[name], x, "libx264", work, crf=20)
            row = {"project": name, "x264_crf20": {"ssim": ssim(x, ref), "mb": round(os.path.getsize(x) / 1e6, 1)}}
            for enc, key, steps in (("h264_nvenc", "NVENC_CQ_OFFSET", (4, 6, 8, 10)), ("h264_qsv", "QSV_QUALITY_OFFSET", (-8, -6, -4, -2))):
                for off in steps:
                    setattr(encoders, key, off)
                    o = os.path.join(a.out, f"{name}-{enc}{off}.mp4")
                    render(projects(a.media, work)[name], o, enc, work, crf=20)
                    row[f"{enc}{off:+d}"] = {"ssim": ssim(o, ref), "mb": round(os.path.getsize(o) / 1e6, 1)}
                    os.remove(o)
                setattr(encoders, key, 0)
            print(json.dumps(row), flush=True)
            results.append(row)
            for f in (x,):
                os.remove(f)
        json.dump(results, open(os.path.join(a.out, "calibration.json"), "w"), indent=1)
        return

    plans = projects(a.media, work)
    names = [n for n in plans if not a.only or n in a.only.split(",")]
    for name in names:
        ref = None
        if name in ("short", "gameplay", "cuts_zooms"):
            ref = os.path.join(a.out, f"{name}-ref.mp4")
            if not os.path.exists(ref):
                render(projects(a.media, work)[name], ref, "libx264", work, crf=8)
        for enc in a.encoders.split(","):
            out = os.path.join(a.out, f"{name}-{enc}.mp4")
            plan = projects(a.media, work)[name]
            try:
                r = render(plan, out, enc, work)
            except RuntimeError as e:
                r = {"error": str(e)[-300:]}
                results.append({"project": name, "encoder": enc, **r})
                print(json.dumps(results[-1]), flush=True)
                continue
            w, h, fps, dur = probe(out)
            total = editor.timeline_duration(plan)
            row = {"project": name, "encoder": enc, **r, "realtime_x": round(total / r["seconds"], 2), "out": f"{w}x{h}@{fps:g}", "duration": round(dur, 2), "expected": round(total, 2), "mb": round(os.path.getsize(out) / 1e6, 1)}
            if ref:
                row["ssim"] = round(ssim(out, ref), 4)
            if name == "multi_audio":
                row.update(sync_offsets(out, fps))
            try:
                encoders.validate_output(out, duration=total, width=plan.width, height=plan.height, video=True, audio=plan.with_audio, fps=plan.fps)
                row["valid"] = True
            except encoders.OutputInvalid as e:
                row["valid"] = str(e)
            results.append(row)
            print(json.dumps(row), flush=True)
            os.remove(out)
    json.dump(results, open(os.path.join(a.out, "results.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
