# PyInstaller spec for the desktop app's engine (desktop_engine.py).
#
#   pip install -r requirements-desktop.txt
#   pyinstaller desktop.spec --noconfirm
#
# Output: dist/wipeclip-engine/ (a folder, not one file: a one-file build
# unpacks itself to a temp folder on every start, which is slow and trips
# antivirus scanners). The desktop build copies that folder to
# src-tauri/resources/engine/, see .github/workflows/desktop.yml.
# ruff: noqa

import os
import sys

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

# macOS release builds: every bundled binary signed with the app's identity
# and hardened runtime, as notarization requires (CI imports the certificate).
codesign_identity = (os.environ.get("APPLE_SIGNING_IDENTITY") or None) if sys.platform == "darwin" else None

datas = []
# The moderation model (app/pipeline/nsfw_classifier.py), fetched into
# app/models/ by `python -m app.pipeline.nsfw_classifier` before this runs.
nsfw_model = os.path.join("app", "models", "nsfw-image-detection-384.safetensors")
if not os.path.exists(nsfw_model):
    raise SystemExit(f"{nsfw_model} missing - run `python -m app.pipeline.nsfw_classifier` first")
datas += [(nsfw_model, os.path.join("app", "models"))]
# The background removal models (app/pipeline/matte.py), fetched into
# app/models/ by `python -m app.pipeline.matte` before this runs.
# And the text reading models for scene analysis (app/pipeline/ocr.py),
# fetched by `python -m app.pipeline.ocr`.
for matte_model, step in (
    ("selfie_segmenter.tflite", "matte"),
    ("selfie_segmenter_landscape.tflite", "matte"),
    ("en_PP-OCRv3_det_infer.onnx", "ocr"),
    ("en_PP-OCRv3_rec_infer.onnx", "ocr"),
):
    matte_path = os.path.join("app", "models", matte_model)
    if not os.path.exists(matte_path):
        raise SystemExit(f"{matte_path} missing - run `python -m app.pipeline.{step}` first")
    datas += [(matte_path, os.path.join("app", "models"))]
datas += collect_data_files("imageio_ffmpeg")  # the static ffmpeg binary
binaries = []

hiddenimports = []
hiddenimports += collect_submodules("app")  # pipelines are imported lazily
hiddenimports += collect_submodules("uvicorn")
# Speech recognition (app/pipeline/speech.py): imported lazily, and
# ctranslate2's converter specs are loaded by name.
hiddenimports += collect_submodules("faster_whisper") + collect_submodules("ctranslate2")
# Voice translation (app/pipeline/dub.py): onnxruntime runs its models.
hiddenimports += ["onnxruntime", "tokenizers", "sentencepiece"]  # sentencepiece: the fast voice's tokenizer

a = Analysis(
    ["desktop_engine.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    # faster_whisper imports av (FFmpeg bindings, ~70 MB) at the top only to
    # decode files; the engine hands it samples, so a stub stands in.
    runtime_hooks=["pyi_rth_av_stub.py"],
    # Cloud-server-only modules; app/ imports them lazily and only when configured.
    excludes=["redis", "rq", "google", "sentry_sdk", "rembg", "hypercorn", "a2wsgi", "boto3", "tkinter", "av", "torch", "transformers", "hf_xet"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="wipeclip-engine",
    # A console build, so stdout/stderr exist and reach the app's log. The
    # app starts it with CREATE_NO_WINDOW, so no console window ever shows.
    console=True,
    upx=False,
    codesign_identity=codesign_identity,
)
coll = COLLECT(exe, a.binaries, a.datas, name="wipeclip-engine", upx=False)
