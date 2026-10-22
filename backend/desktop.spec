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
datas += collect_data_files("imageio_ffmpeg")  # the static ffmpeg binary
binaries = []

hiddenimports = []
hiddenimports += collect_submodules("app")  # pipelines are imported lazily
hiddenimports += collect_submodules("uvicorn")

a = Analysis(
    ["desktop_engine.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    # Cloud-server-only modules; app/ imports them lazily and only when configured.
    excludes=["redis", "rq", "google", "sentry_sdk", "rembg", "onnxruntime", "hypercorn", "a2wsgi", "boto3", "tkinter"],
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
