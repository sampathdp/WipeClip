"""Audio mixing and sync in the export (app/pipeline/editor.py master_chain
and the mix) and noise reduction of whole audio tracks
(app/pipeline/audio_clean.py): sound stays on the frames it belongs to
through speed changes, transitions, added tracks, the limiter and the
cleaned copy, and the mix never clips. Real ffmpeg on synthetic media
whose picture flashes exactly when its sound clicks.

Run from the backend folder:  python -m unittest tests.test_audio_mix
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import tempfile
import unittest
from unittest import mock

import numpy as np
from fastapi.testclient import TestClient

from app import main
from app.pipeline import audio_clean, editor
from app.pipeline.video import get_ffmpeg_path

FF = get_ffmpeg_path()
W, H, FPS = 160, 90, 30
RATE = 48000
FLASHES = (1.0, 2.5, 4.0, 5.0)  # source seconds of each flash + click


def _between(times: tuple[float, ...], width: float) -> str:
    return "+".join(f"between(t\\,{t}\\,{t + width})" for t in times)


def make_flash_clicks(path: str, duration: float = 6.0) -> None:
    """Black video with a white frame at each FLASHES time and a 5 ms
    1 kHz click at the same instant."""
    boxes = ",".join(f"drawbox=c=white:t=fill:enable='between(t,{t},{t + 0.5 / FPS})'" for t in FLASHES)
    subprocess.run(
        [FF, "-y", "-loglevel", "error",
         "-f", "lavfi", "-i", f"color=black:s={W}x{H}:r={FPS}:d={duration},{boxes},format=yuv420p",
         "-f", "lavfi", "-i", f"aevalsrc='0.8*sin(2*PI*1000*t)*({_between(FLASHES, 0.02)})':s={RATE}:c=stereo:d={duration}",
         "-c:v", "libx264", "-crf", "18", "-g", "1", "-c:a", "pcm_s16le", path],
        check=True,
    )  # fmt: skip


def make_wav(path: str, expr: str, duration: float) -> None:
    subprocess.run([FF, "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"aevalsrc='{expr}':s={RATE}:d={duration}", path], check=True)


def audio_of(path: str, channels: int = 1) -> np.ndarray:
    """Decoded samples; with channels=2 interleaved L/R as stored (a mono
    downmix adds about 3 dB to identical channels, so peaks are read per
    channel)."""
    raw = subprocess.run(
        [FF, "-loglevel", "error", "-i", path, "-vn", "-ac", str(channels), "-ar", str(RATE), "-f", "f32le", "-"], capture_output=True, check=True
    ).stdout
    return np.frombuffer(raw, np.float32)


def clicks(x: np.ndarray, threshold: float = 0.2) -> list[float]:
    """Onset times of clicks: loud samples after at least 50 ms of quiet."""
    loud = np.flatnonzero(np.abs(x) > threshold)
    out: list[float] = []
    last = -1e9
    for i in loud:
        if i - last > 0.05 * RATE:
            out.append(i / RATE)
        last = i
    return out


def flashes(path: str) -> list[float]:
    raw = subprocess.run(
        [FF, "-loglevel", "error", "-i", path, "-vf", "scale=16:9,format=gray", "-f", "rawvideo", "-"], capture_output=True, check=True
    ).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, 16 * 9).mean(axis=1)
    lit = np.flatnonzero(frames > 128)
    out: list[float] = []
    for i in lit:
        if not out or i / FPS - out[-1] > 0.1:
            out.append(i / FPS)
    return out


def clip(src: str, start: float, duration: float, **kw) -> editor.PlanClip:
    return editor.PlanClip(source_path=src, source_has_audio=True, source_width=W, source_height=H, start=start, duration=duration, **kw)


def render(plan: editor.ExportPlan, out: str) -> None:
    asyncio.run(editor.render_export(plan, out))


class MasterChainTest(unittest.TestCase):
    def test_limiter_compensates_its_lookahead(self) -> None:
        self.assertIn("latency=1", editor.master_chain(0))
        self.assertNotIn("volume", editor.master_chain(0.01))
        self.assertIn("volume=6.00dB", editor.master_chain(6))
        # Clamped to the range the API accepts.
        self.assertIn("volume=24.00dB", editor.master_chain(99))

    def test_limiter_adds_no_delay(self) -> None:
        src = "aevalsrc='0.5*between(t\\,1\\,1.0005)':s=48000:d=2"
        for chain in ("anull", editor.master_chain(0)):
            raw = subprocess.run(
                [FF, "-loglevel", "error", "-f", "lavfi", "-i", src, "-af", chain, "-ac", "1", "-f", "f32le", "-"], capture_output=True, check=True
            ).stdout
            x = np.frombuffer(raw, np.float32)
            self.assertEqual(len(x), 2 * RATE, chain)
            self.assertAlmostEqual(int(np.argmax(np.abs(x))) / RATE, 1.0, delta=0.0002, msg=chain)


class ExportSyncTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = tempfile.TemporaryDirectory()
        cls.src = os.path.join(cls.dir.name, "flash.mov")
        make_flash_clicks(cls.src)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.dir.cleanup()

    def assert_in_sync(self, out: str, expected: int) -> None:
        v = flashes(out)
        a = clicks(audio_of(out))
        self.assertEqual(len(v), expected, f"flashes {v}")
        self.assertEqual(len(a), expected, f"clicks {a}")
        for fv, fa in zip(v, a):
            # Within one frame: the flash is quantized to frames, the click isn't.
            self.assertLess(abs(fa - fv), 1 / FPS + 0.006, f"flash {fv:.3f}s, click {fa:.3f}s")

    def test_speed_change_and_transition_keep_sound_on_its_frames(self) -> None:
        plan = editor.ExportPlan(
            width=W, height=H, fps=FPS, with_audio=True,
            clips=[
                clip(self.src, 0.0, 3.0, transition="crossfade", transition_duration=0.2),
                clip(self.src, 3.0, 3.0, speed=2.0),
            ],
        )  # fmt: skip
        out = os.path.join(self.dir.name, "speed.mp4")
        render(plan, out)
        self.assert_in_sync(out, 4)

    def test_trimmed_clips_and_master_gain_stay_in_sync(self) -> None:
        # Two cuts out of the source (a trimmed edit), louder by 6 dB.
        plan = editor.ExportPlan(
            width=W, height=H, fps=FPS, with_audio=True, clips=[clip(self.src, 0.5, 1.0), clip(self.src, 3.5, 2.0)], master_gain_db=6.0
        )
        out = os.path.join(self.dir.name, "trim.mp4")
        render(plan, out)
        self.assert_in_sync(out, 3)  # 1.0, then 4.0 and 5.0

    def test_added_track_lands_on_its_timeline_time(self) -> None:
        wav = os.path.join(self.dir.name, "click.wav")
        make_wav(wav, f"0.6*sin(2*PI*1000*t)*({_between((0.5,), 0.005)})", 2.0)
        plan = editor.ExportPlan(
            width=W, height=H, fps=FPS, with_audio=True,
            clips=[clip(self.src, 0.0, 0.8, volume=0.0)],  # the clip's own clicks are silent
            audio=[editor.PlanAudio(path=wav, start=0.2, offset=0.0, duration=0.6)],
            output_format="audio",
        )  # fmt: skip
        out = os.path.join(self.dir.name, "track.m4a")
        render(plan, out)
        a = clicks(audio_of(out))
        self.assertEqual(len(a), 1, a)
        self.assertAlmostEqual(a[0], 0.7, delta=0.003)


class MixClippingTest(unittest.TestCase):
    def test_loud_tracks_summed_and_boosted_do_not_clip(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "flash.mov")
            make_flash_clicks(src, 3.0)
            tone = os.path.join(d, "tone.wav")
            make_wav(tone, "0.8*sin(2*PI*220*t)", 3.0)
            plan = editor.ExportPlan(
                width=W, height=H, fps=FPS, with_audio=True,
                clips=[clip(src, 0.0, 3.0, volume=2.0)],
                audio=[editor.PlanAudio(path=tone, start=0, offset=0, duration=3.0, volume=2.0),
                       editor.PlanAudio(path=tone, start=0, offset=0, duration=3.0, volume=2.0)],
                master_gain_db=12.0, output_format="audio",
            )  # fmt: skip
            out = os.path.join(d, "loud.m4a")
            render(plan, out)
            x = audio_of(out, channels=2)
            # The limiter holds about -1 dBFS; AAC coding adds a little ripple.
            self.assertLess(float(np.max(np.abs(x))), 0.99)
            self.assertGreater(float(np.max(np.abs(x))), 0.8)
            self.assertAlmostEqual(len(x) / 2 / RATE, 3.0, delta=0.03)

    def test_missing_track_file_fails_cleanly(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "flash.mov")
            make_flash_clicks(src, 2.0)
            plan = editor.ExportPlan(
                width=W, height=H, fps=FPS, with_audio=True, clips=[clip(src, 0.0, 2.0)],
                audio=[editor.PlanAudio(path=os.path.join(d, "gone.wav"), start=0, offset=0, duration=1.0)],
            )  # fmt: skip
            with self.assertRaises(Exception):
                render(plan, os.path.join(d, "out.mp4"))


class MonoLevelTest(unittest.TestCase):
    """Mono sources (a microphone) play at full level on both sides, as in
    players and the preview; ffmpeg's own upmix is 3 dB lower."""

    def test_detects_mono_streams(self) -> None:
        self.assertTrue(editor.audio_is_mono("  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, mono, fltp, 69 kb/s"))
        self.assertFalse(editor.audio_is_mono("  Stream #0:0: Audio: opus, 48000 Hz, stereo, fltp"))
        self.assertFalse(editor.audio_is_mono("  Stream #0:0: Video: h264, yuv420p, 1920x1080"))

    def test_mono_track_and_clip_keep_their_level(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            mic = os.path.join(d, "mic.wav")
            make_wav(mic, "0.5*sin(2*PI*440*t)", 2.0)
            self.assertTrue(editor.probe_audio_mono(mic))
            vid = os.path.join(d, "mono.mov")
            subprocess.run(
                [FF, "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=black:s={W}x{H}:r={FPS}:d=2",
                 "-f", "lavfi", "-i", f"aevalsrc='0.5*sin(2*PI*440*t)':s={RATE}:d=2", "-c:v", "libx264", "-c:a", "pcm_s16le", vid],
                check=True,
            )  # fmt: skip
            info = editor.probe_media(vid)
            self.assertTrue(info.audio_mono)
            for name, plan in {
                "track": editor.ExportPlan(
                    width=W, height=H, fps=FPS, with_audio=True, output_format="audio",
                    clips=[clip(vid, 0.0, 2.0, volume=0.0, source_mono=True)],
                    audio=[editor.PlanAudio(path=mic, start=0, offset=0, duration=2.0, mono=True)],
                ),
                "clip": editor.ExportPlan(
                    width=W, height=H, fps=FPS, with_audio=True, output_format="audio", clips=[clip(vid, 0.0, 2.0, source_mono=True)]
                ),
            }.items():  # fmt: skip
                out = os.path.join(d, f"{name}.m4a")
                render(plan, out)
                x = audio_of(out, channels=2).reshape(-1, 2)
                peaks = np.abs(x[RATE // 4 : -RATE // 4]).max(axis=0)
                for p in peaks:
                    self.assertAlmostEqual(float(p), 0.5, delta=0.03, msg=f"{name}: {peaks}")


class TrackCleanupTest(unittest.TestCase):
    """Noise reduction of a whole audio track: the copy must line up with
    the original, since the editor swaps one for the other in place."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = tempfile.TemporaryDirectory()
        cls.src = os.path.join(cls.dir.name, "mic.wav")
        # Steady hiss with clicks at known times (a microphone track).
        clicks_expr = f"0.7*sin(2*PI*1000*t)*({_between((0.75, 2.0, 3.25), 0.005)})"
        subprocess.run(
            [FF, "-y", "-loglevel", "error",
             "-f", "lavfi", "-i", f"aevalsrc='{clicks_expr}':s={RATE}:d=4",
             "-f", "lavfi", "-i", f"anoisesrc=color=white:amplitude=0.03:s={RATE}:d=4",
             "-filter_complex", "[0:a][1:a]amix=inputs=2:normalize=0", cls.src],
            check=True,
        )  # fmt: skip

    @classmethod
    def tearDownClass(cls) -> None:
        cls.dir.cleanup()

    def test_cleaned_copy_lines_up_and_is_quieter_between_clicks(self) -> None:
        out = os.path.join(self.dir.name, "clean.m4a")
        asyncio.run(audio_clean.clean_audio(self.src, out, 0.0, 4.0, 0.6, False))
        before, after = audio_of(self.src), audio_of(out)
        self.assertAlmostEqual(len(after) / RATE, len(before) / RATE, delta=0.025)
        for t0, t1 in zip(clicks(before), clicks(after)):
            self.assertAlmostEqual(t0, t1, delta=0.001)
        quiet = slice(int(1.0 * RATE), int(1.8 * RATE))
        rms = lambda x: float(np.sqrt(np.mean(x[quiet].astype(np.float64) ** 2)))  # noqa: E731
        self.assertLess(rms(after), rms(before) * 0.5)

    def test_engine_accepts_an_audio_file(self) -> None:
        with mock.patch.object(main, "LOCAL_MODE", True):
            res = TestClient(main.app).post("/api/audio/clean", data={"path": self.src, "start": "0", "end": "4", "denoise": "0.4", "level": "false"})
        self.assertEqual(res.status_code, 200, res.text[:300])
        self.assertEqual(res.headers["content-type"], "audio/mp4")

    def test_a_file_without_sound_gets_a_clear_message(self) -> None:
        silent_video = os.path.join(self.dir.name, "no sound.mp4")
        subprocess.run([FF, "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=black:s={W}x{H}:r={FPS}:d=1", "-pix_fmt", "yuv420p", silent_video], check=True)
        with mock.patch.object(main, "LOCAL_MODE", True):
            res = TestClient(main.app).post("/api/audio/clean", data={"path": silent_video, "start": "0", "end": "1", "denoise": "0.6"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("no sound", res.json()["detail"])


if __name__ == "__main__":
    unittest.main()


class ClipSoundTest(unittest.TestCase):
    """A clip's own sound: fades and a volume curve (src/lib/editor/clipSound.ts),
    in clip time after speed."""

    def test_fades_and_curve(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "tone.mov")
            subprocess.run(
                [FF, "-y", "-loglevel", "error",
                 "-f", "lavfi", "-i", f"color=black:s={W}x{H}:r={FPS}:d=8,format=yuv420p",
                 "-f", "lavfi", "-i", f"aevalsrc='0.5*sin(2*PI*440*t)':s={RATE}:c=stereo:d=8",
                 "-c:v", "libx264", "-g", "1", "-c:a", "pcm_s16le", src],
                check=True,
            )  # fmt: skip
            out = os.path.join(d, "out.mp4")
            # 6 s of source at 2x: 3 s on the timeline. Fade in over 0.5 s,
            # out over 0.5 s; the curve drops to half (-6 dB) from 1.5 s.
            c = clip(src, 0.0, 6.0, speed=2.0, fade_in=0.5, fade_out=0.5, gain_points=[(0.0, 1.0), (1.4, 1.0), (1.5, 0.5), (3.0, 0.5)])
            render(editor.ExportPlan(width=W, height=H, fps=FPS, with_audio=True, clips=[c]), out)
            x = audio_of(out)

            def level(t0: float, t1: float) -> float:
                part = x[int(t0 * RATE) : int(t1 * RATE)]
                return float(np.sqrt(np.mean(part**2)))

            full = level(0.8, 1.3)
            self.assertGreater(full, 0.1)
            self.assertLess(level(0.0, 0.05), full * 0.2)  # fading in
            self.assertAlmostEqual(level(1.7, 2.3) / full, 0.5, delta=0.06)  # the curve's half
            self.assertLess(level(2.95, 3.0), full * 0.1)  # faded out

    def test_chain_without_shape_is_just_the_volume(self) -> None:
        self.assertEqual(editor._clip_sound(clip("x", 0.0, 2.0, volume=0.8)), "volume=0.8")


class WideSpeedTest(unittest.TestCase):
    """Constant speeds from 0.1x to 10x (MIN_SPEED / MAX_SPEED in
    src/lib/editor/timeline.ts): the clip lasts its source length / speed,
    with sound for all of it."""

    def test_slow_and_fast(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "tone.mov")
            subprocess.run(
                [FF, "-y", "-loglevel", "error",
                 "-f", "lavfi", "-i", f"color=gray:s={W}x{H}:r={FPS}:d=6,format=yuv420p",
                 "-f", "lavfi", "-i", f"aevalsrc='0.5*sin(2*PI*440*t)':s={RATE}:c=stereo:d=6",
                 "-c:v", "libx264", "-g", "1", "-c:a", "pcm_s16le", src],
                check=True,
            )  # fmt: skip
            for speed, source, expected in ((5.0, 5.0, 1.0), (0.25, 0.5, 2.0)):
                out = os.path.join(d, f"out{speed}.mp4")
                render(editor.ExportPlan(width=W, height=H, fps=FPS, with_audio=True, clips=[clip(src, 0.0, source, speed=speed)]), out)
                x = audio_of(out)
                self.assertAlmostEqual(len(x) / RATE, expected, delta=0.05, msg=f"{speed}x")
                self.assertGreater(float(np.sqrt(np.mean(x[: int(0.8 * expected * RATE)] ** 2))), 0.1, f"{speed}x has sound")

    def test_request_accepts_the_range(self) -> None:
        self.assertEqual(main._EditorClip(source=0, start=0, end=1, speed=0.1).speed, 0.1)
        self.assertEqual(main._EditorClip(source=0, start=0, end=1, speed=10).speed, 10)
        with self.assertRaises(Exception):
            main._EditorClip(source=0, start=0, end=1, speed=12)


def frame_at(path: str, t: float) -> np.ndarray:
    """The frame at `t` seconds as an RGB array."""
    raw = subprocess.run(
        [FF, "-loglevel", "error", "-ss", f"{t:.3f}", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True
    ).stdout
    return np.frombuffer(raw, np.uint8).reshape(H, W, 3).astype(float)


class StrengthTest(unittest.TestCase):
    """Look and effect strength over time (src/lib/editor/strength.ts): the
    graded / effected picture blended over the original by a curve."""

    def test_mix_commands(self) -> None:
        cmds = editor.mix_commands([(0.0, 0.0), (1.0, 1.0)], "blend@x", 10)
        self.assertTrue(cmds.startswith("0.0000 blend@x all_opacity 0.0000"))
        self.assertIn("0.5000 blend@x all_opacity 0.5000", cmds)
        self.assertEqual(len(cmds.split(";")), 11)
        self.assertAlmostEqual(editor.strength_at([(1.0, 0.2), (2.0, 0.8)], 0.0), 0.2)
        self.assertAlmostEqual(editor.strength_at([(1.0, 0.2), (2.0, 0.8)], 1.5), 0.5)

    def test_effect_and_look_fade_in(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            white = os.path.join(d, "white.mov")
            red = os.path.join(d, "red.mov")
            for path, color in ((white, "white"), (red, "red")):
                subprocess.run(
                    [FF, "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color={color}:s={W}x{H}:r={FPS}:d=3,format=yuv420p", "-c:v", "libx264", "-g", "1", path],
                    check=True,
                )
            # Invert fades in over 0-2 s: white, then grey, then nearly black.
            out = os.path.join(d, "fx.mp4")
            fx = editor.PlanEffect(type="invert", start=0.0, end=3.0, intensity=100, mix=[(0.0, 0.0), (2.0, 1.0)])
            c = editor.PlanClip(source_path=white, source_has_audio=False, source_width=W, source_height=H, start=0.0, duration=3.0)
            render(editor.ExportPlan(width=W, height=H, fps=FPS, with_audio=False, clips=[c], effects=[fx]), out)
            self.assertGreater(frame_at(out, 0.05).mean(), 230)
            self.assertAlmostEqual(frame_at(out, 1.0).mean(), 128, delta=25)
            self.assertLess(frame_at(out, 2.5).mean(), 30)
            # A black & white look fades in on red: saturated first, grey at the end.
            out = os.path.join(d, "look.mp4")
            c = editor.PlanClip(
                source_path=red, source_has_audio=False, source_width=W, source_height=H, start=0.0, duration=3.0,
                filter="bw", intensity=100, look_mix=[(0.0, 0.0), (2.0, 1.0)],
            )  # fmt: skip
            render(editor.ExportPlan(width=W, height=H, fps=FPS, with_audio=False, clips=[c]), out)

            def chroma(f: np.ndarray) -> float:
                return float((f.max(axis=2) - f.min(axis=2)).mean())

            self.assertGreater(chroma(frame_at(out, 0.05)), 150)
            self.assertLess(chroma(frame_at(out, 2.5)), 25)
            self.assertLess(chroma(frame_at(out, 1.0)), chroma(frame_at(out, 0.05)) - 40)
