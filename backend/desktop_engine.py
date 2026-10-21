"""Entry point of the engine the desktop app bundles (see desktop.spec and
src-tauri/src/engine.rs): this same backend, run on the user's own machine so
the import check, AI cleanup and export never leave it.

The app starts it with:
    WIPECLIP_LOCAL_PORT   the localhost port to listen on
    WIPECLIP_LOCAL_TOKEN  a random per-launch value every request must send
                          as X-Local-Token (see LOCAL_MODE in app/config.py)
    WIPECLIP_PARENT_PID   the app's process id: the engine exits when that
                          process does, even if the app crashes or is killed
    ALLOWED_ORIGINS       the app's own origins
"""

from __future__ import annotations

import multiprocessing
import os
import sys
import threading
import time


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


def main() -> None:
    os.environ["WIPECLIP_LOCAL"] = "1"
    port = int(os.environ["WIPECLIP_LOCAL_PORT"])
    parent = os.environ.get("WIPECLIP_PARENT_PID")
    if parent:
        threading.Thread(target=_exit_with_parent, args=(int(parent),), daemon=True).start()

    import uvicorn

    from app.main import app

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
