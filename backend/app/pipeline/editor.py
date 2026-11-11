"""Timeline export for the browser editor (/editor on the frontend).

The editor is non-destructive: the browser never modifies the uploaded
files, it only keeps a project description. This module turns that
description into a single ffmpeg run, so every edit visible in the editor
is an actual operation in the exported file:

  1. Clips. Each clip is its own input, opened with input-level `-ss`/`-t`
     (fast keyframe seek + frame-accurate decode, since we always
     re-encode), so a deleted section is simply never read - no gap, no
     black or frozen frames, no audio hole. Per clip: speed (setpts/atempo),
     color grade (look.py, baked into a 3D LUT), sharpen/blur, then placement
     on the canvas - fit or fill, plus the clip's own position/scale/
     rotation/opacity - over the canvas background (color, gradient, a
     blurred copy of the clip, or an image). A clip can also be cropped,
     reversed (reverse/areverse) or be a freeze frame (one decoded frame
     held for the clip's length, silent).
  2. Joins. Clips (now all canvas-sized, same fps/SAR/format) are joined
     pairwise with `concat` (a cut) or `xfade` + `acrossfade` (a
     transition), overlapping exactly like the editor's timeline math.
  3. Effects. Timed effects run on the joined video, each limited to its
     time range with ffmpeg's timeline `enable`.
  3b. Focus zooms and pointer effects (desktop screen recordings). The
     browser evaluates the camera window and the cursor/click-ring state
     per output frame with the same code its preview uses
     (src/lib/editor/focusExport.ts) and sends only the changes; here they
     become per-frame step expressions (step_expr) that drive a per-clip
     zoom (scale + overlay inside the clip's fitted box) and four ring
     layers plus a cursor sprite. Nothing about easing or smoothing is re-derived here,
     so preview and export can't drift apart.
  4. Overlays. Stickers, text and images - all PNGs rasterized by the
     browser, the same images the preview shows - and picture-in-picture
     video layers are composited bottom to top with their position, size,
     rotation, opacity, time range and in/out animation. A video layer's
     sound joins the audio mix like an audio clip.
  5. Audio. The clips' own audio (after joins) is mixed with every added /
     extracted audio clip (trimmed, delayed to its timeline position, with
     volume and fades), then the master bus: the editor's loudness gain and
     a peak limiter, so the mix can't clip (master_chain).

Clip and transition durations are quantized to whole frames before
building the graph so video and audio lengths agree exactly per clip -
otherwise per-clip rounding drift accumulates across many cuts and audio
slides out of sync.

Everything in `ExportPlan` is server-validated (see api_video_export in
app/main.py); nothing here ever takes a path or filter fragment from the
client.
"""

from __future__ import annotations

import functools
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Optional

import numpy as np

from app.config import VIDEO_ENCODE_CRF, VIDEO_ENCODE_PRESET
from app.pipeline import encoders
from app.pipeline import look as look_pipeline
from app.pipeline.video import _run_ffmpeg, get_ffmpeg_path

if TYPE_CHECKING:
    from app.progress import JobProgress

# Editor transition type -> (xfade transition, audio style). "dip" audio
# fades the outgoing clip's sound out before the incoming one fades in (a
# short dip, matching a picture that passes through a fade/solid color);
# "blend" is a regular overlapping audio crossfade.
TRANSITIONS: dict[str, tuple[str, str]] = {
    "fade": ("fade", "dip"),
    "crossfade": ("fade", "blend"),
    "dipblack": ("fadeblack", "dip"),
    "dipwhite": ("fadewhite", "dip"),
    "slideleft": ("slideleft", "blend"),
    "slideright": ("slideright", "blend"),
    "zoom": ("zoomin", "blend"),
    "blur": ("hblur", "blend"),
    "slideup": ("slideup", "blend"),
    "slidedown": ("slidedown", "blend"),
    "wipeleft": ("wipeleft", "blend"),
    "wiperight": ("wiperight", "blend"),
    "wipeup": ("wipeup", "blend"),
    "wipedown": ("wipedown", "blend"),
    "circleopen": ("circleopen", "blend"),
    "circleclose": ("circleclose", "blend"),
    "smoothleft": ("smoothleft", "blend"),
    "smoothright": ("smoothright", "blend"),
    "smoothup": ("smoothup", "blend"),
    "smoothdown": ("smoothdown", "blend"),
    "vertopen": ("vertopen", "blend"),
    "horzopen": ("horzopen", "blend"),
    "radial": ("radial", "blend"),
    "diagtl": ("diagtl", "blend"),
    "diagbr": ("diagbr", "blend"),
    "circlecrop": ("circlecrop", "dip"),
    "rectcrop": ("rectcrop", "dip"),
    "fadegrays": ("fadegrays", "blend"),
}

# Layer blend mode -> (ffmpeg blend mode, neutral color). The layer is
# drawn onto a canvas of the neutral color - the one that leaves the video
# unchanged in that mode - and the whole canvas is blended, so the area
# around the layer (and its soft edges) stays as it was.
BLEND_MODES: dict[str, tuple[str, str]] = {
    "normal": ("normal", "black"),
    "multiply": ("multiply", "white"),
    "screen": ("screen", "black"),
    "overlay": ("overlay", "0x808080"),
    "darken": ("darken", "white"),
    "lighten": ("lighten", "black"),
    "add": ("addition", "black"),
    "difference": ("difference", "black"),
}

EASES = ("linear", "smooth", "in", "out")

# Export formats: an MP4, an animated GIF (no sound) or the sound alone (M4A).
OUTPUT_FORMATS = {"mp4": ("export.mp4", "video/mp4"), "gif": ("export.gif", "image/gif"), "audio": ("export.m4a", "audio/mp4")}
GIF_FPS = 15
GIF_MAX_WIDTH = 640
# Quality -> x264 CRF (lower = better, bigger).
QUALITY_CRF = {"standard": VIDEO_ENCODE_CRF, "high": VIDEO_ENCODE_CRF - 3, "max": VIDEO_ENCODE_CRF - 6}

# Must match DUCK_ATTACK / DUCK_RELEASE in src/lib/editor/ducking.ts.
DUCK_ATTACK = 0.3
DUCK_RELEASE = 0.5


def duck_gain_expr(au: "PlanAudio", var: str) -> str:
    """Gain of a ducked track as an expression of `var` (timeline seconds):
    1 - amount * (trapezoid per region) - duckGain() in ducking.ts."""
    points: list[dict] = []
    for a, b in au.duck_regions:
        points += [
            {"t": a - DUCK_ATTACK, "v": 0.0, "ease": "linear"},
            {"t": a, "v": 1.0, "ease": "linear"},
            {"t": b, "v": 1.0, "ease": "linear"},
            {"t": b + DUCK_RELEASE, "v": 0.0, "ease": "linear"},
        ]
    if not points or au.duck_amount <= 0:
        return "1"
    return f"(1-{_num(au.duck_amount)}*({keyframe_expr(points, 'v', var)}))"


def envelope_expr(points: list[tuple[float, float]], var: str) -> str:
    """A track's volume curve as an expression of `var` (source seconds):
    curveAt() in src/lib/editor/envelope.ts."""
    return keyframe_expr([{"t": t, "v": v, "ease": "linear"} for t, v in points], "v", var)


# Must match BREATH_DROP_DB / BREATH_RAMP in src/lib/editor/breaths.ts.
BREATH_DROP_DB = -18.0
BREATH_RAMP = 0.03


def breath_points(spans: list[tuple[float, float]]) -> list[dict]:
    """Breath gain as keyframes (source seconds): 1 outside, BREATH_DROP_DB
    inside, ramping over BREATH_RAMP inside each span - breathGain()."""
    low = 10 ** (BREATH_DROP_DB / 20)
    pts: list[dict] = []
    for a, b in sorted(spans):
        r = min(BREATH_RAMP, (b - a) / 2)
        pts += [{"t": a, "v": 1.0}, {"t": a + r, "v": low}, {"t": b - r, "v": low}, {"t": b, "v": 1.0}]
    for p in pts:
        p["ease"] = "linear"
    return pts


# Master bus: the loudness gain (src/lib/editor/loudness.ts, measured and
# stored by the editor, so the preview plays the same level), then a peak
# limiter at about -1 dBFS (LIMIT_CEILING there). latency=1 compensates the
# limiter's 5 ms look-ahead: without it every export's sound came out 5 ms
# late and lost its last 5 ms (measured).
LIMIT_CEILING = 0.89
MAX_MASTER_GAIN_DB = 24.0


def master_chain(gain_db: float) -> str:
    gain = max(-MAX_MASTER_GAIN_DB, min(MAX_MASTER_GAIN_DB, gain_db))
    pre = f"volume={gain:.2f}dB," if abs(gain) >= 0.05 else ""
    return f"{pre}alimiter=limit={LIMIT_CEILING}:level=disabled:latency=1"


# Track tone (src/lib/editor/voiceTone.ts): a low cut, a three-band EQ, a
# de-esser and a compressor. The editor sends the exact numbers (toneWire);
# the preview runs the same biquads in Web Audio and a port of ffmpeg's
# deesser and acompressor in an AudioWorklet. Must match TONE_* there.
# tests/fixtures/tone-chains.json pins the chains built here.
TONE_LOW_CUT_HZ = 80
TONE_BASS_HZ = 120
TONE_MID_HZ = 400
TONE_MID_Q = 1
TONE_TREBLE_HZ = 4000
TONE_KNEE = 2.82843


@dataclass
class PlanCompressor:
    threshold: float  # dBFS, RMS detection
    ratio: float
    attack: float  # ms
    release: float  # ms
    makeup: float  # dB


@dataclass
class PlanTone:
    low_cut: bool = False
    bass: float = 0.0  # dB
    mid: float = 0.0
    treble: float = 0.0
    de_ess: float = 0.0  # ffmpeg deesser intensity 0..1
    comp: Optional[PlanCompressor] = None


def tone_chain(t: Optional[PlanTone]) -> str:
    """The track's tone as ffmpeg filters ("" when it changes nothing).
    Shelves use slope 1 (t=s:w=1), the Web Audio spec's shelf; the low cut
    is a 2-pole Butterworth, like the preview's highpass at Q -3.01 dB."""
    if t is None:
        return ""
    parts: list[str] = []
    if t.low_cut:
        parts.append(f"highpass=f={TONE_LOW_CUT_HZ}:t=q:w=0.707107")
    if t.bass:
        parts.append(f"lowshelf=f={TONE_BASS_HZ}:t=s:w=1:g={_num(t.bass)}")
    if t.mid:
        parts.append(f"equalizer=f={TONE_MID_HZ}:t=q:w={_num(TONE_MID_Q)}:g={_num(t.mid)}")
    if t.treble:
        parts.append(f"highshelf=f={TONE_TREBLE_HZ}:t=s:w=1:g={_num(t.treble)}")
    if t.de_ess > 0:
        parts.append(f"deesser=i={_num(t.de_ess)}:m=0.5:f=0.5:s=o")
    if t.comp:
        c = t.comp
        parts.append(
            f"acompressor=level_in=1:mode=downward:threshold={_num(10 ** (c.threshold / 20))}:ratio={_num(c.ratio)}"
            f":attack={_num(c.attack)}:release={_num(c.release)}:makeup={_num(10 ** (c.makeup / 20))}"
            f":knee={_num(TONE_KNEE)}:link=average:detection=rms:mix=1"
        )
    return ",".join(parts)


ANIMS_IN = ("none", "fade", "pop", "bounce", "spin", "zoomin", "slideup", "slidedown", "slideleft", "slideright")
ANIMS_OUT = ("none", "fade", "pop", "spin", "zoomout", "slideup", "slidedown", "slideleft", "slideright")
EFFECTS = (
    "blur",
    "motionblur",
    "glitch",
    "vhs",
    "grain",
    "noise",
    "pixelate",
    "rgbsplit",
    "flash",
    "shake",
    "zoom",
    "bw",
    "sepia",
    "invert",
    "hue",
    "vignette",
    "letterbox",
    "strobe",
    "mirror",
)
FILTER_IDS = tuple(look_pipeline.FILTERS)

# Must match ANIM_SECONDS / SLIDE_DISTANCE in src/lib/editor/timeline.ts so
# the preview and the export animate alike.
ANIM_SECONDS = 0.35
SLIDE_DISTANCE = 0.15  # fraction of canvas width (x) / height (y)

AUDIO_RATE = 48000
# Shortest source piece a speed ramp's sound is split into (seconds); under
# it the clip's sound plays at the ramp's average tempo (_clip_audio_chain).
MIN_RAMP_AUDIO_PIECE = 0.05

# Voice effects - the preview's Web Audio graphs in src/lib/editor/voiceFx.ts.
# Pitch: resample to the new pitch, then atempo back to the length.
VOICE_FX: dict[str, str] = {
    "none": "",
    "chipmunk": f"asetrate={AUDIO_RATE}*1.5,aresample={AUDIO_RATE},atempo=0.666667",
    "deep": f"asetrate={AUDIO_RATE}*0.75,aresample={AUDIO_RATE},atempo=1.333333",
    "robot": "aeval='val(ch)*sin(2*PI*50*t)':c=same",
    "echo": "aecho=in_gain=1:out_gain=0.7:delays=250:decays=0.45",
    "telephone": "highpass=f=300,lowpass=f=3400",
    "radio": "highpass=f=500,lowpass=f=2800,volume=4,asoftclip=type=tanh,volume=0.5",
}


@dataclass
class MediaInfo:
    width: int  # display width (rotation applied), like the browser reports
    height: int
    fps: float
    duration: float
    has_audio: bool
    audio_mono: bool = False  # its (first) audio stream is mono


_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
_VIDEO_STREAM_RE = re.compile(r"Stream #\d+:\d+[^:]*: Video: .*?(\d{2,5})x(\d{2,5})")
_FPS_RE = re.compile(r"(\d+(?:\.\d+)?) fps")
_ROTATION_RE = re.compile(r"rotation of (-?\d+(?:\.\d+)?) degrees|rotate\s*:\s*(-?\d+)")


def _ffmpeg_info(path: str) -> str:
    proc = subprocess.run(
        [get_ffmpeg_path(), "-hide_banner", "-i", path], capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    return proc.stderr


def _duration_of(text: str) -> float:
    d = _DURATION_RE.search(text)
    return int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3)) if d else 0.0


def probe_media(path: str) -> MediaInfo:
    """Container-level metadata via `ffmpeg -i` (ffprobe isn't bundled by
    imageio-ffmpeg). Unlike video.probe_video (OpenCV), this reports the
    *display* size - a phone clip with a 90-degree rotation flag comes back
    portrait - which is what the browser editor shows and what ffmpeg's
    default autorotation produces during export. Also detects whether
    there's an audio stream at all, which OpenCV can't.

    Raises:
        ValueError: if ffmpeg finds no video stream.
    """
    text = _ffmpeg_info(path)
    video = _VIDEO_STREAM_RE.search(text)
    if not video:
        raise ValueError("Could not find a video stream in this file")
    width, height = int(video.group(1)), int(video.group(2))

    video_line = text[video.start() : text.find("\n", video.start())]
    fps_match = _FPS_RE.search(video_line)
    fps = float(fps_match.group(1)) if fps_match else 0.0

    rotation = _ROTATION_RE.search(text)
    if rotation:
        angle = abs(float(rotation.group(1) or rotation.group(2) or 0)) % 180
        if 45 < angle < 135:
            width, height = height, width

    has_audio = re.search(r"Stream #\d+:\d+[^:]*: Audio:", text) is not None
    return MediaInfo(width=width, height=height, fps=fps, duration=_duration_of(text), has_audio=has_audio, audio_mono=audio_is_mono(text))


_AUDIO_LINE_RE = re.compile(r"Stream #\d+:\d+[^:]*: Audio: .*")


def audio_is_mono(text: str) -> bool:
    """Whether the first audio stream in `ffmpeg -i` output is mono."""
    line = _AUDIO_LINE_RE.search(text)
    return bool(line and re.search(r",\s*mono\b", line.group(0)))


def probe_audio_mono(path: str) -> bool:
    return audio_is_mono(_ffmpeg_info(path))


def _stereo(mono: bool) -> str:
    """Filters that make a source stereo: a mono one on both channels at
    full level, the way players and the editor's preview play it. ffmpeg's
    own upmix (aformat to stereo) puts mono 3 dB lower on each side, so a
    microphone track exported 3 dB quieter than it was heard (measured)."""
    to_stereo = "aformat=sample_fmts=fltp:channel_layouts=stereo"
    return f"pan=stereo|c0=c0|c1=c0,{to_stereo}" if mono else to_stereo


def probe_audio(path: str) -> float:
    """Duration of an uploaded audio file (MP3/WAV/M4A/AAC/OGG...).

    Raises:
        ValueError: if ffmpeg finds no audio stream.
    """
    text = _ffmpeg_info(path)
    if re.search(r"Stream #\d+:\d+[^:]*: Audio:", text) is None:
        raise ValueError("Could not find an audio stream in this file")
    return _duration_of(text)


async def cut_range(input_path: str, output_path: str, start: float, end: float) -> None:
    """Re-encodes source-time [start, end) of `input_path` to a standalone
    clip - used to run the existing AI cleanup (video.reconstruct_region) on only
    the timeline segment the user selected. Re-encoded rather than stream-
    copied so the cut is frame-accurate instead of snapping to keyframes,
    at a CRF below the normal output's so this intermediate generation
    costs no visible quality. Autorotation is left on (ffmpeg's default),
    so the result is stored in display orientation - the orientation the
    editor showed when the user marked the cleanup region.
    """
    await _run_ffmpeg(
        [
            "-y",
            "-ss",
            f"{start:.3f}",
            "-t",
            f"{end - start:.3f}",
            "-i",
            input_path,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            VIDEO_ENCODE_PRESET,
            "-crf",
            str(max(0, VIDEO_ENCODE_CRF - 4)),
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            output_path,
        ]
    )


@dataclass
class PlanClip:
    source_path: str
    source_has_audio: bool
    source_width: int
    source_height: int
    start: float  # source seconds; for a freeze, the held frame's time
    duration: float  # source seconds; becomes timeline seconds in quantize_plan
    source_mono: bool = False  # its audio is mono (see _stereo)
    transition: str | None = None  # key of TRANSITIONS, into the next clip
    freeze: bool = False
    reverse: bool = False
    crop_x: float = 0.0  # kept part of the source frame, fractions
    crop_y: float = 0.0
    crop_w: float = 1.0
    crop_h: float = 1.0
    transition_duration: float = 0.0
    speed: float = 1.0
    volume: float = 1.0
    x: float = 0.5
    y: float = 0.5
    scale: float = 1.0
    rotation: float = 0.0
    filter: str = "original"
    intensity: float = 100.0
    adjust: dict = field(default_factory=lambda: dict(_NEUTRAL_ADJUST))
    # Focus zoom: (t, x, y, s) rows in clip time - the visible window of the
    # (cropped) frame, top-left x/y and size s, fractions. Empty = no zoom.
    camera: list[tuple[float, float, float, float]] = field(default_factory=list)
    # Transform animation: {t, x, y, scale, rotation, ease} in clip time;
    # replaces x/y/scale/rotation (see keyframe_expr).
    keyframes: list[dict] = field(default_factory=list)
    # Curves as [r, g, b] tables and an imported LUT (size^3 RGB, red
    # fastest) - both baked into the clip's LUT with the grade (look.py).
    curve: list[list[float]] = field(default_factory=list)
    lut_size: int = 0
    lut_data: list[float] = field(default_factory=list)
    lut_intensity: float = 0.0
    # Shape mask over the clip's box: a grayscale PNG, white = shown.
    mask_path: str | None = None
    # Stabilization strength 0..100 (0 = off) and, once analysed
    # (prepare_stabilization), the motion file vidstabtransform reads.
    stabilize: float = 0.0
    stab_path: str | None = None
    # Speed curve: the speeds of equal source pieces, played in order,
    # instead of `speed` (src/lib/editor/speed.ts). Empty = constant.
    ramp: list[float] = field(default_factory=list)
    # Source seconds the clip covers; set by quantize_plan (which turns
    # `duration` into timeline seconds).
    source_length: float = 0.0


_NEUTRAL_ADJUST = {
    "brightness": 0.0,
    "contrast": 0.0,
    "saturation": 0.0,
    "exposure": 0.0,
    "temperature": 0.0,
    "tint": 0.0,
    "highlights": 0.0,
    "shadows": 0.0,
    "sharpness": 0.0,
    "blur": 0.0,
    "opacity": 100.0,
}


@dataclass
class PlanOverlay:
    image_path: str
    image_width: int
    image_height: int
    start: float
    end: float
    x: float  # center, fraction of canvas width
    y: float  # center, fraction of canvas height
    width: float  # fraction of canvas width
    rotation: float  # degrees, clockwise
    opacity: float = 1.0
    anim_in: str = "none"
    anim_out: str = "none"
    video: bool = False  # image_path is a video, played from `offset`
    offset: float = 0.0
    blend: str = "normal"  # key of BLEND_MODES
    key_color: str | None = None  # chroma key (video layers), "#rrggbb"
    key_similarity: float = 0.0  # 0..100
    key_smoothness: float = 0.0  # 0..100
    # Animation: {t, x, y, scale, rotation, opacity, ease} in timeline time;
    # replaces x/y/rotation/opacity, and scale multiplies the size.
    keyframes: list[dict] = field(default_factory=list)
    # Shape mask (video layers; image layers carry it in their PNG).
    mask_path: str | None = None
    # Animated text: image_path is a grid of states (image_width/height are
    # one cell), state k shown from sprite_times[k] (timeline seconds).
    sprite_cols: int = 1
    sprite_rows: int = 1
    sprite_times: list[float] = field(default_factory=list)
    # Webcam background removal (video layers; app/pipeline/matte.py): the
    # matted file (picture on top, mask below) replaces the layer's picture.
    matte: PlanMatte | None = None


@dataclass
class PlanMatte:
    """Same settings and math as src/lib/editor/matte.ts, which draws the
    preview from the same matted file."""

    path: str
    mode: str  # "remove" | "blur" | "image" | "video"
    edge: float = 0.0  # -100..100: shrink .. grow the outline
    soft: float = 25.0  # 0..100: edge softness
    blur: float = 50.0  # 0..100: background blur ("blur")
    bg_path: str | None = None  # "image" / "video"
    bg_width: int = 0
    bg_height: int = 0
    fit: str = "fill"  # "fill" | "fit"
    x: float = 0.5  # 0..1: which part of an overflowing background shows
    y: float = 0.5
    scale: float = 1.0  # 1..4
    loop: bool = True  # "video": loop, else hold its last frame


MATTE_MODES = ("remove", "blur", "image", "video")


@dataclass
class PlanAudio:
    path: str
    start: float  # timeline seconds
    offset: float  # source seconds
    duration: float
    volume: float = 1.0
    fade_in: float = 0.0
    fade_out: float = 0.0
    voice: str = "none"  # key of VOICE_FX
    mono: bool = False  # the file's audio is mono (see _stereo)
    # Auto-ducking: lowered by duck_amount (0..1) during these timeline
    # ranges, ramping over DUCK_ATTACK before and DUCK_RELEASE after.
    duck_amount: float = 0.0
    duck_regions: list[tuple[float, float]] = field(default_factory=list)
    tone: Optional[PlanTone] = None  # see tone_chain; before the volume, like the preview
    # Volume curve (src/lib/editor/envelope.ts): (source second, gain 0..2),
    # linear between points, held outside them.
    envelope: list[tuple[float, float]] = field(default_factory=list)
    # Breaths turned down (src/lib/editor/breaths.ts): (start, end) source seconds.
    breaths: list[tuple[float, float]] = field(default_factory=list)


@dataclass
class PlanEffect:
    type: str
    start: float
    end: float
    intensity: float  # 0..100


@dataclass
class PlanPointer:
    """Reconstructed cursor and click rings, positioned per frame (rows in
    timeline time, canvas fractions; see focusExport.ts)."""

    cursor_path: str | None
    cursor_w: float  # sprite size, fractions of canvas height
    cursor_h: float
    hot_x: float  # hotspot, fractions of the sprite
    hot_y: float
    ring_paths: list[str]  # [left, right]
    ring_sizes: list[float]  # sprite width / ring radius
    # (t, x, y) or (t, x, y, k); x < 0 hides. k (0..1] is the cursor's size
    # relative to its sprite when it grows with the zoom (Smart Zoom 2).
    cursor_rows: list[tuple[float, ...]]
    ring_rows: list[tuple[float, int, float, float, float, float]]  # (t, layer, x, y, r, alpha)


@dataclass
class PlanMask:
    """A privacy mask: rows (t, x, y, w, h) of its rectangle in canvas
    fractions per frame where it changes (src/lib/editor/masks.ts), shown
    from start to end."""

    mode: str  # blur | pixelate | solid
    start: float
    end: float
    strength: float  # 0..100
    color: str  # #rrggbb
    rows: list[tuple[float, float, float, float, float]]


MASK_MODES = ("blur", "pixelate", "solid")


@dataclass
class ExportPlan:
    width: int
    height: int
    fps: float
    with_audio: bool
    clips: list[PlanClip]
    overlays: list[PlanOverlay] = field(default_factory=list)
    audio: list[PlanAudio] = field(default_factory=list)
    effects: list[PlanEffect] = field(default_factory=list)
    fit: str = "fit"  # "fit" | "fill"
    # Canvas frame (types.ts CanvasFrame): inset per side as a fraction of
    # the canvas, corner radius as a fraction of its short side, shadow 0..1.
    frame_padding: float = 0.0
    frame_radius: float = 0.0
    frame_shadow: float = 0.0
    background: str = "color"  # "color" | "gradient" | "blur" | "image"
    color: str = "#000000"
    color2: str = "#000000"
    background_image: str | None = None
    crf: int = VIDEO_ENCODE_CRF
    audio_bitrate: str = "192k"
    output_format: str = "mp4"  # key of OUTPUT_FORMATS
    pointer: PlanPointer | None = None
    masks: list[PlanMask] = field(default_factory=list)
    # Loudness normalization gain on the whole mix, dB (master_chain).
    master_gain_db: float = 0.0


def plan_to_json(plan: ExportPlan) -> str:
    """The whole plan as JSON for the export job (it crosses the RQ
    boundary as a plain string). Every field goes through, so a field added
    to ExportPlan can't be silently dropped between the API and the worker
    - see plan_from_json and tests/test_focus_export.py."""
    return json.dumps(asdict(plan))


def _tone_from_json(t: Optional[dict]) -> Optional[PlanTone]:
    if not t:
        return None
    return PlanTone(**{**t, "comp": PlanCompressor(**t["comp"]) if t.get("comp") else None})


def plan_from_json(text: str) -> ExportPlan:
    raw = json.loads(text)
    pointer = raw.get("pointer")
    return ExportPlan(
        **{k: v for k, v in raw.items() if k not in ("clips", "overlays", "audio", "effects", "pointer", "masks")},
        clips=[PlanClip(**{**c, "camera": [tuple(r) for r in c.get("camera", [])]}) for c in raw["clips"]],
        overlays=[PlanOverlay(**{**o, "matte": PlanMatte(**o["matte"]) if o.get("matte") else None}) for o in raw.get("overlays", [])],
        audio=[PlanAudio(**{**a, "tone": _tone_from_json(a.get("tone"))}) for a in raw.get("audio", [])],
        effects=[PlanEffect(**e) for e in raw.get("effects", [])],
        pointer=(
            PlanPointer(
                **{
                    **pointer,
                    "cursor_rows": [tuple(r) for r in pointer["cursor_rows"]],
                    "ring_rows": [tuple(r) for r in pointer["ring_rows"]],
                }
            )
            if pointer
            else None
        ),
        masks=[PlanMask(**{**m, "rows": [tuple(r) for r in m["rows"]]}) for m in raw.get("masks", [])],
    )


def quantize_plan(plan: ExportPlan) -> None:
    """Converts each clip's source length to its timeline length (speed)
    and snaps it to whole frames (in place), then clamps each transition so
    it never exceeds half of either neighboring clip - xfade can't overlap
    more than a clip's own length, and sharing a clip between two
    transitions needs room for both. Idempotent guard: only runs once.
    """
    if getattr(plan, "_quantized", False):
        return
    plan._quantized = True  # type: ignore[attr-defined]
    frame = 1.0 / plan.fps
    for clip in plan.clips:
        clip.source_length = clip.duration
        if clip.ramp:
            piece = clip.duration / len(clip.ramp)
            timeline = sum(piece / s for s in clip.ramp)
        else:
            timeline = clip.duration / clip.speed
        clip.duration = max(1, round(timeline * plan.fps)) * frame
    for i, clip in enumerate(plan.clips):
        if clip.transition is None or i == len(plan.clips) - 1:
            clip.transition = None
            clip.transition_duration = 0.0
            continue
        limit = min(clip.duration, plan.clips[i + 1].duration) / 2
        frames = math.floor(min(clip.transition_duration, limit) * plan.fps)
        if frames < 1:
            clip.transition = None
            clip.transition_duration = 0.0
        else:
            clip.transition_duration = frames * frame


def timeline_duration(plan: ExportPlan) -> float:
    return sum(c.duration for c in plan.clips) - sum(c.transition_duration for c in plan.clips)


def _num(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".") or "0"


_FFMPEG_MAJOR = re.compile(r"ffmpeg version n?(\d+)\.")


@functools.lru_cache(maxsize=1)
def _ffmpeg_major() -> int:
    """The ffmpeg binary's major version; 0 if it can't be told (a git build)."""
    try:
        out = subprocess.run([get_ffmpeg_path(), "-hide_banner", "-version"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return 0
    m = _FFMPEG_MAJOR.search(out)
    return int(m.group(1)) if m else 0


def _graph_args(script: str) -> list[str]:
    """Reads the filter graph from the file `script`. ffmpeg 7 added
    `-/filter_complex <file>` and ffmpeg 8 removed the old
    `-filter_complex_script`, which failed every desktop export once the
    bundled ffmpeg became 9.0. Older builds (a system ffmpeg) keep the old one."""
    return ["-/filter_complex", script] if _ffmpeg_major() >= 7 else ["-filter_complex_script", script]


def _even(v: float) -> int:
    return max(2, int(round(v / 2)) * 2)


def _atempo(speed: float) -> str:
    # atempo accepts 0.5..100 per instance, so slower speeds are a chain
    # of halvings plus the rest.
    if abs(speed - 1) <= 1e-6:
        return "anull"
    parts = []
    while speed < 0.5:
        parts.append("atempo=0.5")
        speed /= 0.5
    parts.append(f"atempo={_num(speed)}")
    return ",".join(parts)


def ramp_pts_expr(clip: PlanClip) -> str:
    """Output time (seconds) of the frame at source time T - STARTT of a
    speed-ramped clip: each source piece lasts piece / speed - the
    piecewise-linear localToSource() inverse in src/lib/editor/speed.ts."""
    piece = clip.source_length / len(clip.ramp)
    x = "(T-STARTT)"
    acc = [0.0]
    for s in clip.ramp:
        acc.append(acc[-1] + piece / s)

    def seg(k: int) -> str:
        return f"({_num(acc[k])}+({x}-{_num(k * piece)})/{_num(clip.ramp[k])})"

    def build(lo: int, hi: int) -> str:
        if lo == hi:
            return seg(lo)
        mid = (lo + hi + 1) // 2
        return f"if(lt({x},{_num(mid * piece)}),{build(lo, mid - 1)},{build(mid, hi)})"

    return build(0, len(clip.ramp) - 1)


def _rounded_box(w: int, h: int, r: float, supersample: int = 4) -> "Image.Image":
    """White w x h rounded rectangle on black (mode L), antialiased."""
    from PIL import Image, ImageDraw

    big = Image.new("L", (w * supersample, h * supersample), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        (0, 0, w * supersample - 1, h * supersample - 1), radius=max(0.0, r) * supersample, fill=255
    )
    return big.resize((w, h), Image.Resampling.LANCZOS)


def _gradient_image(tmp: str, w: int, h: int, top: str, bottom: str) -> str:
    """Top-to-bottom gradient as the preview draws it (CSS linear-gradient
    "to bottom": each row's color interpolated in sRGB at its center).
    ffmpeg's own `gradients` source doesn't blend a vertical line evenly
    (it jumps to the second color near the top). One file per size and pair
    of colors, shared by every clip of the render."""
    from PIL import Image

    path = os.path.join(tmp, f"gradient-{w}x{h}-{top.lstrip('#')}-{bottom.lstrip('#')}.png")
    if not os.path.exists(path):
        c0 = np.array([int(top[i : i + 2], 16) for i in (1, 3, 5)], dtype=np.float64)
        c1 = np.array([int(bottom[i : i + 2], 16) for i in (1, 3, 5)], dtype=np.float64)
        t = ((np.arange(h) + 0.5) / h)[:, None]
        rows = np.rint(c0 + (c1 - c0) * t).astype(np.uint8)
        Image.fromarray(np.repeat(rows[:, None, :], w, axis=1), "RGB").save(path)
    return path


def frame_shadow(shadow: float) -> tuple[float, float, float] | None:
    """(offset down, CSS blur radius, opacity) in canvas-height units, as
    frameShadow() in src/lib/editor/timeline.ts. None for no shadow."""
    s = max(0.0, min(1.0, shadow))
    return (0.02 * s, 0.06, 0.6 * s) if s > 0 else None


def _frame_mask(tmp: str, i: int, w: int, h: int, radius: float) -> str:
    """Alpha mask that rounds the video box's corners (preview: clip-path
    inset(... round r))."""
    path = os.path.join(tmp, f"frame-mask{i}.png")
    _rounded_box(w, h, radius).save(path)
    return path


def _frame_shadow_image(tmp: str, i: int, w: int, h: int, radius: float, H: int, shadow: float) -> str | None:
    """RGBA drop shadow centered on the video box, like CSS box-shadow
    "0 dy blur rgba(0,0,0,a)": offset in the box's own (rotated) frame, a
    Gaussian of sigma = blur / 2, and nothing under the box itself."""
    from PIL import Image, ImageChops, ImageFilter

    params = frame_shadow(shadow)
    if params is None:
        return None
    dy_u, blur_u, alpha = params
    dy, sigma = dy_u * H, blur_u * H / 2
    pad = int(math.ceil(3 * sigma + abs(dy))) + 2
    size = (w + 2 * pad, h + 2 * pad)
    shape = Image.new("L", size, 0)
    shape.paste(_rounded_box(w, h, radius), (pad, pad + int(round(dy))))
    blurred = shape.filter(ImageFilter.GaussianBlur(sigma)).point(lambda v: int(v * alpha))
    box = Image.new("L", size, 0)
    box.paste(_rounded_box(w, h, radius), (pad, pad))
    alpha_img = ImageChops.multiply(blurred, ImageChops.invert(box))
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    img.putalpha(alpha_img)
    path = os.path.join(tmp, f"frame-shadow{i}.png")
    img.save(path)
    return path


class _Inputs:
    """Accumulates ffmpeg input args and hands out input indexes."""

    def __init__(self) -> None:
        self.args: list[str] = []
        self.count = 0

    def add(self, *args: str) -> int:
        self.args += list(args)
        self.count += 1
        return self.count - 1


OFFSCREEN = -100000
RING_LAYERS = 4


def _filter_path(path: str) -> str:
    """A file path as a filter argument: forward slashes and an escaped
    drive colon, so it survives graph parsing on Windows too."""
    return path.replace("\\", "/").replace(":", "\\:")


def _round(v: float) -> int:
    """Half up, like JavaScript's Math.round (Python's round() is
    half-to-even), so the browser and this side agree to the pixel."""
    return math.floor(v + 0.5)


def step_expr(times: list[float], values: list[float | int], var: str, fps: float) -> str:
    """ffmpeg expression of `var` (a frame timestamp) that holds values[k]
    from times[k] on - a balanced if(lt()) tree, so each frame costs
    log2(n) comparisons however long the timeline is.

    Every frame computes its own value from its own timestamp, so the
    result doesn't depend on how ffmpeg schedules its threads (sendcmd,
    which changes another filter when a frame passes, does). Boundaries
    sit half a frame early so a row at a frame's (rounded) time always
    applies to that frame."""
    if not times:
        return "0"
    half = 0.5 / fps

    def num(v: float | int) -> str:
        return str(v) if isinstance(v, int) else _num(v)

    # Drop rows that don't change the value (smaller expression).
    t2, v2 = [times[0]], [values[0]]
    for t, v in zip(times[1:], values[1:]):
        if v != v2[-1]:
            t2.append(t)
            v2.append(v)

    def build(lo: int, hi: int) -> str:
        if lo == hi:
            return num(v2[lo])
        mid = (lo + hi + 1) // 2
        return f"if(lt({var},{_num(t2[mid] - half)}),{build(lo, mid - 1)},{build(mid, hi)})"

    return build(0, len(t2) - 1)


def _ease_expr(kind: str, u: str) -> str:
    """ease() in src/lib/editor/keyframes.ts."""
    if kind == "smooth":
        return f"({u}*{u}*(3-2*{u}))"
    if kind == "in":
        return f"({u}*{u})"
    if kind == "out":
        return f"({u}*(2-{u}))"
    return u


def keyframe_values(kfs: list[dict], key: str) -> list[float]:
    return [float(k.get(key, 1.0)) for k in kfs]


def keyframe_expr(kfs: list[dict], key: str, var: str) -> str:
    """ffmpeg expression of `var` (seconds) for one animated value -
    sampleKeyframes() in src/lib/editor/keyframes.ts: held before the first
    and after the last keyframe, eased between neighbors. A balanced
    if(lt()) tree over the keyframe times, like step_expr."""
    vals = keyframe_values(kfs, key)
    if all(v == vals[0] for v in vals):
        return _num(vals[0])
    times = [float(k["t"]) for k in kfs]

    def seg(i: int) -> str:
        a, b = vals[i], vals[i + 1]
        if a == b or times[i + 1] - times[i] < 1e-6:
            return _num(b if times[i + 1] - times[i] < 1e-6 else a)
        u = f"(({var}-{_num(times[i])})/{_num(times[i + 1] - times[i])})"
        return f"({_num(a)}+{_num(b - a)}*{_ease_expr(kfs[i].get('ease', 'smooth'), u)})"

    # Region r: 0 = before the first keyframe, n = after the last, else
    # between keyframes r-1 and r.
    n = len(times)

    def region(r: int) -> str:
        if r == 0:
            return _num(vals[0])
        if r == n:
            return _num(vals[-1])
        return seg(r - 1)

    def build(lo: int, hi: int) -> str:
        if lo == hi:
            return region(lo)
        mid = (lo + hi + 1) // 2
        return f"if(lt({var},{_num(times[mid - 1])}),{build(lo, mid - 1)},{build(mid, hi)})"

    return build(0, n)


def camera_geometry(x: float, y: float, s: float, box_w: int, box_h: int) -> tuple[int, int, int, int]:
    """Same as windowPixels() in src/lib/editor/camera.ts (shared vectors in
    tests/fixtures/camera_vectors.json)."""
    s = max(0.2, min(1.0, s))
    zw, zh = max(box_w, _round(box_w / s)), max(box_h, _round(box_h / s))
    ox = max(box_w - zw, min(0, -_round(x * zw)))
    oy = max(box_h - zh, min(0, -_round(y * zh)))
    return zw, zh, ox, oy


def _camera_chain(clip: PlanClip, i: int, src: str, box_w: int, box_h: int, fps: float) -> list[str]:
    """[src] -> [zc{i}]: the clip zoomed per its camera rows - the frame
    scaled by 1/s and shifted so the camera window fills the fitted box."""
    times = [r[0] for r in clip.camera]
    geo = [camera_geometry(x, y, s, box_w, box_h) for _, x, y, s in clip.camera]
    zw, zh, ox, oy = (step_expr(times, [g[k] for g in geo], "t", fps) for k in range(4))
    return [
        f"[{src}]split[zb{i}][zs{i}]",
        f"[zs{i}]scale=w='{zw}':h='{zh}':eval=frame:flags=bicubic[zz{i}]",
        f"[zb{i}][zz{i}]overlay=x='{ox}':y='{oy}':eval=frame:format=auto,setsar=1[zc{i}]",
    ]


def _pointer_filters(plan: ExportPlan, inputs: _Inputs, base: str, total: float) -> tuple[list[str], str]:
    """Cursor and click-ring layers over [base]; returns (graph, output
    label). Positions, ring sizes and ring opacity are step expressions of
    each frame's own time (see step_expr)."""
    p = plan.pointer
    assert p is not None
    W, H, fps = plan.width, plan.height, plan.fps
    graph: list[str] = []
    acc = base

    def looped(path: str) -> int:
        return inputs.add("-loop", "1", "-framerate", _num(fps), "-t", _num(total + 0.1), "-i", path)

    if p.ring_rows and p.ring_paths:
        ring_inputs = [looped(path) for path in p.ring_paths]
        for c, idx in enumerate(ring_inputs):
            graph.append(f"[{idx}:v]format=rgba,split=2[rc{c}a][rc{c}b]")
        for layer in range(RING_LAYERS):
            rows = [r for r in p.ring_rows if r[1] == layer]
            # step_expr holds the first row's value before it starts: without
            # a hidden row at 0 the ring would show from the first frame
            # until its click.
            if rows and rows[0][0] > 0:
                rows.insert(0, (0.0, layer, 0.0, 0.0, 0.0, 0.0))
            c = 0 if layer < 2 or len(ring_inputs) == 1 else 1
            src = f"rc{c}{'a' if layer % 2 == 0 else 'b'}"
            if not rows:
                graph.append(f"[{src}]nullsink")
                continue
            ratio = p.ring_sizes[c]
            times = [r[0] for r in rows]
            on = [a > 0 and rr > 0 for (_, _, _, _, rr, a) in rows]
            sizes = [max(2, _round(ratio * rr * H)) if v else 2 for (_, _, _, _, rr, _a), v in zip(rows, on)]
            alpha = [round(a, 3) if v else 0.0 for (_, _, _, _, _r, a), v in zip(rows, on)]
            # The sprite keeps one size (the ring's largest) and the ring
            # grows inside it: geq samples the sprite at a scaled coordinate
            # around its center. Resizing the sprite per frame instead made
            # ffmpeg reconfigure the overlay on every size change, which
            # dominated export time (~0.5 s per change).
            full = max(sizes)
            scales = [round(sz / full, 4) if v else 1.0 for sz, v in zip(sizes, on)]
            xs = [_round(x * W - full / 2) if v else OFFSCREEN for (_, _, x, _, _, _), v in zip(rows, on)]
            ys = [_round(y * H - full / 2) if v else OFFSCREEN for (_, _, _, y, _, _), v in zip(rows, on)]
            # Rings are visible for a fraction of a second per click, but
            # geq evaluates every pixel of every frame: the opacity pass and
            # the overlay only run while the ring is on (timeline `enable`
            # with the same per-frame schedule).
            active = step_expr(times, [1 if v else 0 for v in on], "t", fps)
            k = step_expr(times, scales, "T", fps)
            u, v_ = f"(X-W/2)/({k})+W/2", f"(Y-H/2)/({k})+H/2"
            graph.append(
                f"[{src}]scale={full}:{full}:flags=lanczos,"
                f"geq=r='r({u},{v_})':g='g({u},{v_})':b='b({u},{v_})':a='alpha({u},{v_})*({step_expr(times, alpha, 'T', fps)})':enable='{active}'[rl{layer}];"
                f"[{acc}][rl{layer}]overlay=x='{step_expr(times, xs, 't', fps)}':y='{step_expr(times, ys, 't', fps)}':"
                f"eval=frame:eof_action=pass:format=auto:enable='{active}'[pr{layer}]"
            )
            acc = f"pr{layer}"
    if p.cursor_path and p.cursor_rows:
        idx = looped(p.cursor_path)
        cw, ch = max(2, _round(p.cursor_w * H)), max(2, _round(p.cursor_h * H))
        rows = p.cursor_rows
        times = [r[0] for r in rows]
        if not any(len(r) > 3 for r in rows):
            xs = [OFFSCREEN if r[1] < 0 else _round(r[1] * W - p.hot_x * cw) for r in rows]
            ys = [OFFSCREEN if r[1] < 0 else _round(r[2] * H - p.hot_y * ch) for r in rows]
            graph.append(
                f"[{idx}:v]format=rgba,scale={cw}:{ch}:flags=lanczos[pcs];"
                f"[{acc}][pcs]overlay=x='{step_expr(times, xs, 't', fps)}':y='{step_expr(times, ys, 't', fps)}':"
                f"eval=frame:eof_action=pass:format=auto[pcd]"
            )
            acc = "pcd"
        else:
            graph += _scaled_cursor(p, idx, acc, rows, cw, ch, W, H, fps, total)
            acc = "pcd"
    return graph, acc


# Cursor sizes (Smart Zoom 2). Sizes held a while - at rest, and the zoom
# levels the camera holds - are exact static layers. Sizes passed through
# during a zoom transition snap to a ladder of 1 % steps (invisible: a
# 100 px cursor is off by at most half a pixel) and share static layers
# too; only beyond CURSOR_MAX_LAYERS do the rarest sizes go through geq.
# Measured on 30 s at 1080p with a zoom every 4 s: geq for every
# transition frame 18.1 s, ladder 16.0 s, fixed-size cursor 13.8 s.
CURSOR_HELD_LAYERS = 3
CURSOR_HELD_MIN = 0.5  # seconds
CURSOR_LADDER = 1.01
CURSOR_MAX_LAYERS = 48


def cursor_scales(rows: list[tuple[float, ...]], total: float) -> tuple[list[float], list[float]]:
    """Per-row cursor scale as rendered, and the scales that get a static
    layer (longest shown first). Hidden rows keep their value; it's unused."""
    exact = [round(r[3] if len(r) > 3 else 1.0, 3) for r in rows]

    def held(ks: list[float]) -> dict[float, float]:
        out: dict[float, float] = {}
        for i, r in enumerate(rows):
            if r[1] < 0:
                continue
            end = rows[i + 1][0] if i + 1 < len(rows) else total
            out[ks[i]] = out.get(ks[i], 0.0) + max(0.0, end - r[0])
        return out

    h = held(exact)
    anchors = [k for k in sorted(h, key=lambda k: (-h[k], k))[:CURSOR_HELD_LAYERS] if h[k] >= CURSOR_HELD_MIN]
    step = math.log(CURSOR_LADDER)

    def snap(k: float) -> float:
        if k in anchors:
            return k
        near = [a for a in anchors if abs(a - k) <= k * (CURSOR_LADDER - 1) / 2]
        if near:
            return near[0]
        return round(math.exp(round(math.log(max(0.01, k)) / step) * step), 4)

    ks = [snap(k) for k in exact]
    h = held(ks)
    ranked = sorted(h, key=lambda k: (k not in anchors, -h[k], k))
    return ks, ranked[:CURSOR_MAX_LAYERS] or [1.0]


def _scaled_cursor(p: PlanPointer, idx: int, acc: str, rows: list[tuple[float, ...]], cw: int, ch: int, W: int, H: int, fps: float, total: float) -> list[str]:
    """The cursor when its size changes with the zoom. The sprite is drawn
    at the largest size; each row's k says how much of it shows. Like the
    rings, the sprite is never resized per frame (that reconfigures the
    overlay on every change): sizes held for a while - at rest, and at the
    zoom levels the camera holds - are static, pre-scaled layers, and the
    sizes in between (zoom transitions) sample the full sprite through geq
    around the hotspot, so the tip stays exactly on the recorded position.
    Each layer only runs while its size is shown (timeline `enable`)."""
    times = [r[0] for r in rows]
    ks, statics = cursor_scales(rows, total)
    hx, hy = p.hot_x * cw, p.hot_y * ch
    vis = [r[1] >= 0 for r in rows]
    moving_on = [1 if v and k not in statics else 0 for v, k in zip(vis, ks)]
    labels = [f"pcs{j}" for j in range(len(statics))]
    split = len(statics) + (1 if any(moving_on) else 0)
    graph = [f"[{idx}:v]format=rgba,scale={cw}:{ch}:flags=lanczos,split={split}{''.join(f'[{lb}]' for lb in labels)}{'[pcg]' if any(moving_on) else ''}"]
    cur = acc
    for j, k_static in enumerate(statics):
        on = [1 if v and k == k_static else 0 for v, k in zip(vis, ks)]
        sw, sh = max(2, _round(cw * k_static)), max(2, _round(ch * k_static))
        sx = [_round(r[1] * W - hx * k_static) if o else OFFSCREEN for r, o in zip(rows, on)]
        sy = [_round(r[2] * H - hy * k_static) if o else OFFSCREEN for r, o in zip(rows, on)]
        graph.append(
            f"[{labels[j]}]scale={sw}:{sh}:flags=lanczos[pcz{j}];"
            f"[{cur}][pcz{j}]overlay=x='{step_expr(times, sx, 't', fps)}':y='{step_expr(times, sy, 't', fps)}':"
            f"eval=frame:eof_action=pass:format=auto:enable='{step_expr(times, on, 't', fps)}'[pcm{j}]"
        )
        cur = f"pcm{j}"
    if not any(moving_on):
        graph.append(f"[{cur}]null[pcd]")
        return graph
    mx = [_round(r[1] * W - hx) if on else OFFSCREEN for r, on in zip(rows, moving_on)]
    my = [_round(r[2] * H - hy) if on else OFFSCREEN for r, on in zip(rows, moving_on)]
    active = step_expr(times, moving_on, "t", fps)
    k = step_expr(times, [k if on else 1.0 for k, on in zip(ks, moving_on)], "T", fps)
    u, v = f"{_num(hx)}+(X-{_num(hx)})/({k})", f"{_num(hy)}+(Y-{_num(hy)})/({k})"
    graph.append(
        f"[pcg]geq=r='r({u},{v})':g='g({u},{v})':b='b({u},{v})':a='alpha({u},{v})*lte(X,{_num(hx)}+({_num(cw)}-{_num(hx)})*({k}))*lte(Y,{_num(hy)}+({_num(ch)}-{_num(hy)})*({k}))':enable='{active}'[pcg2];"
        f"[{cur}][pcg2]overlay=x='{step_expr(times, mx, 't', fps)}':y='{step_expr(times, my, 't', fps)}':"
        f"eval=frame:eof_action=pass:format=auto:enable='{active}'[pcd]"
    )
    return graph


def mask_pixels(m: PlanMask, W: int, H: int) -> tuple[list[float], list[list[int]]]:
    """Row times and integer boxes (x, y, w, h). A hidden row becomes a
    2x2 box far off-screen."""
    times, boxes = [], []
    for t, x, y, w, h in m.rows:
        x0, y0 = _round(x * W), _round(y * H)
        x1, y1 = _round((x + w) * W), _round((y + h) * H)
        if w <= 0 or h <= 0 or x1 - x0 < 2 or y1 - y0 < 2:
            boxes.append([OFFSCREEN, OFFSCREEN, 2, 2])
        else:
            boxes.append([x0, y0, x1 - x0, y1 - y0])
        times.append(t)
    return times, boxes


def _mask_filters(plan: ExportPlan, base: str, total: float) -> tuple[list[str], str]:
    """Privacy masks over [base], in order; returns (graph, output label).

    Each mask's rectangle is a small box source scaled per frame
    (scale eval=frame) and placed per frame (overlay eval=frame), both
    reading the frame's own timestamp through step_expr - deterministic,
    unlike sendcmd, and drawbox can't change its box per frame. Solid masks
    are that box in their color. Blur and pixelate masks use it as a white
    matte on black: a blurred / pixelated copy of the frame shows through
    it, so exactly the previewed area is covered."""
    W, H, fps = plan.width, plan.height, plan.fps
    d = _num(total + 0.1)
    graph: list[str] = []
    acc = base
    for i, m in enumerate(plan.masks):
        if not m.rows:
            continue
        times, boxes = mask_pixels(m, W, H)
        x, y, w, h = (step_expr(times, [b[k] for b in boxes], "t", fps) for k in range(4))
        en = f"enable='between(t,{_num(m.start)},{_num(m.end)})'"
        sized = f"scale=w='{w}':h='{h}':eval=frame:flags=neighbor"
        place = f"overlay=x='{x}':y='{y}':eval=frame:format=auto:eof_action=pass"
        k = max(0.0, min(1.0, m.strength / 100))
        if m.mode == "solid":
            graph.append(f"color=c=0x{m.color.lstrip('#')}:s=16x16:r={_num(fps)}:d={d},{sized}[mbox{i}]")
            graph.append(f"[{acc}][mbox{i}]{place}:{en}[mk{i}]")
        else:
            if m.mode == "blur":
                fx = f"gblur=sigma={_num(H * (0.008 + 0.04 * k))}:steps=2:{en}"
            else:
                block = max(4, _round(H * (0.008 + 0.05 * k)))
                fx = f"scale=w='max(1,trunc(iw/{block}))':h='max(1,trunc(ih/{block}))':flags=neighbor,scale={W}:{H}:flags=neighbor"
            graph.append(f"[{acc}]split[mb{i}][ms{i}]")
            graph.append(f"[ms{i}]{fx},format=yuva420p[mf{i}]")
            graph.append(f"color=c=white:s=16x16:r={_num(fps)}:d={d},format=gray,{sized}[mw{i}]")
            graph.append(f"color=c=black:s={W}x{H}:r={_num(fps)}:d={d},format=gray[mz{i}]")
            graph.append(f"[mz{i}][mw{i}]{place},format=gray[mm{i}]")
            graph.append(f"[mf{i}][mm{i}]alphamerge[ma{i}]")
            graph.append(f"[mb{i}][ma{i}]overlay=format=auto:eof_action=pass:{en}[mk{i}]")
        acc = f"mk{i}"
    return graph, acc


def _clip_video_chain(plan: ExportPlan, clip: PlanClip, i: int, idx: int, inputs: _Inputs, tmp: str) -> list[str]:
    """Filters turning clip input `idx` into a canvas-sized [v{i}]."""
    W, H, fps = plan.width, plan.height, plan.fps
    d = _num(clip.duration)
    graph: list[str] = []

    # Keyframes replace the static transform; a value that never changes
    # is applied like a static one, the rest per frame of clip time t.
    def animated(key: str, static: float) -> tuple[str | None, float]:
        if not clip.keyframes:
            return None, static
        vals = keyframe_values(clip.keyframes, key)
        return (keyframe_expr(clip.keyframes, key, "t") if len(set(vals)) > 1 else None), vals[0]

    x_anim, pos_x = animated("x", clip.x)
    y_anim, pos_y = animated("y", clip.y)
    scale_anim, scale = animated("scale", clip.scale)
    rot_anim, rotation = animated("rotation", clip.rotation)
    x_pos = f"{W}*({x_anim})" if x_anim else _num(pos_x * W)
    y_pos = f"{H}*({y_anim})" if y_anim else _num(pos_y * H)

    pre: list[str] = []
    if clip.freeze:
        # The first decoded frame, repeated for the whole hold with fresh
        # frame-rate timestamps (a lone frame would otherwise produce no
        # output from the fps filter below).
        frames = int(math.ceil(clip.duration * fps)) + 1
        pre.append(f"trim=end_frame=1,loop=loop={frames}:size=1,setpts=N/({_num(fps)}*TB)")
    cropped = clip.crop_x > 0 or clip.crop_y > 0 or clip.crop_w < 1 or clip.crop_h < 1
    if cropped:
        pre.append(_crop_filter(clip))
    if clip.stabilize > 0 and not clip.freeze:
        # On the decoded (cropped) frames, the same sequence the analysis
        # pass saw - before retiming changes the frame count.
        pre.append(_stabilize_filter(clip))
    if clip.ramp and not clip.freeze:
        pre.append(f"setpts='({ramp_pts_expr(clip)})/TB'")
    elif not clip.freeze:
        pre.append(f"setpts=(PTS-STARTPTS)/{_num(clip.speed)}")
    lut = (clip.lut_size, clip.lut_data, clip.lut_intensity) if clip.lut_size and clip.lut_intensity > 0 else None
    if not look_pipeline.is_neutral_color(clip.filter, clip.intensity, clip.adjust) or clip.curve or lut:
        cube = os.path.join(tmp, f"look{i}.cube")
        look_pipeline.write_cube(
            cube, look_pipeline.grade_stages(clip.filter, clip.intensity, clip.adjust), curve=clip.curve or None, lut=lut
        )
        # Forward slashes + escaped drive colon so the path survives filter
        # graph parsing on Windows too.
        cube_arg = _filter_path(cube)
        pre.append(f"lut3d=file='{cube_arg}'")
    if clip.adjust["sharpness"] > 0:
        pre.append(f"unsharp=5:5:{_num(clip.adjust['sharpness'] / 100 * 1.5)}")

    # Fitted box: the (cropped) source's aspect, contained in (fit) or
    # covering (fill) the canvas, times the clip's own scale.
    src_ar = (clip.source_width * clip.crop_w) / max(1, clip.source_height * clip.crop_h)
    if (plan.fit == "fit") == (src_ar > W / H):
        box_w, box_h = W, W / src_ar
    else:
        box_w, box_h = H * src_ar, H
    inset = 1 - 2 * max(0.0, min(0.2, plan.frame_padding))
    box_scale = 1.0 if scale_anim else scale
    box_w, box_h = _even(box_w * box_scale * inset), _even(box_h * box_scale * inset)
    pre.append(f"scale={box_w}:{box_h}:flags=lanczos,setsar=1")
    blur = f"gblur=sigma={_num(clip.adjust['blur'] / 100 * 0.02 * H)}" if clip.adjust["blur"] > 0 else None
    # With a zoom the blur comes after it, as in the preview (which blurs
    # the zoomed picture); before it, the zoom magnified the blur.
    if blur and not clip.camera:
        pre.append(blur)
    pre.append(f"fps={_num(fps)}")
    if clip.reverse:
        # After scaling, so the buffered frames are at most canvas-sized.
        pre.append("reverse")

    opacity = max(0.0, min(1.0, clip.adjust["opacity"] / 100))
    post: list[str] = []
    if abs(rotation) > 0.01 or rot_anim or scale_anim or opacity < 0.999:
        post.append("format=rgba")
    if rot_anim:
        # A box that fits every angle, so the center stays put. Filled with
        # transparent black: c=none leaves the previous frame's pixels
        # around the picture, which smears a turning picture into a disc.
        post.append(f"rotate=a='({rot_anim})*PI/180':c=black@0:ow='hypot(iw,ih)':oh='hypot(iw,ih)'")
    elif abs(rotation) > 0.01:
        rad = f"{_num(rotation)}*PI/180"
        post.append(f"rotate=a={rad}:c=none:ow=rotw({rad}):oh=roth({rad})")
    if opacity < 0.999:
        post.append(f"colorchannelmixer=aa={_num(opacity)}")
    if scale_anim:
        # After rotating, so the rotate filter keeps one input size.
        post.append(f"scale=w='max(2,trunc(iw*({scale_anim})/2)*2)':h='max(2,trunc(ih*({scale_anim})/2)*2)':eval=frame")

    needs_blur_bg = plan.background == "blur"
    chain = ",".join(pre)
    head = f"[{idx}:v:0]{chain}"
    if clip.camera:
        # Zoomed after fitting, so the zoom works on canvas-sized frames and
        # the blurred background (split below) follows it, like the preview.
        graph.append(f"[{idx}:v:0]{chain}[cp{i}]")
        graph += _camera_chain(clip, i, f"cp{i}", box_w, box_h, fps)
        head = f"[zc{i}]{blur or 'null'}"
    if needs_blur_bg:
        graph.append(f"{head},split[c{i}][cb{i}]")
        graph.append(
            f"[cb{i}]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
            f"gblur=sigma={_num(H / 30)},setsar=1[bg{i}]"
        )
        fg_in = f"c{i}"
    else:
        graph.append(f"{head}[c{i}]")
        fg_in = f"c{i}"
        if plan.background == "image" and plan.background_image:
            bg_idx = inputs.add("-loop", "1", "-framerate", _num(fps), "-t", d, "-i", plan.background_image)
            graph.append(
                f"[{bg_idx}:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={_num(fps)}[bg{i}]"
            )
        elif plan.background == "gradient":
            grad_idx = inputs.add("-loop", "1", "-framerate", _num(fps), "-t", d, "-i", _gradient_image(tmp, W, H, plan.color, plan.color2))
            graph.append(f"[{grad_idx}:v]format=rgb24,setsar=1,fps={_num(fps)}[bg{i}]")
        else:
            graph.append(f"color=c={plan.color}:s={W}x{H}:r={_num(fps)}:d={d}[bg{i}]")

    # Canvas frame: rounded corners (alpha mask), then the shadow on the
    # background under where the video lands, turned and faded with it.
    # The clip's shape mask (src/lib/editor/shapeMask.ts) multiplies in.
    radius = max(0.0, min(0.1, plan.frame_radius)) * min(W, H)
    if radius > 0.5 or clip.mask_path:
        masks = []
        if radius > 0.5:
            mask_idx = inputs.add("-loop", "1", "-framerate", _num(fps), "-t", d, "-i", _frame_mask(tmp, i, box_w, box_h, radius))
            graph.append(f"[{mask_idx}:v]format=gray,setsar=1[fm{i}]")
            masks.append(f"fm{i}")
        if clip.mask_path:
            sm_idx = inputs.add("-loop", "1", "-framerate", _num(fps), "-t", d, "-i", clip.mask_path)
            graph.append(f"[{sm_idx}:v]scale={box_w}:{box_h}:flags=bicubic,format=gray,setsar=1[fsm{i}]")
            masks.append(f"fsm{i}")
        if len(masks) == 2:
            graph.append(f"[fm{i}][fsm{i}]blend=all_mode=multiply[fmm{i}]")
            masks = [f"fmm{i}"]
        graph.append(f"[{fg_in}]format=rgba[fr{i}]")
        graph.append(f"[fr{i}][{masks[0]}]alphamerge[fa{i}]")
        fg_in = f"fa{i}"
        if not post:
            post.append("format=rgba")
    shadow_path = _frame_shadow_image(tmp, i, box_w, box_h, radius, H, plan.frame_shadow)
    if shadow_path:
        sh_idx = inputs.add("-loop", "1", "-framerate", _num(fps), "-t", d, "-i", shadow_path)
        sh_post = ["format=rgba"] + [f for f in post if f.startswith(("rotate", "colorchannelmixer", "scale"))]
        graph.append(f"[{sh_idx}:v]{','.join(sh_post)},setsar=1[fs{i}]")
        graph.append(f"[bg{i}][fs{i}]overlay=x='{x_pos}-overlay_w/2':y='{y_pos}-overlay_h/2':format=auto[bs{i}]")
        bg_label = f"bs{i}"
    else:
        bg_label = f"bg{i}"

    if post:
        graph.append(f"[{fg_in}]{','.join(post)}[cf{i}]")
        fg_in = f"cf{i}"
    graph.append(
        f"[{bg_label}][{fg_in}]overlay=x='{x_pos}-overlay_w/2':y='{y_pos}-overlay_h/2':"
        f"format=auto:eof_action=repeat,format=yuv420p,setsar=1,"
        f"tpad=stop_mode=clone:stop_duration={d},trim=duration={d},setpts=PTS-STARTPTS,settb=AVTB,fps={_num(fps)}[v{i}]"
    )
    return graph


def _crop_filter(clip: PlanClip) -> str:
    return (
        f"crop=w='trunc(iw*{_num(clip.crop_w)}/2)*2':h='trunc(ih*{_num(clip.crop_h)}/2)*2':"
        f"x='iw*{_num(clip.crop_x)}':y='ih*{_num(clip.crop_y)}'"
    )


def _stabilize_filter(clip: PlanClip) -> str:
    """vidstabtransform with the analysed motion, zoomed just enough to
    hide the moving edges; deshake (one pass) when there's no analysis
    (an ffmpeg without vidstab)."""
    k = max(0.0, min(1.0, clip.stabilize / 100))
    if clip.stab_path:
        return f"vidstabtransform=input='{_filter_path(clip.stab_path)}':smoothing={int(round(5 + 45 * k))}:optzoom=1:interpol=bicubic"
    r = int(round(16 + 48 * k))
    return f"deshake=rx={r}:ry={r}"


_VIDSTAB: bool | None = None


def has_vidstab() -> bool:
    global _VIDSTAB
    if _VIDSTAB is None:
        try:
            out = subprocess.run([get_ffmpeg_path(), "-hide_banner", "-filters"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30).stdout
            _VIDSTAB = "vidstabdetect" in out
        except (OSError, subprocess.SubprocessError):
            _VIDSTAB = False
    return _VIDSTAB


def stabilize_analysis_args(clip: PlanClip, trf_path: str) -> list[str]:
    """Pass 1: motion of the clip's frames (same range and crop as the
    render) into `trf_path`."""
    k = max(0.0, min(1.0, clip.stabilize / 100))
    vf = [_crop_filter(clip)] if clip.crop_x > 0 or clip.crop_y > 0 or clip.crop_w < 1 or clip.crop_h < 1 else []
    vf.append(f"vidstabdetect=result='{_filter_path(trf_path)}':shakiness={int(round(3 + 7 * k))}:accuracy=15")
    length = clip.source_length or clip.duration * clip.speed
    return ["-y", "-hide_banner", "-ss", _num(clip.start), "-t", _num(length), "-i", clip.source_path, "-vf", ",".join(vf), "-an", "-f", "null", "-"]


async def prepare_stabilization(plan: ExportPlan, tmp: str, cancel: "threading.Event | None" = None) -> None:
    """Runs the analysis pass for every stabilized clip (when this ffmpeg
    has vidstab), so build_export_args can use vidstabtransform."""
    quantize_plan(plan)
    if not any(c.stabilize > 0 and not c.freeze for c in plan.clips) or not has_vidstab():
        return
    for i, clip in enumerate(plan.clips):
        if clip.stabilize > 0 and not clip.freeze:
            path = os.path.join(tmp, f"stab{i}.trf")
            await _run_ffmpeg(stabilize_analysis_args(clip, path), cancel=cancel)
            clip.stab_path = path


def _clip_audio_chain(plan: ExportPlan, clip: PlanClip, i: int, idx: int) -> str:
    d = _num(clip.duration)
    if clip.ramp and clip.source_has_audio and clip.source_length / len(clip.ramp) < MIN_RAMP_AUDIO_PIECE:
        # Too short to split: atempo emits nothing for a piece under ~21 ms,
        # leaving the clip without sound, and the silence apad then makes
        # has no timestamps, which fails the next concat ("Invalid data
        # found when processing input"). One tempo for the whole clip, the
        # ramp's average, keeps it the same length.
        piece = clip.source_length / len(clip.ramp)
        average = clip.source_length / sum(piece / s for s in clip.ramp)
        return (
            f"[{idx}:a:0]aresample={AUDIO_RATE},{_stereo(clip.source_mono)},{_atempo(average)},"
            f"volume={_num(clip.volume)},apad,atrim=duration={d},asetpts=PTS-STARTPTS[a{i}]"
        )
    if clip.ramp and clip.source_has_audio:
        # Each source piece at its own tempo, joined back together.
        k = len(clip.ramp)
        piece = clip.source_length / k
        heads = "".join(f"[ra{i}_{n}]" for n in range(k))
        parts = [
            f"[{idx}:a:0]aresample={AUDIO_RATE},{_stereo(clip.source_mono)},asplit={k}{heads}"
        ]
        for n, s in enumerate(clip.ramp):
            parts.append(
                f"[ra{i}_{n}]atrim=start={_num(n * piece)}:end={_num((n + 1) * piece)},asetpts=PTS-STARTPTS,{_atempo(s)}[rb{i}_{n}]"
            )
        tails = "".join(f"[rb{i}_{n}]" for n in range(k))
        parts.append(f"{tails}concat=n={k}:v=0:a=1,volume={_num(clip.volume)},apad,atrim=duration={d},asetpts=PTS-STARTPTS[a{i}]")
        return ";".join(parts)
    src = f"[{idx}:a:0]" if clip.source_has_audio else f"anullsrc=r={AUDIO_RATE}:cl=stereo,"
    tempo = _atempo(clip.speed) if clip.source_has_audio else "anull"
    rev = "areverse," if clip.reverse and clip.source_has_audio else ""
    return (
        f"{src}aresample={AUDIO_RATE},{_stereo(clip.source_mono and clip.source_has_audio)},{rev}{tempo},"
        f"volume={_num(clip.volume)},apad,atrim=duration={d},asetpts=PTS-STARTPTS[a{i}]"
    )


def _full_at_50(k: float) -> float:
    """Strength of the "on by default" effects (black & white, sepia,
    invert): full from 50% intensity, half at 0. Same as fullAt50 in
    PreviewPlayer.tsx."""
    return min(1.0, 0.5 + k)


def _effect_filters(e: PlanEffect, W: int, H: int) -> str:
    """One timed effect as a filter chain over the joined canvas video.
    Mirrors the preview in src/components/editor/PreviewPlayer.tsx."""
    k = max(0.0, min(1.0, e.intensity / 100))
    s, t_end = _num(e.start), _num(e.end)
    en = f"enable='between(t,{s},{t_end})'"
    if e.type == "blur":
        return f"gblur=sigma={_num(H * (0.004 + 0.02 * k))}:{en}"
    if e.type == "motionblur":
        return f"tmix=frames={int(round(3 + 6 * k))}:{en}"
    if e.type == "glitch":
        sh = int(round(H * (0.006 + 0.02 * k)))
        return f"rgbashift=rh={sh}:bh=-{sh}:gv={sh // 2}:{en},noise=alls={int(10 + 30 * k)}:allf=t:{en}"
    if e.type == "vhs":
        sh = int(round(H * (0.003 + 0.006 * k)))
        return (
            f"rgbashift=rh={sh}:bh=-{sh}:{en},noise=alls={int(8 + 14 * k)}:allf=t:{en},"
            f"drawgrid=w=iw:h=4:t=1:c=black@{_num(0.15 + 0.25 * k)}:{en},eq=saturation={_num(1 + 0.3 * k)}:{en}"
        )
    if e.type == "grain":
        return f"noise=alls={int(6 + 20 * k)}:allf=t:{en}"
    if e.type == "noise":
        return f"noise=c0s={int(15 + 45 * k)}:c1s={int(15 + 45 * k)}:c2s={int(15 + 45 * k)}:allf=t+u:{en}"
    if e.type == "pixelate":
        p = max(2, int(round(H * (0.01 + 0.05 * k))))
        return f"pixelize=w={p}:h={p}:{en}"
    if e.type == "rgbsplit":
        sh = max(1, int(round(H * (0.004 + 0.016 * k))))
        return f"rgbashift=rh={sh}:bh=-{sh}:{en}"
    if e.type == "flash":
        mid = (e.start + e.end) / 2
        half = max(0.01, (e.end - e.start) / 2)
        return f"eq=brightness='{_num(0.3 + 0.6 * k)}*max(0,1-abs(t-{_num(mid)})/{_num(half)})':eval=frame"
    if e.type == "shake":
        a = max(2, int(round(H * (0.008 + 0.03 * k))))
        on = f"between(t,{s},{t_end})"
        return (
            f"pad=iw+{2 * a}:ih+{2 * a}:{a}:{a}:color=black,"
            f"crop={W}:{H}:x='{a}+{a}*sin(t*41)*{on}':y='{a}+{a}*cos(t*37)*{on}'"
        )
    if e.type == "zoom":
        z = _num(0.1 + 0.4 * k)
        ramp = f"between(t,{s},{t_end})*sin(PI*(t-{s})/{_num(max(0.01, e.end - e.start))})"
        return (
            f"scale=w='trunc({W}*(1+{z}*{ramp})/2)*2':h=-2:eval=frame,"
            f"crop={W}:{H}:(in_w-{W})/2:(in_h-{H})/2,setsar=1"
        )
    if e.type == "bw":
        return f"eq=saturation={_num(1 - _full_at_50(k))}:{en}"
    if e.type == "sepia":
        # CSS sepia(a): the sepia matrix blended with identity by a.
        x = 1 - _full_at_50(k)
        m = (
            (0.393 + 0.607 * x, 0.769 - 0.769 * x, 0.189 - 0.189 * x),
            (0.349 - 0.349 * x, 0.686 + 0.314 * x, 0.168 - 0.168 * x),
            (0.272 - 0.272 * x, 0.534 - 0.534 * x, 0.131 + 0.869 * x),
        )
        coeffs = ":".join(f"{ch}{src}={_num(m[i][j])}" for i, ch in enumerate("rgb") for j, src in enumerate("rgb"))
        return f"colorchannelmixer={coeffs}:{en}"
    if e.type == "invert":
        a = _num(_full_at_50(k))
        lut = f"'val+{a}*(negval-val)'"
        return f"lutyuv=y={lut}:u={lut}:v={lut}:{en}"
    if e.type == "hue":
        return f"hue=h='{_num(360 * (0.25 + 1.75 * k))}*(t-{s})':{en}"
    if e.type == "vignette":
        return f"vignette=angle={_num(min(math.pi / 2, 0.4 + k))}:{en}"
    if e.type == "letterbox":
        bh = max(1, int(round(H * (0.06 + 0.08 * k))))
        return f"drawbox=x=0:y=0:w=iw:h={bh}:color=black:t=fill:{en},drawbox=x=0:y=ih-{bh}:w=iw:h={bh}:color=black:t=fill:{en}"
    if e.type == "strobe":
        rate = _num(2 * (4 + 8 * k))
        return f"eq=brightness='0.6*between(t,{s},{t_end})*(1-mod(floor((t-{s})*{rate}),2))':eval=frame"
    if e.type == "mirror":
        return f"hflip={en}"
    raise ValueError(f"unknown effect {e.type}")


# easeOutBack of {p} - backOut() in src/lib/editor/timeline.ts.
_BACK_OUT = "(1+2.70158*pow({p}-1,3)+1.70158*pow({p}-1,2))"


def matte_curve(m: float, edge: float) -> float:
    """The mask's edge curve, 0..1 in and out - the same as edgeCurve() in
    src/lib/editor/matte.ts. Twice as steep as the mask, centered on a
    threshold that `edge` moves: below it a pixel is background, above it
    the person. Steepening drops the faint halo the model leaves around a
    person; moving the threshold over the softened mask grows or shrinks
    the outline."""
    c = 0.5 - max(-100.0, min(100.0, edge)) / 100 * 0.4
    return max(0.0, min(1.0, (m - c) * 2 + 0.5))


def matte_soft_sigma(soft: float, height: float) -> float:
    """Edge softness as a Gaussian blur's sigma in pixels of a mask
    `height` tall (matte.ts softSigma)."""
    return (0.002 + 0.02 * max(0.0, min(100.0, soft)) / 100) * height


def matte_blur_sigma(blur: float, height: float) -> float:
    """Background blur's sigma in pixels of a layer `height` tall (matte.ts blurSigma)."""
    return 0.05 * max(0.0, min(100.0, blur)) / 100 * height


def matte_bg_rect(box_w: float, box_h: float, m: PlanMatte) -> tuple[float, float, float, float]:
    """Where an image or video background goes in the layer's box: (left,
    top, width, height) in the box's pixels (matte.ts bgRect). "fill" covers
    the box, "fit" shows all of it; `scale` enlarges it; x/y pick which part
    of an overflowing background shows (0.5 = centered)."""
    bw, bh = max(1, m.bg_width), max(1, m.bg_height)
    k = (max if m.fit == "fill" else min)(box_w / bw, box_h / bh) * max(1.0, min(4.0, m.scale))
    w, h = bw * k, bh * k
    return (box_w - w) * m.x, (box_h - h) * m.y, w, h


def _matte_head(m: PlanMatte, src: str, n: int, plan: ExportPlan, start: float, end: float, tw: int, th: int, bg_idx: int | None) -> str:
    """Filters from the matted file `src` (picture on top, mask below) to the
    layer at tw x th, without its output label: the person over a clear,
    blurred, image or video background."""
    s, fps, length = _num(start), _num(plan.fps), _num(max(0.05, end - start))
    c = 0.5 - max(-100.0, min(100.0, m.edge)) / 100 * 0.4
    # The mask half is limited-range luma (16..235) as encoded: at the
    # layer's size, to 0..1, softened, then the edge curve (matte_curve) -
    # sizes relative to the height, as the preview does at its own size.
    graph = [
        f"{src}setpts=PTS-STARTPTS+{s}/TB,fps={fps},split[mpa{n}][mpb{n}]",
        f"[mpb{n}]crop=iw:ih/2:0:ih/2,extractplanes=y,scale={tw}:{th}:flags=bicubic,"
        f"lut=c0='clip((val-16)*255/219,0,255)',gblur=sigma={_num(matte_soft_sigma(m.soft, th))}:steps=2,"
        f"lut=c0='clip(((val/255-{_num(c)})*2+0.5)*255,0,255)'[mpm{n}]",
    ]
    picture = f"[mpa{n}]crop=iw:ih/2:0:0,scale={tw}:{th}:flags=lanczos,format=rgba"
    if m.mode == "blur":
        graph.append(f"{picture},split[mpc{n}][mpd{n}]")
        graph.append(f"[mpd{n}]gblur=sigma={_num(max(0.01, matte_blur_sigma(m.blur, th)))}:steps=3[mpg{n}]")
        back = f"[mpg{n}]"
    else:
        graph.append(f"{picture}[mpc{n}]")
        back = None
    if m.mode in ("image", "video") and bg_idx is not None:
        left, top, w, h = matte_bg_rect(tw, th, m)
        prep = f"[{bg_idx}:v]"
        if m.mode == "video":
            # Starts with the layer; ffmpeg loops the input (-stream_loop),
            # or the last frame is held when it's shorter than the layer.
            prep += ("" if m.loop else f"tpad=stop_mode=clone:stop_duration={length},") + f"fps={fps},"
        graph.append(f"{prep}setpts=PTS-STARTPTS+{s}/TB,scale={max(2, round(w))}:{max(2, round(h))}:flags=bicubic,format=rgba[mpi{n}]")
        # A clear box the size of the layer, the background placed in it
        # (a "fit" background leaves the rest clear).
        graph.append(f"color=c=black@0:s={tw}x{th}:r={fps}:d={length},format=rgba,setpts=PTS-STARTPTS+{s}/TB[mpk{n}]")
        graph.append(f"[mpk{n}][mpi{n}]overlay=x={_num(left)}:y={_num(top)}:format=rgb:eof_action=pass,format=rgba[mpg{n}]")
        back = f"[mpg{n}]"
    if back is None:
        graph.append(f"[mpc{n}][mpm{n}]alphamerge")
    else:
        graph.append(f"[mpc{n}][mpm{n}]alphamerge[mpf{n}]")
        graph.append(f"{back}[mpf{n}]overlay=format=rgb,format=rgba")
    return ";".join(graph)


def _overlay_filters(
    o: PlanOverlay, src: str, n: int, plan: ExportPlan, base_label: str, mask_idx: int | None = None, bg_idx: int | None = None
) -> tuple[str, str]:
    """Filter chain for one overlay (the pad `src`, e.g. "[3:v:0]") plus the
    overlay onto `base_label`; returns (chain, output label). Same geometry and
    animation curves as stickerFrame() in src/lib/editor/timeline.ts."""
    W, H = plan.width, plan.height
    target_w = max(2, round(o.width * W))
    target_h = max(2, round(target_w * o.image_height / o.image_width))
    anim = min(ANIM_SECONDS, (o.end - o.start) / 2)
    s, a = _num(o.start), _num(anim)
    pin = f"min(1,max(0,(t-{s})/{a}))"
    pout = f"min(1,max(0,(t-{_num(o.end - anim)})/{a}))"
    kfs = o.keyframes
    turning = bool(kfs) and len(set(keyframe_values(kfs, "rotation"))) > 1
    rotation = keyframe_values(kfs, "rotation")[0] if kfs and not turning else o.rotation
    rad = f"({keyframe_expr(kfs, 'rotation', 't')})*PI/180" if turning else f"{_num(rotation)}*PI/180"

    parts = ["format=rgba"]
    if o.sprite_times:
        # The current state's cell, picked per frame by its own time.
        cols = o.sprite_cols
        k = step_expr(o.sprite_times, list(range(len(o.sprite_times))), "t", plan.fps)
        parts.append(
            f"crop=w=iw/{cols}:h=ih/{o.sprite_rows}:x='iw/{cols}*mod({k},{cols})':y='ih/{o.sprite_rows}*floor(({k})/{cols})'"
        )
    if o.key_color:
        # Same math as applyKey() in src/lib/editor/chromaKey.ts.
        parts.append(
            f"colorkey=0x{o.key_color.lstrip('#')}:{_num(max(0.01, min(1.0, o.key_similarity / 100)))}:"
            f"{_num(max(0.0, min(1.0, o.key_smoothness / 100)))}"
        )
    parts.append(f"scale={target_w}:{target_h}:flags=lanczos")
    # Shift the input (a video layer's trimmed range, or a still looped for
    # the layer's length) to start at the layer's timeline position, so the
    # time-based fades/animations and `enable` below see timeline time.
    parts.insert(0, f"setpts=PTS-STARTPTS+{s}/TB,fps={_num(plan.fps)}" if o.video else f"setpts=PTS-STARTPTS+{s}/TB")
    if o.matte:
        # The matted file in place of the video (src is its input), composed
        # at the layer's size; the rest of the chain (opacity, rotation,
        # animation, shape mask, placement) runs on the result as on any layer.
        src = _matte_head(o.matte, src, n, plan, o.start, o.end, target_w, target_h, bg_idx) + f"[mto{n}];[mto{n}]"
        parts = ["null"]
    sized = len(parts)  # filters up to here run before the shape mask
    opacities = keyframe_values(kfs, "opacity") if kfs else [o.opacity]
    if len(set(opacities)) > 1:
        # Animated opacity: alpha times the curve at the frame's time T.
        parts.append(f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*({keyframe_expr(kfs, 'opacity', 'T')})'")
    elif opacities[0] < 0.999:
        parts.append(f"colorchannelmixer=aa={_num(max(0.0, opacities[0]))}")
    spins = []
    if o.anim_in == "spin":
        spins.append(f"-PI*(1-{pin})")
    if o.anim_out == "spin":
        spins.append(f"+PI*{pout}")
    if spins or turning:
        # Per-frame angle in a box that fits every angle, so the layer's
        # size (and its centered position) stays put while it turns. Filled
        # with transparent black, not c=none (see _clip_video_chain).
        parts.append(f"rotate=a='{rad}{''.join(spins)}':c=black@0:ow='hypot(iw,ih)':oh='hypot(iw,ih)'")
    elif abs(rotation) > 0.01:
        parts.append(f"rotate=a={rad}:c=none:ow=rotw({rad}):oh=roth({rad})")
    if o.anim_in in ("fade", "zoomin", "spin") or o.anim_in.startswith("slide"):
        parts.append(f"fade=t=in:st={s}:d={a}:alpha=1")
    if o.anim_out in ("fade", "zoomout", "spin") or o.anim_out.startswith("slide"):
        parts.append(f"fade=t=out:st={_num(o.end - anim)}:d={a}:alpha=1")
    factors = []
    if o.anim_in in ("pop", "spin"):
        factors.append(f"max(0.02,{pin})")
    if o.anim_in == "bounce":
        factors.append(f"max(0.02,{_BACK_OUT.format(p=pin)})")
    if o.anim_in == "zoomin":
        factors.append(f"(0.6+0.4*{pin})")
    if o.anim_out in ("pop", "spin"):
        factors.append(f"max(0.02,1-{pout})")
    if o.anim_out == "zoomout":
        factors.append(f"(1-0.4*{pout})")
    if kfs and keyframe_values(kfs, "scale") != [1.0] * len(kfs):
        factors.append(f"({keyframe_expr(kfs, 'scale', 't')})")
    if factors:
        f = "*".join(factors)
        parts.append(f"scale=w='max(2,iw*{f})':h='max(2,ih*{f})':eval=frame")

    dx = _num(SLIDE_DISTANCE * W)
    dy = _num(SLIDE_DISTANCE * H)
    x_expr = f"{W}*({keyframe_expr(kfs, 'x', 't')})" if kfs else _num(o.x * W)
    y_expr = f"{H}*({keyframe_expr(kfs, 'y', 't')})" if kfs else _num(o.y * H)
    shifts_in = {"slideleft": ("+", "x"), "slideright": ("-", "x"), "slideup": ("+", "y"), "slidedown": ("-", "y")}
    shifts_out = {"slideleft": ("-", "x"), "slideright": ("+", "x"), "slideup": ("-", "y"), "slidedown": ("+", "y")}
    if o.anim_in in shifts_in:
        sign, axis = shifts_in[o.anim_in]
        term = f"{sign}{dx if axis == 'x' else dy}*(1-{pin})"
        x_expr, y_expr = (x_expr + term, y_expr) if axis == "x" else (x_expr, y_expr + term)
    if o.anim_out in shifts_out:
        sign, axis = shifts_out[o.anim_out]
        term = f"{sign}{dx if axis == 'x' else dy}*{pout}"
        x_expr, y_expr = (x_expr + term, y_expr) if axis == "x" else (x_expr, y_expr + term)

    in_label, out_label = f"ol{n}", f"oo{n}"
    if mask_idx is not None:
        # Shape mask, in the layer's own frame: its alpha times the mask.
        head = (
            f"{src}{','.join(parts[:sized])}[olp{n}];"
            f"[{mask_idx}:v]setpts=PTS-STARTPTS+{s}/TB,scale={target_w}:{target_h}:flags=bicubic,format=gray[olm{n}];"
            f"[olp{n}]split[olq{n}][olr{n}];[olq{n}]alphaextract[ola{n}];"
            f"[ola{n}][olm{n}]blend=all_mode=multiply[olb{n}];[olr{n}][olb{n}]alphamerge"
        )
        rest = parts[sized:]
        source = head + ("," + ",".join(rest) if rest else "")
    else:
        source = f"{src}{','.join(parts)}"
    place = f"overlay=x='{x_expr}-overlay_w/2':y='{y_expr}-overlay_h/2':enable='between(t,{s},{_num(o.end)})':eval=frame"
    if o.blend != "normal":
        # Layer on a neutral full canvas (see BLEND_MODES), blended in RGB -
        # the preview's mix-blend-mode works on sRGB values too.
        mode, neutral = BLEND_MODES[o.blend]
        d = _num(timeline_duration(plan) + 0.1)
        chain = (
            f"{source}[{in_label}];"
            f"color=c={neutral}:s={W}x{H}:r={_num(plan.fps)}:d={d},format=rgba[on{n}];"
            f"[on{n}][{in_label}]{place}:eof_action=pass:format=rgb,format=gbrp[ob{n}];"
            f"[{base_label}]format=gbrp[oa{n}];"
            f"[oa{n}][ob{n}]blend=all_mode={mode}:enable='between(t,{s},{_num(o.end)})',format=yuv420p[{out_label}]"
        )
        return chain, out_label
    chain = f"{source}[{in_label}];[{base_label}][{in_label}]{place}:eof_action=pass:format=auto[{out_label}]"
    return chain, out_label


# Long timelines are rendered in two steps (see render_export): every
# clip input's decoder stays open for the whole render, about 80 MB each
# before its filters and 150 MB with them at 1080p (measured: 40 clips
# peaked at 5.6 GB), so from SEGMENT_MIN_CLIPS clips on, groups of about
# SEGMENT_CLIPS clips are first rendered to near-lossless pieces, which
# the final render joins and puts the timeline's layers on.
SEGMENT_MIN_CLIPS = 13
SEGMENT_CLIPS = 8
SEGMENT_CRF = 8


def segment_groups(plan: ExportPlan) -> list[list[int]]:
    """The clip indexes of each piece, or [] when the timeline is rendered
    in one go. A piece only ends at a plain cut: a transition needs both
    of its clips in the same render."""
    quantize_plan(plan)
    if len(plan.clips) < SEGMENT_MIN_CLIPS:
        return []
    groups: list[list[int]] = [[]]
    for i in range(len(plan.clips)):
        if len(groups[-1]) >= SEGMENT_CLIPS and plan.clips[i - 1].transition is None:
            groups.append([])
        groups[-1].append(i)
    return groups


def _clip_track(plan: ExportPlan, indexes: "range | list[int]", inputs: _Inputs, tmp: str, graph: list[str]) -> tuple[str, str, float]:
    """The clips at `indexes` (consecutive), each fitted to the canvas and
    joined with their transitions, added to `graph`. Returns the video and
    audio labels and the track's length."""
    fps = plan.fps
    indexes = list(indexes)
    # A freeze only needs a moment of its source around the held frame.
    # Every input's decoder is open for the whole render; with its default
    # thread count (one per core) each 1080p decoder holds ~230 MB, so with
    # many clips they're limited to 2 threads each (24 clips: 5.6 -> 3.5 GB
    # peak, same render time, measured).
    dec_threads = ["-threads", "2"] if len(indexes) > 2 else []
    clip_idx = {
        i: inputs.add(*dec_threads, "-ss", _num(c.start), "-t", _num(0.5 if c.freeze else (c.source_length or c.duration * c.speed)), "-i", c.source_path)
        for i, c in ((i, plan.clips[i]) for i in indexes)
    }
    for i in indexes:
        graph += _clip_video_chain(plan, plan.clips[i], i, clip_idx[i], inputs, tmp)
        if plan.with_audio:
            graph.append(_clip_audio_chain(plan, plan.clips[i], i, clip_idx[i]))

    # Video: each run of plain cuts joined by one concat, and the runs
    # crossfaded into each other. Never a concat after an xfade: xfade ends
    # its stream at its last frame's start, so the fps after such a concat
    # dropped a frame at every later cut (18 clips with 2 crossfades lost
    # 1.2 s, measured).
    runs: list[list[int]] = [[]]
    for i in indexes:
        if runs[-1] and plan.clips[i - 1].transition:
            runs.append([])
        runs[-1].append(i)

    def run_label(run: list[int]) -> str:
        if len(run) == 1:
            return f"v{run[0]}"
        graph.append("".join(f"[v{i}]" for i in run) + f"concat=n={len(run)}:v=1:a=0,fps={_num(fps)}[vr{run[0]}]")
        return f"vr{run[0]}"

    v_acc = run_label(runs[0])
    length = sum(plan.clips[i].duration for i in runs[0])
    for run in runs[1:]:
        td = plan.clips[run[0] - 1].transition_duration
        xfade, _ = TRANSITIONS[plan.clips[run[0] - 1].transition]
        graph.append(f"[{v_acc}][{run_label(run)}]xfade=transition={xfade}:duration={_num(td)}:offset={_num(length - td)}[vx{run[0]}]")
        v_acc = f"vx{run[0]}"
        length += sum(plan.clips[i].duration for i in run) - td

    first = indexes[0]
    a_acc = f"a{first}"
    if plan.with_audio:
        for i in indexes[1:]:
            prev = plan.clips[i - 1]
            a_out = f"aj{i}"
            if prev.transition:
                _, audio_style = TRANSITIONS[prev.transition]
                td = prev.transition_duration
                # Where the clips overlap: the audio track's length so far.
                at = sum(plan.clips[k].duration - plan.clips[k].transition_duration for k in indexes if k < i - 1) + prev.duration
                if audio_style == "dip":
                    half = _num(td / 2)
                    graph.append(f"[{a_acc}]afade=t=out:st={_num(at - td)}:d={half}[ao{i}]")
                    graph.append(f"[a{i}]afade=t=in:st={half}:d={half}[ai{i}]")
                    graph.append(f"[ao{i}][ai{i}]acrossfade=d={_num(td)}:c1=nofade:c2=nofade[{a_out}]")
                else:
                    graph.append(f"[{a_acc}][a{i}]acrossfade=d={_num(td)}:c1=tri:c2=tri[{a_out}]")
            else:
                graph.append(f"[{a_acc}][a{i}]concat=n=2:v=0:a=1[{a_out}]")
            a_acc = a_out
    return v_acc, a_acc, length


def build_segment_args(plan: ExportPlan, indexes: list[int], output_path: str, tmp: str, n: int) -> list[str]:
    """First step of a long timeline's render: the clips at `indexes` as one
    near-lossless piece (H.264 at SEGMENT_CRF, PCM audio) of exactly their
    timeline length. `n` names the piece's graph script."""
    quantize_plan(plan)
    inputs = _Inputs()
    graph: list[str] = []
    v_acc, a_acc, length = _clip_track(plan, indexes, inputs, tmp, graph)
    graph.append(f"[{v_acc}]format=yuv420p[sv]")
    script = os.path.join(tmp, f"segment{n}.txt")
    with open(script, "w", encoding="utf-8") as f:
        f.write(";\n".join(graph))
    args = ["-y", "-hide_banner", *inputs.args, *_graph_args(script), "-map", "[sv]"]
    if plan.with_audio:
        args += ["-map", f"[{a_acc}]", "-c:a", "pcm_s16le"]
    return args + [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(SEGMENT_CRF), "-pix_fmt", "yuv420p",
        "-r", _num(plan.fps), "-t", _num(length), output_path,
    ]  # fmt: skip


def build_export_args(
    plan: ExportPlan, output_path: str, tmp: str, encoder: str = encoders.SOFTWARE, segments: list[str] | None = None
) -> list[str]:
    """Builds the ffmpeg argument list and writes the filter graph (plus
    any LUT files) into `tmp` - the graph goes in a script file because a
    long timeline's graph can exceed Windows' command-line length limit.
    `encoder`: the MP4 video encoder (app/pipeline/encoders.py).
    `segments`: the clips' pre-rendered pieces (build_segment_args), in
    order, used instead of the clips themselves.
    """
    quantize_plan(plan)
    fps = plan.fps
    total = timeline_duration(plan)
    inputs = _Inputs()
    graph: list[str] = []

    if segments is None:
        v_acc, a_acc, _ = _clip_track(plan, range(len(plan.clips)), inputs, tmp, graph)
    else:
        # The clips were pre-rendered in groups (build_segment_args): joined
        # here, so only one decoder per group is open for this render.
        idx = [inputs.add("-i", s) for s in segments]
        pads = "".join(f"[{n}:v:0]" + (f"[{n}:a:0]" if plan.with_audio else "") for n in idx)
        graph.append(f"{pads}concat=n={len(idx)}:v=1:a={1 if plan.with_audio else 0}[vseg]" + ("[aseg]" if plan.with_audio else ""))
        v_acc, a_acc = "vseg", "aseg"

    if plan.effects:
        fx = ",".join(_effect_filters(e, plan.width, plan.height) for e in plan.effects)
        graph.append(f"[{v_acc}]{fx}[vfx]")
        v_acc = "vfx"

    # Privacy masks cover the video and its effects (and sit under the
    # pointer, text and stickers - the preview's order).
    if plan.masks:
        mask_graph, v_acc = _mask_filters(plan, v_acc, total)
        graph += mask_graph

    # Pointer layers sit above the video and its effects, below text,
    # stickers and images - the preview's stacking order.
    if plan.pointer and (plan.pointer.ring_rows or plan.pointer.cursor_rows):
        pointer_graph, v_acc = _pointer_filters(plan, inputs, v_acc, total)
        graph += pointer_graph

    for n, o in enumerate(plan.overlays):
        bg_idx = None
        if o.video:
            # Just the layer's range of its video (or of its matted file,
            # which has the same timing); shifted into place in
            # _overlay_filters, and gone after its end (eof_action=pass).
            picture = o.matte.path if o.matte else o.image_path
            src = f"[{inputs.add('-ss', _num(o.offset), '-t', _num(o.end - o.start), '-i', picture)}:v:0]"
            m = o.matte
            if m and m.bg_path and m.mode == "image":
                bg_idx = inputs.add("-loop", "1", "-framerate", _num(fps), "-t", _num(o.end - o.start + 0.1), "-i", m.bg_path)
            elif m and m.bg_path and m.mode == "video":
                loop = ["-stream_loop", "-1"] if m.loop else []
                bg_idx = inputs.add(*loop, "-t", _num(o.end - o.start), "-i", m.bg_path)
        else:
            # Looped still for the layer's own length, shifted into place in
            # _overlay_filters. Looping it from t=0 instead made ffmpeg decode
            # and queue every frame before the layer appears: about 470 MB
            # per text layer on a 1080p timeline (measured). Read inside the
            # graph rather than as an -i input: one input per caption line
            # overflowed Windows' 32,767-character command line on long videos.
            frames = max(1, math.ceil((o.end - o.start + 0.1) * fps))
            graph.append(
                f"movie=filename='{_filter_path(o.image_path)}',loop=loop={frames - 1}:size=1:start=0,"
                f"setpts=N/({_num(fps)}*TB)[oli{n}]"
            )
            src = f"[oli{n}]"
        mask_idx = inputs.add("-loop", "1", "-framerate", _num(fps), "-t", _num(o.end - o.start + 0.1), "-i", o.mask_path) if o.mask_path else None
        chain, v_acc = _overlay_filters(o, src, n, plan, v_acc, mask_idx, bg_idx)
        graph.append(chain)
    if plan.output_format == "gif":
        # A shared palette from the whole clip, at GIF size and frame rate.
        graph.append(
            f"[{v_acc}]fps={_num(min(fps, GIF_FPS))},scale='min({GIF_MAX_WIDTH},iw)':-2:flags=lanczos,split[ga][gb];"
            f"[ga]palettegen=stats_mode=diff[gp];[gb][gp]paletteuse=dither=bayer:bayer_scale=4[outv]"
        )
    elif plan.output_format == "audio":
        graph.append(f"[{v_acc}]nullsink")
    else:
        # Standard-range YUV with no colour tags, as players expect. ffmpeg 9
        # carried a text or sticker layer's full range and RGB ("gbr") matrix
        # tag through to the file, which players that trust it show in the
        # wrong colours.
        graph.append(f"[{v_acc}]scale=out_range=tv,format=yuv420p,setparams=range=tv:colorspace=unknown:color_primaries=unknown:color_trc=unknown[outv]")

    if plan.with_audio and plan.audio:
        mix_inputs = [f"[{a_acc}]"]
        for n, au in enumerate(plan.audio):
            idx = inputs.add("-ss", _num(au.offset), "-t", _num(au.duration), "-i", au.path)
            delay = int(round(au.start * 1000))
            chain = (
                f"[{idx}:a:0]aresample={AUDIO_RATE},{_stereo(au.mono)},"
                f"atrim=duration={_num(au.duration)},asetpts=PTS-STARTPTS,"
            )
            tone = tone_chain(au.tone)
            if tone:
                chain += f"{tone},"
            chain += f"volume={_num(au.volume)}"
            if VOICE_FX.get(au.voice):
                chain += f",{VOICE_FX[au.voice]}"
            if au.envelope:
                chain += f",volume='{envelope_expr(au.envelope, f'(t+{_num(au.offset)})')}':eval=frame"
            if au.breaths:
                chain += f",volume='{keyframe_expr(breath_points(au.breaths), 'v', f'(t+{_num(au.offset)})')}':eval=frame"
            if au.duck_amount > 0 and au.duck_regions:
                # t is the track's own time here (before adelay).
                chain += f",volume='{duck_gain_expr(au, f'(t+{_num(au.start)})')}':eval=frame"
            if au.fade_in > 0:
                chain += f",afade=t=in:st=0:d={_num(au.fade_in)}"
            if au.fade_out > 0:
                chain += f",afade=t=out:st={_num(max(0.0, au.duration - au.fade_out))}:d={_num(au.fade_out)}"
            chain += f",adelay=delays={delay}:all=1[ax{n}]"
            graph.append(chain)
            mix_inputs.append(f"[ax{n}]")
        # duration=first: the clips' own (always full-length) track sets the
        # length; normalize=0 keeps every track at its chosen volume.
        graph.append(f"{''.join(mix_inputs)}amix=inputs={len(mix_inputs)}:duration=first:normalize=0[amixed]")
        a_acc = "amixed"
    if plan.with_audio:
        graph.append(f"[{a_acc}]{master_chain(plan.master_gain_db)}[amix]")
        a_acc = "amix"

    script = os.path.join(tmp, "graph.txt")
    with open(script, "w", encoding="utf-8") as f:
        f.write(";\n".join(graph))

    if plan.output_format == "gif":
        return ["-y", "-hide_banner", *inputs.args, *_graph_args(script), "-map", "[outv]", "-loop", "0", "-t", _num(total), output_path]
    if plan.output_format == "audio":
        return [
            "-y", "-hide_banner", *inputs.args, *_graph_args(script),
            "-map", f"[{a_acc}]", "-c:a", "aac", "-b:a", plan.audio_bitrate, "-t", _num(total), output_path,
        ]  # fmt: skip

    args = ["-y", "-hide_banner", *inputs.args, *_graph_args(script), "-map", "[outv]"]
    if plan.with_audio:
        args += ["-map", f"[{a_acc}]", "-c:a", "aac", "-b:a", plan.audio_bitrate]
    args += [
        *encoders.encoder_args(encoder, plan.crf),
        "-r",
        _num(fps),
        "-t",
        _num(total),
        "-movflags",
        "+faststart",
        output_path,
    ]
    return args


async def render_export(plan: ExportPlan, output_path: str, job: "JobProgress | None" = None) -> None:
    """Renders the plan. With a `job` (app/progress.py) it reports seconds
    rendered out of the timeline's length and stops on cancel.

    MP4s use the encoder app/pipeline/encoders.py picks (hardware when it
    works); if that fails or its file doesn't check out, the export is
    rendered again with libx264. Every output is checked (streams, size,
    length, a decodable end) before it's returned. Raises encoders.DiskFull
    when there isn't room, before rendering or when a write fails."""
    tmp = tempfile.mkdtemp(prefix="wipeclip-export-")
    try:
        quantize_plan(plan)
        total = timeline_duration(plan)
        encoders.check_space(os.path.dirname(os.path.abspath(output_path)), encoders.estimate_bytes(plan.width, plan.height, plan.fps, total))
        encoder = encoders.pick_encoder() if plan.output_format == "mp4" else encoders.SOFTWARE
        if job is not None:
            job.check()
            # Stabilization analysis runs while the phase still reads "checking".
            await prepare_stabilization(plan, tmp, cancel=job.cancel)
            job.total = total
            job.phase = "rendering"
        else:
            await prepare_stabilization(plan, tmp)

        # Long timelines: the clips' pieces first (segment_groups), each on
        # the temp drive, counted as the first half of the progress bar.
        groups = segment_groups(plan)
        segments: list[str] | None = None
        share = 0.5 if groups else 0.0
        if groups:
            encoders.check_space(tmp, 4 * encoders.estimate_bytes(plan.width, plan.height, plan.fps, total))
            segments, rendered = [], 0.0
            for n, group in enumerate(groups):
                path = os.path.join(tmp, f"segment{n}.mkv")
                start = rendered

                def report_piece(seconds: float, start: float = start) -> None:
                    if job is not None:
                        job.done = (start + seconds) * share

                await _run_ffmpeg(
                    build_segment_args(plan, group, path, tmp, n),
                    progress=report_piece if job is not None else None,
                    cancel=job.cancel if job is not None else None,
                )
                segments.append(path)
                rendered += sum(plan.clips[i].duration - (plan.clips[i].transition_duration if i != group[-1] else 0.0) for i in group)

        def report(seconds: float) -> None:
            if job is not None:
                job.done = total * share + seconds * (1 - share)

        async def attempt(enc: str) -> dict:
            started = time.monotonic()
            if job is None:
                await _run_ffmpeg(build_export_args(plan, output_path, tmp, enc, segments))
            else:
                job.done = total * share
                await _run_ffmpeg(build_export_args(plan, output_path, tmp, enc, segments), progress=report, cancel=job.cancel)
            info = encoders.validate_output(
                output_path,
                duration=total,
                width=plan.width if plan.output_format == "mp4" else None,
                height=plan.height if plan.output_format == "mp4" else None,
                video=plan.output_format != "audio",
                audio=plan.with_audio and plan.output_format != "gif",
                fps=plan.fps,
            )
            print(
                f"export: {plan.output_format} {plan.width}x{plan.height} {_num(plan.fps)} fps, {total:.1f} s, "
                f"{len(plan.clips)} clips, encoder {enc}, {time.monotonic() - started:.1f} s, {os.path.getsize(output_path) / 1e6:.1f} MB",
                file=sys.stderr,
            )
            return info

        try:
            await attempt(encoder)
        except (RuntimeError, encoders.OutputInvalid) as exc:
            if encoders.is_disk_full(str(exc)):
                raise encoders.DiskFull(None, shutil.disk_usage(os.path.dirname(os.path.abspath(output_path))).free) from exc
            if encoder == encoders.SOFTWARE:
                raise
            # Only the error's kind: ffmpeg's text can contain file paths.
            print(f"export: {encoder} failed ({type(exc).__name__}); rendering again with {encoders.SOFTWARE}", file=sys.stderr)
            encoders.give_up_hardware()
            try:
                await attempt(encoders.SOFTWARE)
            except RuntimeError as exc2:
                if encoders.is_disk_full(str(exc2)):
                    raise encoders.DiskFull(None, None) from exc2
                raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
