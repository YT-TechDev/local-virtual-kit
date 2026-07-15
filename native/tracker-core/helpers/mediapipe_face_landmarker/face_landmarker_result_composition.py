"""Composes a validated #552 inference outcome into a tracking payload.

This module owns orchestration only. It strictly revalidates the closed
`FaceLandmarkerInferenceOutcome` shape and status/result/timing consistency,
then reuses the existing three-stage pipeline -- `select_single_face_candidate`,
`compose_face_candidate_observation`, `assemble_helper_tracking_payload` --
without duplicating or weakening any of their mapping, validation, or
canonical LOST contracts.

A bounded non-success inference outcome (`RUNTIME_UNAVAILABLE`,
`IMAGE_ADAPTATION_FAILED`, `DETECTION_FAILED`) is mapped through the same
pipeline using a call-scoped empty candidate-result surface, so it produces
exactly the existing canonical no-face LOST payload rather than a directly
constructed one.

An invalid outcome, or a pipeline stage returning an inconsistent or
unrecognized object, is an internal composition failure and returns `None`.
It is never silently converted into a fabricated LOST payload. Unexpected
programming exceptions raised by the three pipeline calls are not caught
here and remain visible to the caller.

The returned `FaceLandmarkerResultComposition` retains no raw candidate
result, selection, or observation; it is directly usable as input to
`helper_result_json.serialize_helper_result_line`, which this module never
calls itself.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from face_landmarker_inference import (
    FaceLandmarkerInferenceOutcome,
    FaceLandmarkerInferenceStatus,
)
from face_result_selection import (
    FaceCandidateSelection,
    FaceCandidateSelectionStatus,
    SelectedFaceCandidate,
    select_single_face_candidate,
)
from face_candidate_observation import (
    FaceCandidateObservation,
    FaceCandidateObservationStatus,
    compose_face_candidate_observation,
)
from helper_tracking_payload import (
    HelperTrackingPayload,
    HelperTrackingPayloadStatus,
    assemble_helper_tracking_payload,
)
from helper_result_json import HelperFrameAck

_INT64_MIN = -(1 << 63)
_INT64_MAX = (1 << 63) - 1
_UINT32_MAX = (1 << 32) - 1

_MIN_PAYLOAD_BYTES = 3
_MAX_PAYLOAD_BYTES = 32 * 1024 * 1024

_ZERO_TIMING_STATUSES = (
    FaceLandmarkerInferenceStatus.RUNTIME_UNAVAILABLE,
    FaceLandmarkerInferenceStatus.IMAGE_ADAPTATION_FAILED,
)

_VALID_INFERENCE_STATUSES = (
    FaceLandmarkerInferenceStatus.SUCCESS,
    FaceLandmarkerInferenceStatus.RUNTIME_UNAVAILABLE,
    FaceLandmarkerInferenceStatus.IMAGE_ADAPTATION_FAILED,
    FaceLandmarkerInferenceStatus.DETECTION_FAILED,
)


@dataclass(frozen=True)
class FaceLandmarkerResultComposition:
    request_id: int
    frame_timestamp_ms: int
    inference_ms: float
    frame_ack: HelperFrameAck
    payload: HelperTrackingPayload


@dataclass(frozen=True)
class _EmptyFaceLandmarkerCandidateResult:
    """Canonical no-face candidate surface for a bounded inference failure."""

    face_landmarks: tuple[object, ...] = ()
    face_blendshapes: tuple[object, ...] = ()
    facial_transformation_matrixes: tuple[object, ...] = ()


def compose_face_landmarker_inference_outcome(
    outcome: FaceLandmarkerInferenceOutcome,
) -> FaceLandmarkerResultComposition | None:
    """Composes one validated #552 outcome into a serializer-ready payload.

    Strictly validates `outcome`, then calls exactly once and in order:
    `select_single_face_candidate`, `compose_face_candidate_observation`,
    `assemble_helper_tracking_payload`. Returns `None` for an invalid
    outcome or an inconsistent stage return value, without fabricating a
    LOST payload. Unexpected exceptions raised by the pipeline calls
    propagate to the caller.
    """
    if not _is_valid_outcome(outcome):
        return None

    if outcome.status is FaceLandmarkerInferenceStatus.SUCCESS:
        candidate_source = outcome.candidate_result
    else:
        candidate_source = _EmptyFaceLandmarkerCandidateResult()

    selection = select_single_face_candidate(candidate_source)
    if not _is_valid_selection(selection):
        return None

    observation = compose_face_candidate_observation(selection)
    if not _is_valid_observation(observation, selection):
        return None

    payload = assemble_helper_tracking_payload(observation)
    if not _is_valid_payload(payload, observation):
        return None

    frame_ack = HelperFrameAck(
        sequence=outcome.request_id,
        payload_bytes=outcome.payload_bytes,
        checksum=outcome.source_checksum,
    )

    return FaceLandmarkerResultComposition(
        request_id=outcome.request_id,
        frame_timestamp_ms=outcome.frame_timestamp_ms,
        inference_ms=outcome.inference_ms,
        frame_ack=frame_ack,
        payload=payload,
    )


def _is_valid_outcome(outcome: object) -> bool:
    if type(outcome) is not FaceLandmarkerInferenceOutcome:
        return False

    status = outcome.status
    if type(status) is not FaceLandmarkerInferenceStatus:
        return False
    if status not in _VALID_INFERENCE_STATUSES:
        return False

    request_id = outcome.request_id
    if type(request_id) is not int:
        return False
    if not (1 <= request_id <= _INT64_MAX):
        return False

    frame_timestamp_ms = outcome.frame_timestamp_ms
    if type(frame_timestamp_ms) is not int:
        return False
    if not (_INT64_MIN <= frame_timestamp_ms <= _INT64_MAX):
        return False

    payload_bytes = outcome.payload_bytes
    if type(payload_bytes) is not int:
        return False
    if not (_MIN_PAYLOAD_BYTES <= payload_bytes <= _MAX_PAYLOAD_BYTES):
        return False
    if payload_bytes % 3 != 0:
        return False

    source_checksum = outcome.source_checksum
    if type(source_checksum) is not int:
        return False
    if not (0 <= source_checksum <= _UINT32_MAX):
        return False

    inference_ms = outcome.inference_ms
    if type(inference_ms) is not float:
        return False
    if not math.isfinite(inference_ms):
        return False
    if inference_ms < 0.0:
        return False

    candidate_result = outcome.candidate_result

    if status is FaceLandmarkerInferenceStatus.SUCCESS:
        if candidate_result is None:
            return False
    else:
        if candidate_result is not None:
            return False
        if status in _ZERO_TIMING_STATUSES and inference_ms != 0.0:
            return False

    return True


def _is_valid_selection(selection: object) -> bool:
    if type(selection) is not FaceCandidateSelection:
        return False

    status = selection.status
    if type(status) is not FaceCandidateSelectionStatus:
        return False

    selected_face = selection.selected_face

    if status is FaceCandidateSelectionStatus.SINGLE_FACE:
        return type(selected_face) is SelectedFaceCandidate

    if status in (
        FaceCandidateSelectionStatus.NO_FACE,
        FaceCandidateSelectionStatus.MULTIPLE_FACES,
        FaceCandidateSelectionStatus.MALFORMED,
    ):
        return selected_face is None

    return False


def _is_valid_observation(
    observation: object, selection: FaceCandidateSelection
) -> bool:
    if type(observation) is not FaceCandidateObservation:
        return False

    status = observation.status
    if type(status) is not FaceCandidateObservationStatus:
        return False

    face_rotation = observation.face_rotation
    expressions = observation.expressions
    selection_status = selection.status

    if selection_status is FaceCandidateSelectionStatus.NO_FACE:
        if status is not FaceCandidateObservationStatus.NO_FACE:
            return False
        return face_rotation is None and expressions is None

    if selection_status is FaceCandidateSelectionStatus.MULTIPLE_FACES:
        if status is not FaceCandidateObservationStatus.MULTIPLE_FACES:
            return False
        return face_rotation is None and expressions is None

    if selection_status is FaceCandidateSelectionStatus.MALFORMED:
        if status is not FaceCandidateObservationStatus.MALFORMED:
            return False
        return face_rotation is None and expressions is None

    if selection_status is FaceCandidateSelectionStatus.SINGLE_FACE:
        if status is FaceCandidateObservationStatus.VALID_FACE:
            return face_rotation is not None and expressions is not None
        if status is FaceCandidateObservationStatus.MALFORMED:
            return face_rotation is None and expressions is None
        return False

    return False


def _is_valid_payload(
    payload: object, observation: FaceCandidateObservation
) -> bool:
    if type(payload) is not HelperTrackingPayload:
        return False

    status = payload.status
    if type(status) is not HelperTrackingPayloadStatus:
        return False

    observation_status = observation.status

    if observation_status is FaceCandidateObservationStatus.VALID_FACE:
        return status is HelperTrackingPayloadStatus.TRACKING

    if observation_status in (
        FaceCandidateObservationStatus.NO_FACE,
        FaceCandidateObservationStatus.MULTIPLE_FACES,
        FaceCandidateObservationStatus.MALFORMED,
    ):
        return status is HelperTrackingPayloadStatus.LOST

    return False
