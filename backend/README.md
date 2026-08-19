# WipeClip.io backend

FastAPI service that does the actual video watermark removal (ffmpeg
`delogo`/`overlay`), plus the image-cleanup endpoints it was originally
built with. Copied from the standalone Sprite Cleaner tool — pipeline code
under `app/pipeline/` is unchanged except for the addition of
`app/pipeline/moderation.py`.

The frontend (`../`) talks to `/api/video/probe` and `/api/video/process`
only. See `app/main.py` for the full endpoint list.

## Content moderation

Both video endpoints screen sampled frames for explicit content
(`app/pipeline/moderation.py`) before doing anything else, and return
`422 {"detail": {"code": "content_blocked", ...}}` if flagged — the
frontend shows this as a hard stop, not a retryable error.

The default (`MODERATION_PROVIDER=local`, or unset) uses NudeNet, a
self-hosted ONNX nudity classifier — no account or API key needed, but it's
a heuristic, not a guarantee, and it is **not** CSAM detection (that needs a
vetted hash-matching service under formal registration — see the module
docstring before touching this). For stronger/legally-defensible coverage,
wire a hosted moderation API (AWS Rekognition, Google Cloud Video
Intelligence SafeSearch, Azure Content Moderator) into
`screen_frames_cloud()` in that module and set `MODERATION_PROVIDER`
accordingly.

NudeNet's model (~a few MB) downloads automatically on first use of a video
endpoint — that first call needs network access; every call after is
offline.

## Run locally

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

Requires `ffmpeg` on PATH, or falls back to the static binary bundled by
`imageio-ffmpeg` (already in requirements.txt) — no separate install needed.

Point the frontend at this backend via `NEXT_PUBLIC_TOOLS_API_URL` in
`../.env.local` (see `../.env.local.example`).

## Deploy

- `Dockerfile` — standard container build, `uvicorn` on port 8000.
- `passenger_wsgi.py` — cPanel/Passenger shared-hosting entry point.

Set `ALLOWED_ORIGINS` to your production frontend origin(s) in either case
(defaults to `*`, fine for local dev only).
