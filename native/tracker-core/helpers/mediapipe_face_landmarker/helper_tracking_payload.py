"""Assembles the Native Core tracking-value payload from a face observation.

This module is dependency-free and must not import MediaPipe or NumPy. It
consumes only a `FaceCandidateObservation` produced by
`face_candidate_observation.compose_face_candidate_observation` and owns
only the tracking-value payload (status, confidence, face rotation, eyes,
mouth). It does not own transport metadata, diagnostics, lifecycle, JSON
serialization, or request/result correlation.

Tracking confidence is a fixed, explicitly documented presence-based
surrogate: 1.0 for a complete valid single-face observation, 0.0 for any
non-tracking status. No finer confidence precision is claimed.

An inconsistent or numerically unsafe internal object (a status/payload
mismatch, a wrong nested payload type, or an out-of-range/non-finite
numeric field) returns None rather than being coerced into a safe payload,
so a programming/contract error is not silently hidden as LOST.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum

from expression_mapping import ExpressionValues
from face_candidate_observation import (
    FaceCandidateObservation,
    FaceCandidateObservationStatus,
)
from rotation_mapping import FaceRotationValues

_ROTATION_MIN = -1.0
_ROTATION_MAX = 1.0
_NORMALIZED_MIN = 0.0
_NORMALIZED_MAX = 1.0

_LOST_OBSERVATION_STATUSES = (
    FaceCandidateObservationStatus.NO_FACE,
    FaceCandidateObservationStatus.MULTIPLE_FACES,
    FaceCandidateObservationStatus.MALFORMED,
)


class HelperTrackingPayloadStatus(Enum):
    TRACKING = "tracking"
    LOST = "lost"


@dataclass(frozen=True)
class HelperFaceRotationPayload:
    pitch: float
    yaw: float
    roll: float


@dataclass(frozen=True)
class HelperEyePayload:
    left_open: float
    right_open: float


@dataclass(frozen=True)
class HelperMouthPayload:
    open: float
    smile: float


@dataclass(frozen=True)
class HelperTrackingPayload:
    status: HelperTrackingPayloadStatus
    confidence: float
    face_rotation: HelperFaceRotationPayload
    eyes: HelperEyePayload
    mouth: HelperMouthPayload


_LOST_PAYLOAD = HelperTrackingPayload(
    status=HelperTrackingPayloadStatus.LOST,
    confidence=0.0,
    face_rotation=HelperFaceRotationPayload(pitch=0.0, yaw=0.0, roll=0.0),
    eyes=HelperEyePayload(left_open=1.0, right_open=1.0),
    mouth=HelperMouthPayload(open=0.0, smile=0.0),
)


def assemble_helper_tracking_payload(
    observation: FaceCandidateObservation,
) -> HelperTrackingPayload | None:
    """Converts a FaceCandidateObservation into a HelperTrackingPayload.

    Requires `type(observation) is FaceCandidateObservation` exactly
    (subclasses and unrelated objects are rejected). VALID_FACE requires an
    exact `FaceRotationValues` and an exact `ExpressionValues` payload, with
    every copied numeric field a finite built-in `int`/`float` within its
    required range; on success this returns TRACKING with confidence fixed
    at 1.0. NO_FACE, MULTIPLE_FACES, and MALFORMED require no attached
    payload and return a complete neutral LOST payload with confidence
    fixed at 0.0. Any other inconsistency -- an unknown status, a
    status/payload mismatch, a wrong nested payload type, or an unsafe
    numeric value -- returns None.
    """
    if type(observation) is not FaceCandidateObservation:
        return None

    status = observation.status
    face_rotation = observation.face_rotation
    expressions = observation.expressions

    if status == FaceCandidateObservationStatus.VALID_FACE:
        return _assemble_tracking_payload(face_rotation, expressions)

    if status in _LOST_OBSERVATION_STATUSES:
        if face_rotation is not None or expressions is not None:
            return None
        return _LOST_PAYLOAD

    return None


def _assemble_tracking_payload(
    face_rotation: object, expressions: object
) -> HelperTrackingPayload | None:
    if type(face_rotation) is not FaceRotationValues:
        return None
    if type(expressions) is not ExpressionValues:
        return None

    pitch = _validate_number(face_rotation.pitch, _ROTATION_MIN, _ROTATION_MAX)
    yaw = _validate_number(face_rotation.yaw, _ROTATION_MIN, _ROTATION_MAX)
    roll = _validate_number(face_rotation.roll, _ROTATION_MIN, _ROTATION_MAX)
    left_eye_open = _validate_number(
        expressions.left_eye_open, _NORMALIZED_MIN, _NORMALIZED_MAX
    )
    right_eye_open = _validate_number(
        expressions.right_eye_open, _NORMALIZED_MIN, _NORMALIZED_MAX
    )
    mouth_open = _validate_number(
        expressions.mouth_open, _NORMALIZED_MIN, _NORMALIZED_MAX
    )
    mouth_smile = _validate_number(
        expressions.mouth_smile, _NORMALIZED_MIN, _NORMALIZED_MAX
    )

    if any(
        value is None
        for value in (
            pitch,
            yaw,
            roll,
            left_eye_open,
            right_eye_open,
            mouth_open,
            mouth_smile,
        )
    ):
        return None

    return HelperTrackingPayload(
        status=HelperTrackingPayloadStatus.TRACKING,
        confidence=1.0,
        face_rotation=HelperFaceRotationPayload(pitch=pitch, yaw=yaw, roll=roll),
        eyes=HelperEyePayload(left_open=left_eye_open, right_open=right_eye_open),
        mouth=HelperMouthPayload(open=mouth_open, smile=mouth_smile),
    )


def _validate_number(value: object, minimum: float, maximum: float) -> float | None:
    """Accepts only an exact built-in int/float, finite and within range."""
    if type(value) is not int and type(value) is not float:
        return None

    as_float = float(value)
    if not math.isfinite(as_float):
        return None
    if as_float < minimum or as_float > maximum:
        return None

    return as_float
