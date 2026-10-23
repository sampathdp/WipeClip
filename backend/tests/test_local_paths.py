"""Files named by path (the desktop engine's videos that stay on disk):
accepted only in local mode, only existing absolute media files, and
mixed in order with uploads for an export.

Run from the backend folder:  python -m unittest tests.test_local_paths
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from unittest import mock

from fastapi import HTTPException

from app import main


class LocalFileTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.video = os.path.join(self.dir.name, "clip.MP4")
        with open(self.video, "wb") as f:
            f.write(b"x")
        self.text = os.path.join(self.dir.name, "notes.txt")
        with open(self.text, "wb") as f:
            f.write(b"x")

    def tearDown(self) -> None:
        self.dir.cleanup()

    def test_refused_by_the_cloud_backend(self) -> None:
        with mock.patch.object(main, "LOCAL_MODE", False), self.assertRaises(HTTPException):
            main._local_file(self.video, main._VIDEO_SUFFIXES)

    def test_existing_video_accepted_in_place(self) -> None:
        with mock.patch.object(main, "LOCAL_MODE", True):
            self.assertEqual(main._local_file(self.video, main._VIDEO_SUFFIXES), self.video)

    def test_rejects_other_files(self) -> None:
        with mock.patch.object(main, "LOCAL_MODE", True):
            for bad in (self.text, os.path.join(self.dir.name, "gone.mp4"), "clip.MP4", self.dir.name):
                with self.subTest(bad=bad), self.assertRaises(HTTPException):
                    main._local_file(bad, main._VIDEO_SUFFIXES)

    def test_path_lists(self) -> None:
        self.assertIsNone(main._local_paths(None, "source_paths"))
        self.assertEqual(main._local_paths(json.dumps([None, "C:/a.mp4"]), "source_paths"), [None, "C:/a.mp4"])
        for bad in ("{", json.dumps({"a": 1}), json.dumps([1])):
            with self.subTest(bad=bad), self.assertRaises(HTTPException):
                main._local_paths(bad, "source_paths")


if __name__ == "__main__":
    unittest.main()
