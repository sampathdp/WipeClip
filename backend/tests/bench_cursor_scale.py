"""Export cost of the zoom-aware cursor (Smart Zoom 2) at 1080p.

Not a unit test (slow): run from the backend folder with
    python -m tests.bench_cursor_scale [seconds]

Renders the same synthetic screen recording three times: no pointer,
a fixed-size cursor (the 3-column rows every project used before), and a
cursor that grows with a zoom every 4 s (4-column rows). Prints wall
times.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time

from PIL import Image

from app.pipeline import editor
from app.pipeline.video import get_ffmpeg_path

W, H, FPS = 1920, 1080, 30


def main(seconds: float) -> None:
    tmp = tempfile.mkdtemp(prefix="cursor-bench-")
    src = os.path.join(tmp, "src.mp4")
    subprocess.run(
        [get_ffmpeg_path(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc2=s={W}x{H}:r={FPS}:d={seconds}", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", src],
        check=True,
    )
    # Cursor sprite at its largest size: 0.045 x 2.5 of the height.
    side = round(0.045 * 2.5 * H)
    sprite = os.path.join(tmp, "cursor.png")
    Image.new("RGBA", (round(side * 0.7), round(side * 1.2)), (255, 255, 255, 255)).save(sprite)
    fixed, scaled = [], []
    for f in range(int(seconds * FPS)):
        t = f / FPS
        x, y = 0.3 + 0.4 * ((t % 7) / 7), 0.5
        u = t % 4
        # Zoom in over 0.6 s, hold 2 s, out over 0.6 s, rest.
        z = 1 + 1.5 * (min(1, u / 0.6) if u < 2.6 else max(0, 1 - (u - 2.6) / 0.6))
        fixed.append((round(t, 3), x, y))
        scaled.append((round(t, 3), x, y, round(z / 2.5, 4)))

    def plan(rows):
        clip = editor.PlanClip(source_path=src, source_has_audio=False, source_width=W, source_height=H, start=0.0, duration=seconds)
        p = editor.ExportPlan(width=W, height=H, fps=FPS, with_audio=False, clips=[clip])
        if rows is not None:
            p.pointer = editor.PlanPointer(sprite, side * 0.7 / H, side * 1.2 / H, 0, 0, [], [], rows, [])
        return p

    for name, rows in (("no pointer", None), ("fixed cursor", fixed), ("growing cursor", scaled)):
        out = os.path.join(tmp, f"{name.replace(' ', '-')}.mp4")
        with tempfile.TemporaryDirectory() as work:
            args = editor.build_export_args(plan(rows), out, work)
            t0 = time.perf_counter()
            subprocess.run([get_ffmpeg_path(), "-loglevel", "error", *args], check=True)
            print(f"{name:15s} {seconds:.0f} s at {W}x{H}: {time.perf_counter() - t0:.1f} s")


if __name__ == "__main__":
    main(float(sys.argv[1]) if len(sys.argv) > 1 else 30)
