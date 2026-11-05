"""Long timelines rendered in pieces (editor.segment_groups): the pieces
must join into the same video, at the same length, with sound, as the
one-pass render. Real ffmpeg on synthetic media.

Run from the backend folder:  python -m unittest tests.test_segmented_export
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import tempfile
import unittest
from unittest import mock

from app.pipeline import editor, encoders
from app.pipeline.video import get_ffmpeg_path
from tests.test_focus_export import FPS, H, W, frame_at

COLORS = ["red", "lime", "blue", "white", "yellow", "cyan", "magenta", "black"]
RGB = {"red": (255, 0, 0), "lime": (0, 255, 0), "blue": (0, 0, 255), "white": (255, 255, 255),
       "yellow": (255, 255, 0), "cyan": (0, 255, 255), "magenta": (255, 0, 255), "black": (0, 0, 0)}  # fmt: skip


def color_at(path: str, t: float) -> str:
    """Which of COLORS the frame's center is (nearest), at time t."""
    b, g, r = (int(v) for v in frame_at(path, t)[H // 2, W // 2])
    return min(RGB, key=lambda c: sum((x - y) ** 2 for x, y in zip(RGB[c], (r, g, b))))


def make_color_steps(path: str) -> None:
    """One second of each of COLORS, with a tone throughout."""
    parts = ";".join(f"color={c}:s={W}x{H}:r={FPS}:d=1[c{n}]" for n, c in enumerate(COLORS))
    joined = "".join(f"[c{n}]" for n in range(len(COLORS)))
    graph = f"{parts};{joined}concat=n={len(COLORS)}:v=1:a=0,format=yuv420p[v]"
    subprocess.run(
        [
            get_ffmpeg_path(), "-y", "-hide_banner", "-loglevel", "error", "-filter_complex", graph,
            "-f", "lavfi", "-i", f"sine=frequency=440:duration={len(COLORS)}", "-map", "[v]", "-map", "0:a",
            "-c:v", "libx264", "-crf", "10", "-c:a", "aac", "-shortest", path,
        ],
        check=True,
    )  # fmt: skip


def plan_of(src: str, n: int, transitions: set[int] = frozenset()) -> editor.ExportPlan:
    """n half-second clips, clip i from the middle of color i % 8."""
    clips = [
        editor.PlanClip(
            source_path=src, source_has_audio=True, source_width=W, source_height=H, start=(i % 8) + 0.25, duration=0.5,
            transition="crossfade" if i in transitions else None, transition_duration=0.2 if i in transitions else 0.0,
        )
        for i in range(n)
    ]  # fmt: skip
    return editor.ExportPlan(width=W, height=H, fps=FPS, with_audio=True, clips=clips)


def render(plan: editor.ExportPlan, out: str) -> None:
    asyncio.run(editor.render_export(plan, out))


class SegmentGroupsTest(unittest.TestCase):
    def test_short_timelines_render_in_one_go(self) -> None:
        self.assertEqual(editor.segment_groups(plan_of("x.mp4", editor.SEGMENT_MIN_CLIPS - 1)), [])

    def test_groups_cover_every_clip_in_order(self) -> None:
        groups = editor.segment_groups(plan_of("x.mp4", 20))
        self.assertEqual([i for g in groups for i in g], list(range(20)))
        self.assertTrue(all(len(g) <= editor.SEGMENT_CLIPS for g in groups))

    def test_a_transition_keeps_its_clips_together(self) -> None:
        # Clip 7 crossfades into clip 8, where a piece would otherwise end.
        groups = editor.segment_groups(plan_of("x.mp4", 20, {7}))
        piece = next(g for g in groups if 7 in g)
        self.assertIn(8, piece)


class SegmentedRenderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.mkdtemp(prefix="segment-test-")
        cls.src = os.path.join(cls.tmp, "steps.mp4")
        make_color_steps(cls.src)

    def test_pieces_match_the_one_pass_render(self) -> None:
        n, fades = 18, {3, 11}
        pieces, whole = os.path.join(self.tmp, "pieces.mp4"), os.path.join(self.tmp, "whole.mp4")
        render(plan_of(self.src, n, fades), pieces)
        with mock.patch.object(editor, "SEGMENT_MIN_CLIPS", 10_000):
            render(plan_of(self.src, n, fades), whole)

        plan = plan_of(self.src, n, fades)
        editor.quantize_plan(plan)
        total = editor.timeline_duration(plan)
        for path in (pieces, whole):
            # Length, size, both streams and a decodable end (raises otherwise).
            encoders.validate_output(path, duration=total, width=W, height=H, video=True, audio=True, fps=FPS)

        # Each clip's color, sampled between the transitions.
        t = 0.0
        for i, clip in enumerate(plan.clips):
            mid = t + clip.duration / 2
            self.assertEqual(color_at(pieces, mid), COLORS[i % 8], f"clip {i} at {mid:.2f} s")
            self.assertEqual(color_at(whole, mid), COLORS[i % 8], f"clip {i} at {mid:.2f} s")
            t += clip.duration - clip.transition_duration
        # Every frame is there (cuts after a crossfade used to drop one each).
        for path in (pieces, whole):
            self.assertEqual(frame_count(path), round(total * FPS), path)


class EveryTransitionTest(unittest.TestCase):
    def test_every_transition_renders(self) -> None:
        """Each editor transition is a transition the bundled ffmpeg knows,
        and the export keeps its length with all of them in one video."""
        tmp = tempfile.mkdtemp(prefix="transition-test-")
        src = os.path.join(tmp, "steps.mp4")
        make_color_steps(src)
        kinds = list(editor.TRANSITIONS)
        plan = plan_of(src, len(kinds) + 1)
        for clip, kind in zip(plan.clips, kinds):
            clip.transition, clip.transition_duration = kind, 0.2
        out = os.path.join(tmp, "all.mp4")
        render(plan, out)
        check = plan_of(src, len(kinds) + 1)
        for clip, kind in zip(check.clips, kinds):
            clip.transition, clip.transition_duration = kind, 0.2
        editor.quantize_plan(check)
        encoders.validate_output(out, duration=editor.timeline_duration(check), width=W, height=H, video=True, audio=True, fps=FPS)


def frame_count(path: str) -> int:
    err = subprocess.run([get_ffmpeg_path(), "-hide_banner", "-i", path, "-map", "0:v", "-f", "null", "-"], capture_output=True, text=True).stderr
    return int(err.rsplit("frame=", 1)[1].split()[0])


if __name__ == "__main__":
    unittest.main()
