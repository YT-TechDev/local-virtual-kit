"""Validates and normalizes MediaPipe-style 4x4 facial transform matrices.

This module is dependency-free and must not import MediaPipe or NumPy. It
only consumes plain nested sequences of numbers; parsing MediaPipe transform
objects or any Euler/pitch-yaw-roll decomposition is out of scope for this
slice.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

MATRIX_TOLERANCE = 1e-5


@dataclass(frozen=True)
class NormalizedRotationMatrix:
    rows: tuple[
        tuple[float, float, float],
        tuple[float, float, float],
        tuple[float, float, float],
    ]


def normalize_facial_transform_matrix(
    matrix: Sequence[Sequence[float]],
) -> NormalizedRotationMatrix | None:
    """Validates a 4x4 affine matrix and returns its normalized 3x3 rotation.

    Returns None for any input that is malformed, non-finite, sheared,
    reflected, non-uniformly scaled, or otherwise not a valid uniform-scale
    rotation-plus-translation transform. Never raises for such inputs.
    """
    values = _extract_finite_4x4(matrix)
    if values is None:
        return None

    if not _has_valid_affine_row(values):
        return None

    columns = [
        (values[0][col], values[1][col], values[2][col]) for col in range(3)
    ]

    scale = _uniform_scale(columns)
    if scale is None:
        return None

    normalized_columns = [
        (col[0] / scale, col[1] / scale, col[2] / scale) for col in columns
    ]

    if not _columns_are_unit_length(normalized_columns):
        return None

    if not _columns_are_orthogonal(normalized_columns):
        return None

    if not _determinant_is_one(normalized_columns):
        return None

    rows = tuple(
        (
            normalized_columns[0][row],
            normalized_columns[1][row],
            normalized_columns[2][row],
        )
        for row in range(3)
    )
    return NormalizedRotationMatrix(rows=rows)


def _extract_finite_4x4(
    matrix: Sequence[Sequence[float]],
) -> list[list[float]] | None:
    """Copies `matrix` into a 4x4 list of finite floats, or None if invalid."""
    try:
        row_count = len(matrix)
    except TypeError:
        return None

    if row_count != 4:
        return None

    values: list[list[float]] = []
    for row in matrix:
        try:
            row_values = list(row)
        except TypeError:
            return None

        if len(row_values) != 4:
            return None

        extracted_row: list[float] = []
        for value in row_values:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return None
            if not math.isfinite(value):
                return None
            extracted_row.append(float(value))
        values.append(extracted_row)

    return values


def _has_valid_affine_row(values: list[list[float]]) -> bool:
    expected = (0.0, 0.0, 0.0, 1.0)
    return all(
        abs(actual - target) <= MATRIX_TOLERANCE
        for actual, target in zip(values[3], expected)
    )


def _uniform_scale(columns: list[tuple[float, float, float]]) -> float | None:
    lengths = [math.sqrt(sum(component * component for component in col)) for col in columns]

    if any(length <= MATRIX_TOLERANCE for length in lengths):
        return None

    reference = lengths[0]
    if any(abs(length - reference) > MATRIX_TOLERANCE for length in lengths[1:]):
        return None

    return reference


def _columns_are_unit_length(columns: list[tuple[float, float, float]]) -> bool:
    for col in columns:
        length = math.sqrt(sum(component * component for component in col))
        if abs(length - 1.0) > MATRIX_TOLERANCE:
            return False
    return True


def _columns_are_orthogonal(columns: list[tuple[float, float, float]]) -> bool:
    pairs = ((0, 1), (0, 2), (1, 2))
    for i, j in pairs:
        dot = sum(a * b for a, b in zip(columns[i], columns[j]))
        if abs(dot) > MATRIX_TOLERANCE:
            return False
    return True


def _determinant_is_one(columns: list[tuple[float, float, float]]) -> bool:
    a, b, c = columns
    determinant = (
        a[0] * (b[1] * c[2] - b[2] * c[1])
        - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])
    )
    return abs(determinant - 1.0) <= MATRIX_TOLERANCE
