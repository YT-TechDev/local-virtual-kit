"""Adapts a MediaPipe-style facial transform matrix payload into a plain tuple.

This module is dependency-free and must not import MediaPipe or NumPy. It
accepts either an already-plain nested sequence of 4x4 numbers or the
measured MediaPipe ndarray-like runtime shape (a `shape`/`ndim`/`tolist`
structural contract), and converts either route into the same detached,
immutable `PlainFacialTransformMatrix` tuple-of-tuples shape.

This module owns only structural adaptation: distinguishing an already-plain
nested sequence from the measured ndarray-like runtime route, exact 4x4
container bounds, the standard `tolist()` conversion for the measured
runtime route, and detached built-in float conversion. It does not own
finite validation, affine/rotation/scale/orthogonality/determinant
validation, or matrix repair; `matrix_mapping.py` remains the sole owner of
those guarantees.
"""

from __future__ import annotations

from collections.abc import Sequence as SequenceABC
from typing import TypeAlias

FacialTransformMatrixRow: TypeAlias = tuple[
    float,
    float,
    float,
    float,
]

PlainFacialTransformMatrix: TypeAlias = tuple[
    FacialTransformMatrixRow,
    FacialTransformMatrixRow,
    FacialTransformMatrixRow,
    FacialTransformMatrixRow,
]

_MATRIX_SIZE = 4


def adapt_facial_transform_matrix_payload(
    payload: object,
) -> PlainFacialTransformMatrix | None:
    """Adapts `payload` into a detached, immutable 4x4 plain float matrix.

    Accepts an already-plain nested sequence of 4x4 built-in numbers, or a
    measured ndarray-like object exposing `shape`, `ndim`, and a callable
    `tolist()`. Returns None for any malformed input in either route, and
    never raises for ordinary malformed-input failures. Does not validate
    finiteness or geometry; that remains the responsibility of
    `matrix_mapping.normalize_facial_transform_matrix`.
    """
    if _is_bounded_sequence(payload):
        return _adapt_plain_sequence(payload)
    return _adapt_ndarray_like(payload)


def _is_bounded_sequence(value: object) -> bool:
    """True only for a `collections.abc.Sequence`, excluding str/bytes/bytearray."""
    if isinstance(value, (str, bytes, bytearray)):
        return False
    return isinstance(value, SequenceABC)


def _is_plain_number(value: object) -> bool:
    """True only for a built-in `int` or `float`, excluding `bool`."""
    if isinstance(value, bool):
        return False
    return isinstance(value, (int, float))


def _adapt_plain_sequence(
    payload: SequenceABC,
) -> PlainFacialTransformMatrix | None:
    try:
        if len(payload) != _MATRIX_SIZE:
            return None

        rows: list[FacialTransformMatrixRow] = []
        for row in payload:
            if not _is_bounded_sequence(row):
                return None
            if len(row) != _MATRIX_SIZE:
                return None

            scalars: list[float] = []
            for scalar in row:
                if not _is_plain_number(scalar):
                    return None
                scalars.append(float(scalar))
            rows.append((scalars[0], scalars[1], scalars[2], scalars[3]))

        return (rows[0], rows[1], rows[2], rows[3])
    except Exception:
        return None


def _adapt_ndarray_like(payload: object) -> PlainFacialTransformMatrix | None:
    try:
        shape = payload.shape
    except Exception:
        return None

    if not _is_valid_matrix_shape(shape):
        return None

    try:
        ndim = payload.ndim
    except Exception:
        return None

    if isinstance(ndim, bool) or not isinstance(ndim, int) or ndim != 2:
        return None

    try:
        tolist = getattr(payload, "tolist", None)
    except Exception:
        return None

    if not callable(tolist):
        return None

    try:
        converted = tolist()
    except Exception:
        return None

    return _adapt_tolist_result(converted)


def _is_valid_matrix_shape(shape: object) -> bool:
    try:
        if len(shape) != 2:
            return False
        rows, cols = shape[0], shape[1]
    except Exception:
        return False

    for dimension in (rows, cols):
        if isinstance(dimension, bool) or not isinstance(dimension, int):
            return False

    return rows == _MATRIX_SIZE and cols == _MATRIX_SIZE


def _adapt_tolist_result(converted: object) -> PlainFacialTransformMatrix | None:
    try:
        if not isinstance(converted, list) or len(converted) != _MATRIX_SIZE:
            return None

        rows: list[FacialTransformMatrixRow] = []
        for row in converted:
            if not isinstance(row, list) or len(row) != _MATRIX_SIZE:
                return None

            scalars: list[float] = []
            for scalar in row:
                if not _is_plain_number(scalar):
                    return None
                scalars.append(float(scalar))
            rows.append((scalars[0], scalars[1], scalars[2], scalars[3]))

        return (rows[0], rows[1], rows[2], rows[3])
    except Exception:
        return None
