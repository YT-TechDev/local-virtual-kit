"""Classifies a MediaPipe-style FaceLandmarkerResult candidate.

This module is dependency-free and must not import MediaPipe or NumPy. It
only inspects the three outer, face-indexed collections on a
FaceLandmarkerResult-like object (`face_landmarks`, `face_blendshapes`,
`facial_transformation_matrixes`) to classify the result as no-face,
single-face, multiple-faces, or malformed.

Selecting among multiple faces is out of scope: `MULTIPLE_FACES` never
selects the first face. Validating inner per-face payload contents
(blendshape categories, transform matrices) is also out of scope; those
responsibilities belong to `blendshape_category_adapter.py`,
`matrix_mapping.py`, and `rotation_mapping.py`.
"""

from __future__ import annotations

from collections.abc import Sequence as SequenceABC
from dataclasses import dataclass
from enum import Enum
from typing import Protocol, Sequence


class FaceLandmarkerCandidateResultLike(Protocol):
    face_landmarks: Sequence[object]
    face_blendshapes: Sequence[object]
    facial_transformation_matrixes: Sequence[object]


class FaceCandidateSelectionStatus(Enum):
    NO_FACE = "no_face"
    SINGLE_FACE = "single_face"
    MULTIPLE_FACES = "multiple_faces"
    MALFORMED = "malformed"


@dataclass(frozen=True)
class SelectedFaceCandidate:
    blendshape_categories: object
    facial_transformation_matrix: object


@dataclass(frozen=True)
class FaceCandidateSelection:
    status: FaceCandidateSelectionStatus
    selected_face: SelectedFaceCandidate | None


def select_single_face_candidate(
    result: FaceLandmarkerCandidateResultLike,
) -> FaceCandidateSelection:
    """Classifies a FaceLandmarkerResult-like object by aligned outer face count.

    Inspects only the three outer collections (`face_landmarks`,
    `face_blendshapes`, `facial_transformation_matrixes`) and their lengths.
    Never selects among multiple faces and never validates inner per-face
    payload contents.

    Returns MALFORMED for a None result; a missing or exception-raising
    outer attribute; an outer value that is not a bounded
    `collections.abc.Sequence` (`str`, `bytes`, and `bytearray` are
    rejected); mismatched outer lengths; or any ordinary
    attribute/len/indexing exception. Returns NO_FACE when all three outer
    lengths are zero, SINGLE_FACE (with `selected_face` set) when they are
    all one, and MULTIPLE_FACES (with `selected_face=None`) when they are
    equal and greater than one.
    """
    if result is None:
        return _malformed()

    try:
        face_landmarks = result.face_landmarks
        face_blendshapes = result.face_blendshapes
        facial_transformation_matrixes = result.facial_transformation_matrixes
    except Exception:
        return _malformed()

    for outer in (face_landmarks, face_blendshapes, facial_transformation_matrixes):
        if not _is_bounded_sequence(outer):
            return _malformed()

    try:
        landmark_count = len(face_landmarks)
        blendshape_count = len(face_blendshapes)
        matrix_count = len(facial_transformation_matrixes)
    except Exception:
        return _malformed()

    if landmark_count != blendshape_count or blendshape_count != matrix_count:
        return _malformed()

    face_count = landmark_count

    if face_count == 0:
        return FaceCandidateSelection(FaceCandidateSelectionStatus.NO_FACE, None)

    if face_count > 1:
        return FaceCandidateSelection(
            FaceCandidateSelectionStatus.MULTIPLE_FACES, None
        )

    try:
        _ = face_landmarks[0]
        blendshape_categories = face_blendshapes[0]
        facial_transformation_matrix = facial_transformation_matrixes[0]
    except Exception:
        return _malformed()

    return FaceCandidateSelection(
        FaceCandidateSelectionStatus.SINGLE_FACE,
        SelectedFaceCandidate(
            blendshape_categories=blendshape_categories,
            facial_transformation_matrix=facial_transformation_matrix,
        ),
    )


def _is_bounded_sequence(value: object) -> bool:
    """True only for a `collections.abc.Sequence`, excluding str/bytes/bytearray."""
    if isinstance(value, (str, bytes, bytearray)):
        return False
    return isinstance(value, SequenceABC)


def _malformed() -> FaceCandidateSelection:
    return FaceCandidateSelection(FaceCandidateSelectionStatus.MALFORMED, None)
