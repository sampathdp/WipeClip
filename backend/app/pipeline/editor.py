"""Timeline export for the browser editor (/editor on the frontend).

The editor is non-destructive: the browser never modifies the uploaded
video, it only keeps a project description - an ordered list of clips
(source-time ranges), the transition after each clip, and timed sticker
overlays. This module turns that description into a single ffmpeg run that
renders the final video, so every edit visible in the editor is an actual
operation in the exported file:

  - each clip is its own input, opened with input-level `-ss`/`-t` (fast
    keyframe seek + frame-accurate decode, since we always re-encode), so a
    deleted middle section is simply never read - no gap, no black or
    frozen frames, no audio hole;
  - every clip is normalized to one canvas (size, SAR, fps, pixel format,
    audio format) so clips from different sources - e.g. an AI-cleaned
    segment that came back at 720p - join cleanly;
  - clips are joined pairwise, either with `concat` (a cut) or `xfade` +
    `acrossfade` (a transition), which overlaps the two clips by the
    transition duration exactly like the editor's own timeline math;
  - stickers are PNGs rasterized by the browser (the same image the preview
    shows) overlaid with their position, size, rotation, time range and
    in/out animation.

Clip and transition durations are quantized to whole frames before
building the graph so video and audio lengths agree exactly per clip -
otherwise per-clip rounding drift accumulates across many cuts and audio
slides out of sync.

Everything in `ExportPlan` is server-validated (see build_plan in
app/main.py); nothing here ever takes a path or filter fragment from the
client.
"""

from __future__ import annotations

import math
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass, field

from app.config import VIDEO_ENCODE_CRF, VIDEO_ENCODE_PRESET
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

STICKER_ANIMS_IN = ("none", "fade", "pop", "slide")
STICKER_ANIMS_OUT = ("none", "fade", "slide")
# Must match STICKER_ANIM_SECONDS / STICKER_SLIDE_DISTANCE in the frontend
# (src/lib/editor/timeline.ts) so the preview and the export animate alike.
STICKER_ANIM_SECONDS = 0.35
STICKER_SLIDE_DISTANCE = 0.15  # fraction of canvas width

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
    proc = subprocess.run(
        [get_ffmpeg_path(), "-hide_banner", "-i", path], capture_output=True, text=True, errors="replace"
    )
    text = proc.stderr

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

    duration = 0.0
    d = _DURATION_RE.search(text)
    if d:
        duration = int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3))

    has_audio = re.search(r"Stream #\d+:\d+[^:]*: Audio:", text) is not None
    return MediaInfo(width=width, height=height, fps=fps, duration=duration, has_audio=has_audio)


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
    start: float
    duration: float
    transition: str | None = None  # key of TRANSITIONS, into the next clip
    transition_duration: float = 0.0


@dataclass
class PlanSticker:
    image_path: str
    image_width: int
    image_height: int
    start: float
    end: float
    x: float  # center, fraction of canvas width
    y: float  # center, fraction of canvas height
    width: float  # fraction of canvas width
    rotation: float  # degrees, clockwise
    anim_in: str = "none"
    anim_out: str = "none"


@dataclass
class ExportPlan:
    width: int
    height: int
    fps: float
    with_audio: bool
    clips: list[PlanClip]
    stickers: list[PlanSticker] = field(default_factory=list)


def quantize_plan(plan: ExportPlan) -> None:
    """Snaps clip and transition durations to whole frames (in place), and
    clamps each transition so it never exceeds half of either neighboring
    clip - xfade can't overlap more than a clip's own length, and sharing
    a clip between two transitions needs room for both.
    """
    frame = 1.0 / plan.fps
    for clip in plan.clips:
        clip.duration = max(1, round(clip.duration * plan.fps)) * frame
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


def _sticker_filters(s: PlanSticker, idx: int, plan: ExportPlan, base_label: str) -> tuple[str, str]:
    """Filter chain for one sticker input plus the overlay onto
    `base_label`; returns (chain, output label). Same geometry the preview
    uses: size is a fraction of canvas width (height from the image's own
    aspect), rotation is about the sticker's center, position is its center.
    """
    target_w = max(2, round(s.width * plan.width))
    target_h = max(2, round(target_w * s.image_height / s.image_width))
    anim = min(STICKER_ANIM_SECONDS, (s.end - s.start) / 2)
    rad = f"{_num(s.rotation)}*PI/180"

    parts = [f"format=rgba,scale={target_w}:{target_h}:flags=lanczos"]
    if abs(s.rotation) > 0.01:
        parts.append(f"rotate=a={rad}:c=none:ow=rotw({rad}):oh=roth({rad})")
    if s.anim_in in ("fade", "slide"):
        parts.append(f"fade=t=in:st={_num(s.start)}:d={_num(anim)}:alpha=1")
    if s.anim_out in ("fade", "slide"):
        parts.append(f"fade=t=out:st={_num(s.end - anim)}:d={_num(anim)}:alpha=1")
    if s.anim_in == "pop":
        # Grows from nothing to full size; clamped away from zero because
        # scale can't produce a 0px frame.
        grow = f"max(0.02,min(1,(t-{_num(s.start)})/{_num(anim)}))"
        parts.append(f"scale=w='max(2,iw*{grow})':h='max(2,ih*{grow})':eval=frame")

    # Slide in: enters from the left of its resting spot; slide out: leaves
    # to the right - both over `anim` seconds, alongside the alpha fade above.
    slide = _num(STICKER_SLIDE_DISTANCE * plan.width)
    x_expr = _num(s.x * plan.width)
    if s.anim_in == "slide":
        x_expr += f"-{slide}*(1-min(1,max(0,(t-{_num(s.start)})/{_num(anim)})))"
    if s.anim_out == "slide":
        x_expr += f"+{slide}*min(1,max(0,(t-{_num(s.end - anim)})/{_num(anim)}))"
    x_expr += "-overlay_w/2"
    y_expr = f"{_num(s.y * plan.height)}-overlay_h/2"

    in_label = f"st{idx}"
    out_label = f"so{idx}"
    chain = (
        f"[{len(plan.clips) + idx}:v]{','.join(parts)}[{in_label}];"
        f"[{base_label}][{in_label}]overlay=x='{x_expr}':y='{y_expr}':"
        f"enable='between(t,{_num(s.start)},{_num(s.end)})':eval=frame:eof_action=pass:format=auto[{out_label}]"
    )
    return chain, out_label


def build_export_args(plan: ExportPlan, output_path: str, filter_script_path: str) -> list[str]:
    """Builds the ffmpeg argument list (inputs + mapping + encode) and
    writes the filter graph to `filter_script_path` - passed as a script
    file rather than inline because a long timeline's graph can exceed
    Windows' command-line length limit. Expects quantize_plan() to have run.
    """
    w, h, fps = plan.width, plan.height, plan.fps
    total = timeline_duration(plan)
    args: list[str] = ["-y", "-hide_banner"]

    for clip in plan.clips:
        args += ["-ss", _num(clip.start), "-t", _num(clip.duration), "-i", clip.source_path]
    for s in plan.stickers:
        # Looped still starting at t=0 so its timestamps line up with the
        # output timeline; ends with the sticker (eof_action=pass then
        # leaves the video untouched afterwards).
        args += ["-loop", "1", "-framerate", _num(fps), "-t", _num(s.end + 0.1), "-i", s.image_path]

    graph: list[str] = []
    for i, clip in enumerate(plan.clips):
        d = _num(clip.duration)
        graph.append(
            f"[{i}:v:0]scale={w}:{h}:force_original_aspect_ratio=decrease:flags=lanczos,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps={_num(fps)},format=yuv420p,"
            f"tpad=stop_mode=clone:stop_duration={d},trim=duration={d},setpts=PTS-STARTPTS,settb=AVTB,fps={_num(fps)}[v{i}]"
        )
        if plan.with_audio:
            audio_src = (
                f"[{i}:a:0]"
                if clip.source_has_audio
                else f"anullsrc=r={AUDIO_RATE}:cl=stereo,"
            )
            graph.append(
                f"{audio_src}aresample={AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,"
                f"apad,atrim=duration={d},asetpts=PTS-STARTPTS[a{i}]"
            )

    v_acc, a_acc = "v0", "a0"
    length = plan.clips[0].duration
    for i in range(1, len(plan.clips)):
        prev = plan.clips[i - 1]
        cur = plan.clips[i]
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

    for idx, sticker in enumerate(plan.stickers):
        chain, v_acc = _sticker_filters(sticker, idx, plan, v_acc)
        graph.append(chain)

    graph.append(f"[{v_acc}]format=yuv420p[outv]")

    with open(filter_script_path, "w", encoding="utf-8") as f:
        f.write(";\n".join(graph))

    args += ["-filter_complex_script", filter_script_path, "-map", "[outv]"]
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
    quantize_plan(plan)
    fd, script_path = tempfile.mkstemp(suffix=".txt")
    os.close(fd)
    try:
        await _run_ffmpeg(build_export_args(plan, output_path, script_path))
    finally:
        os.remove(script_path)
