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

import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING

import numpy as np

from app.config import VIDEO_ENCODE_CRF, VIDEO_ENCODE_PRESET
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
    cursor_rows: list[tuple[float, float, float]]  # (t, x, y); x < 0 hides
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
    pointer: PlanPointer | None = None
    masks: list[PlanMask] = field(default_factory=list)


def plan_to_json(plan: ExportPlan) -> str:
    """The whole plan as JSON for the export job (it crosses the RQ
    boundary as a plain string). Every field goes through, so a field added
    to ExportPlan can't be silently dropped between the API and the worker
    - see plan_from_json and tests/test_focus_export.py."""
    return json.dumps(asdict(plan))


def plan_from_json(text: str) -> ExportPlan:
    raw = json.loads(text)
    pointer = raw.get("pointer")
    return ExportPlan(
        **{k: v for k, v in raw.items() if k not in ("clips", "overlays", "audio", "effects", "pointer", "masks")},
        clips=[PlanClip(**{**c, "camera": [tuple(r) for r in c.get("camera", [])]}) for c in raw["clips"]],
        overlays=[PlanOverlay(**o) for o in raw.get("overlays", [])],
        audio=[PlanAudio(**a) for a in raw.get("audio", [])],
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
        times = [r[0] for r in p.cursor_rows]
        xs = [OFFSCREEN if x < 0 else _round(x * W - p.hot_x * cw) for _, x, _ in p.cursor_rows]
        ys = [OFFSCREEN if x < 0 else _round(y * H - p.hot_y * ch) for _, x, y in p.cursor_rows]
        graph.append(
            f"[{idx}:v]format=rgba,scale={cw}:{ch}:flags=lanczos[pcs];"
            f"[{acc}][pcs]overlay=x='{step_expr(times, xs, 't', fps)}':y='{step_expr(times, ys, 't', fps)}':"
            f"eval=frame:eof_action=pass:format=auto[pcd]"
        )
        acc = "pcd"
    return graph, acc


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

    pre: list[str] = []
    if clip.freeze:
        # The first decoded frame, repeated for the whole hold with fresh
        # frame-rate timestamps (a lone frame would otherwise produce no
        # output from the fps filter below).
        frames = int(math.ceil(clip.duration * fps)) + 1
        pre.append(f"trim=end_frame=1,loop=loop={frames}:size=1,setpts=N/({_num(fps)}*TB)")
    cropped = clip.crop_x > 0 or clip.crop_y > 0 or clip.crop_w < 1 or clip.crop_h < 1
    if cropped:
        pre.append(
            f"crop=w='trunc(iw*{_num(clip.crop_w)}/2)*2':h='trunc(ih*{_num(clip.crop_h)}/2)*2':"
            f"x='iw*{_num(clip.crop_x)}':y='ih*{_num(clip.crop_y)}'"
        )
    if not clip.freeze:
        pre.append(f"setpts=(PTS-STARTPTS)/{_num(clip.speed)}")
    if not look_pipeline.is_neutral_color(clip.filter, clip.intensity, clip.adjust):
        cube = os.path.join(tmp, f"look{i}.cube")
        look_pipeline.write_cube(cube, look_pipeline.grade_stages(clip.filter, clip.intensity, clip.adjust))
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
    box_w, box_h = _even(box_w * clip.scale * inset), _even(box_h * clip.scale * inset)
    pre.append(f"scale={box_w}:{box_h}:flags=lanczos,setsar=1")
    if clip.adjust["blur"] > 0:
        pre.append(f"gblur=sigma={_num(clip.adjust['blur'] / 100 * 0.02 * H)}")
    pre.append(f"fps={_num(fps)}")
    if clip.reverse:
        # After scaling, so the buffered frames are at most canvas-sized.
        pre.append("reverse")

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
    head = f"[{idx}:v:0]{chain}"
    if clip.camera:
        # Zoomed after fitting, so the zoom works on canvas-sized frames and
        # the blurred background (split below) follows it, like the preview.
        graph.append(f"[{idx}:v:0]{chain}[cp{i}]")
        graph += _camera_chain(clip, i, f"cp{i}", box_w, box_h, fps)
        head = f"[zc{i}]null"
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
    radius = max(0.0, min(0.1, plan.frame_radius)) * min(W, H)
    if radius > 0.5:
        mask_idx = inputs.add("-loop", "1", "-framerate", _num(fps), "-t", d, "-i", _frame_mask(tmp, i, box_w, box_h, radius))
        graph.append(f"[{mask_idx}:v]format=gray,setsar=1[fm{i}]")
        graph.append(f"[{fg_in}]format=rgba[fr{i}]")
        graph.append(f"[fr{i}][fm{i}]alphamerge[fa{i}]")
        fg_in = f"fa{i}"
        if not post:
            post.append("format=rgba")
    shadow_path = _frame_shadow_image(tmp, i, box_w, box_h, radius, H, plan.frame_shadow)
    if shadow_path:
        sh_idx = inputs.add("-loop", "1", "-framerate", _num(fps), "-t", d, "-i", shadow_path)
        sh_post = ["format=rgba"] + [f for f in post if f.startswith(("rotate", "colorchannelmixer"))]
        graph.append(f"[{sh_idx}:v]{','.join(sh_post)},setsar=1[fs{i}]")
        graph.append(
            f"[bg{i}][fs{i}]overlay=x='{_num(clip.x * W)}-overlay_w/2':y='{_num(clip.y * H)}-overlay_h/2':format=auto[bs{i}]"
        )
        bg_label = f"bs{i}"
    else:
        bg_label = f"bg{i}"

    if post:
        graph.append(f"[{fg_in}]{','.join(post)}[cf{i}]")
        fg_in = f"cf{i}"
    graph.append(
        f"[{bg_label}][{fg_in}]overlay=x='{_num(clip.x * W)}-overlay_w/2':y='{_num(clip.y * H)}-overlay_h/2':"
        f"format=auto:eof_action=repeat,format=yuv420p,setsar=1,"
        f"tpad=stop_mode=clone:stop_duration={d},trim=duration={d},setpts=PTS-STARTPTS,settb=AVTB,fps={_num(fps)}[v{i}]"
    )
    return graph


def _clip_audio_chain(plan: ExportPlan, clip: PlanClip, i: int, idx: int) -> str:
    d = _num(clip.duration)
    src = f"[{idx}:a:0]" if clip.source_has_audio else f"anullsrc=r={AUDIO_RATE}:cl=stereo,"
    tempo = _atempo(clip.speed) if clip.source_has_audio else "anull"
    rev = "areverse," if clip.reverse and clip.source_has_audio else ""
    return (
        f"{src}aresample={AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,{rev}{tempo},"
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
    if o.video:
        # Shift the trimmed input to start at the layer's timeline position,
        # at the output frame rate, so the time-based fades/animations and
        # `enable` below see timeline time.
        parts.insert(0, f"setpts=PTS-STARTPTS+{s}/TB,fps={_num(plan.fps)}")
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
        f"[{input_idx}:v:0]{','.join(parts)}[{in_label}];"
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

    # A freeze only needs a moment of its source around the held frame.
    clip_idx = [
        inputs.add("-ss", _num(c.start), "-t", _num(0.5 if c.freeze else c.duration * c.speed), "-i", c.source_path)
        for c in plan.clips
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
        if o.video:
            # Just the layer's range of its video; shifted into place in
            # _overlay_filters, and gone after its end (eof_action=pass).
            idx = inputs.add("-ss", _num(o.offset), "-t", _num(o.end - o.start), "-i", o.image_path)
        else:
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
        args += ["-map", f"[{a_acc}]", "-c:a", "aac", "-b:a", plan.audio_bitrate]
    args += [
        "-c:v",
        "libx264",
        "-preset",
        VIDEO_ENCODE_PRESET,
        "-crf",
        str(plan.crf),
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


async def render_export(plan: ExportPlan, output_path: str, job: "JobProgress | None" = None) -> None:
    """Renders the plan. With a `job` (app/progress.py) it reports seconds
    rendered out of the timeline's length and stops on cancel."""
    tmp = tempfile.mkdtemp(prefix="wipeclip-export-")
    try:
        if job is None:
            await _run_ffmpeg(build_export_args(plan, output_path, tmp))
            return
        job.check()
        job.total = timeline_duration(plan)
        job.phase = "rendering"

        def report(seconds: float) -> None:
            job.done = seconds

        await _run_ffmpeg(build_export_args(plan, output_path, tmp), progress=report, cancel=job.cancel)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
