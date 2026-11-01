"""Entry point of the engine the desktop app bundles (see desktop.spec and
src-tauri/src/engine.rs): this same backend, run on the user's own machine so
the import check, AI cleanup and export never leave it.

The app starts it with:
    WIPECLIP_LOCAL_PORT   the localhost port to listen on
    WIPECLIP_LOCAL_TOKEN  a random per-launch value every request must send
                          as X-Local-Token (see LOCAL_MODE in app/config.py)
    WIPECLIP_PARENT_PID   the app's process id: the engine exits when that
                          process does, even if the app crashes or is killed
    WIPECLIP_IDLE_EXIT    seconds without a request after which the engine
                          exits to give its memory back (default 300, 0 =
                          never); the app starts it again on the next job
    ALLOWED_ORIGINS       the app's own origins

It runs below normal priority and leaves one core free by default, so the
editor stays responsive on small machines while an export renders.
"""

from __future__ import annotations

import multiprocessing
import os
import sys
import threading
import time

DEFAULT_IDLE_EXIT_SECONDS = 300


def _exit_with_parent(pid: int) -> None:
    # Not a read on an inherited stdin pipe: on Windows a pending read on it
    # blocks every other use of that handle, which stalled server startup.
    if sys.platform == "win32":
        import ctypes

        synchronize, infinite = 0x00100000, 0xFFFFFFFF
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(synchronize, False, pid)
        if handle:
            kernel32.WaitForSingleObject(handle, infinite)
    else:
        while os.getppid() == pid:
            time.sleep(1)
    os._exit(0)


def _lower_priority() -> None:
    # Inherited by the ffmpeg processes the jobs start, so a render yields
    # the CPU to the editor's UI and playback instead of competing with it.
    try:
        if sys.platform == "win32":
            import ctypes

            below_normal = 0x00004000
            kernel32 = ctypes.windll.kernel32
            # The pseudo handle is (HANDLE)-1: as ctypes' default int it gets
            # truncated, and the call fails.
            kernel32.GetCurrentProcess.restype = ctypes.c_void_p
            kernel32.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
            if not kernel32.SetPriorityClass(kernel32.GetCurrentProcess(), below_normal):
                raise ctypes.WinError()
        else:
            os.nice(5)
    except Exception as e:  # never worth failing the start over
        print(f"engine: couldn't lower priority: {e}", file=sys.stderr)


def _default_job_threads() -> None:
    # app/config.py gives a job every core; on the user's machine one is kept
    # for the app itself. An explicit JOB_THREADS still wins.
    cores = os.cpu_count() or 1
    os.environ.setdefault("JOB_THREADS", str(max(1, cores - 1)))


class _IdleExit:
    """ASGI wrapper that exits the process once no request has been in
    flight for `seconds`. Jobs run inside their request (app/main.py
    _run_pipeline_job), so an open request is what "busy" means. A plain
    ASGI wrapper rather than a FastAPI middleware, so a streamed response
    counts until its last byte is sent."""

    def __init__(self, app, seconds: float) -> None:
        self.app = app
        self.seconds = seconds
        self.active = 0
        self.last = time.monotonic()
        threading.Thread(target=self._watch, daemon=True).start()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        self.active += 1
        self.last = time.monotonic()
        try:
            return await self.app(scope, receive, send)
        finally:
            self.active -= 1
            self.last = time.monotonic()

    def _watch(self) -> None:
        while True:
            time.sleep(min(15.0, self.seconds))
            if self.active == 0 and time.monotonic() - self.last >= self.seconds:
                print("engine: idle, exiting to free memory", file=sys.stderr)
                os._exit(0)


def _idle_exit_seconds() -> float:
    try:
        return max(0.0, float(os.environ.get("WIPECLIP_IDLE_EXIT", DEFAULT_IDLE_EXIT_SECONDS)))
    except ValueError:
        return float(DEFAULT_IDLE_EXIT_SECONDS)


def main() -> None:
    os.environ["WIPECLIP_LOCAL"] = "1"
    port = int(os.environ["WIPECLIP_LOCAL_PORT"])
    parent = os.environ.get("WIPECLIP_PARENT_PID")
    if parent:
        threading.Thread(target=_exit_with_parent, args=(int(parent),), daemon=True).start()
    _lower_priority()
    _default_job_threads()

    import uvicorn

    from app.main import app

    idle = _idle_exit_seconds()
    served = _IdleExit(app, idle) if idle > 0 else app
    # Pure-Python parts only. uvicorn's "auto" defaults pick its optional
    # speedups (websockets, httptools, uvloop) whenever they import, and in
    # the packaged build they import as empty stubs: the engine crashed at
    # startup (websockets) or on every request (httptools). The engine serves
    # no websockets; h11 and asyncio are uvicorn's own required dependencies.
    uvicorn.run(
        served,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        access_log=False,
        ws="none",
        http="h11",
        loop="asyncio",
    )


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
