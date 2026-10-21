"""Job tickets: the backend half of src/lib/jobTicket.ts.

Video jobs are uploaded by the browser straight to this backend (too big
and too slow to pass through the Next.js routes on Vercel). Those routes
still do every plan and credit check, then hand the browser a ticket
signed with INTERNAL_API_SECRET; /api/video/export and /api/video/process
take their billing-relevant settings (resolution, branding, quality...) from
the ticket only, never from the form.

Before a job runs, the ticket is claimed through the site's
/api/internal/ticket, so one ticket can never run two jobs; a failed paid
job is refunded the same way. SITE_URL must point at the Next.js site for
that. Both are no-ops until configured, so local dev needs neither -
same pattern as INTERNAL_API_SECRET in main.py.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import time
import traceback
import urllib.error
import urllib.request

from fastapi import HTTPException

from app.config import LOCAL_MODE


def _b64url_decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def verify(token: str, kind: str) -> dict:
    """The ticket's payload, if it's well-formed, correctly signed, of the
    expected kind and not expired.

    Raises:
        HTTPException: 403 otherwise.
    """
    secret = os.environ.get("INTERNAL_API_SECRET")
    try:
        payload_b64, sig = token.split(".")
        payload = json.loads(_b64url_decode(payload_b64))
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=403, detail="Invalid job ticket.") from exc
    if secret:
        expected = base64.urlsafe_b64encode(
            hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).digest()
        ).rstrip(b"=").decode()
        if not hmac.compare_digest(expected, sig):
            raise HTTPException(status_code=403, detail="Invalid job ticket.")
    if payload.get("kind") != kind:
        raise HTTPException(status_code=403, detail="Invalid job ticket.")
    # Local tickets cost no credits because the user's own machine does the
    # work, so they must never buy a job on this server.
    if payload.get("local") and not LOCAL_MODE:
        raise HTTPException(status_code=403, detail="Invalid job ticket.")
    if float(payload.get("exp", 0)) < time.time() * 1000:
        raise HTTPException(status_code=403, detail="This request has expired. Please try again.")
    return payload


def _call_site(action: str, token: str) -> dict | None:
    """POSTs to the site's /api/internal/ticket. None when SITE_URL isn't
    configured. Raises on network/HTTP errors."""
    site = os.environ.get("SITE_URL")
    if not site:
        return None
    req = urllib.request.Request(
        f"{site.rstrip('/')}/api/internal/ticket",
        data=json.dumps({"action": action, "ticket": token}).encode(),
        headers={
            "Content-Type": "application/json",
            "X-Internal-Process-Secret": os.environ.get("INTERNAL_API_SECRET", ""),
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read() or b"{}")


async def claim(token: str) -> None:
    """Marks the ticket used.

    Fails open if the site can't be reached: refusing would strand a user
    who has already paid for this job, and replays are only possible while
    the site is down.

    Raises:
        HTTPException: 409 if the ticket was already used.
    """
    try:
        res = await asyncio.to_thread(_call_site, "claim", token)
    except (urllib.error.URLError, TimeoutError, ValueError):
        traceback.print_exc()
        return
    if res is not None and res.get("ok") is False:
        raise HTTPException(status_code=409, detail="This request was already used. Please try again.")


async def refund(token: str) -> None:
    """Gives a failed job's credits back (the site decides whether the
    ticket paid anything). Best effort: failures are logged, never raised,
    so they can't hide the job's own error."""
    try:
        await asyncio.to_thread(_call_site, "refund", token)
    except Exception:  # noqa: BLE001
        print("[tickets] refund failed for a job ticket")
        traceback.print_exc()
