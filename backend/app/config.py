"""Central tunable constants for the sprite-cleaning pipeline.

Mirrors the CLI tool's CONFIGURABLE PARAMETERS block - see the top-level
README for context on what each stage does. Values here are defaults; most
are also exposed as per-request overrides in the API schemas.
"""

import os
from pathlib import Path

# --- Desktop app engine (backend/desktop_engine.py) --------------------------
# The desktop app runs this same backend on the user's own machine. LOCAL_MODE
# is set only there: every request must then carry LOCAL_TOKEN (a random value
# the app makes per launch), upload tickets are skipped, and job tickets the
# site marked `local` are accepted - the cloud backend refuses those.
LOCAL_MODE: bool = os.environ.get("WIPECLIP_LOCAL") == "1"
LOCAL_TOKEN: str = os.environ.get("WIPECLIP_LOCAL_TOKEN", "")

# --- Alpha classification thresholds (0-255) --------------------------------
OPAQUE_ALPHA_THRESHOLD: int = 250
TRANSPARENT_ALPHA_THRESHOLD: int = 4

# --- Chroma-key background removal (fallback / fast path) -------------------
DEFAULT_BG_TOLERANCE: float = 30.0
BG_BORDER_SAMPLE_FRACTION: float = 0.02
BG_EDGE_FEATHER_PX: float = 2.0
AUTO_BG_OPAQUE_FRACTION: float = 0.999

# --- Halo detection / decontamination ---------------------------------------
DEFAULT_STRENGTH: float = 1.0
BASE_CONTAMINATION_THRESHOLD: float = 22.0
PROPAGATION_KERNEL_SIZES: tuple[int, ...] = (3, 5, 9, 15, 25)
MAX_INPAINT_RADIUS: int = 6
MAX_EDGE_BAND_PX: int = 8

# --- Alpha cleanup ------------------------------------------------------------
DEFAULT_ALPHA_ERODE: float = 0.5
MIN_NOISE_ISLAND_AREA: int = 3

# --- Edge smoothing -----------------------------------------------------------
ALPHA_SMOOTH_SIGMA: float = 0.6

# --- Selective sharpening -----------------------------------------------------
DEFAULT_SHARPEN_RADIUS: float = 0.8
DEFAULT_SHARPEN_AMOUNT: float = 0.8
SHARPEN_THRESHOLD: int = 2

# --- Standalone image-sharpen endpoint (api_image_sharpen in main.py) -------
# Client picks a strength preset (light/standard/strong) mapped to one of
# these server-side - the amount is never taken as a raw client-supplied
# float, so a malicious value can't push selective_unsharp_mask into
# visibly blown-out output.
SHARPEN_AMOUNT_PRESETS: dict[str, float] = {"light": 0.4, "standard": DEFAULT_SHARPEN_AMOUNT, "strong": 1.4}

# --- Manual spot-removal (paint-to-remove) inpainting ------------------------
DEFAULT_INPAINT_RADIUS: int = 8
MAX_INPAINT_MASK_RADIUS: int = 40  # hard cap so a runaway brush stroke can't
                                    # blow out inpaint quality/latency

# --- ML background removal ----------------------------------------------------
REMBG_MODEL_NAME: str = "isnet-general-use"  # good general-purpose quality/speed balance

# --- Free preview cap for the free image tools (auto-enhance, sharpen) ---
# The daily free result is downscaled to this before processing; the
# Next.js routes set the `preview` form flag (see src/lib/imageTool.ts) and
# full resolution costs a credit. Downscaling BEFORE the pipeline runs, not
# after, is also just cheaper: rembg's segmentation cost scales with pixel
# count.
IMAGE_PREVIEW_MAX_MEGAPIXELS: float = 0.25

# --- Artifact candidate detection (suggest-only, never auto-applies) ---
# Tuned deliberately conservative: it is far better to miss a real artifact
# (the user falls back to manual painting) than to flag legitimate artwork
# and risk it being accepted and damaged. Every candidate is a *suggestion*
# the frontend must render for user review - nothing is removed until the
# user explicitly approves it (see app/pipeline/detect_artifacts.py).
DETECT_VALUE_DELTA_THRESHOLD: float = 20.0   # min brightness rise over baseline
DETECT_SATURATION_DELTA_THRESHOLD: float = 18.0  # min saturation drop vs baseline
DETECT_EDGE_MARGIN_PX: int = 6               # keep candidates this far from any
                                              # strong structural edge, so ordinary
                                              # hard color transitions never qualify
DETECT_MIN_BLOB_AREA: int = 120              # px^2
DETECT_MAX_BLOB_AREA_FRACTION_OF_KERNEL: float = 5.0  # ignore anomalies bigger
                                              # than this multiple of the
                                              # top-hat kernel's own area (kept
                                              # relative to the kernel, not
                                              # total image/opaque area, so it
                                              # scales correctly on sprite
                                              # sheets with many small sprites).
                                              # There's a wide safety margin
                                              # here: real artifacts measured
                                              # ~3x kernel area, false-positive
                                              # whole-sprite blobs measured
                                              # ~75x kernel area - lots of room
                                              # between the two.
DETECT_MIN_SOLIDITY: float = 0.25            # area / bounding-box area - filters
                                              # out thin edge slivers, keeps blobs
DETECT_MAX_CANDIDATES: int = 20              # cap returned suggestions
DETECT_BOX_PADDING_PX: int = 6               # padding added around each blob's
                                              # bounding box in the returned region

# --- Output ---------------------------------------------------------------
PNG_COMPRESSION_LEVEL: int = 6
MAX_UPLOAD_DIMENSION: int = 6000  # px, safety cap on longest side

# --- Resource limits (per process) ---------------------------------------------
# Every job peaks at roughly 1-3 GB of RAM and will happily use every core,
# so how many run at once is what actually sizes the server. Inline mode (no
# REDIS_URL) queues requests past MAX_CONCURRENT_JOBS instead of running
# them side by side; with RQ, concurrency is the number of worker processes.
MAX_CONCURRENT_JOBS: int = max(1, int(os.environ.get("MAX_CONCURRENT_JOBS", "1")))
# Threads one job may use: ffmpeg (decode, filters, x264 - fewer threads
# also means fewer frames in flight, so less RAM), OpenCV and the
# ONNX models (rembg). Defaults to an even share of the cores, so
# concurrent jobs don't oversubscribe the CPU.
JOB_THREADS: int = max(
    1, int(os.environ.get("JOB_THREADS", str(max(1, (os.cpu_count() or 1) // MAX_CONCURRENT_JOBS))))
)
# onnxruntime (via rembg) reads this when a session is created.
os.environ.setdefault("OMP_NUM_THREADS", str(JOB_THREADS))

# --- Video region cleanup (ffmpeg-based) ---- -----------------------------------
# Synchronous request/response (no job queue) - these caps keep a single
# ffmpeg encode within a request/response cycle a browser will actually wait
# out, rather than silently hanging on a multi-hundred-MB or hour-long upload.
MAX_VIDEO_UPLOAD_BYTES: int = 300 * 1024 * 1024  # 300 MB
MAX_VIDEO_DURATION_SECONDS: float = 600.0  # 10 minutes
VIDEO_ENCODE_PRESET: str = "veryfast"  # libx264 preset - speed/size tradeoff
VIDEO_ENCODE_CRF: int = 20  # lower = higher quality/bigger file; 20 is visually near-lossless
MIN_REGION_PX: int = 4  # smallest allowed region edge length

# --- Region reconstruction (reconstruct_region) ------------------------------------
# reconstruct_region() went through two reconstructions before this one:
#   1. ffmpeg's boundary-interpolation filter - fast, but a crude smooth boundary
#      interpolation with no texture awareness. Visibly *smeared* any
#      strong nearby color (e.g. text) clear across the box instead of
#      containing it.
#   2. OpenCV's Telea inpainting (per-frame, PDE-based edge propagation) -
#      contained bleeding far better than that, but Telea/NS-family
#      methods still only propagate smooth gradients inward. They don't
#      copy real texture/pattern from elsewhere in the frame, so any
#      region with actual color texture (not a flat/near-flat surface)
#      still came out visibly softer than its surroundings - measured
#      directly: near-perfect on a flat white background, still an
#      obvious blur on a colorful gradient background.
#
# This now uses OpenCV-contrib's xphoto FSR ("Frequency Selective
# Reconstruction") inpainting instead - an exemplar/frequency-based method
# that actually searches for well-matching content rather than diffusing
# a gradient, which is the "find the nearest better pixels" approach.
# Confirmed dramatically better on the same colorful-gradient case that
# left Telea soft. Cost: FSR is much slower per frame than Telea, so this
# only runs it on a small padded crop around the region (all the context
# it actually needs) rather than the full frame. Downscaling the crop's
# working resolution for extra speed was tried and reverted: it measurably
# reintroduced a bleed/smear artifact next to sharp nearby content (e.g.
# text right at the region edge) that full resolution doesn't have -
# exactly the case this change exists to fix, so trading it away for speed
# defeats the point.
#
# FSR cost climbs steeply with region area, though, and its exemplar
# search has little real content to draw on once the hole is large, so a
# big marked box is both very slow AND not visibly sharper than plain
# diffusion. _inpaint_region() therefore routes any box past
# REGION_INPAINT_FSR_MAX_REGION_PX to Telea (cv2.inpaint) instead -
# seconds, not minutes, for the whole clip. Small boxes (the
# overwhelmingly common case) still get FSR at full resolution, unchanged.
# At REGION_FSR_SCALE = 1.0 the FSR path runs ~6.5x realtime end-to-end
# for a normal box; a clip near MAX_VIDEO_DURATION_SECONDS is still tens of
# minutes on the FSR path in a synchronous request with no job queue -
# reconsider MAX_VIDEO_DURATION_SECONDS or a background job queue first.
#
# None of this - not boundary interpolation, not Telea, not FSR - can *recover* content
# that's 100% covered by the object in every single frame; that
# information is simply gone from the source. FSR just produces a much
# more plausible fill than diffusion-based inpainting did, not the real
# original pixels. Actual recovery is only possible when the covered
# content shifts relative to the fixed object at some point in the
# clip (camera pan, scrolling caption, etc.) - that needs motion-aware
# multi-frame reconstruction (optical-flow-guided video inpainting), which
# is a materially bigger feature than this.
REGION_FSR_CONTEXT_PAD_PX: int = 100  # how much surrounding context
                                          # (beyond the region itself) FSR
                                          # gets to work with
REGION_FSR_SCALE: float = 1.0         # working resolution for the FSR
                                          # pass, relative to the padded
                                          # crop - the speed/quality lever
                                          # (below 1.0 is faster but brings
                                          # back a bleed/smear artifact
                                          # next to sharp nearby content -
                                          # see the block comment above)
REGION_INPAINT_FSR_MAX_REGION_PX: int = 130_000  # ~360x360. A marked
                                          # box with more pixels than this
                                          # is reconstructed with Telea
                                          # (cv2.inpaint) instead of FSR:
                                          # FSR on a hole that large is both
                                          # very slow (minutes per clip) and
                                          # no sharper in practice - too
                                          # little real content around it to
                                          # exemplar from. Small
                                          # boxes stay on the FSR path.

# The reconstructed patch is then re-sharpened in the final ffmpeg pass -
# still somewhat soft after any inpainting method - to restore local
# contrast on top of it. Cosmetic only, same caveat as above.
REGION_PATCH_SHARPEN_KSIZE: int = 7      # unsharp luma_msize_x/y (odd, 3-23)
REGION_PATCH_SHARPEN_AMOUNT: float = 2.5  # unsharp luma_amount

# --- Optical-flow-assisted reconstruction (Pro-tier quality="pro") ----------
# CPU-only motion-aware fill: the REGION_FSR_* block above ends by
# naming the real fix for FSR's fundamental limit (it can only plausibly
# fill a fully-covered region, never recover it) as "motion-aware
# multi-frame reconstruction (optical-flow-guided video inpainting)". This
# is that upgrade, gated behind quality="pro" (see reconstruct_region()) - free/
# starter traffic keeps the plain FSR path unchanged.
#
# For each covered frame, dense optical flow (Farneback, CPU) checks a
# window of nearby frames for camera pan/scroll that carried the region's
# real underlying content to a screen position outside the marked region at
# some point nearby in time - if so, those are the actual original pixels,
# not a plausible fill. Any pixel no neighbor frame ever uncovers (a
# genuinely static/tripod shot, or motion too large for the padded search
# window below) falls back to _fsr_inpaint_region exactly as quality=
# "standard" already does.
REGION_FLOW_SEARCH_RADIUS_FRAMES: int = 6  # neighbor frames searched each
                                          # direction - also bounds the
                                          # sliding buffer's memory (at most
                                          # 2*radius+1 full frames held at
                                          # once, see
                                          # _inpaint_region_to_temp_video_flow)
REGION_FLOW_CONTEXT_PAD_PX: int = 220  # padding beyond the region flow
                                          # is allowed to search within -
                                          # larger than REGION_FSR_
                                          # CONTEXT_PAD_PX since this needs
                                          # room for real motion to have
                                          # carried content out from under
                                          # the region, not just enough
                                          # context to blend a seam
REGION_FLOW_ESTIMATION_SCALE: float = 0.5  # the flow FIELD is estimated
                                          # on a downscaled crop (cheap -
                                          # flow is smooth/low-frequency,
                                          # same principle as
                                          # REGION_FSR_SCALE); recovered
                                          # pixels are always sampled from
                                          # the full-resolution buffered
                                          # frame, never downscaled
REGION_FLOW_PROBE_SAMPLES: int = 6        # frame pairs checked across the
                                          # clip before the pro pass: if
                                          # none of them carries real
                                          # content out from under the
                                          # region (a still shot), the clip
                                          # goes straight to the per-frame
                                          # fill instead of paying for 12
                                          # flow fields a frame that can't
                                          # recover anything
REGION_FLOW_MIN_RECOVERABLE: float = 0.02  # fraction of region pixels the
                                          # probe must see uncovered for
                                          # the pro pass to be worth it

# Per-frame fill reuse: the fill only reads the pixels around the region,
# so while those stay the same (a still shot) the previous result is reused
# instead of recomputed. Compared against the frame the fill was last
# computed on, not the previous frame, so a slow drift (fade, exposure)
# still adds up to a recompute.
REGION_REUSE_MAX_MEAN_DIFF: float = 1.0  # mean absolute difference (0-255)
                                          # of the surrounding pixels; above
                                          # compression noise, below any
                                          # visible change

# --- Output resolution selection -----------------------------------------
# Requested output height per option; the API never upscales past the
# source's actual height regardless of what's requested here (see
# api_video_process in app/main.py).
RESOLUTION_HEIGHTS: dict[str, int] = {"720p": 720, "1080p": 1080, "4k": 2160}

# --- Browser editor export (/api/video/export, app/pipeline/editor.py) -------
# One export uploads the original plus any AI-cleaned segments the editor
# holds, so the total cap is above the single-video cap; each individual
# file still has to fit MAX_VIDEO_UPLOAD_BYTES. The timeline itself is
# bounded by MAX_VIDEO_DURATION_SECONDS like any other video job. For the
# editor, RESOLUTION_HEIGHTS caps the *short* side, so a 9:16 1080x1920 clip
# counts as 1080p rather than being squeezed to 720 pixels tall.
EDITOR_MAX_TOTAL_UPLOAD_BYTES: int = 2 * MAX_VIDEO_UPLOAD_BYTES
EDITOR_MAX_SOURCES: int = 16
EDITOR_MAX_CLIPS: int = 200
EDITOR_MAX_STICKERS: int = 60  # overlay layers: stickers + text + images
EDITOR_MAX_STICKER_BYTES: int = 4 * 1024 * 1024
EDITOR_MAX_STICKER_DIMENSION: int = 2048
EDITOR_MAX_TRANSITION_SECONDS: float = 2.0
EDITOR_MAX_FPS: float = 60.0
EDITOR_MAX_AUDIO: int = 12  # audio clips (and uploaded audio files) per export
EDITOR_MAX_AUDIO_BYTES: int = 50 * 1024 * 1024
# The desktop engine takes audio the app made itself on the user's machine:
# voice translation's full-length WAVs (44.1 kHz stereo, about 10 MB a
# minute) passed the cloud cap above at five minutes and failed the export.
EDITOR_MAX_LOCAL_AUDIO_BYTES: int = MAX_VIDEO_UPLOAD_BYTES
EDITOR_MAX_EFFECTS: int = 30
# Keyframes per clip or layer, and how far (seconds) their times may reach.
EDITOR_MAX_KEYFRAMES: int = 100
EDITOR_MAX_KEYFRAME_SPAN: float = 24 * 3600.0
# Longest animated GIF export (GIFs grow fast and play poorly when long).
EDITOR_MAX_GIF_SECONDS: float = 60.0
# Speech regions an audio track can duck under (src/lib/editor/ducking.ts).
EDITOR_MAX_DUCK_REGIONS: int = 2000
# States in an animated text's sprite sheet (src/lib/editor/textAnim.ts).
EDITOR_MAX_SPRITE_STATES: int = 64
# Focus zooms / pointer effects (desktop screen recordings): rows of
# per-frame values the browser sends only where they change.
EDITOR_MAX_CAMERA_ROWS: int = 100_000  # per clip
EDITOR_MAX_POINTER_ROWS: int = 200_000  # cursor + ring rows together
EDITOR_MAX_MASKS: int = 40  # privacy masks per export
EDITOR_MAX_MASK_ROWS: int = 50_000  # per mask
# ffmpeg's reverse filter buffers every frame of the clip in memory, so a
# reversed clip's source range is capped. Must match MAX_REVERSE_SECONDS in
# src/lib/editor/timeline.ts.
EDITOR_MAX_REVERSE_SECONDS: float = 10.0
# The seconds cap alone isn't enough: 10 s of 4K60 is ~7.5 GB of buffered
# frames. main.py also rejects a reversed clip whose estimated frame buffer
# (frames x scaled frame size, yuv420p) is past this.
EDITOR_MAX_REVERSE_BUFFER_BYTES: int = int(
    float(os.environ.get("EDITOR_MAX_REVERSE_BUFFER_MB", "1024")) * 1024 * 1024
)
EDITOR_MAX_FREEZE_SECONDS: float = 30.0
# Free-tier exports ("compact", decided by the Next.js /api/export route):
# a higher CRF and lower audio bitrate make files ~30-40% smaller, which is
# what the bandwidth bill is paid on. Barely visible at 720p.
EDITOR_COMPACT_CRF: int = 23
EDITOR_COMPACT_AUDIO_BITRATE: str = "128k"

# --- Content moderation (explicit-content screening) -------------------------
# Local, self-hosted classifier only - flags likely nudity so the API can
# refuse to process a clip. This is a heuristic classifier, not a legal
# guarantee: it will miss some material and can flag borderline-but-legitimate
# content (swimwear, medical/artistic nudity). It is NOT CSAM detection -
# that is a hash-matching problem against known-image databases (PhotoDNA,
# Thorn Safer, Google CSAI Match), requires formal registration with the
# operating body, and must not be approximated by a classifier like this one.
# See app/pipeline/moderation.py for how to wire in a stronger hosted
# moderation API (AWS Rekognition / Google Video Intelligence / Azure)
# alongside or instead of this local pass.
NSFW_SAMPLE_FRAMES: int = 5              # frames sampled evenly across the clip
# A frame counts as a hit at this NSFW probability (local classifier) or
# label confidence (MODERATION_PROVIDER=aws). Above the classifier's 0.5
# decision point on purpose: dark or violent but non-explicit film scenes
# score up to ~0.7 (Sintel, the bundled demo, peaks at 0.67), and a false
# block stops someone editing their own footage.
NSFW_CONFIDENCE_THRESHOLD: float = 0.85
