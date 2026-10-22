"""The numpy NSFW classifier (app/pipeline/nsfw_classifier.py) and the local
moderation pass built on it.

Reference scores come from timm 1.0.30 running the same weights
(vit_tiny_patch16_384, timm's own eval transform). The model tests need the
weights: they download into app/models/ on first run (22 MB) and are skipped
if that isn't possible.

Run from the backend folder:  python -m unittest tests.test_nsfw_classifier
"""

from __future__ import annotations

import math
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image

from app.pipeline import moderation, nsfw_classifier

PUBLIC = Path(__file__).resolve().parents[2] / "public"


def _weights_available() -> bool:
    try:
        nsfw_classifier.ensure_model()
        return True
    except Exception:  # noqa: BLE001 - offline, blocked or checksum: skip
        return False


class ErfTest(unittest.TestCase):
    def test_matches_math_erf(self) -> None:
        x = np.linspace(-6, 6, 2001, dtype=np.float32)
        expected = np.array([math.erf(v) for v in x.astype(np.float64)])
        self.assertLess(np.abs(nsfw_classifier._erf(x.copy()) - expected).max(), 5e-7)

    def test_stays_float32(self) -> None:
        x = np.ones((4, 8), dtype=np.float32)
        self.assertEqual(nsfw_classifier._gelu(x).dtype, np.float32)


class PreprocessTest(unittest.TestCase):
    def test_shape_range_and_channel_order(self) -> None:
        bgr = np.zeros((720, 1280, 3), dtype=np.uint8)
        bgr[..., 2] = 255  # red in BGR
        x = nsfw_classifier.preprocess(bgr)
        self.assertEqual(x.shape, (3, 384, 384))
        self.assertEqual(x.dtype, np.float32)
        self.assertAlmostEqual(float(x[0].mean()), 1.0, places=5)  # R channel first
        self.assertAlmostEqual(float(x[2].mean()), -1.0, places=5)


@unittest.skipUnless(_weights_available(), "NSFW model weights unavailable")
class ClassifierTest(unittest.TestCase):
    def test_matches_timm(self) -> None:
        icon = np.ascontiguousarray(np.array(Image.open(PUBLIC / "icon-512.webp").convert("RGB"))[..., ::-1])
        noise = np.random.default_rng(0).integers(0, 255, (480, 640, 3), dtype=np.uint8)
        probs = nsfw_classifier.nsfw_probabilities([icon, noise])
        np.testing.assert_allclose(probs, [0.05166, 0.12712], atol=2e-5)

    def test_parallel_frames_match_single(self) -> None:
        frames = [np.random.default_rng(i).integers(0, 255, (360, 640, 3), dtype=np.uint8) for i in range(3)]
        together = nsfw_classifier.nsfw_probabilities(frames)
        alone = [nsfw_classifier.nsfw_probabilities([f])[0] for f in frames]
        np.testing.assert_allclose(together, alone, atol=1e-6)

    def test_safe_frame_not_flagged(self) -> None:
        noise = np.random.default_rng(0).integers(0, 255, (480, 640, 3), dtype=np.uint8)
        self.assertFalse(moderation.screen_frames_local([noise]).flagged)


class ThresholdTest(unittest.TestCase):
    def test_any_frame_over_threshold_flags(self) -> None:
        with mock.patch.object(nsfw_classifier, "nsfw_probabilities", return_value=[0.1, 0.9]):
            result = moderation.screen_frames_local([np.zeros((2, 2, 3), np.uint8)] * 2)
        self.assertTrue(result.flagged)
        self.assertEqual(result.labels, ["NSFW"])

    def test_below_threshold_passes(self) -> None:
        with mock.patch.object(nsfw_classifier, "nsfw_probabilities", return_value=[0.84, 0.7]):
            result = moderation.screen_frames_local([np.zeros((2, 2, 3), np.uint8)] * 2)
        self.assertFalse(result.flagged)
        self.assertEqual(result.labels, [])


if __name__ == "__main__":
    unittest.main()
