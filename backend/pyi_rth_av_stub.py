"""PyInstaller runtime hook for the engine (desktop.spec): a stand-in for
av, which faster_whisper imports at the top of its audio module but only
uses to decode media files. The engine passes it samples instead
(app/pipeline/speech.py), so av itself (~70 MB of FFmpeg) isn't bundled."""

import sys
import types


class _NotBundled(types.ModuleType):
    def __getattr__(self, name):
        raise ImportError("av isn't bundled with the WipeClip engine")


sys.modules.setdefault("av", _NotBundled("av"))
