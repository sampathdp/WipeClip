"""Optional RQ/Redis job queue - decouples ffmpeg/inpaint execution from the
web request so concurrency is bounded by worker count and a backend
redeploy doesn't kill an in-flight job. Entirely opt-in: with REDIS_URL
unset, get_queue() returns None and main.py's routes fall back to running
the same pipeline call inline (via asyncio.to_thread) exactly as before -
so this ships inert until Redis is actually provisioned.

This is a queue for *decoupling execution*, not full async UX: the Next.js
route (and this backend's own route handler) still does one bounded
blocking wait for the result (see _run_pipeline_job in main.py), so no
credit-flow or frontend redesign was needed to add it. A real async
UX (progress bar, poll-and-fetch-later) needs a durable place to park
output across requests/instances - i.e. object storage - which this
project doesn't have yet.

Deployment caveat: jobs pass file paths, not bytes, through Redis (see
app/jobs.py) - worker.py's process must therefore share a filesystem with
whichever API instance enqueued the job. True for one VM/container running
both API and worker; NOT true across independent Cloud Run
services/instances without a shared volume. Don't set REDIS_URL in a
deployment where that doesn't hold, or jobs will enqueue fine and then
fail to find their input file.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from rq import Queue

QUEUE_NAME = "wipeclip"


@lru_cache(maxsize=1)
def get_queue() -> Queue | None:
    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        return None
    # Imported only when configured, so the desktop engine ships without them.
    import redis
    from rq import Queue

    return Queue(QUEUE_NAME, connection=redis.from_url(redis_url))
