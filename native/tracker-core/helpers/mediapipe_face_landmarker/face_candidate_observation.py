"""Composes a classified FaceCandidateSelection into a face observation.

This module is dependency-free and must not import MediaPipe or NumPy. It
accepts only a `FaceCandidateSelection` produced by
`face_result_selection.select_single_face_candidate`; it never accepts a raw
FaceLandmarkerResult-like object or a bare `SelectedFaceCandidate`, and it
never calls `select_single_face_candidate` itself.

Composition delegates entirely to existing boundaries:
`blendshape_category_adapter.py` and `expression_mapping.py` own expression
extraction and mapping; `facial_transform_matrix_adapter.py` owns structural
payload adaptation (including the measured MediaPipe ndarray-like route);
`matrix_mapping.py` and `rotation_mapping.py` own matrix validation and Euler
conversion. This module does not duplicate or weaken any of that validation.

All-or-nothing policy: a SINGLE_FACE selection becomes VALID_FACE only if
both the expression and rotation pipelines succeed. Any inner failure, any
inconsistent selection (a status/`selected_face` pairing that could not have
come from `select_single_face_candidate`), or an unrecognized status
produces a MALFORMED observation with both payloads set to None. No partial
or stale payload is ever attached to a non-valid observation.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from blendshape_category_adapter import extract_expression_blendshape_scores
from expression_mapping import ExpressionValues, map_blendshape_scores
from face_result_selection import (
    FaceCandidateSelection,
    FaceCandidateSelectionStatus,
    SelectedFaceCandidate,
)
from facial_transform_matrix_adapter import adapt_facial_transform_matrix_payload
from matrix_mapping import normalize_facial_transform_matrix
from rotation_mapping import (
    FaceRotationValues,
    map_normalized_rotation_to_face_rotation,
)


class FaceCandidateObservationStatus(Enum):
    NO_FACE = "no_face"
    VALID_FACE = "valid_face"
    MULTIPLE_FACES = "multiple_faces"
    MALFORMED = "malformed"


@dataclass(frozen=True)
class FaceCandidateObservation:
    status: FaceCandidateObservationStatus
    face_rotation: FaceRotationValues | None
    expressions: ExpressionValues | None


def compose_face_candidate_observation(
    selection: FaceCandidateSelection,
) -> FaceCandidateObservation:
    """Composes a FaceCandidateSelection into a complete face observation.

    Accepts only a `FaceCandidateSelection`; None or any other input type is
    rejected as MALFORMED. Validates that `selection.selected_face` is
    consistent with `selection.status` (None for NO_FACE, MULTIPLE_FACES,
    and MALFORMED; an actual `SelectedFaceCandidate` for SINGLE_FACE) and
    returns MALFORMED for any inconsistent or unrecognized status.

    For a valid SINGLE_FACE selection, runs the expression and rotation
    pipelines in sequence and returns VALID_FACE only if both succeed.
    Never returns one payload without the other; any inner failure returns
    MALFORMED with both payloads set to None.
    """
    if not isinstance(selection, FaceCandidateSelection):
        return _malformed_observation()

    status = selection.status
    selected_face = selection.selected_face

    if status == FaceCandidateSelectionStatus.NO_FACE:
        if selected_face is not None:
            return _malformed_observation()
        return FaceCandidateObservation(
            FaceCandidateObservationStatus.NO_FACE, None, None
        )

    if status == FaceCandidateSelectionStatus.MULTIPLE_FACES:
        if selected_face is not None:
            return _malformed_observation()
        return FaceCandidateObservation(
            FaceCandidateObservationStatus.MULTIPLE_FACES, None, None
        )

    if status == FaceCandidateSelectionStatus.MALFORMED:
        return _malformed_observation()

    if status == FaceCandidateSelectionStatus.SINGLE_FACE:
        if not isinstance(selected_face, SelectedFaceCandidate):
            return _malformed_observation()
        return _compose_single_face(selected_face)

    return _malformed_observation()


def _compose_single_face(
    selected_face: SelectedFaceCandidate,
) -> FaceCandidateObservation:
    try:
        scores = extract_expression_blendshape_scores(
            selected_face.blendshape_categories
        )
    except Exception:
        return _malformed_observation()
    if scores is None:
        return _malformed_observation()

    adapted_matrix = adapt_facial_transform_matrix_payload(
        selected_face.facial_transformation_matrix
    )
    if adapted_matrix is None:
        return _malformed_observation()

    normalized_matrix = normalize_facial_transform_matrix(adapted_matrix)
    if normalized_matrix is None:
        return _malformed_observation()

    expressions = map_blendshape_scores(scores)
    face_rotation = map_normalized_rotation_to_face_rotation(normalized_matrix)

    return FaceCandidateObservation(
        FaceCandidateObservationStatus.VALID_FACE, face_rotation, expressions
    )


def _malformed_observation() -> FaceCandidateObservation:
    return FaceCandidateObservation(FaceCandidateObservationStatus.MALFORMED, None, None)
