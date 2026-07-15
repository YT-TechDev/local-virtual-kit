"""Standard-library fake-based tests for face_landmarker_result_composition.py.

Run directly: python -B test_face_landmarker_result_composition.py

These tests use strict fakes and bounded synthetic MediaPipe-like objects
only. They do not import or install real MediaPipe or NumPy and claim only
fake-based outcome-validation, existing-pipeline-orchestration, status
mapping, payload/metadata composition, and ownership/no-I/O evidence: no
real MediaPipe compatibility, model behavior, inference quality, tracking
quality, runtime performance, or camera behavior is proven here.
"""

from __future__ import annotations

import contextlib
import dataclasses
import io
import json
import math
import unittest
from dataclasses import FrozenInstanceError, dataclass
from unittest import mock

import face_candidate_observation
import face_landmarker_result_composition as flrc
import face_result_selection
import helper_tracking_payload
from face_candidate_observation import (
    FaceCandidateObservation,
    FaceCandidateObservationStatus,
)
from face_landmarker_inference import (
    FaceLandmarkerInferenceOutcome,
    FaceLandmarkerInferenceStatus,
)
from face_landmarker_result_composition import (
    FaceLandmarkerResultComposition,
    compose_face_landmarker_inference_outcome,
)
from face_result_selection import (
    FaceCandidateSelection,
    FaceCandidateSelectionStatus,
    SelectedFaceCandidate,
)
from helper_result_json import HelperFrameAck, serialize_helper_result_line
from helper_tracking_payload import (
    HelperEyePayload,
    HelperFaceRotationPayload,
    HelperMouthPayload,
    HelperTrackingPayload,
    HelperTrackingPayloadStatus,
)

_INT64_MIN = -(1 << 63)
_INT64_MAX = (1 << 63) - 1
_UINT32_MAX = (1 << 32) - 1
_MAX_PAYLOAD_BYTES = 32 * 1024 * 1024

_REQUEST_ID = 42
_TIMESTAMP_MS = 1000
_PAYLOAD_BYTES = 12
_CHECKSUM = 999
_INFERENCE_MS = 3.5

_SUCCESS = FaceLandmarkerInferenceStatus.SUCCESS
_RUNTIME_UNAVAILABLE = FaceLandmarkerInferenceStatus.RUNTIME_UNAVAILABLE
_IMAGE_ADAPTATION_FAILED = FaceLandmarkerInferenceStatus.IMAGE_ADAPTATION_FAILED
_DETECTION_FAILED = FaceLandmarkerInferenceStatus.DETECTION_FAILED

_BOUNDED_FAILURE_STATUSES = (
    _RUNTIME_UNAVAILABLE,
    _IMAGE_ADAPTATION_FAILED,
    _DETECTION_FAILED,
)


# =============================================================================
# Fakes and builders
# =============================================================================


@dataclass
class _FakeCandidateResult:
    """Synthetic stand-in for a MediaPipe FaceLandmarkerResult, not imported here."""

    face_landmarks: object
    face_blendshapes: object
    facial_transformation_matrixes: object


@dataclass
class _FakeCategory:
    """Minimal category-like object matching blendshape_category_adapter's Protocol."""

    category_name: str | None
    score: float | None


class _FakeRuntimeMatrix:
    """Minimal ndarray-like fake exposing shape/ndim/tolist, without importing NumPy."""

    def __init__(self, rows: list[list[float]]) -> None:
        self.shape = (4, 4)
        self.ndim = 2
        self._rows = rows

    def tolist(self) -> list[list[float]]:
        return self._rows


def _identity_matrix() -> list[list[float]]:
    return [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


_MALFORMED_MATRIX = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]

_NON_FINITE_MATRIX = _identity_matrix()
_NON_FINITE_MATRIX[0][0] = math.nan


def _full_categories() -> list[_FakeCategory]:
    return [
        _FakeCategory("eyeBlinkLeft", 0.0),
        _FakeCategory("eyeBlinkRight", 0.0),
        _FakeCategory("jawOpen", 0.0),
        _FakeCategory("mouthSmileLeft", 0.0),
        _FakeCategory("mouthSmileRight", 0.0),
    ]


def _partial_categories_missing_right_eye() -> list[_FakeCategory]:
    return [
        _FakeCategory("eyeBlinkLeft", 0.25),
        _FakeCategory("jawOpen", 0.5),
        _FakeCategory("mouthSmileLeft", 0.6),
        _FakeCategory("mouthSmileRight", 0.4),
    ]


def _duplicate_categories() -> list[_FakeCategory]:
    return [
        _FakeCategory("jawOpen", 0.4),
        _FakeCategory("jawOpen", 0.6),
    ]


def _non_finite_score_categories() -> list[_FakeCategory]:
    return [_FakeCategory("jawOpen", math.nan)]


def _single_face_result(categories: object, matrix: object) -> _FakeCandidateResult:
    return _FakeCandidateResult(
        face_landmarks=[object()],
        face_blendshapes=[categories],
        facial_transformation_matrixes=[matrix],
    )


def _no_face_result() -> _FakeCandidateResult:
    return _FakeCandidateResult(face_landmarks=[], face_blendshapes=[], facial_transformation_matrixes=[])


def _multiple_faces_result(count: int = 2) -> _FakeCandidateResult:
    return _FakeCandidateResult(
        face_landmarks=[object() for _ in range(count)],
        face_blendshapes=[object() for _ in range(count)],
        facial_transformation_matrixes=[object() for _ in range(count)],
    )


def _mismatched_length_result() -> _FakeCandidateResult:
    return _FakeCandidateResult(
        face_landmarks=[object()],
        face_blendshapes=[object(), object()],
        facial_transformation_matrixes=[object()],
    )


def _malformed_attribute_result() -> _FakeCandidateResult:
    return _FakeCandidateResult(
        face_landmarks=None, face_blendshapes=[], facial_transformation_matrixes=[]
    )


def _make_outcome(
    *,
    status: FaceLandmarkerInferenceStatus = _SUCCESS,
    request_id: object = _REQUEST_ID,
    frame_timestamp_ms: object = _TIMESTAMP_MS,
    payload_bytes: object = _PAYLOAD_BYTES,
    source_checksum: object = _CHECKSUM,
    inference_ms: object = _INFERENCE_MS,
    candidate_result: object = None,
) -> FaceLandmarkerInferenceOutcome:
    return FaceLandmarkerInferenceOutcome(
        status=status,
        request_id=request_id,
        frame_timestamp_ms=frame_timestamp_ms,
        payload_bytes=payload_bytes,
        source_checksum=source_checksum,
        inference_ms=inference_ms,
        candidate_result=candidate_result,
    )


def _success_outcome(candidate_result: object, **overrides: object) -> FaceLandmarkerInferenceOutcome:
    fields = {"status": _SUCCESS, "candidate_result": candidate_result}
    fields.update(overrides)
    return _make_outcome(**fields)


def _bounded_failure_outcome(
    status: FaceLandmarkerInferenceStatus, inference_ms: float = 0.0, **overrides: object
) -> FaceLandmarkerInferenceOutcome:
    fields = {"status": status, "candidate_result": None, "inference_ms": inference_ms}
    fields.update(overrides)
    return _make_outcome(**fields)


def _assert_canonical_lost(test: unittest.TestCase, payload: HelperTrackingPayload) -> None:
    test.assertEqual(payload.status, HelperTrackingPayloadStatus.LOST)
    test.assertEqual(payload.confidence, 0.0)
    test.assertEqual(payload.face_rotation.pitch, 0.0)
    test.assertEqual(payload.face_rotation.yaw, 0.0)
    test.assertEqual(payload.face_rotation.roll, 0.0)
    test.assertEqual(payload.eyes.left_open, 1.0)
    test.assertEqual(payload.eyes.right_open, 1.0)
    test.assertEqual(payload.mouth.open, 0.0)
    test.assertEqual(payload.mouth.smile, 0.0)


def _patched_pipeline_mocks():
    return (
        mock.patch("face_landmarker_result_composition.select_single_face_candidate"),
        mock.patch("face_landmarker_result_composition.compose_face_candidate_observation"),
        mock.patch("face_landmarker_result_composition.assemble_helper_tracking_payload"),
    )


# =============================================================================
# Output contract
# =============================================================================


class OutputContractTests(unittest.TestCase):
    def test_composition_type_is_exact(self) -> None:
        outcome = _success_outcome(_single_face_result(_full_categories(), _identity_matrix()))
        composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIs(type(composition), FaceLandmarkerResultComposition)

    def test_composition_field_set_is_exact(self) -> None:
        field_names = {field.name for field in dataclasses.fields(FaceLandmarkerResultComposition)}
        self.assertEqual(
            field_names,
            {"request_id", "frame_timestamp_ms", "inference_ms", "frame_ack", "payload"},
        )

    def test_composition_is_frozen(self) -> None:
        outcome = _success_outcome(_single_face_result(_full_categories(), _identity_matrix()))
        composition = compose_face_landmarker_inference_outcome(outcome)
        with self.assertRaises(FrozenInstanceError):
            composition.request_id = 999

    def test_frame_ack_type_is_exact(self) -> None:
        outcome = _success_outcome(_single_face_result(_full_categories(), _identity_matrix()))
        composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIs(type(composition.frame_ack), HelperFrameAck)

    def test_frame_ack_field_set_is_exact(self) -> None:
        field_names = {field.name for field in dataclasses.fields(HelperFrameAck)}
        self.assertEqual(field_names, {"sequence", "payload_bytes", "checksum"})

    def test_exact_metadata_preservation(self) -> None:
        outcome = _success_outcome(
            _single_face_result(_full_categories(), _identity_matrix()),
            request_id=123,
            frame_timestamp_ms=-500,
            payload_bytes=30,
            source_checksum=54321,
            inference_ms=7.25,
        )
        composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertEqual(composition.request_id, 123)
        self.assertEqual(composition.frame_timestamp_ms, -500)
        self.assertEqual(composition.inference_ms, 7.25)
        self.assertEqual(composition.frame_ack.sequence, 123)
        self.assertEqual(composition.frame_ack.payload_bytes, 30)
        self.assertEqual(composition.frame_ack.checksum, 54321)

    def test_frame_ack_sequence_equals_request_id(self) -> None:
        outcome = _success_outcome(
            _single_face_result(_full_categories(), _identity_matrix()), request_id=77
        )
        composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertEqual(composition.frame_ack.sequence, composition.request_id)

    def test_payload_bytes_length_preserved_exactly(self) -> None:
        outcome = _success_outcome(
            _single_face_result(_full_categories(), _identity_matrix()), payload_bytes=21
        )
        composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertEqual(composition.frame_ack.payload_bytes, 21)

    def test_source_checksum_preserved_exactly(self) -> None:
        outcome = _success_outcome(
            _single_face_result(_full_categories(), _identity_matrix()), source_checksum=4242
        )
        composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertEqual(composition.frame_ack.checksum, 4242)

    def test_inference_timing_preserved_as_builtin_float(self) -> None:
        outcome = _success_outcome(
            _single_face_result(_full_categories(), _identity_matrix()), inference_ms=12.75
        )
        composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIs(type(composition.inference_ms), float)
        self.assertEqual(composition.inference_ms, 12.75)

    def test_no_raw_candidate_field(self) -> None:
        field_names = {field.name for field in dataclasses.fields(FaceLandmarkerResultComposition)}
        self.assertNotIn("candidate_result", field_names)

    def test_no_selection_or_observation_or_status_fields(self) -> None:
        field_names = {field.name for field in dataclasses.fields(FaceLandmarkerResultComposition)}
        forbidden = {
            "selection",
            "selected_face",
            "observation",
            "face_rotation",
            "expressions",
            "status",
            "inference_status",
        }
        self.assertTrue(field_names.isdisjoint(forbidden))


# =============================================================================
# Serializer readiness
# =============================================================================


class SerializerReadinessTests(unittest.TestCase):
    def test_tracking_composition_is_serializer_ready(self) -> None:
        outcome = _success_outcome(_single_face_result(_full_categories(), _identity_matrix()))
        composition = compose_face_landmarker_inference_outcome(outcome)
        line = serialize_helper_result_line(
            composition.payload,
            request_id=composition.request_id,
            frame_timestamp_ms=composition.frame_timestamp_ms,
            inference_ms=composition.inference_ms,
            frame_ack=composition.frame_ack,
        )
        self.assertIsNotNone(line)
        self.assertTrue(line.endswith("\n"))

    def test_lost_composition_is_serializer_ready(self) -> None:
        outcome = _success_outcome(_no_face_result())
        composition = compose_face_landmarker_inference_outcome(outcome)
        line = serialize_helper_result_line(
            composition.payload,
            request_id=composition.request_id,
            frame_timestamp_ms=composition.frame_timestamp_ms,
            inference_ms=composition.inference_ms,
            frame_ack=composition.frame_ack,
        )
        self.assertIsNotNone(line)
        self.assertTrue(line.endswith("\n"))


# =============================================================================
# Strict outcome validation
# =============================================================================


class StrictOutcomeValidationTests(unittest.TestCase):
    def _assert_rejected(self, outcome: object) -> None:
        select_patch, observe_patch, assemble_patch = _patched_pipeline_mocks()
        with select_patch as mock_select, observe_patch as mock_observe, assemble_patch as mock_assemble:
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)
        mock_select.assert_not_called()
        mock_observe.assert_not_called()
        mock_assemble.assert_not_called()

    def test_wrong_outcome_type_rejected(self) -> None:
        self._assert_rejected({"status": _SUCCESS})

    def test_outcome_subclass_rejected(self) -> None:
        class _OutcomeSubclass(FaceLandmarkerInferenceOutcome):
            pass

        outcome = _OutcomeSubclass(
            status=_SUCCESS,
            request_id=_REQUEST_ID,
            frame_timestamp_ms=_TIMESTAMP_MS,
            payload_bytes=_PAYLOAD_BYTES,
            source_checksum=_CHECKSUM,
            inference_ms=_INFERENCE_MS,
            candidate_result=object(),
        )
        self._assert_rejected(outcome)

    def test_wrong_status_type_rejected(self) -> None:
        self._assert_rejected(_make_outcome(status="success", candidate_result=object()))

    def test_unknown_string_status_rejected(self) -> None:
        self._assert_rejected(_make_outcome(status="unknown", candidate_result=object()))

    def test_equality_spoofing_status_rejected(self) -> None:
        class _AlwaysEqualStatus:
            def __eq__(self, other: object) -> bool:
                return True

            def __hash__(self) -> int:
                return 0

        self._assert_rejected(
            _make_outcome(status=_AlwaysEqualStatus(), candidate_result=object())
        )

    def test_request_id_wrong_type_rejected(self) -> None:
        self._assert_rejected(
            _success_outcome(object(), request_id="7")
        )

    def test_request_id_bool_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), request_id=True))

    def test_request_id_zero_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), request_id=0))

    def test_request_id_above_int64_max_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), request_id=_INT64_MAX + 1))

    def test_timestamp_wrong_type_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), frame_timestamp_ms="1000"))

    def test_timestamp_below_int64_min_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), frame_timestamp_ms=_INT64_MIN - 1))

    def test_timestamp_above_int64_max_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), frame_timestamp_ms=_INT64_MAX + 1))

    def test_payload_bytes_wrong_type_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), payload_bytes=12.0))

    def test_payload_bytes_bool_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), payload_bytes=True))

    def test_payload_bytes_below_one_pixel_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), payload_bytes=2))

    def test_payload_bytes_not_divisible_by_three_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), payload_bytes=4))

    def test_payload_bytes_above_max_rejected(self) -> None:
        self._assert_rejected(
            _success_outcome(object(), payload_bytes=_MAX_PAYLOAD_BYTES + 3)
        )

    def test_checksum_wrong_type_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), source_checksum=123.0))

    def test_checksum_bool_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), source_checksum=True))

    def test_checksum_negative_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), source_checksum=-1))

    def test_checksum_above_uint32_max_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), source_checksum=_UINT32_MAX + 1))

    def test_inference_timing_wrong_type_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), inference_ms="1.0"))

    def test_inference_timing_int_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), inference_ms=1))

    def test_inference_timing_bool_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), inference_ms=True))

    def test_inference_timing_float_subclass_rejected(self) -> None:
        class _FloatSubclass(float):
            pass

        self._assert_rejected(_success_outcome(object(), inference_ms=_FloatSubclass(1.0)))

    def test_inference_timing_nan_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), inference_ms=math.nan))

    def test_inference_timing_positive_infinity_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), inference_ms=math.inf))

    def test_inference_timing_negative_infinity_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), inference_ms=-math.inf))

    def test_inference_timing_negative_rejected(self) -> None:
        self._assert_rejected(_success_outcome(object(), inference_ms=-0.1))

    def test_success_with_none_candidate_rejected(self) -> None:
        self._assert_rejected(_success_outcome(None))

    def test_runtime_unavailable_with_candidate_rejected(self) -> None:
        self._assert_rejected(
            _make_outcome(status=_RUNTIME_UNAVAILABLE, candidate_result=object(), inference_ms=0.0)
        )

    def test_image_adaptation_failed_with_candidate_rejected(self) -> None:
        self._assert_rejected(
            _make_outcome(
                status=_IMAGE_ADAPTATION_FAILED, candidate_result=object(), inference_ms=0.0
            )
        )

    def test_detection_failed_with_candidate_rejected(self) -> None:
        self._assert_rejected(
            _make_outcome(status=_DETECTION_FAILED, candidate_result=object(), inference_ms=0.0)
        )

    def test_runtime_unavailable_with_nonzero_timing_rejected(self) -> None:
        self._assert_rejected(_bounded_failure_outcome(_RUNTIME_UNAVAILABLE, inference_ms=1.0))

    def test_image_adaptation_failed_with_nonzero_timing_rejected(self) -> None:
        self._assert_rejected(
            _bounded_failure_outcome(_IMAGE_ADAPTATION_FAILED, inference_ms=1.0)
        )


# =============================================================================
# Exact pipeline reuse
# =============================================================================


class PipelineReuseTests(unittest.TestCase):
    def test_success_passes_exact_candidate_identity_and_calls_pipeline_once_in_order(
        self,
    ) -> None:
        sentinel_candidate = _single_face_result(_full_categories(), _identity_matrix())
        outcome = _success_outcome(sentinel_candidate)

        call_log: list[str] = []
        captured: dict[str, object] = {}

        def _select(candidate: object) -> FaceCandidateSelection:
            call_log.append("select")
            captured["select_arg"] = candidate
            result = face_result_selection.select_single_face_candidate(candidate)
            captured["select_result"] = result
            return result

        def _observe(selection: FaceCandidateSelection) -> FaceCandidateObservation:
            call_log.append("observe")
            captured["observe_arg"] = selection
            result = face_candidate_observation.compose_face_candidate_observation(selection)
            captured["observe_result"] = result
            return result

        def _assemble(observation: FaceCandidateObservation) -> HelperTrackingPayload:
            call_log.append("assemble")
            captured["assemble_arg"] = observation
            return helper_tracking_payload.assemble_helper_tracking_payload(observation)

        with mock.patch(
            "face_landmarker_result_composition.select_single_face_candidate", side_effect=_select
        ) as mock_select, mock.patch(
            "face_landmarker_result_composition.compose_face_candidate_observation",
            side_effect=_observe,
        ) as mock_observe, mock.patch(
            "face_landmarker_result_composition.assemble_helper_tracking_payload",
            side_effect=_assemble,
        ) as mock_assemble:
            composition = compose_face_landmarker_inference_outcome(outcome)

        self.assertIsNotNone(composition)
        mock_select.assert_called_once()
        mock_observe.assert_called_once()
        mock_assemble.assert_called_once()
        self.assertEqual(call_log, ["select", "observe", "assemble"])
        self.assertIs(captured["select_arg"], sentinel_candidate)
        self.assertIs(captured["observe_arg"], captured["select_result"])
        self.assertIs(captured["assemble_arg"], captured["observe_result"])

    def test_bounded_non_success_passes_empty_candidate_surface(self) -> None:
        for status in _BOUNDED_FAILURE_STATUSES:
            with self.subTest(status=status):
                outcome = _bounded_failure_outcome(status, inference_ms=0.0)
                captured: dict[str, object] = {}

                def _select(candidate: object) -> FaceCandidateSelection:
                    captured["arg"] = candidate
                    return face_result_selection.select_single_face_candidate(candidate)

                with mock.patch(
                    "face_landmarker_result_composition.select_single_face_candidate",
                    side_effect=_select,
                ) as mock_select:
                    composition = compose_face_landmarker_inference_outcome(outcome)

                mock_select.assert_called_once()
                arg = captured["arg"]
                self.assertIsInstance(arg, flrc._EmptyFaceLandmarkerCandidateResult)
                self.assertEqual(arg.face_landmarks, ())
                self.assertEqual(arg.face_blendshapes, ())
                self.assertEqual(arg.facial_transformation_matrixes, ())
                self.assertIsNotNone(composition)


# =============================================================================
# Successful candidate behavior
# =============================================================================


class SuccessfulCandidateBehaviorTests(unittest.TestCase):
    def test_single_valid_face_produces_tracking_payload(self) -> None:
        outcome = _success_outcome(_single_face_result(_full_categories(), _identity_matrix()))
        composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNotNone(composition)
        self.assertEqual(composition.payload.status, HelperTrackingPayloadStatus.TRACKING)
        self.assertEqual(composition.payload.confidence, 1.0)

    def test_single_valid_face_exact_rotation_and_expression_values(self) -> None:
        outcome = _success_outcome(_single_face_result(_full_categories(), _identity_matrix()))
        composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertAlmostEqual(composition.payload.face_rotation.pitch, 0.0)
        self.assertAlmostEqual(composition.payload.face_rotation.yaw, 0.0)
        self.assertAlmostEqual(composition.payload.face_rotation.roll, 0.0)
        self.assertAlmostEqual(composition.payload.eyes.left_open, 1.0)
        self.assertAlmostEqual(composition.payload.eyes.right_open, 1.0)
        self.assertAlmostEqual(composition.payload.mouth.open, 0.0)
        self.assertAlmostEqual(composition.payload.mouth.smile, 0.0)

    def test_single_valid_face_exact_request_metadata(self) -> None:
        outcome = _success_outcome(
            _single_face_result(_full_categories(), _identity_matrix()),
            request_id=9001,
            frame_timestamp_ms=55555,
            payload_bytes=15,
            source_checksum=8080,
            inference_ms=4.4,
        )
        composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertEqual(composition.request_id, 9001)
        self.assertEqual(composition.frame_timestamp_ms, 55555)
        self.assertEqual(composition.inference_ms, 4.4)
        self.assertEqual(composition.frame_ack.sequence, 9001)
        self.assertEqual(composition.frame_ack.payload_bytes, 15)
        self.assertEqual(composition.frame_ack.checksum, 8080)

    def test_runtime_like_matrix_surface_produces_tracking_payload(self) -> None:
        matrix = _FakeRuntimeMatrix(_identity_matrix())
        outcome = _success_outcome(_single_face_result(_full_categories(), matrix))
        composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertEqual(composition.payload.status, HelperTrackingPayloadStatus.TRACKING)
        self.assertAlmostEqual(composition.payload.face_rotation.pitch, 0.0)


# =============================================================================
# Canonical LOST behavior
# =============================================================================


class CanonicalLostBehaviorTests(unittest.TestCase):
    def _assert_lost_for_candidate(self, candidate: object) -> None:
        outcome = _success_outcome(candidate)
        composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNotNone(composition)
        _assert_canonical_lost(self, composition.payload)

    def test_zero_faces(self) -> None:
        self._assert_lost_for_candidate(_no_face_result())

    def test_multiple_aligned_faces(self) -> None:
        self._assert_lost_for_candidate(_multiple_faces_result(2))

    def test_mismatched_outer_collection_lengths(self) -> None:
        self._assert_lost_for_candidate(_mismatched_length_result())

    def test_malformed_outer_attributes(self) -> None:
        self._assert_lost_for_candidate(_malformed_attribute_result())

    def test_duplicate_required_blendshape_category(self) -> None:
        self._assert_lost_for_candidate(
            _single_face_result(_duplicate_categories(), _identity_matrix())
        )

    def test_non_finite_required_category_score(self) -> None:
        self._assert_lost_for_candidate(
            _single_face_result(_non_finite_score_categories(), _identity_matrix())
        )

    def test_missing_matrix(self) -> None:
        self._assert_lost_for_candidate(_single_face_result(_full_categories(), None))

    def test_invalid_matrix_shape(self) -> None:
        self._assert_lost_for_candidate(
            _single_face_result(_full_categories(), _MALFORMED_MATRIX)
        )

    def test_non_finite_matrix(self) -> None:
        self._assert_lost_for_candidate(
            _single_face_result(_full_categories(), _NON_FINITE_MATRIX)
        )

    def test_malformed_candidate_object_proceeds_to_malformed_lost_path(self) -> None:
        outcome = _success_outcome(object())
        composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNotNone(composition)
        _assert_canonical_lost(self, composition.payload)


# =============================================================================
# Missing-category behavior
# =============================================================================


class MissingCategoryBehaviorTests(unittest.TestCase):
    def test_missing_eye_blink_right_uses_neutral_fallback_and_stays_tracking(self) -> None:
        outcome = _success_outcome(
            _single_face_result(_partial_categories_missing_right_eye(), _identity_matrix())
        )
        composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertEqual(composition.payload.status, HelperTrackingPayloadStatus.TRACKING)
        self.assertEqual(composition.payload.eyes.right_open, 1.0)


# =============================================================================
# Bounded inference failure mapping
# =============================================================================


class BoundedInferenceFailureMappingTests(unittest.TestCase):
    def _assert_bounded_failure_maps_to_lost(
        self, status: FaceLandmarkerInferenceStatus, inference_ms: float
    ) -> None:
        outcome = _bounded_failure_outcome(
            status,
            inference_ms=inference_ms,
            request_id=555,
            frame_timestamp_ms=6060,
            payload_bytes=18,
            source_checksum=777,
        )

        select_wrap = mock.patch(
            "face_landmarker_result_composition.select_single_face_candidate",
            side_effect=face_result_selection.select_single_face_candidate,
        )
        observe_wrap = mock.patch(
            "face_landmarker_result_composition.compose_face_candidate_observation",
            side_effect=face_candidate_observation.compose_face_candidate_observation,
        )
        assemble_wrap = mock.patch(
            "face_landmarker_result_composition.assemble_helper_tracking_payload",
            side_effect=helper_tracking_payload.assemble_helper_tracking_payload,
        )

        with select_wrap as mock_select, observe_wrap as mock_observe, assemble_wrap as mock_assemble:
            composition = compose_face_landmarker_inference_outcome(outcome)

        self.assertIsNotNone(composition)
        mock_select.assert_called_once()
        mock_observe.assert_called_once()
        mock_assemble.assert_called_once()
        _assert_canonical_lost(self, composition.payload)
        self.assertEqual(composition.request_id, 555)
        self.assertEqual(composition.frame_timestamp_ms, 6060)
        self.assertEqual(composition.inference_ms, inference_ms)
        self.assertEqual(composition.frame_ack.sequence, 555)
        self.assertEqual(composition.frame_ack.payload_bytes, 18)
        self.assertEqual(composition.frame_ack.checksum, 777)

    def test_runtime_unavailable_maps_to_lost(self) -> None:
        self._assert_bounded_failure_maps_to_lost(_RUNTIME_UNAVAILABLE, 0.0)

    def test_image_adaptation_failed_maps_to_lost(self) -> None:
        self._assert_bounded_failure_maps_to_lost(_IMAGE_ADAPTATION_FAILED, 0.0)

    def test_detection_failed_zero_timing_maps_to_lost(self) -> None:
        self._assert_bounded_failure_maps_to_lost(_DETECTION_FAILED, 0.0)

    def test_detection_failed_positive_timing_maps_to_lost(self) -> None:
        self._assert_bounded_failure_maps_to_lost(_DETECTION_FAILED, 8.5)


# =============================================================================
# No stale values
# =============================================================================


class NoStaleValuesTests(unittest.TestCase):
    def test_lost_after_tracking_carries_no_previous_values(self) -> None:
        tracking_outcome = _success_outcome(
            _single_face_result(_full_categories(), _identity_matrix()),
            request_id=1,
            frame_timestamp_ms=100,
        )
        tracking_composition = compose_face_landmarker_inference_outcome(tracking_outcome)
        self.assertEqual(tracking_composition.payload.status, HelperTrackingPayloadStatus.TRACKING)

        rotated_categories = [
            _FakeCategory("eyeBlinkLeft", 0.9),
            _FakeCategory("eyeBlinkRight", 0.9),
            _FakeCategory("jawOpen", 0.8),
            _FakeCategory("mouthSmileLeft", 0.9),
            _FakeCategory("mouthSmileRight", 0.9),
        ]
        second_tracking_outcome = _success_outcome(
            _single_face_result(rotated_categories, _identity_matrix()),
            request_id=1,
            frame_timestamp_ms=100,
        )
        second_tracking = compose_face_landmarker_inference_outcome(second_tracking_outcome)
        self.assertNotAlmostEqual(second_tracking.payload.eyes.left_open, 1.0)

        lost_outcome = _bounded_failure_outcome(
            _RUNTIME_UNAVAILABLE, request_id=2, frame_timestamp_ms=200
        )
        lost_composition = compose_face_landmarker_inference_outcome(lost_outcome)

        _assert_canonical_lost(self, lost_composition.payload)
        self.assertEqual(lost_composition.request_id, 2)
        self.assertEqual(lost_composition.frame_timestamp_ms, 200)

    def test_each_call_has_independent_metadata(self) -> None:
        first = compose_face_landmarker_inference_outcome(
            _success_outcome(
                _single_face_result(_full_categories(), _identity_matrix()), request_id=10
            )
        )
        second = compose_face_landmarker_inference_outcome(
            _success_outcome(
                _single_face_result(_full_categories(), _identity_matrix()), request_id=20
            )
        )
        self.assertEqual(first.request_id, 10)
        self.assertEqual(second.request_id, 20)
        self.assertNotEqual(first.request_id, second.request_id)


# =============================================================================
# Internal composition failure
# =============================================================================


class InternalCompositionFailureTests(unittest.TestCase):
    def test_selector_returns_none(self) -> None:
        outcome = _success_outcome(object())
        with mock.patch(
            "face_landmarker_result_composition.select_single_face_candidate", return_value=None
        ) as mock_select, mock.patch(
            "face_landmarker_result_composition.compose_face_candidate_observation"
        ) as mock_observe, mock.patch(
            "face_landmarker_result_composition.assemble_helper_tracking_payload"
        ) as mock_assemble:
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)
        mock_select.assert_called_once()
        mock_observe.assert_not_called()
        mock_assemble.assert_not_called()

    def test_selector_returns_wrong_type(self) -> None:
        outcome = _success_outcome(object())
        with mock.patch(
            "face_landmarker_result_composition.select_single_face_candidate",
            return_value="not-a-selection",
        ), mock.patch(
            "face_landmarker_result_composition.compose_face_candidate_observation"
        ) as mock_observe:
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)
        mock_observe.assert_not_called()

    def test_selector_returns_subclass(self) -> None:
        class _SelectionSubclass(FaceCandidateSelection):
            pass

        bad_selection = _SelectionSubclass(
            status=FaceCandidateSelectionStatus.NO_FACE, selected_face=None
        )
        outcome = _success_outcome(object())
        with mock.patch(
            "face_landmarker_result_composition.select_single_face_candidate",
            return_value=bad_selection,
        ), mock.patch(
            "face_landmarker_result_composition.compose_face_candidate_observation"
        ) as mock_observe:
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)
        mock_observe.assert_not_called()

    def test_selector_returns_unknown_status(self) -> None:
        bad_selection = FaceCandidateSelection(status="unexpected", selected_face=None)
        outcome = _success_outcome(object())
        with mock.patch(
            "face_landmarker_result_composition.select_single_face_candidate",
            return_value=bad_selection,
        ), mock.patch(
            "face_landmarker_result_composition.compose_face_candidate_observation"
        ) as mock_observe:
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)
        mock_observe.assert_not_called()

    def test_selector_returns_inconsistent_single_face_without_selected_face(self) -> None:
        bad_selection = FaceCandidateSelection(
            status=FaceCandidateSelectionStatus.SINGLE_FACE, selected_face=None
        )
        outcome = _success_outcome(object())
        with mock.patch(
            "face_landmarker_result_composition.select_single_face_candidate",
            return_value=bad_selection,
        ), mock.patch(
            "face_landmarker_result_composition.compose_face_candidate_observation"
        ) as mock_observe:
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)
        mock_observe.assert_not_called()

    def test_selector_returns_inconsistent_no_face_with_selected_face(self) -> None:
        bad_selection = FaceCandidateSelection(
            status=FaceCandidateSelectionStatus.NO_FACE,
            selected_face=SelectedFaceCandidate(
                blendshape_categories=object(), facial_transformation_matrix=object()
            ),
        )
        outcome = _success_outcome(object())
        with mock.patch(
            "face_landmarker_result_composition.select_single_face_candidate",
            return_value=bad_selection,
        ), mock.patch(
            "face_landmarker_result_composition.compose_face_candidate_observation"
        ) as mock_observe:
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)
        mock_observe.assert_not_called()

    def test_observation_returns_none(self) -> None:
        outcome = _success_outcome(_no_face_result())
        with mock.patch(
            "face_landmarker_result_composition.compose_face_candidate_observation",
            return_value=None,
        ) as mock_observe, mock.patch(
            "face_landmarker_result_composition.assemble_helper_tracking_payload"
        ) as mock_assemble:
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)
        mock_observe.assert_called_once()
        mock_assemble.assert_not_called()

    def test_observation_returns_wrong_type(self) -> None:
        outcome = _success_outcome(_no_face_result())
        with mock.patch(
            "face_landmarker_result_composition.compose_face_candidate_observation",
            return_value="not-an-observation",
        ), mock.patch(
            "face_landmarker_result_composition.assemble_helper_tracking_payload"
        ) as mock_assemble:
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)
        mock_assemble.assert_not_called()

    def test_observation_returns_subclass(self) -> None:
        class _ObservationSubclass(FaceCandidateObservation):
            pass

        bad_observation = _ObservationSubclass(
            status=FaceCandidateObservationStatus.NO_FACE, face_rotation=None, expressions=None
        )
        outcome = _success_outcome(_no_face_result())
        with mock.patch(
            "face_landmarker_result_composition.compose_face_candidate_observation",
            return_value=bad_observation,
        ), mock.patch(
            "face_landmarker_result_composition.assemble_helper_tracking_payload"
        ) as mock_assemble:
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)
        mock_assemble.assert_not_called()

    def test_observation_status_inconsistent_with_selection(self) -> None:
        bad_observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.NO_FACE, face_rotation=None, expressions=None
        )
        outcome = _success_outcome(
            _single_face_result(_full_categories(), _identity_matrix())
        )
        with mock.patch(
            "face_landmarker_result_composition.compose_face_candidate_observation",
            return_value=bad_observation,
        ), mock.patch(
            "face_landmarker_result_composition.assemble_helper_tracking_payload"
        ) as mock_assemble:
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)
        mock_assemble.assert_not_called()

    def test_observation_attaches_payload_for_non_valid_status(self) -> None:
        from expression_mapping import ExpressionValues
        from rotation_mapping import FaceRotationValues

        bad_observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.NO_FACE,
            face_rotation=FaceRotationValues(pitch=0.0, yaw=0.0, roll=0.0),
            expressions=ExpressionValues(
                left_eye_open=1.0, right_eye_open=1.0, mouth_open=0.0, mouth_smile=0.0
            ),
        )
        outcome = _success_outcome(_no_face_result())
        with mock.patch(
            "face_landmarker_result_composition.compose_face_candidate_observation",
            return_value=bad_observation,
        ), mock.patch(
            "face_landmarker_result_composition.assemble_helper_tracking_payload"
        ) as mock_assemble:
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)
        mock_assemble.assert_not_called()

    def test_assembler_returns_none(self) -> None:
        outcome = _success_outcome(_no_face_result())
        with mock.patch(
            "face_landmarker_result_composition.assemble_helper_tracking_payload",
            return_value=None,
        ) as mock_assemble:
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)
        mock_assemble.assert_called_once()

    def test_assembler_returns_wrong_type(self) -> None:
        outcome = _success_outcome(_no_face_result())
        with mock.patch(
            "face_landmarker_result_composition.assemble_helper_tracking_payload",
            return_value="not-a-payload",
        ):
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)

    def test_assembler_returns_subclass(self) -> None:
        class _PayloadSubclass(HelperTrackingPayload):
            pass

        bad_payload = _PayloadSubclass(
            status=HelperTrackingPayloadStatus.LOST,
            confidence=0.0,
            face_rotation=HelperFaceRotationPayload(pitch=0.0, yaw=0.0, roll=0.0),
            eyes=HelperEyePayload(left_open=1.0, right_open=1.0),
            mouth=HelperMouthPayload(open=0.0, smile=0.0),
        )
        outcome = _success_outcome(_no_face_result())
        with mock.patch(
            "face_landmarker_result_composition.assemble_helper_tracking_payload",
            return_value=bad_payload,
        ):
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)

    def test_assembler_returns_lost_for_valid_face(self) -> None:
        lost_payload = HelperTrackingPayload(
            status=HelperTrackingPayloadStatus.LOST,
            confidence=0.0,
            face_rotation=HelperFaceRotationPayload(pitch=0.0, yaw=0.0, roll=0.0),
            eyes=HelperEyePayload(left_open=1.0, right_open=1.0),
            mouth=HelperMouthPayload(open=0.0, smile=0.0),
        )
        outcome = _success_outcome(_single_face_result(_full_categories(), _identity_matrix()))
        with mock.patch(
            "face_landmarker_result_composition.assemble_helper_tracking_payload",
            return_value=lost_payload,
        ):
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)

    def test_assembler_returns_tracking_for_no_face(self) -> None:
        tracking_payload = HelperTrackingPayload(
            status=HelperTrackingPayloadStatus.TRACKING,
            confidence=1.0,
            face_rotation=HelperFaceRotationPayload(pitch=0.0, yaw=0.0, roll=0.0),
            eyes=HelperEyePayload(left_open=1.0, right_open=1.0),
            mouth=HelperMouthPayload(open=0.0, smile=0.0),
        )
        outcome = _success_outcome(_no_face_result())
        with mock.patch(
            "face_landmarker_result_composition.assemble_helper_tracking_payload",
            return_value=tracking_payload,
        ):
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)

    def test_assembler_returns_tracking_for_multiple_faces(self) -> None:
        tracking_payload = HelperTrackingPayload(
            status=HelperTrackingPayloadStatus.TRACKING,
            confidence=1.0,
            face_rotation=HelperFaceRotationPayload(pitch=0.0, yaw=0.0, roll=0.0),
            eyes=HelperEyePayload(left_open=1.0, right_open=1.0),
            mouth=HelperMouthPayload(open=0.0, smile=0.0),
        )
        outcome = _success_outcome(_multiple_faces_result(2))
        with mock.patch(
            "face_landmarker_result_composition.assemble_helper_tracking_payload",
            return_value=tracking_payload,
        ):
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)

    def test_assembler_returns_tracking_for_malformed(self) -> None:
        tracking_payload = HelperTrackingPayload(
            status=HelperTrackingPayloadStatus.TRACKING,
            confidence=1.0,
            face_rotation=HelperFaceRotationPayload(pitch=0.0, yaw=0.0, roll=0.0),
            eyes=HelperEyePayload(left_open=1.0, right_open=1.0),
            mouth=HelperMouthPayload(open=0.0, smile=0.0),
        )
        outcome = _success_outcome(_malformed_attribute_result())
        with mock.patch(
            "face_landmarker_result_composition.assemble_helper_tracking_payload",
            return_value=tracking_payload,
        ):
            composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNone(composition)


# =============================================================================
# Exception visibility
# =============================================================================


class ExceptionVisibilityTests(unittest.TestCase):
    def test_pipeline_stage_exceptions_are_not_swallowed(self) -> None:
        stage_targets = (
            "face_landmarker_result_composition.select_single_face_candidate",
            "face_landmarker_result_composition.compose_face_candidate_observation",
            "face_landmarker_result_composition.assemble_helper_tracking_payload",
        )
        exception_types = (RuntimeError, KeyboardInterrupt, SystemExit)
        outcome = _success_outcome(_no_face_result())

        for target in stage_targets:
            for exception_type in exception_types:
                with self.subTest(target=target, exception_type=exception_type):
                    with mock.patch(target, side_effect=exception_type("boom")):
                        with self.assertRaises(exception_type):
                            compose_face_landmarker_inference_outcome(outcome)


# =============================================================================
# Ownership and privacy
# =============================================================================


class OwnershipAndPrivacyTests(unittest.TestCase):
    def test_no_candidate_secret_leaks_into_composition_repr(self) -> None:
        class _SecretMatrix:
            def __len__(self) -> int:
                raise RuntimeError("len failed")

            def __repr__(self) -> str:
                return "SECRET_MARKER_VALUE"

        outcome = _success_outcome(
            _single_face_result(_full_categories(), _SecretMatrix())
        )
        composition = compose_face_landmarker_inference_outcome(outcome)
        self.assertIsNotNone(composition)
        self.assertNotIn("SECRET_MARKER_VALUE", repr(composition))
        self.assertNotIn("SECRET_MARKER_VALUE", str(composition))

    def test_repeated_calls_share_no_state(self) -> None:
        tracking = compose_face_landmarker_inference_outcome(
            _success_outcome(
                _single_face_result(_full_categories(), _identity_matrix()), request_id=1
            )
        )
        lost = compose_face_landmarker_inference_outcome(
            _success_outcome(_no_face_result(), request_id=2)
        )
        second_tracking = compose_face_landmarker_inference_outcome(
            _success_outcome(
                _single_face_result(_full_categories(), _identity_matrix()), request_id=3
            )
        )
        self.assertEqual(tracking.payload.status, HelperTrackingPayloadStatus.TRACKING)
        self.assertEqual(lost.payload.status, HelperTrackingPayloadStatus.LOST)
        self.assertEqual(second_tracking.payload.status, HelperTrackingPayloadStatus.TRACKING)

    def test_no_stdout_on_tracking(self) -> None:
        outcome = _success_outcome(_single_face_result(_full_categories(), _identity_matrix()))
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            compose_face_landmarker_inference_outcome(outcome)
        self.assertEqual(buffer.getvalue(), "")

    def test_no_stderr_on_tracking(self) -> None:
        outcome = _success_outcome(_single_face_result(_full_categories(), _identity_matrix()))
        buffer = io.StringIO()
        with contextlib.redirect_stderr(buffer):
            compose_face_landmarker_inference_outcome(outcome)
        self.assertEqual(buffer.getvalue(), "")

    def test_no_stdout_on_lost(self) -> None:
        outcome = _success_outcome(_no_face_result())
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            compose_face_landmarker_inference_outcome(outcome)
        self.assertEqual(buffer.getvalue(), "")

    def test_no_stderr_on_lost(self) -> None:
        outcome = _success_outcome(_no_face_result())
        buffer = io.StringIO()
        with contextlib.redirect_stderr(buffer):
            compose_face_landmarker_inference_outcome(outcome)
        self.assertEqual(buffer.getvalue(), "")

    def test_no_filesystem_calls(self) -> None:
        outcome = _success_outcome(_single_face_result(_full_categories(), _identity_matrix()))
        lost_outcome = _success_outcome(_no_face_result())

        def _raise_if_opened(*args: object, **kwargs: object) -> None:
            raise AssertionError("production composition must not open files")

        with mock.patch("builtins.open", side_effect=_raise_if_opened):
            compose_face_landmarker_inference_outcome(outcome)
            compose_face_landmarker_inference_outcome(lost_outcome)

    def test_no_json_serialization_from_production(self) -> None:
        outcome = _success_outcome(_single_face_result(_full_categories(), _identity_matrix()))
        lost_outcome = _success_outcome(_no_face_result())

        with mock.patch("json.dumps", side_effect=AssertionError("must not serialize")):
            compose_face_landmarker_inference_outcome(outcome)
            compose_face_landmarker_inference_outcome(lost_outcome)

    def test_module_does_not_import_serializer(self) -> None:
        self.assertFalse(hasattr(flrc, "serialize_helper_result_line"))

    def test_module_does_not_import_json(self) -> None:
        self.assertFalse(hasattr(flrc, "json"))

    def test_module_does_not_import_mediapipe_or_numpy(self) -> None:
        forbidden_names = {"mediapipe", "numpy", "np", "mp", "cv2"}
        module_names = {name.lower() for name in vars(flrc)}
        self.assertTrue(module_names.isdisjoint(forbidden_names))


if __name__ == "__main__":
    unittest.main()
