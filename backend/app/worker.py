"""RQ worker entrypoint: `python -m app.worker`.

Processes jobs enqueued by app/main.py's routes when REDIS_URL is set - see
app/queue.py for the opt-in contract and, importantly, its filesystem-
locality caveat (this process must share a filesystem with whichever API
instance enqueued the job).
"""

from __future__ import annotations

import sys

from rq import Worker

# Not otherwise referenced in this module - importing it here means a
# broken pipeline import fails loudly at worker startup instead of on the
# first job it's asked to run.
import app.jobs  # noqa: F401
from app.queue import QUEUE_NAME, get_queue


def main() -> None:
    queue = get_queue()
    if queue is None:
        print("REDIS_URL is not set - nothing to work. Set REDIS_URL and retry.", file=sys.stderr)
        raise SystemExit(1)
    Worker([QUEUE_NAME], connection=queue.connection).work()


if __name__ == "__main__":
    main()
