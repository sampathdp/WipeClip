"""Layer blend modes and chroma key in the editor export, rendered with the
real ffmpeg on synthetic media and checked pixel by pixel.

Run from the backend folder:  python -m unittest tests.test_editor_layers
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest

from PIL import Image

from app.pipeline import editor
from app.pipeline.video import get_ffmpeg_path
from tests.test_focus_export import FPS, H, W, base_plan, frame_at, make_quadrants, render


def make_green_screen(path: str, seconds: float = 3.0) -> None:
    """A lime frame with a red square in the middle."""
    graph = f"color=lime:s=160x90:r={FPS}:d={seconds}[g];color=red:s=40x40:r={FPS}:d={seconds}[r];[g][r]overlay=60:25,format=yuv420p[v]"
    subprocess.run(
        [get_ffmpeg_path(), "-y", "-hide_banner", "-loglevel", "error", "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-crf", "8", path],
        check=True,
    )


class LayerExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.mkdtemp(prefix="layers-test-")
        cls.src = os.path.join(cls.tmp, "quad.mp4")
        make_quadrants(cls.src)
        cls.green = os.path.join(cls.tmp, "green.mp4")
        make_green_screen(cls.green)

    def out(self, name: str) -> str:
        return os.path.join(self.tmp, name)

    def test_chroma_key_on_video_layer(self) -> None:
        plan = base_plan(self.src)
        # Full-canvas layer: the lime turns transparent, the red square stays.
        plan.overlays.append(
            editor.PlanOverlay(
                image_path=self.green, image_width=160, image_height=90, start=0.0, end=3.0,
                x=0.5, y=0.5, width=1.0, rotation=0.0, video=True,
                key_color="#00ff00", key_similarity=30, key_smoothness=10,
            )
        )
        out = self.out("key.mp4")
        render(plan, out)
        f = frame_at(out, 1.0)
        b, g, r = (int(v) for v in f[H // 2, W // 2])
        self.assertTrue(r > 180 and g < 80 and b < 80, f"center should be the red square, got {(r, g, b)}")
        # Top-left quadrant of the base (red) and bottom-right (white) show through.
        b, g, r = (int(v) for v in f[10, 10])
        self.assertTrue(r > 180 and g < 80, f"keyed area should show the base, got {(r, g, b)}")
        b, g, r = (int(v) for v in f[H - 10, W - 10])
        self.assertTrue(min(r, g, b) > 200, f"keyed area should show the base, got {(r, g, b)}")

    def test_multiply_blend(self) -> None:
        gray = self.out("gray.png")
        Image.new("RGBA", (W, H), (128, 128, 128, 255)).save(gray)
        plan = base_plan(self.src)
        plan.overlays.append(
            editor.PlanOverlay(
                image_path=gray, image_width=W, image_height=H, start=0.0, end=2.0,
                x=0.5, y=0.5, width=1.0, rotation=0.0, blend="multiply",
            )
        )
        out = self.out("multiply.mp4")
        render(plan, out)
        f = frame_at(out, 1.0)
        b, g, r = (int(v) for v in f[H - 10, W - 10])  # white * gray = gray
        self.assertTrue(all(105 < v < 150 for v in (r, g, b)), f"white x gray should be gray, got {(r, g, b)}")
        b, g, r = (int(v) for v in f[10, 10])  # red * gray = dark red
        self.assertTrue(100 < r < 150 and g < 40 and b < 40, f"red x gray should be dark red, got {(r, g, b)}")
        # After the layer ends the video is untouched.
        b, g, r = (int(v) for v in frame_at(out, 2.5)[H - 10, W - 10])
        self.assertTrue(min(r, g, b) > 200, f"after the layer, white stays white, got {(r, g, b)}")

    def test_screen_blend_small_layer_leaves_rest(self) -> None:
        gray = self.out("gray-small.png")
        Image.new("RGBA", (64, 36), (128, 128, 128, 255)).save(gray)
        plan = base_plan(self.src)
        plan.overlays.append(
            editor.PlanOverlay(
                image_path=gray, image_width=64, image_height=36, start=0.0, end=3.0,
                x=0.25, y=0.25, width=0.2, rotation=0.0, blend="screen",
            )
        )
        out = self.out("screen.mp4")
        render(plan, out)
        f = frame_at(out, 1.0)
        b, g, r = (int(v) for v in f[H // 4, W // 4])  # red screen gray = (255, 128, 128)
        self.assertTrue(r > 220 and 100 < g < 160 and 100 < b < 160, f"red screen gray, got {(r, g, b)}")
        b, g, r = (int(v) for v in f[5, 5])  # outside the layer: plain red
        self.assertTrue(r > 180 and g < 60 and b < 60, f"outside the layer stays red, got {(r, g, b)}")


def kf(t: float, x: float = 0.5, y: float = 0.5, scale: float = 1.0, rotation: float = 0.0, opacity: float = 1.0, ease: str = "linear") -> dict:
    return {"t": t, "x": x, "y": y, "scale": scale, "rotation": rotation, "opacity": opacity, "ease": ease}


def magenta_center(frame) -> tuple[float, float]:
    import numpy as np

    b, g, r = (frame[..., i].astype(int) for i in range(3))
    mask = (r > 180) & (b > 180) & (g < 90)
    ys, xs = np.nonzero(mask)
    assert len(xs), "no magenta found"
    return float(xs.mean()), float(ys.mean())


class KeyframeExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.mkdtemp(prefix="keyframes-test-")
        cls.src = os.path.join(cls.tmp, "quad.mp4")
        make_quadrants(cls.src)
        cls.square = os.path.join(cls.tmp, "magenta.png")
        Image.new("RGBA", (32, 32), (255, 0, 255, 255)).save(cls.square)
        cls.black = os.path.join(cls.tmp, "black.mp4")
        subprocess.run(
            [get_ffmpeg_path(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=black:s={W}x{H}:r={FPS}:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", cls.black],
            check=True,
        )

    def layer(self, **kw) -> editor.PlanOverlay:
        base = dict(image_path=self.square, image_width=32, image_height=32, start=0.0, end=3.0, x=0.5, y=0.5, width=0.1, rotation=0.0)
        base.update(kw)
        return editor.PlanOverlay(**base)

    def test_layer_moves_between_keyframes(self) -> None:
        plan = base_plan(self.black)
        plan.overlays.append(self.layer(keyframes=[kf(0.5, x=0.25), kf(2.5, x=0.75)]))
        out = os.path.join(self.tmp, "move.mp4")
        render(plan, out)
        for t, want in ((0.2, 0.25), (1.0, 0.375), (1.5, 0.5), (2.0, 0.625), (2.8, 0.75)):
            x, y = magenta_center(frame_at(out, t))
            self.assertAlmostEqual(x / W, want, delta=0.02, msg=f"x at {t}")
            self.assertAlmostEqual(y / H, 0.5, delta=0.03)

    def test_late_layers_show_only_in_their_time(self) -> None:
        """Still layers are looped for their own length and shifted into
        place (not looped from 0): they must still appear exactly in their
        range, keyframes in timeline time, shape masks lined up."""
        from PIL import ImageDraw

        mask = os.path.join(self.tmp, "disc.png")
        img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        ImageDraw.Draw(img).ellipse((8, 8, 24, 24), fill=(255, 255, 255, 255))
        img.save(mask)
        plan = base_plan(self.black)
        plan.overlays.append(self.layer(start=1.0, end=2.0, keyframes=[kf(1.0, x=0.25), kf(2.0, x=0.75)]))
        plan.overlays.append(self.layer(start=2.2, end=2.9, width=0.4, mask_path=mask))
        out = os.path.join(self.tmp, "late.mp4")
        render(plan, out)
        import numpy as np

        def magenta(frame) -> int:
            b, g, r = (frame[..., i].astype(int) for i in range(3))
            return int(((r > 180) & (b > 180) & (g < 90)).sum())

        self.assertEqual(magenta(frame_at(out, 0.8)), 0, "nothing before the layer starts")
        x, _ = magenta_center(frame_at(out, 1.5))
        self.assertAlmostEqual(x / W, 0.5, delta=0.03, msg="keyframes in timeline time")
        self.assertEqual(magenta(frame_at(out, 2.1)), 0, "gone after its end")
        f = frame_at(out, 2.5)
        self.assertGreater(magenta(f), 0, "the masked layer shows in its range")
        b, g, r = (int(v) for v in f[H // 2, W // 2])
        self.assertTrue(r > 180 and b > 180, f"inside the disc, got {(r, g, b)}")
        side = W // 2 - int(0.4 * W * 0.45)
        self.assertLess(int(np.asarray(f[H // 2, side]).max()), 60, "outside the disc is hidden")
        self.assertEqual(magenta(frame_at(out, 2.95)), 0)

    def test_layer_scale_rotation_opacity(self) -> None:
        plan = base_plan(self.black)
        plan.overlays.append(
            self.layer(keyframes=[kf(0.0, scale=1.0, rotation=0, opacity=0.0), kf(2.0, scale=2.0, rotation=90, opacity=1.0)])
        )
        out = os.path.join(self.tmp, "scale.mp4")
        render(plan, out)
        f = frame_at(out, 1.0)  # scale 1.5, half opacity
        px = f[H // 2, W // 2]
        self.assertTrue(100 < int(px[2]) < 160 and int(px[1]) < 40, f"half-opaque magenta, got {px[::-1]}")
        f = frame_at(out, 2.5)  # scale 2 (64px wide at 320), full opacity
        import numpy as np

        row = f[H // 2]
        on = np.nonzero((row[:, 2] > 180) & (row[:, 0] > 180))[0]
        self.assertAlmostEqual(len(on), 64, delta=4)

    def test_spin_in_leaves_no_trail(self) -> None:
        import numpy as np

        plan = base_plan(self.black)
        plan.overlays.append(self.layer(anim_in="spin", width=0.2))
        out = os.path.join(self.tmp, "spin.mp4")
        render(plan, out)
        row = frame_at(out, 1.5)[H // 2]
        on = np.nonzero((row[:, 2] > 100) & (row[:, 0] > 100))[0]
        self.assertAlmostEqual(len(on), 64, delta=4, msg="a turned layer must not leave earlier angles behind")

    def test_clip_keyframes_scale_and_move(self) -> None:
        plan = base_plan(self.src, keyframes=[kf(0.0, scale=1.0), kf(2.0, x=0.75, scale=0.5)])
        out = os.path.join(self.tmp, "clip.mp4")
        render(plan, out)
        f = frame_at(out, 0.0)
        self.assertGreater(int(f[5, 5][2]), 180)  # full frame: red corner
        f = frame_at(out, 2.5)  # half size, centered at x=0.75: left half black
        self.assertLess(int(f[H // 2, 20].max()), 40)
        # Its top-left (red) quadrant now sits around (0.5..0.75, 0.25..0.5).
        b, g, r = (int(v) for v in f[int(H * 0.4), int(W * 0.6)])
        self.assertTrue(r > 180 and g < 80, f"red quadrant moved, got {(r, g, b)}")


class SpeedRampExportTest(unittest.TestCase):
    def test_ramp_retimes_picture_and_sound(self) -> None:
        tmp = tempfile.mkdtemp(prefix="ramp-test-")
        # 4 s source: red for 2 s, then blue; with a tone so audio is mixed.
        src = os.path.join(tmp, "rb.mp4")
        graph = (
            f"color=red:s={W}x{H}:r={FPS}:d=2[a];color=blue:s={W}x{H}:r={FPS}:d=2[b];[a][b]concat=n=2:v=1:a=0,format=yuv420p[v];"
            "sine=f=440:d=4[s]"
        )
        subprocess.run(
            [get_ffmpeg_path(), "-y", "-loglevel", "error", "-filter_complex", graph, "-map", "[v]", "-map", "[s]", "-c:v", "libx264", "-c:a", "aac", "-shortest", src],
            check=True,
        )
        # First half (red, 2 s) at 4x = 0.5 s; second half (blue) at 0.5x = 4 s.
        clip = editor.PlanClip(
            source_path=src, source_has_audio=True, source_width=W, source_height=H, start=0.0, duration=4.0,
            ramp=[4.0] * 12 + [0.5] * 12,
        )
        plan = editor.ExportPlan(width=W, height=H, fps=FPS, with_audio=True, clips=[clip])
        out = os.path.join(tmp, "ramp.mp4")
        render(plan, out)
        self.assertAlmostEqual(editor.timeline_duration(plan), 4.5, delta=0.05)
        probe = editor.probe_media(out)
        self.assertAlmostEqual(probe.duration, 4.5, delta=0.15)

        def is_red(t: float) -> bool:
            b, g, r = (int(v) for v in frame_at(out, t)[H // 2, W // 2])
            return r > 180 and b < 80

        self.assertTrue(is_red(0.3))
        self.assertFalse(is_red(0.7))
        self.assertFalse(is_red(4.2))

    def test_short_ramped_clip_next_to_another_exports(self) -> None:
        # A 0.34 s clip with a gentle ramp: its 24 sound pieces (14 ms each)
        # are too short for atempo, which used to leave the clip silent with
        # no timestamps and fail the export at the next clip.
        tmp = tempfile.mkdtemp(prefix="ramp-short-")
        src = os.path.join(tmp, "tone.mp4")
        subprocess.run(
            [get_ffmpeg_path(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=gray:s={W}x{H}:r={FPS}:d=4",
             "-f", "lavfi", "-i", "sine=f=440:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src],
            check=True,
        )
        ramp = [round(1.048 - 0.002 * n, 3) for n in range(24)]
        short = editor.PlanClip(source_path=src, source_has_audio=True, source_width=W, source_height=H, start=1.0, duration=0.335, ramp=ramp)
        after = editor.PlanClip(source_path=src, source_has_audio=True, source_width=W, source_height=H, start=2.0, duration=1.5)
        plan = editor.ExportPlan(width=W, height=H, fps=FPS, with_audio=True, clips=[short, after])
        out = os.path.join(tmp, "out.mp4")
        render(plan, out)
        probe = editor.probe_media(out)
        self.assertAlmostEqual(probe.duration, editor.timeline_duration(plan), delta=0.15)
        self.assertGreater(audio_rms(out, 0.05, 0.2), 0.05, "the short clip keeps its sound")
        self.assertGreater(audio_rms(out, 0.6, 1.0), 0.05)


def audio_rms(path: str, start: float, dur: float) -> float:
    import numpy as np

    raw = subprocess.run(
        [get_ffmpeg_path(), "-loglevel", "error", "-ss", str(start), "-t", str(dur), "-i", path, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    x = np.frombuffer(raw, dtype=np.float32)
    return float(np.sqrt(np.mean(x * x))) if len(x) else 0.0


class AudioTrackExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.mkdtemp(prefix="audio-test-")
        cls.src = os.path.join(cls.tmp, "quad.mp4")
        make_quadrants(cls.src, seconds=4.0)
        cls.tone = os.path.join(cls.tmp, "tone.wav")
        subprocess.run([get_ffmpeg_path(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=440:d=4", cls.tone], check=True)

    def plan(self, **audio_kw) -> editor.ExportPlan:
        clip = editor.PlanClip(source_path=self.src, source_has_audio=False, source_width=W, source_height=H, start=0.0, duration=4.0)
        plan = editor.ExportPlan(width=W, height=H, fps=FPS, with_audio=True, clips=[clip])
        plan.audio.append(editor.PlanAudio(path=self.tone, start=0.0, offset=0.0, duration=4.0, **audio_kw))
        return plan

    def test_ducking_lowers_during_speech(self) -> None:
        out = os.path.join(self.tmp, "duck.mp4")
        render(self.plan(duck_amount=0.9, duck_regions=[(1.5, 2.5)]), out)
        loud, quiet = audio_rms(out, 0.3, 0.6), audio_rms(out, 1.7, 0.6)
        self.assertGreater(loud, 0.05)
        self.assertAlmostEqual(quiet / loud, 0.1, delta=0.04)
        self.assertGreater(audio_rms(out, 3.3, 0.5) / loud, 0.9)

    def test_voice_effects_render(self) -> None:
        for fx in editor.VOICE_FX:
            out = os.path.join(self.tmp, f"voice-{fx}.mp4")
            render(self.plan(voice=fx), out)
            self.assertGreater(audio_rms(out, 1.0, 1.0), 0.01, fx)
            self.assertAlmostEqual(editor.probe_media(out).duration, 4.0, delta=0.15)


class ShapeMaskExportTest(unittest.TestCase):
    def test_clip_and_video_layer_masks(self) -> None:
        from PIL import ImageDraw

        tmp = tempfile.mkdtemp(prefix="mask-test-")
        src = os.path.join(tmp, "quad.mp4")
        make_quadrants(src)
        # White disc in the middle of a black (hidden) frame.
        mask = os.path.join(tmp, "mask.png")
        img = Image.new("RGBA", (160, 90), (0, 0, 0, 0))
        ImageDraw.Draw(img).ellipse((50, 15, 110, 75), fill=(255, 255, 255, 255))
        img.save(mask)
        plan = base_plan(src, mask_path=mask)
        out = os.path.join(tmp, "clip-mask.mp4")
        render(plan, out)
        f = frame_at(out, 1.0)
        self.assertLess(int(f[5, 5].max()), 40, "outside the mask shows the background")
        self.assertGreater(int(f[H // 2 - 10, W // 2 - 10][2]), 180, "inside shows the clip (red quadrant)")

        # The same mask on a full-canvas video layer over the clip.
        green = os.path.join(tmp, "green.mp4")
        subprocess.run(
            [get_ffmpeg_path(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=lime:s=160x90:r={FPS}:d=3", "-pix_fmt", "yuv420p", green],
            check=True,
        )
        plan = base_plan(src)
        plan.overlays.append(
            editor.PlanOverlay(image_path=green, image_width=160, image_height=90, start=0.0, end=3.0, x=0.5, y=0.5, width=1.0, rotation=0.0, video=True, mask_path=mask)
        )
        out = os.path.join(tmp, "layer-mask.mp4")
        render(plan, out)
        f = frame_at(out, 1.0)
        b, g, r = (int(v) for v in f[H // 2, W // 2])
        self.assertTrue(g > 180 and r < 80, f"layer shows inside its mask, got {(r, g, b)}")
        b, g, r = (int(v) for v in f[5, 5])
        self.assertTrue(r > 180 and g < 80, f"base shows outside the layer's mask, got {(r, g, b)}")


class ColorExportTest(unittest.TestCase):
    def test_lut_and_curves(self) -> None:
        tmp = tempfile.mkdtemp(prefix="color-test-")
        src = os.path.join(tmp, "quad.mp4")
        make_quadrants(src)
        # A 2-point LUT that swaps red and blue, full strength.
        data = []
        for b in (0.0, 1.0):
            for g in (0.0, 1.0):
                for r in (0.0, 1.0):
                    data += [b, g, r]
        out = os.path.join(tmp, "lut.mp4")
        render(base_plan(src, lut_size=2, lut_data=data, lut_intensity=100), out)
        b, g, r = (int(v) for v in frame_at(out, 1.0)[H // 4, W // 4])  # red quadrant
        self.assertTrue(b > 180 and r < 80, f"red becomes blue, got {(r, g, b)}")
        # Curves that invert every channel: white turns black.
        inv = [[1 - i / 63 for i in range(64)]] * 3
        out = os.path.join(tmp, "curve.mp4")
        render(base_plan(src, curve=inv), out)
        self.assertLess(int(frame_at(out, 1.0)[H * 3 // 4, W * 3 // 4].max()), 40)


class StabilizeExportTest(unittest.TestCase):
    def test_shaky_clip_is_steadied(self) -> None:
        import asyncio

        import numpy as np

        tmp = tempfile.mkdtemp(prefix="stab-test-")
        # A textured frame jittering a few pixels every frame.
        src = os.path.join(tmp, "shaky.mp4")
        graph = (
            f"testsrc2=s={W + 40}x{H + 40}:r={FPS}:d=3,"
            f"crop={W}:{H}:x='20+12*sin(n*2.1)':y='20+12*cos(n*1.7)',format=yuv420p"
        )
        subprocess.run([get_ffmpeg_path(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", graph, "-c:v", "libx264", "-crf", "12", src], check=True)

        def jitter(path: str) -> float:
            # Mean frame-to-frame difference: lower = steadier.
            frames = [frame_at(path, t).astype(np.float32) for t in np.arange(1.0, 2.0, 1 / FPS)]
            return float(np.mean([np.abs(a - b).mean() for a, b in zip(frames, frames[1:])]))

        out = os.path.join(tmp, "steady.mp4")
        plan = base_plan(src, stabilize=80)
        asyncio.run(editor.prepare_stabilization(plan, tmp))
        if editor.has_vidstab():
            self.assertIsNotNone(plan.clips[0].stab_path)
        render(plan, out)
        self.assertLess(jitter(out), jitter(src) * 0.8)


class OutputFormatTest(unittest.TestCase):
    def test_gif_and_audio_only(self) -> None:
        tmp = tempfile.mkdtemp(prefix="format-test-")
        src = os.path.join(tmp, "quad.mp4")
        make_quadrants(src, seconds=2.0)
        tone = os.path.join(tmp, "tone.wav")
        subprocess.run([get_ffmpeg_path(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=440:d=2", tone], check=True)

        def plan(fmt: str) -> editor.ExportPlan:
            clip = editor.PlanClip(source_path=src, source_has_audio=False, source_width=W, source_height=H, start=0.0, duration=2.0)
            p = editor.ExportPlan(width=W, height=H, fps=FPS, with_audio=fmt == "audio", clips=[clip], output_format=fmt)
            if fmt == "audio":
                p.audio.append(editor.PlanAudio(path=tone, start=0.0, offset=0.0, duration=2.0))
            return p

        gif = os.path.join(tmp, "out.gif")
        render(plan("gif"), gif)
        with Image.open(gif) as im:
            self.assertEqual(im.format, "GIF")
            self.assertGreater(getattr(im, "n_frames", 1), 20)
        m4a = os.path.join(tmp, "out.m4a")
        render(plan("audio"), m4a)
        self.assertGreater(audio_rms(m4a, 0.5, 1.0), 0.05)
        self.assertAlmostEqual(editor.probe_audio(m4a), 2.0, delta=0.15)


class TextSpriteExportTest(unittest.TestCase):
    def test_sprite_states_follow_their_times(self) -> None:
        tmp = tempfile.mkdtemp(prefix="sprite-test-")
        black = os.path.join(tmp, "black.mp4")
        subprocess.run(
            [get_ffmpeg_path(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=black:s={W}x{H}:r={FPS}:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", black],
            check=True,
        )
        # 2 x 2 grid of 40 x 20 cells: red, green, blue, white.
        sheet = Image.new("RGBA", (80, 40))
        for i, c in enumerate([(255, 0, 0, 255), (0, 255, 0, 255), (0, 0, 255, 255), (255, 255, 255, 255)]):
            sheet.paste(Image.new("RGBA", (40, 20), c), ((i % 2) * 40, (i // 2) * 20))
        path = os.path.join(tmp, "sheet.png")
        sheet.save(path)
        plan = base_plan(black)
        plan.overlays.append(
            editor.PlanOverlay(
                image_path=path, image_width=40, image_height=20, start=0.5, end=3.0, x=0.5, y=0.5, width=0.5, rotation=0.0,
                sprite_cols=2, sprite_rows=2, sprite_times=[0.5, 1.0, 1.5, 2.0],
            )
        )
        out = os.path.join(tmp, "sprite.mp4")
        render(plan, out)
        for t, want in ((0.7, "red"), (1.2, "green"), (1.7, "blue"), (2.5, "white")):
            b, g, r = (int(v) for v in frame_at(out, t)[H // 2, W // 2])
            got = "white" if min(r, g, b) > 200 else "red" if r > 180 and g < 80 else "green" if g > 180 and r < 80 else "blue" if b > 180 and r < 80 else str((r, g, b))
            self.assertEqual(got, want, f"state at {t}")
        # Whole layer is one cell: 0.5 of the width = 160 px.
        import numpy as np

        row = frame_at(out, 0.7)[H // 2]
        self.assertAlmostEqual(len(np.nonzero(row[:, 2] > 180)[0]), 160, delta=3)


if __name__ == "__main__":
    unittest.main()
