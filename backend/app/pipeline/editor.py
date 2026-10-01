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
     blurred copy of the clip, or an image).
  2. Joins. Clips (now all canvas-sized, same fps/SAR/format) are joined
     pairwise with `concat` (a cut) or `xfade` + `acrossfade` (a
     transition), overlapping exactly like the editor's timeline math.
  3. Effects. Timed effects run on the joined video, each limited to its
     time range with ffmpeg's timeline `enable`.
  4. Overlays. Stickers, text and images - all PNGs rasterized by the
     browser, the same images the preview shows - are composited bottom to
     top with their position, size, rotation, opacity, time range and
     in/out animation.
  5. Audio. The clips' own audio (after joins) is mixed with every added /
     extracted audio clip (trimmed, delayed to its timeline position, with
     volume and fades), then limited to avoid clipping.

Clip and transition durations are quantized to whole frames before
building the graph so video and audio lengths agree exactly per clip -
otherwise per-clip rounding drift accumulates across many cuts and audio
slides out of sync.

Everything in `ExportPlan` is server-validated (see api_video_export in
app/main.py); nothing here ever takes a path or filter fragment from the
client.
"""

from __future__ import annotations

import math
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field

from app.config import VIDEO_ENCODE_CRF, VIDEO_ENCODE_PRESET
from app.pipeline import look as look_pipeline
from app.pipeline.video import _run_ffmpeg, get_ffmpeg_path

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
}

ANIMS_IN = ("none", "fade", "pop", "zoomin", "slideup", "slidedown", "slideleft", "slideright")
ANIMS_OUT = ("none", "fade", "zoomout", "slideup", "slidedown", "slideleft", "slideright")
EFFECTS = ("blur", "motionblur", "glitch", "vhs", "grain", "noise", "pixelate", "rgbsplit", "flash", "shake", "zoom")
FILTER_IDS = tuple(look_pipeline.FILTERS)

# Must match ANIM_SECONDS / SLIDE_DISTANCE in src/lib/editor/timeline.ts so
# the preview and the export animate alike.
ANIM_SECONDS = 0.35
SLIDE_DISTANCE = 0.15  # fraction of canvas width (x) / height (y)

AUDIO_RATE = 48000


@dataclass
class MediaInfo:
    width: int  # display width (rotation applied), like the browser reports
    height: int
    fps: float
    duration: float
    has_audio: bool


_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
_VIDEO_STREAM_RE = re.compile(r"Stream #\d+:\d+[^:]*: Video: .*?(\d{2,5})x(\d{2,5})")
_FPS_RE = re.compile(r"(\d+(?:\.\d+)?) fps")
_ROTATION_RE = re.compile(r"rotation of (-?\d+(?:\.\d+)?) degrees|rotate\s*:\s*(-?\d+)")


def _ffmpeg_info(path: str) -> str:
    proc = subprocess.run(
        [get_ffmpeg_path(), "-hide_banner", "-i", path], capture_output=True, text=True, errors="replace"
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
    return MediaInfo(width=width, height=height, fps=fps, duration=_duration_of(text), has_audio=has_audio)


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
    clip - used to run the existing AI cleanup (video.remove_logo) on only
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
    start: float
    duration: float  # source seconds; becomes timeline seconds in quantize_plan
    transition: str | None = None  # key of TRANSITIONS, into the next clip
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


@dataclass
class PlanAudio:
    path: str
    start: float  # timeline seconds
    offset: float  # source seconds
    duration: float
    volume: float = 1.0
    fade_in: float = 0.0
    fade_out: float = 0.0


@dataclass
class PlanEffect:
    type: str
    start: float
    end: float
    intensity: float  # 0..100


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
    background: str = "color"  # "color" | "gradient" | "blur" | "image"
    color: str = "#000000"
    color2: str = "#000000"
    background_image: str | None = None


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
        clip.duration = max(1, round(clip.duration / clip.speed * plan.fps)) * frame
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


def _even(v: float) -> int:
    return max(2, int(round(v / 2)) * 2)


def _atempo(speed: float) -> str:
    # atempo accepts 0.5..100 per instance; editor speeds are 0.5..2.
    return f"atempo={_num(speed)}" if abs(speed - 1) > 1e-6 else "anull"


class _Inputs:
    """Accumulates ffmpeg input args and hands out input indexes."""

    def __init__(self) -> None:
        self.args: list[str] = []
        self.count = 0

    def add(self, *args: str) -> int:
        self.args += list(args)
        self.count += 1
        return self.count - 1


def _clip_video_chain(plan: ExportPlan, clip: PlanClip, i: int, idx: int, inputs: _Inputs, tmp: str) -> list[str]:
    """Filters turning clip input `idx` into a canvas-sized [v{i}]."""
    W, H, fps = plan.width, plan.height, plan.fps
    d = _num(clip.duration)
    graph: list[str] = []

    pre = [f"setpts=(PTS-STARTPTS)/{_num(clip.speed)}"]
    if not look_pipeline.is_neutral_color(clip.filter, clip.intensity, clip.adjust):
        cube = os.path.join(tmp, f"look{i}.cube")
        look_pipeline.write_cube(cube, look_pipeline.grade_stages(clip.filter, clip.intensity, clip.adjust))
        # Forward slashes + escaped drive colon so the path survives filter
        # graph parsing on Windows too.
        cube_arg = cube.replace("\\", "/").replace(":", "\\:")
        pre.append(f"lut3d=file='{cube_arg}'")
    if clip.adjust["sharpness"] > 0:
        pre.append(f"unsharp=5:5:{_num(clip.adjust['sharpness'] / 100 * 1.5)}")

    # Fitted box: the source's aspect, contained in (fit) or covering (fill)
    # the canvas, times the clip's own scale.
    src_ar = clip.source_width / max(1, clip.source_height)
    if (plan.fit == "fit") == (src_ar > W / H):
        box_w, box_h = W, W / src_ar
    else:
        box_w, box_h = H * src_ar, H
    box_w, box_h = _even(box_w * clip.scale), _even(box_h * clip.scale)
    pre.append(f"scale={box_w}:{box_h}:flags=lanczos,setsar=1")
    if clip.adjust["blur"] > 0:
        pre.append(f"gblur=sigma={_num(clip.adjust['blur'] / 100 * 0.02 * H)}")
    pre.append(f"fps={_num(fps)}")

    opacity = max(0.0, min(1.0, clip.adjust["opacity"] / 100))
    post: list[str] = []
    if abs(clip.rotation) > 0.01 or opacity < 0.999:
        post.append("format=rgba")
    if abs(clip.rotation) > 0.01:
        rad = f"{_num(clip.rotation)}*PI/180"
        post.append(f"rotate=a={rad}:c=none:ow=rotw({rad}):oh=roth({rad})")
    if opacity < 0.999:
        post.append(f"colorchannelmixer=aa={_num(opacity)}")

    needs_blur_bg = plan.background == "blur"
    chain = ",".join(pre)
    if needs_blur_bg:
        graph.append(f"[{idx}:v:0]{chain},split[c{i}][cb{i}]")
        graph.append(
            f"[cb{i}]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
            f"gblur=sigma={_num(H / 30)},setsar=1[bg{i}]"
        )
        fg_in = f"c{i}"
    else:
        graph.append(f"[{idx}:v:0]{chain}[c{i}]")
        fg_in = f"c{i}"
        if plan.background == "image" and plan.background_image:
            bg_idx = inputs.add("-loop", "1", "-framerate", _num(fps), "-t", d, "-i", plan.background_image)
            graph.append(
                f"[{bg_idx}:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={_num(fps)}[bg{i}]"
            )
        elif plan.background == "gradient":
            graph.append(
                f"gradients=s={W}x{H}:c0={plan.color}:c1={plan.color2}:x0=0:y0=0:x1=0:y1={H}:"
                f"speed=0:r={_num(fps)}:d={d}[bg{i}]"
            )
        else:
            graph.append(f"color=c={plan.color}:s={W}x{H}:r={_num(fps)}:d={d}[bg{i}]")

    if post:
        graph.append(f"[{fg_in}]{','.join(post)}[cf{i}]")
        fg_in = f"cf{i}"
    graph.append(
        f"[bg{i}][{fg_in}]overlay=x='{_num(clip.x * W)}-overlay_w/2':y='{_num(clip.y * H)}-overlay_h/2':"
        f"format=auto:eof_action=repeat,format=yuv420p,setsar=1,"
        f"tpad=stop_mode=clone:stop_duration={d},trim=duration={d},setpts=PTS-STARTPTS,settb=AVTB,fps={_num(fps)}[v{i}]"
    )
    return graph


def _clip_audio_chain(plan: ExportPlan, clip: PlanClip, i: int, idx: int) -> str:
    d = _num(clip.duration)
    src = f"[{idx}:a:0]" if clip.source_has_audio else f"anullsrc=r={AUDIO_RATE}:cl=stereo,"
    tempo = _atempo(clip.speed) if clip.source_has_audio else "anull"
    return (
        f"{src}aresample={AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,{tempo},"
        f"volume={_num(clip.volume)},apad,atrim=duration={d},asetpts=PTS-STARTPTS[a{i}]"
    )


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
    raise ValueError(f"unknown effect {e.type}")


def _overlay_filters(o: PlanOverlay, input_idx: int, n: int, plan: ExportPlan, base_label: str) -> tuple[str, str]:
    """Filter chain for one overlay input plus the overlay onto
    `base_label`; returns (chain, output label). Same geometry and
    animation curves as stickerFrame() in src/lib/editor/timeline.ts."""
    W, H = plan.width, plan.height
    target_w = max(2, round(o.width * W))
    target_h = max(2, round(target_w * o.image_height / o.image_width))
    anim = min(ANIM_SECONDS, (o.end - o.start) / 2)
    s, a = _num(o.start), _num(anim)
    pin = f"min(1,max(0,(t-{s})/{a}))"
    pout = f"min(1,max(0,(t-{_num(o.end - anim)})/{a}))"
    rad = f"{_num(o.rotation)}*PI/180"

    parts = [f"format=rgba,scale={target_w}:{target_h}:flags=lanczos"]
    if o.opacity < 0.999:
        parts.append(f"colorchannelmixer=aa={_num(max(0.0, o.opacity))}")
    if abs(o.rotation) > 0.01:
        parts.append(f"rotate=a={rad}:c=none:ow=rotw({rad}):oh=roth({rad})")
    if o.anim_in in ("fade", "zoomin") or o.anim_in.startswith("slide"):
        parts.append(f"fade=t=in:st={s}:d={a}:alpha=1")
    if o.anim_out in ("fade", "zoomout") or o.anim_out.startswith("slide"):
        parts.append(f"fade=t=out:st={_num(o.end - anim)}:d={a}:alpha=1")
    factors = []
    if o.anim_in == "pop":
        factors.append(f"max(0.02,{pin})")
    if o.anim_in == "zoomin":
        factors.append(f"(0.6+0.4*{pin})")
    if o.anim_out == "zoomout":
        factors.append(f"(1-0.4*{pout})")
    if factors:
        f = "*".join(factors)
        parts.append(f"scale=w='max(2,iw*{f})':h='max(2,ih*{f})':eval=frame")

    dx = _num(SLIDE_DISTANCE * W)
    dy = _num(SLIDE_DISTANCE * H)
    x_expr = _num(o.x * W)
    y_expr = _num(o.y * H)
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
    chain = (
        f"[{input_idx}:v]{','.join(parts)}[{in_label}];"
        f"[{base_label}][{in_label}]overlay=x='{x_expr}-overlay_w/2':y='{y_expr}-overlay_h/2':"
        f"enable='between(t,{s},{_num(o.end)})':eval=frame:eof_action=pass:format=auto[{out_label}]"
    )
    return chain, out_label


def build_export_args(plan: ExportPlan, output_path: str, tmp: str) -> list[str]:
    """Builds the ffmpeg argument list and writes the filter graph (plus
    any LUT files) into `tmp` - the graph goes in a script file because a
    long timeline's graph can exceed Windows' command-line length limit.
    """
    quantize_plan(plan)
    fps = plan.fps
    total = timeline_duration(plan)
    inputs = _Inputs()
    graph: list[str] = []

    clip_idx = [
        inputs.add("-ss", _num(c.start), "-t", _num(c.duration * c.speed), "-i", c.source_path) for c in plan.clips
    ]
    for i, clip in enumerate(plan.clips):
        graph += _clip_video_chain(plan, clip, i, clip_idx[i], inputs, tmp)
        if plan.with_audio:
            graph.append(_clip_audio_chain(plan, clip, i, clip_idx[i]))

    v_acc, a_acc = "v0", "a0"
    length = plan.clips[0].duration
    for i in range(1, len(plan.clips)):
        prev, cur = plan.clips[i - 1], plan.clips[i]
        v_out, a_out = f"vj{i}", f"aj{i}"
        if prev.transition:
            xfade, audio_style = TRANSITIONS[prev.transition]
            td = prev.transition_duration
            graph.append(
                f"[{v_acc}][v{i}]xfade=transition={xfade}:duration={_num(td)}:offset={_num(length - td)}[{v_out}]"
            )
            if plan.with_audio:
                if audio_style == "dip":
                    half = _num(td / 2)
                    graph.append(f"[{a_acc}]afade=t=out:st={_num(length - td)}:d={half}[ao{i}]")
                    graph.append(f"[a{i}]afade=t=in:st={half}:d={half}[ai{i}]")
                    graph.append(f"[ao{i}][ai{i}]acrossfade=d={_num(td)}:c1=nofade:c2=nofade[{a_out}]")
                else:
                    graph.append(f"[{a_acc}][a{i}]acrossfade=d={_num(td)}:c1=tri:c2=tri[{a_out}]")
            length += cur.duration - td
        else:
            graph.append(f"[{v_acc}][v{i}]concat=n=2:v=1:a=0,fps={_num(fps)}[{v_out}]")
            if plan.with_audio:
                graph.append(f"[{a_acc}][a{i}]concat=n=2:v=0:a=1[{a_out}]")
            length += cur.duration
        v_acc, a_acc = v_out, a_out

    if plan.effects:
        fx = ",".join(_effect_filters(e, plan.width, plan.height) for e in plan.effects)
        graph.append(f"[{v_acc}]{fx}[vfx]")
        v_acc = "vfx"

    for n, o in enumerate(plan.overlays):
        # Looped still from t=0 so its timestamps line up with the output
        # timeline; eof_action=pass leaves the video untouched afterwards.
        idx = inputs.add("-loop", "1", "-framerate", _num(fps), "-t", _num(o.end + 0.1), "-i", o.image_path)
        chain, v_acc = _overlay_filters(o, idx, n, plan, v_acc)
        graph.append(chain)
    graph.append(f"[{v_acc}]format=yuv420p[outv]")

    if plan.with_audio and plan.audio:
        mix_inputs = [f"[{a_acc}]"]
        for n, au in enumerate(plan.audio):
            idx = inputs.add("-ss", _num(au.offset), "-t", _num(au.duration), "-i", au.path)
            delay = int(round(au.start * 1000))
            chain = (
                f"[{idx}:a:0]aresample={AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,"
                f"atrim=duration={_num(au.duration)},asetpts=PTS-STARTPTS,volume={_num(au.volume)}"
            )
            if au.fade_in > 0:
                chain += f",afade=t=in:st=0:d={_num(au.fade_in)}"
            if au.fade_out > 0:
                chain += f",afade=t=out:st={_num(max(0.0, au.duration - au.fade_out))}:d={_num(au.fade_out)}"
            chain += f",adelay=delays={delay}:all=1[ax{n}]"
            graph.append(chain)
            mix_inputs.append(f"[ax{n}]")
        # duration=first: the clips' own (always full-length) track sets the
        # length; normalize=0 keeps every track at its chosen volume and the
        # limiter catches the peaks that summing can create.
        graph.append(
            f"{''.join(mix_inputs)}amix=inputs={len(mix_inputs)}:duration=first:normalize=0,"
            f"alimiter=limit=0.89:level=disabled[amix]"
        )
        a_acc = "amix"

    script = os.path.join(tmp, "graph.txt")
    with open(script, "w", encoding="utf-8") as f:
        f.write(";\n".join(graph))

    args = ["-y", "-hide_banner", *inputs.args, "-filter_complex_script", script, "-map", "[outv]"]
    if plan.with_audio:
        args += ["-map", f"[{a_acc}]", "-c:a", "aac", "-b:a", "192k"]
    args += [
        "-c:v",
        "libx264",
        "-preset",
        VIDEO_ENCODE_PRESET,
        "-crf",
        str(VIDEO_ENCODE_CRF),
        "-pix_fmt",
        "yuv420p",
        "-r",
        _num(fps),
        "-t",
        _num(total),
        "-movflags",
        "+faststart",
        output_path,
    ]
    return args


async def render_export(plan: ExportPlan, output_path: str) -> None:
    tmp = tempfile.mkdtemp(prefix="wipeclip-export-")
    try:
        await _run_ffmpeg(build_export_args(plan, output_path, tmp))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
