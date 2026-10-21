"""Direct-to-bucket video uploads (Google Cloud Storage).

Cloud Run bills an instance for the whole time a request is open, upload
included, and keeps the uploaded bytes in its RAM-backed /tmp. So instead of
posting the video here, the browser asks /api/video/upload-url for a
short-lived signed PUT URL, uploads straight to the bucket, and then sends
only the object's id to /api/video/probe and /api/video/process, which pull
it from the bucket (same region, so fast and free).

Inert until GCS_UPLOAD_BUCKET is set: /api/video/upload-url answers 404 and
the frontend falls back to posting the file directly - same "no-op until
configured" pattern as INTERNAL_API_SECRET/REDIS_URL. The bucket should have
a lifecycle rule deleting objects after a day, since a probed video that is
never processed is never deleted here.

On Cloud Run the URL is signed with the service's own account through the
IAM signBlob API (no key file), which needs that account to hold
roles/iam.serviceAccountTokenCreator on itself and object read/delete on the
bucket.
"""

from __future__ import annotations

import os
import re
import uuid
from datetime import timedelta
from functools import lru_cache

from fastapi import HTTPException

GCS_UPLOAD_BUCKET: str | None = os.environ.get("GCS_UPLOAD_BUCKET") or None
UPLOAD_URL_TTL = timedelta(minutes=30)
UPLOAD_CONTENT_TYPE = "application/octet-stream"

_UPLOAD_ID = re.compile(r"^uploads/[0-9a-f]{32}(\.[a-z0-9]{1,5})?$")
_EXTENSION = re.compile(r"^\.[a-z0-9]{1,5}$")


def enabled() -> bool:
    return GCS_UPLOAD_BUCKET is not None


@lru_cache(maxsize=1)
def _bucket():
    # Imported lazily: local dev without a bucket never needs the client.
    from google.cloud import storage

    return storage.Client().bucket(GCS_UPLOAD_BUCKET)


def create_upload_url(extension: str, max_bytes: int) -> dict:
    """A fresh object id plus a signed PUT URL for it. The browser must send
    exactly the returned headers: they're part of the signature, and
    x-goog-content-length-range makes the bucket itself refuse anything
    bigger than `max_bytes`."""
    import google.auth
    from google.auth.transport import requests as ga_requests

    extension = extension.lower()
    upload_id = f"uploads/{uuid.uuid4().hex}{extension if _EXTENSION.match(extension) else ''}"
    headers = {"x-goog-content-length-range": f"0,{max_bytes}"}

    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    credentials.refresh(ga_requests.Request())
    signing: dict = {}
    if not hasattr(credentials, "sign_bytes"):
        # Metadata-server credentials (Cloud Run) can't sign locally; let the
        # library sign through IAM with the service's own account instead.
        signing = {"service_account_email": credentials.service_account_email, "access_token": credentials.token}

    url = _bucket().blob(upload_id).generate_signed_url(
        version="v4",
        expiration=UPLOAD_URL_TTL,
        method="PUT",
        content_type=UPLOAD_CONTENT_TYPE,
        headers=headers,
        **signing,
    )
    return {"uploadId": upload_id, "url": url, "headers": {"Content-Type": UPLOAD_CONTENT_TYPE, **headers}}


def suffix(upload_id: str) -> str:
    return os.path.splitext(upload_id)[1] or ".mp4"


def download(upload_id: str, path: str, max_bytes: int) -> None:
    """Copies an uploaded video to `path`.

    Raises:
        HTTPException: 400 for a malformed id or an oversized object, 410 if
            it no longer exists (expired, or already processed and deleted).
    """
    from google.api_core.exceptions import NotFound

    if not enabled() or not _UPLOAD_ID.match(upload_id):
        raise HTTPException(status_code=400, detail="Invalid upload.")
    blob = _bucket().blob(upload_id)
    try:
        blob.reload()
        if (blob.size or 0) > max_bytes:
            raise HTTPException(status_code=400, detail=f"File too large (max {max_bytes // (1024 * 1024)}MB)")
        blob.download_to_filename(path)
    except NotFound as exc:
        raise HTTPException(
            status_code=410, detail={"code": "upload_expired", "message": "Upload expired. Please try again."}
        ) from exc


def delete(upload_id: str) -> None:
    """Best effort: the bucket's lifecycle rule catches anything missed."""
    if not enabled() or not _UPLOAD_ID.match(upload_id):
        return
    try:
        _bucket().blob(upload_id).delete()
    except Exception:  # noqa: BLE001
        print("[uploads] could not delete an uploaded video")
