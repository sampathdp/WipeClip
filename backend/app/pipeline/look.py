"""Clip color grading for the editor export. MUST stay identical to
src/lib/editor/look.ts on the frontend: the browser previews these exact
formulas as an SVG filter, and here they're baked into a 3D LUT (.cube) so
ffmpeg's lut3d applies the whole grade - filter preset at its intensity,
then the user's adjustments - in one pass.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

IDENTITY_M = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)


def saturation_matrix(s: float) -> tuple[float, ...]:
    lr, lg, lb = 0.2126 * (1 - s), 0.7152 * (1 - s), 0.0722 * (1 - s)
    return (lr + s, lg, lb, lr, lg + s, lb, lr, lg, lb + s)


SEPIA = (0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131)


def _mix_m(a, b, k: float) -> tuple[float, ...]:
    return tuple(x + (y - x) * k for x, y in zip(a, b))


@dataclass
class Transfer:
    gain: tuple[float, float, float] = (1.0, 1.0, 1.0)
    exposure: float = 0.0
    contrast: float = 1.0
    brightness: float = 0.0
    shadows: float = 0.0
    highlights: float = 0.0
    lift: float = 0.0


FILTERS: dict[str, tuple[dict, tuple[float, ...]]] = {
    "original": ({}, IDENTITY_M),
    "cinematic": (
        {"contrast": 1.18, "brightness": -0.02, "gain": (1.03, 1, 0.95), "shadows": -0.15, "highlights": -0.1, "lift": 0.02},
        saturation_matrix(0.85),
    ),
    "warm": ({"gain": (1.1, 1.02, 0.86)}, saturation_matrix(1.08)),
    "cool": ({"gain": (0.88, 1, 1.12)}, saturation_matrix(0.95)),
    "vintage": ({"contrast": 0.88, "lift": 0.08, "gain": (1.05, 1, 0.9)}, _mix_m(IDENTITY_M, SEPIA, 0.6)),
    "bw": ({"contrast": 1.1}, saturation_matrix(0)),
    "vibrant": ({"contrast": 1.06}, saturation_matrix(1.5)),
    "dramatic": ({"contrast": 1.4, "shadows": -0.25, "highlights": -0.2, "brightness": -0.03}, saturation_matrix(0.8)),
    "soft": ({"contrast": 0.85, "lift": 0.05, "highlights": -0.15}, saturation_matrix(0.92)),
    "fade": ({"contrast": 0.82, "lift": 0.14}, saturation_matrix(0.75)),
}


def _lerp_t(t: dict, k: float) -> Transfer:
    ident = Transfer()
    g = t.get("gain", ident.gain)
    out = Transfer(gain=tuple(1 + (x - 1) * k for x in g))  # type: ignore[arg-type]
    for key in ("exposure", "contrast", "brightness", "shadows", "highlights", "lift"):
        base = getattr(ident, key)
        setattr(out, key, base + (t.get(key, base) - base) * k)
    return out


def _adjust_transfer(a: dict) -> Transfer:
    return Transfer(
        gain=(1 + 0.15 * a["temperature"] / 100, 1 - 0.12 * a["tint"] / 100, 1 - 0.15 * a["temperature"] / 100),
        exposure=a["exposure"] / 100 * 1.5,
        contrast=1 + a["contrast"] / 100 * 0.6,
        brightness=a["brightness"] / 100 * 0.3,
        shadows=a["shadows"] / 100,
        highlights=a["highlights"] / 100,
        lift=0.0,
    )


def grade_stages(filter_id: str, intensity: float, adjust: dict) -> list[tuple[Transfer, tuple[float, ...]]]:
    t, m = FILTERS[filter_id]
    k = max(0.0, min(1.0, intensity / 100))
    return [
        (_lerp_t(t, k), _mix_m(IDENTITY_M, m, k)),
        (_adjust_transfer(adjust), saturation_matrix(1 + adjust["saturation"] / 100)),
    ]


def is_neutral_color(filter_id: str, intensity: float, adjust: dict) -> bool:
    keys = ("brightness", "contrast", "saturation", "exposure", "temperature", "tint", "highlights", "shadows")
    return (filter_id == "original" or intensity == 0) and not any(adjust[k] for k in keys)


def _apply_transfer(t: Transfer, v: np.ndarray, c: int) -> np.ndarray:
    v1 = v * t.gain[c] * (2.0**t.exposure)
    v2 = (v1 - 0.5) * t.contrast + 0.5 + t.brightness
    v2c = np.clip(v2, 0, 1)
    v3 = v2 + 0.25 * (t.shadows * (1 - v2c) ** 2 + t.highlights * v2c**2)
    return np.clip(t.lift + v3 * (1 - t.lift), 0, 1)


def sample_lut(size: int, data: list[float], rgb: np.ndarray) -> np.ndarray:
    """Trilinear lookup of 3 x N colors in a size^3 LUT (red fastest) -
    sampleLut() in src/lib/editor/lut.ts, and the GPU's filtering."""
    lut = np.asarray(data, dtype=np.float64).reshape(size, size, size, 3)  # [b][g][r]
    f = np.clip(rgb, 0, 1) * (size - 1)
    i0 = np.minimum(np.floor(f).astype(int), size - 2)
    t = f - i0
    out = np.zeros_like(rgb)
    for dr in (0, 1):
        for dg in (0, 1):
            for db in (0, 1):
                w = (t[0] if dr else 1 - t[0]) * (t[1] if dg else 1 - t[1]) * (t[2] if db else 1 - t[2])
                out += w * lut[i0[2] + db, i0[1] + dg, i0[0] + dr].T
    return out


def write_cube(
    path: str,
    stages: list[tuple[Transfer, tuple[float, ...]]],
    size: int = 33,
    curve: list[list[float]] | None = None,
    lut: tuple[int, list[float], float] | None = None,
) -> None:
    """Bakes the grade into a .cube 3D LUT (red varies fastest, as the
    format requires): an imported LUT first (mixed in by its intensity),
    then the filter and adjustment stages, then the curves - the preview's
    order (WebGL LUT, then the SVG grade filter)."""
    axis = np.linspace(0.0, 1.0, size)
    b, g, r = np.meshgrid(axis, axis, axis, indexing="ij")
    rgb = np.stack([r.ravel(), g.ravel(), b.ravel()])  # 3 x N, red fastest
    if lut:
        lut_size, data, intensity = lut
        k = max(0.0, min(1.0, intensity / 100))
        rgb = rgb + (sample_lut(lut_size, data, rgb) - rgb) * k
    for t, m in stages:
        rgb = np.stack([_apply_transfer(t, rgb[c], c) for c in range(3)])
        rgb = np.clip(np.array(m, dtype=np.float64).reshape(3, 3) @ rgb, 0, 1)
    if curve:
        rgb = np.stack([np.interp(rgb[c], np.linspace(0.0, 1.0, len(curve[c])), curve[c]) for c in range(3)])
    with open(path, "w", encoding="ascii") as f:
        f.write(f"LUT_3D_SIZE {size}\n")
        np.savetxt(f, rgb.T, fmt="%.6f")
