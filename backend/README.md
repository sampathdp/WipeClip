# WipeClip.io backend

FastAPI service that does the actual video object cleanup (ffmpeg
+ OpenCV inpainting), plus the image-cleanup endpoints it was originally
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

From the repo root (full guide: [../docs/LOCAL_DEV.md](../docs/LOCAL_DEV.md)):

```bash
npm run dev:setup     # venv, requirements, backend/.env, models
npm run dev           # site on :3000 + this backend on :8002
npm run dev:check     # health check
```

`npm run dev:setup` also removes `opencv-python-headless` after installing:
nudenet depends on it, and it overwrites the `cv2` package from
`opencv-contrib-python-headless`, which drops the `cv2.xphoto` inpainting
that AI cleanup uses.

Requires `ffmpeg` on PATH, or falls back to the static binary bundled by
`imageio-ffmpeg` (already in requirements.txt) — no separate install needed.

Point the frontend at this backend via `NEXT_PUBLIC_TOOLS_API_URL` in
`../.env.local` (see `../.env.local.example`).

## Deploy

- `Dockerfile` — standard container build, `uvicorn` on port 8000.
- `passenger_wsgi.py` — cPanel/Passenger shared-hosting entry point.

Set `ALLOWED_ORIGINS` to your production frontend origin(s) in either case
(defaults to `*`, fine for local dev only).

### Direct uploads

With `GCS_UPLOAD_BUCKET` set, the browser uploads videos for
`/api/video/probe` and `/api/video/process` straight to that Cloud Storage
bucket, so Cloud Run isn't billed (or holding the file in RAM) while a slow
upload trickles in - see `app/uploads.py`. One-time setup (the bucket name
matches `UPLOAD_BUCKET` in `.github/workflows/deploy-backend.yml`):

```sh
PROJECT=wipeclip
BUCKET=gs://wipeclip-uploads
SA=$(gcloud run services describe unmarkai-backend --region us-central1 \
  --project $PROJECT --format='value(spec.template.spec.serviceAccountName)')
# Empty means the default compute account:
# PROJECT_NUMBER-compute@developer.gserviceaccount.com

gcloud storage buckets create $BUCKET --project $PROJECT \
  --location us-central1 --uniform-bucket-level-access --public-access-prevention

# Delete leftovers (probed but never processed, failed jobs) after a day.
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":1}}]}' > lifecycle.json
gcloud storage buckets update $BUCKET --lifecycle-file lifecycle.json

# The browser PUTs to the bucket cross-origin. The signed URL is the auth.
echo '[{"origin":["*"],"method":["PUT"],"responseHeader":["Content-Type","x-goog-content-length-range"],"maxAgeSeconds":3600}]' > cors.json
gcloud storage buckets update $BUCKET --cors-file cors.json

# Read/delete uploads, and sign URLs with its own identity (no key file).
gcloud storage buckets add-iam-policy-binding $BUCKET \
  --member serviceAccount:$SA --role roles/storage.objectAdmin
gcloud iam service-accounts add-iam-policy-binding $SA --project $PROJECT \
  --member serviceAccount:$SA --role roles/iam.serviceAccountTokenCreator
gcloud services enable iamcredentials.googleapis.com --project $PROJECT
```

Unset (local dev), `/api/video/upload-url` answers 404 and the frontend
posts the file to the backend as before.
