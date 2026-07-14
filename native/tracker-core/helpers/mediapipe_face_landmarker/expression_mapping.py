"""Maps MediaPipe Face Landmarker blendshape scores to LVK expression values.

This module is dependency-free and must not import MediaPipe. It only
consumes plain ``Mapping[str, float]``-shaped blendshape score data; parsing
MediaPipe ``Category`` objects is out of scope for this slice.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True)
class ExpressionValues:
    left_eye_open: float
    right_eye_open: float
    mouth_open: float
    mouth_smile: float


def map_blendshape_scores(scores: Mapping[str, float]) -> ExpressionValues:
    """Converts blendshape scores into bounded, finite LVK expression values."""
    eye_blink_left = _safe_score(scores, "eyeBlinkLeft")
    eye_blink_right = _safe_score(scores, "eyeBlinkRight")
    jaw_open = _safe_score(scores, "jawOpen")
    mouth_smile_left = _safe_score(scores, "mouthSmileLeft")
    mouth_smile_right = _safe_score(scores, "mouthSmileRight")

    return ExpressionValues(
        left_eye_open=_clamp01(1.0 - eye_blink_left),
        right_eye_open=_clamp01(1.0 - eye_blink_right),
        mouth_open=jaw_open,
        mouth_smile=_clamp01((mouth_smile_left + mouth_smile_right) / 2.0),
    )


def _safe_score(scores: Mapping[str, float], name: str) -> float:
    """Looks up a named score, treating anything unsafe as missing (0.0)."""
    if name not in scores:
        return 0.0

    value = scores[name]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    if not math.isfinite(value):
        return 0.0

    return _clamp01(float(value))


def _clamp01(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value
