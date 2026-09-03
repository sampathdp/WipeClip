"""Central tunable constants for the sprite-cleaning pipeline.

Mirrors the CLI tool's CONFIGURABLE PARAMETERS block - see the top-level
README for context on what each stage does. Values here are defaults; most
are also exposed as per-request overrides in the API schemas.
"""

from pathlib import Path

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

# --- Free-tier preview cap for /api/image/auto-enhance (api_image_auto_enhance) ---
# Anonymous callers get downscaled to this before processing (matches
# remove.bg's known free/anonymous preview cap - see api_image_auto_enhance's
# `preview` flag in main.py for who actually gets capped). Downscaling
# BEFORE the pipeline runs, not after, is also just cheaper: rembg's
# segmentation cost scales with pixel count.
BG_REMOVE_PREVIEW_MAX_MEGAPIXELS: float = 0.25

# --- Watermark/artifact candidate detection (suggest-only, never auto-applies) ---
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

# --- Video watermark removal (ffmpeg-based) -----------------------------------
# Synchronous request/response (no job queue) - these caps keep a single
# ffmpeg encode within a request/response cycle a browser will actually wait
# out, rather than silently hanging on a multi-hundred-MB or hour-long upload.
MAX_VIDEO_UPLOAD_BYTES: int = 300 * 1024 * 1024  # 300 MB
MAX_VIDEO_DURATION_SECONDS: float = 600.0  # 10 minutes
VIDEO_ENCODE_PRESET: str = "veryfast"  # libx264 preset - speed/size tradeoff
VIDEO_ENCODE_CRF: int = 20  # lower = higher quality/bigger file; 20 is visually near-lossless
MIN_REGION_PX: int = 4  # smallest allowed watermark-region edge length

# --- Watermark region reconstruction (remove_logo) --------------------------
# remove_logo() went through two reconstructions before this one:
#   1. ffmpeg's `delogo` filter - fast, but a crude smooth boundary
#      interpolation with no texture awareness. Visibly *smeared* any
#      strong nearby color (e.g. text) clear across the box instead of
#      containing it.
#   2. OpenCV's Telea inpainting (per-frame, PDE-based edge propagation) -
#      contained bleeding far better than delogo, but Telea/NS-family
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
# WATERMARK_INPAINT_FSR_MAX_REGION_PX to Telea (cv2.inpaint) instead -
# seconds, not minutes, for the whole clip. Watermark-sized boxes (the
# overwhelmingly common case) still get FSR at full resolution, unchanged.
# At WATERMARK_FSR_SCALE = 1.0 the FSR path runs ~6.5x realtime end-to-end
# for a normal box; a clip near MAX_VIDEO_DURATION_SECONDS is still tens of
# minutes on the FSR path in a synchronous request with no job queue -
# reconsider MAX_VIDEO_DURATION_SECONDS or a background job queue first.
#
# None of this - not delogo, not Telea, not FSR - can *recover* content
# that's 100% covered by the watermark in every single frame; that
# information is simply gone from the source. FSR just produces a much
# more plausible fill than diffusion-based inpainting did, not the real
# original pixels. Actual recovery is only possible when the covered
# content shifts relative to the fixed watermark at some point in the
# clip (camera pan, scrolling caption, etc.) - that needs motion-aware
# multi-frame reconstruction (optical-flow-guided video inpainting), which
# is a materially bigger feature than this.
WATERMARK_FSR_CONTEXT_PAD_PX: int = 100  # how much surrounding context
                                          # (beyond the region itself) FSR
                                          # gets to work with
WATERMARK_FSR_SCALE: float = 1.0         # working resolution for the FSR
                                          # pass, relative to the padded
                                          # crop - the speed/quality lever
                                          # (below 1.0 is faster but brings
                                          # back a bleed/smear artifact
                                          # next to sharp nearby content -
                                          # see the block comment above)
WATERMARK_INPAINT_FSR_MAX_REGION_PX: int = 130_000  # ~360x360. A marked
                                          # box with more pixels than this
                                          # is reconstructed with Telea
                                          # (cv2.inpaint) instead of FSR:
                                          # FSR on a hole that large is both
                                          # very slow (minutes per clip) and
                                          # no sharper in practice - too
                                          # little real content around it to
                                          # exemplar from. Watermark-sized
                                          # boxes stay on the FSR path.

# The reconstructed patch is then re-sharpened in the final ffmpeg pass -
# still somewhat soft after any inpainting method - to restore local
# contrast on top of it. Cosmetic only, same caveat as above.
WATERMARK_PATCH_SHARPEN_KSIZE: int = 7      # unsharp luma_msize_x/y (odd, 3-23)
WATERMARK_PATCH_SHARPEN_AMOUNT: float = 2.5  # unsharp luma_amount

# --- Optical-flow-assisted reconstruction (Pro-tier quality="pro") ----------
# CPU-only motion-aware fill: the WATERMARK_FSR_* block above ends by
# naming the real fix for FSR's fundamental limit (it can only plausibly
# fill a fully-covered region, never recover it) as "motion-aware
# multi-frame reconstruction (optical-flow-guided video inpainting)". This
# is that upgrade, gated behind quality="pro" (see remove_logo()) - free/
# starter traffic keeps the plain FSR path unchanged.
#
# For each covered frame, dense optical flow (Farneback, CPU) checks a
# window of nearby frames for camera pan/scroll that carried the region's
# real underlying content to a screen position outside the watermark at
# some point nearby in time - if so, those are the actual original pixels,
# not a plausible fill. Any pixel no neighbor frame ever uncovers (a
# genuinely static/tripod shot, or motion too large for the padded search
# window below) falls back to _fsr_inpaint_region exactly as quality=
# "standard" already does.
WATERMARK_FLOW_SEARCH_RADIUS_FRAMES: int = 6  # neighbor frames searched each
                                          # direction - also bounds the
                                          # sliding buffer's memory (at most
                                          # 2*radius+1 full frames held at
                                          # once, see
                                          # _inpaint_region_to_temp_video_flow)
WATERMARK_FLOW_CONTEXT_PAD_PX: int = 220  # padding beyond the region flow
                                          # is allowed to search within -
                                          # larger than WATERMARK_FSR_
                                          # CONTEXT_PAD_PX since this needs
                                          # room for real motion to have
                                          # carried content out from under
                                          # the region, not just enough
                                          # context to blend a seam
WATERMARK_FLOW_ESTIMATION_SCALE: float = 0.5  # the flow FIELD is estimated
                                          # on a downscaled crop (cheap -
                                          # flow is smooth/low-frequency,
                                          # same principle as
                                          # WATERMARK_FSR_SCALE); recovered
                                          # pixels are always sampled from
                                          # the full-resolution buffered
                                          # frame, never downscaled

# --- Video watermark auto-detection (suggest-only, never auto-applies) ------
# Finds a region that stays pixel-static across sampled frames while the
# rest of the frame moves - the signature a fixed corner/overlay logo has
# regardless of what it actually looks like. Same suggest-only contract as
# DETECT_* above: returns a candidate box for the frontend to prefill
# RegionSelector with, user can drag/accept/ignore before anything runs.
# See detect_watermark_candidates() in app/pipeline/video.py.
WATERMARK_DETECT_SAMPLE_FRAMES: int = 10
WATERMARK_DETECT_MIN_MOTION: float = 5.0     # median per-pixel stddev (0-255)
                                              # the *whole* frame must clear
                                              # before trusting any "low
                                              # variance" region as a logo
                                              # rather than just a static shot
WATERMARK_DETECT_LOW_VAR_FRACTION: float = 0.25  # candidate pixels' stddev
                                              # must be under this fraction
                                              # of the frame's median stddev
WATERMARK_DETECT_MIN_BLOB_AREA_FRACTION: float = 0.0006  # of frame area
WATERMARK_DETECT_MAX_BLOB_AREA_FRACTION: float = 0.15    # of frame area
WATERMARK_DETECT_MIN_SOLIDITY: float = 0.35
WATERMARK_DETECT_MAX_CANDIDATES: int = 5
WATERMARK_DETECT_BOX_PADDING_PX: int = 4

# --- Known-platform logo template matching (suggest-only) -------------------
# Complements WATERMARK_DETECT_* above (which finds *any* fixed overlay,
# unidentified) with a match against a *specific* known logo shape - see
# app/pipeline/logo_match.py. Ships empty: no logo images are bundled in
# this repo (TikTok/CapCut/Instagram/Shutterstock/etc. marks are someone
# else's trademarked assets, not something to reproduce here). Drop your
# own reference PNGs into LOGO_REFERENCE_DIR and matching against them is
# automatic; with none present this is a no-op.
LOGO_REFERENCE_DIR: Path = Path(__file__).resolve().parent / "assets" / "watermark_logos"
LOGO_MATCH_MIN_SCORE: float = 0.6      # correlation threshold - untuned
                                        # against real logos since none ship
                                        # here; revisit once you've dropped
                                        # in real references and tested
                                        # against real downloaded clips
LOGO_MATCH_SCALE_MIN: float = 0.4      # smallest fraction of the reference
                                        # image's native size to try
LOGO_MATCH_SCALE_MAX: float = 1.6      # largest fraction to try
LOGO_MATCH_SCALE_STEPS: int = 12       # scales sampled between min and max
LOGO_MATCH_MAX_CANDIDATES: int = 5
WATERMARK_DETECT_BAR_FLATNESS_THRESHOLD: float = 6.0  # a row/column this
                                              # spatially uniform (0-255
                                              # stddev), and part of an
                                              # unbroken run from a frame
                                              # edge, is treated as a
                                              # letterbox/pillarbox bar
                                              # rather than logo content -
                                              # a real logo breaks the run
                                              # by being spatially detailed,
                                              # so this doesn't exclude a
                                              # logo that merely sits inside
                                              # the bar band

# --- Output resolution selection -----------------------------------------
# Requested output height per option; the API never upscales past the
# source's actual height regardless of what's requested here (see
# api_video_process in app/main.py).
RESOLUTION_HEIGHTS: dict[str, int] = {"720p": 720, "1080p": 1080, "4k": 2160}

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
NSFW_CONFIDENCE_THRESHOLD: float = 0.6   # per-detection confidence to count as a hit
NSFW_BLOCKED_LABELS: frozenset[str] = frozenset(
    {
        "FEMALE_GENITALIA_EXPOSED",
        "MALE_GENITALIA_EXPOSED",
        "ANUS_EXPOSED",
        "FEMALE_BREAST_EXPOSED",
        "BUTTOCKS_EXPOSED",
    }
)
