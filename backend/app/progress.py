"""Progress and cancel for jobs the caller watches (the desktop app's
exports): the client picks a random job id, sends it with the job, then
polls GET /api/jobs/{id} and may POST /api/jobs/{id}/cancel.

In-process only: it works where the job runs in the request's own process
- the desktop engine, or the cloud backend without the RQ queue. A job run
by an RQ worker simply reports nothing (the client keeps its indeterminate
bar), and can't be cancelled this way.
"""

from __future__ import annotations

import re
import threading
import time
from dataclasses import dataclass, field

_ID = re.compile(r"^[A-Za-z0-9-]{16,64}$")
_MAX_JOBS = 64


class Cancelled(Exception):
    """The job was cancelled by its caller."""


@dataclass
class JobProgress:
    # Exports: "checking" (reading, screening files) | "rendering".
    # Speech recognition: "download" | "prepare" | "transcribe".
    phase: str = "checking"
    done: float = 0.0  # seconds of output rendered (speech: a fraction)
    total: float = 0.0  # seconds of output (speech: 1)
    cancel: threading.Event = field(default_factory=threading.Event)
    started: float = field(default_factory=time.monotonic)

    def fraction(self) -> float | None:
        if self.phase in ("checking", "prepare") or self.total <= 0:
            return None
        return max(0.0, min(1.0, self.done / self.total))

    def check(self) -> None:
        if self.cancel.is_set():
            raise Cancelled()


_jobs: dict[str, JobProgress] = {}
_lock = threading.Lock()


def valid_id(job_id: str | None) -> bool:
    return bool(job_id and _ID.match(job_id))


def start(job_id: str | None) -> JobProgress | None:
    """Registers a job (None for no or a malformed id). Old entries beyond
    _MAX_JOBS are dropped."""
    if not valid_id(job_id):
        return None
    with _lock:
        while len(_jobs) >= _MAX_JOBS:
            _jobs.pop(next(iter(_jobs)))
        job = _jobs[job_id] = JobProgress()
        return job


def get(job_id: str | None) -> JobProgress | None:
    if not job_id:
        return None
    with _lock:
        return _jobs.get(job_id)


def finish(job_id: str | None) -> None:
    if not job_id:
        return
    with _lock:
        _jobs.pop(job_id, None)
