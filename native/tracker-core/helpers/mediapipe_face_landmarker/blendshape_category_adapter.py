"""Converts one face's MediaPipe-style Category sequence into blendshape scores.

This module is dependency-free and must not import MediaPipe. It accepts only
a single per-face sequence of Category-like objects (``index``, ``score``,
``display_name``, ``category_name``); selecting a face from the outer
``FaceLandmarkerResult.face_blendshapes`` list is out of scope for this slice.

Only ``category_name`` and ``score`` are read. ``display_name`` and ``index``
are never used as a fallback for identity.
"""

from __future__ import annotations

import math
from typing import Protocol, Sequence


class BlendshapeCategoryLike(Protocol):
    category_name: str | None
    score: float | None


MAX_BLENDSHAPE_CATEGORY_COUNT = 64

_EXPRESSION_BLENDSHAPE_NAMES = (
    "eyeBlinkLeft",
    "eyeBlinkRight",
    "jawOpen",
    "mouthSmileLeft",
    "mouthSmileRight",
)

_REQUIRED_NAMES = frozenset(_EXPRESSION_BLENDSHAPE_NAMES)


def extract_expression_blendshape_scores(
    categories: Sequence[BlendshapeCategoryLike],
) -> dict[str, float] | None:
    """Extracts required expression blendshape scores from one face's categories.

    Returns None if `categories` is malformed, over-limit, unsafe, or
    ambiguous (for example: not a bounded sequence, an over-limit item count,
    a non-str/non-None `category_name`, a duplicated required category name,
    or a required `score` that is missing, non-numeric, or non-finite).

    Returns an empty dict for a valid sequence that contains no required
    category names. Otherwise returns a newly allocated dict containing at
    most the five required keys, always ordered by
    `_EXPRESSION_BLENDSHAPE_NAMES` regardless of input order. Finite score
    values are preserved exactly; no clamping is performed here.
    """
    if categories is None:
        return None
    if isinstance(categories, (str, bytes, bytearray)):
        return None

    try:
        reported_length = len(categories)
        if reported_length > MAX_BLENDSHAPE_CATEGORY_COUNT:
            return None

        collected: dict[str, float] = {}

        for index, category in enumerate(categories):
            if index >= MAX_BLENDSHAPE_CATEGORY_COUNT:
                return None

            name = category.category_name
            if name is None:
                continue
            if not isinstance(name, str):
                return None
            if name not in _REQUIRED_NAMES:
                continue
            if name in collected:
                return None

            score = category.score
            if isinstance(score, bool) or not isinstance(score, (int, float)):
                return None

            value = float(score)
            if not math.isfinite(value):
                return None

            collected[name] = value
    except Exception:
        return None

    return {
        name: collected[name]
        for name in _EXPRESSION_BLENDSHAPE_NAMES
        if name in collected
    }
