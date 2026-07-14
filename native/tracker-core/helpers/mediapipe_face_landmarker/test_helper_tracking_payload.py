"""Standard-library tests for helper_tracking_payload.py.

Run directly: python -B test_helper_tracking_payload.py
"""

import contextlib
import dataclasses
import io
import math
import unittest
from dataclasses import FrozenInstanceError, dataclass

from expression_mapping import ExpressionValues
from face_candidate_observation import (
    FaceCandidateObservation,
    FaceCandidateObservationStatus,
    compose_face_candidate_observation,
)
from face_result_selection import select_single_face_candidate
from helper_tracking_payload import (
    HelperEyePayload,
    HelperFaceRotationPayload,
    HelperMouthPayload,
    HelperTrackingPayload,
    HelperTrackingPayloadStatus,
    assemble_helper_tracking_payload,
)
from rotation_mapping import FaceRotationValues


class _NumericLike:
    """Numeric-like object exposing __float__ but not a built-in int/float."""

    def __init__(self, value: float) -> None:
        self._value = value

    def __float__(self) -> float:
        return self._value


class _FaceCandidateObservationSubclass(FaceCandidateObservation):
    """A FaceCandidateObservation subclass, used to prove exact-type rejection."""


class _AlwaysEqualStatus:
    """Object whose __eq__ always returns True, spoofing enum comparisons."""

    def __eq__(self, other: object) -> bool:
        return True

    def __hash__(self) -> int:
        return 0


@dataclass
class _FakeCategory:
    category_name: str
    score: float


@dataclass
class _FakeFaceLandmarkerResult:
    face_landmarks: object
    face_blendshapes: object
    facial_transformation_matrixes: object


_IDENTITY_MATRIX = [
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
    [0.0, 0.0, 0.0, 1.0],
]

_MALFORMED_MATRIX = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]


def _full_categories() -> list[_FakeCategory]:
    return [
        _FakeCategory("eyeBlinkLeft", 0.25),
        _FakeCategory("eyeBlinkRight", 0.1),
        _FakeCategory("jawOpen", 0.5),
        _FakeCategory("mouthSmileLeft", 0.6),
        _FakeCategory("mouthSmileRight", 0.4),
    ]


def _valid_rotation() -> FaceRotationValues:
    return FaceRotationValues(pitch=0.2, yaw=-0.3, roll=0.1)


def _valid_expressions() -> ExpressionValues:
    return ExpressionValues(
        left_eye_open=0.75, right_eye_open=0.6, mouth_open=0.4, mouth_smile=0.55
    )


def _valid_face_observation() -> FaceCandidateObservation:
    return FaceCandidateObservation(
        status=FaceCandidateObservationStatus.VALID_FACE,
        face_rotation=_valid_rotation(),
        expressions=_valid_expressions(),
    )


class AssembleHelperTrackingPayloadStatusMappingTests(unittest.TestCase):
    def test_valid_face_maps_to_tracking(self) -> None:
        payload = assemble_helper_tracking_payload(_valid_face_observation())
        self.assertIsNotNone(payload)
        self.assertEqual(payload.status, HelperTrackingPayloadStatus.TRACKING)

    def test_no_face_maps_to_lost(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.NO_FACE,
            face_rotation=None,
            expressions=None,
        )
        payload = assemble_helper_tracking_payload(observation)
        self.assertEqual(payload.status, HelperTrackingPayloadStatus.LOST)

    def test_multiple_faces_maps_to_lost(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.MULTIPLE_FACES,
            face_rotation=None,
            expressions=None,
        )
        payload = assemble_helper_tracking_payload(observation)
        self.assertEqual(payload.status, HelperTrackingPayloadStatus.LOST)

    def test_malformed_maps_to_lost(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.MALFORMED,
            face_rotation=None,
            expressions=None,
        )
        payload = assemble_helper_tracking_payload(observation)
        self.assertEqual(payload.status, HelperTrackingPayloadStatus.LOST)


class AssembleHelperTrackingPayloadTrackingValuesTests(unittest.TestCase):
    def test_valid_rotation_values_copied_exactly(self) -> None:
        payload = assemble_helper_tracking_payload(_valid_face_observation())
        self.assertEqual(payload.face_rotation.pitch, 0.2)
        self.assertEqual(payload.face_rotation.yaw, -0.3)
        self.assertEqual(payload.face_rotation.roll, 0.1)

    def test_valid_expression_values_copied_exactly(self) -> None:
        payload = assemble_helper_tracking_payload(_valid_face_observation())
        self.assertEqual(payload.eyes.left_open, 0.75)
        self.assertEqual(payload.eyes.right_open, 0.6)
        self.assertEqual(payload.mouth.open, 0.4)
        self.assertEqual(payload.mouth.smile, 0.55)

    def test_tracking_confidence_is_exactly_one(self) -> None:
        payload = assemble_helper_tracking_payload(_valid_face_observation())
        self.assertEqual(payload.confidence, 1.0)

    def test_accepted_integer_values_become_builtin_floats(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=FaceRotationValues(pitch=1, yaw=0, roll=-1),
            expressions=ExpressionValues(
                left_eye_open=1, right_eye_open=0, mouth_open=0, mouth_smile=1
            ),
        )
        payload = assemble_helper_tracking_payload(observation)
        self.assertIsNotNone(payload)
        self.assertEqual(payload.face_rotation.pitch, 1.0)
        self.assertIs(type(payload.face_rotation.pitch), float)
        self.assertIs(type(payload.eyes.left_open), float)

    def test_boundary_rotation_values_accepted(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=FaceRotationValues(pitch=-1.0, yaw=1.0, roll=0.0),
            expressions=_valid_expressions(),
        )
        payload = assemble_helper_tracking_payload(observation)
        self.assertIsNotNone(payload)
        self.assertEqual(payload.face_rotation.pitch, -1.0)
        self.assertEqual(payload.face_rotation.yaw, 1.0)

    def test_boundary_expression_values_accepted(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=_valid_rotation(),
            expressions=ExpressionValues(
                left_eye_open=0.0, right_eye_open=1.0, mouth_open=0.0, mouth_smile=1.0
            ),
        )
        payload = assemble_helper_tracking_payload(observation)
        self.assertIsNotNone(payload)
        self.assertEqual(payload.eyes.left_open, 0.0)
        self.assertEqual(payload.eyes.right_open, 1.0)
        self.assertEqual(payload.mouth.open, 0.0)
        self.assertEqual(payload.mouth.smile, 1.0)

    def test_output_is_detached_from_source_nested_dataclasses(self) -> None:
        source_rotation = _valid_rotation()
        source_expressions = _valid_expressions()
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=source_rotation,
            expressions=source_expressions,
        )
        payload = assemble_helper_tracking_payload(observation)
        self.assertIsNot(payload.face_rotation, source_rotation)
        self.assertIsNot(payload.mouth, source_expressions)
        self.assertNotIsInstance(payload.face_rotation, FaceRotationValues)
        self.assertNotIsInstance(payload.eyes, ExpressionValues)


class AssembleHelperTrackingPayloadLostValuesTests(unittest.TestCase):
    def _assert_neutral_lost_payload(self, payload: HelperTrackingPayload) -> None:
        self.assertEqual(payload.status, HelperTrackingPayloadStatus.LOST)
        self.assertEqual(payload.confidence, 0.0)
        self.assertEqual(
            payload.face_rotation, HelperFaceRotationPayload(0.0, 0.0, 0.0)
        )
        self.assertEqual(payload.eyes, HelperEyePayload(1.0, 1.0))
        self.assertEqual(payload.mouth, HelperMouthPayload(0.0, 0.0))

    def test_no_face_yields_exact_neutral_payload(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.NO_FACE,
            face_rotation=None,
            expressions=None,
        )
        self._assert_neutral_lost_payload(assemble_helper_tracking_payload(observation))

    def test_multiple_faces_yields_exact_neutral_payload(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.MULTIPLE_FACES,
            face_rotation=None,
            expressions=None,
        )
        self._assert_neutral_lost_payload(assemble_helper_tracking_payload(observation))

    def test_malformed_yields_exact_neutral_payload(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.MALFORMED,
            face_rotation=None,
            expressions=None,
        )
        self._assert_neutral_lost_payload(assemble_helper_tracking_payload(observation))

    def test_all_lost_statuses_produce_identical_payloads(self) -> None:
        payloads = [
            assemble_helper_tracking_payload(
                FaceCandidateObservation(status=status, face_rotation=None, expressions=None)
            )
            for status in (
                FaceCandidateObservationStatus.NO_FACE,
                FaceCandidateObservationStatus.MULTIPLE_FACES,
                FaceCandidateObservationStatus.MALFORMED,
            )
        ]
        self.assertEqual(payloads[0], payloads[1])
        self.assertEqual(payloads[1], payloads[2])

    def test_lost_does_not_retain_supplied_tracking_values(self) -> None:
        tracking_payload = assemble_helper_tracking_payload(_valid_face_observation())
        lost_observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.NO_FACE,
            face_rotation=None,
            expressions=None,
        )
        lost_payload = assemble_helper_tracking_payload(lost_observation)
        self.assertNotEqual(lost_payload.face_rotation, tracking_payload.face_rotation)
        self.assertNotEqual(lost_payload.mouth, tracking_payload.mouth)


class AssembleHelperTrackingPayloadInputContractTests(unittest.TestCase):
    def test_none_input_returns_none(self) -> None:
        self.assertIsNone(assemble_helper_tracking_payload(None))

    def test_wrong_object_type_returns_none(self) -> None:
        for bad_input in ("not-an-observation", 42, {"status": "valid_face"}):
            with self.subTest(bad_input=bad_input):
                self.assertIsNone(assemble_helper_tracking_payload(bad_input))

    def test_observation_subclass_is_rejected(self) -> None:
        subclass_observation = _FaceCandidateObservationSubclass(
            status=FaceCandidateObservationStatus.NO_FACE,
            face_rotation=None,
            expressions=None,
        )
        self.assertIsNone(assemble_helper_tracking_payload(subclass_observation))

    def test_unknown_status_returns_none(self) -> None:
        observation = FaceCandidateObservation(
            status="unexpected", face_rotation=None, expressions=None
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_valid_face_with_missing_rotation_returns_none(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=None,
            expressions=_valid_expressions(),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_valid_face_with_missing_expressions_returns_none(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=_valid_rotation(),
            expressions=None,
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_valid_face_with_wrong_rotation_type_returns_none(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=(0.1, 0.1, 0.1),
            expressions=_valid_expressions(),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_valid_face_with_wrong_expression_type_returns_none(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=_valid_rotation(),
            expressions={"mouth_open": 0.1},
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_no_face_with_attached_rotation_returns_none(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.NO_FACE,
            face_rotation=_valid_rotation(),
            expressions=None,
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_no_face_with_attached_expressions_returns_none(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.NO_FACE,
            face_rotation=None,
            expressions=_valid_expressions(),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_multiple_faces_with_attached_payload_returns_none(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.MULTIPLE_FACES,
            face_rotation=_valid_rotation(),
            expressions=_valid_expressions(),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_malformed_with_attached_payload_returns_none(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.MALFORMED,
            face_rotation=_valid_rotation(),
            expressions=_valid_expressions(),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))


class AssembleHelperTrackingPayloadStatusTypeSafetyTests(unittest.TestCase):
    def test_equality_spoofing_status_with_valid_payload_returns_none(self) -> None:
        observation = FaceCandidateObservation(
            status=_AlwaysEqualStatus(),
            face_rotation=_valid_rotation(),
            expressions=_valid_expressions(),
        )
        payload = assemble_helper_tracking_payload(observation)
        self.assertIsNone(payload)

    def test_equality_spoofing_status_with_no_payload_returns_none(self) -> None:
        observation = FaceCandidateObservation(
            status=_AlwaysEqualStatus(), face_rotation=None, expressions=None
        )
        payload = assemble_helper_tracking_payload(observation)
        self.assertIsNone(payload)

    def test_ordinary_unknown_string_status_returns_none(self) -> None:
        observation = FaceCandidateObservation(
            status="unexpected", face_rotation=None, expressions=None
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_legitimate_statuses_retain_existing_behavior(self) -> None:
        valid_face_payload = assemble_helper_tracking_payload(_valid_face_observation())
        self.assertEqual(valid_face_payload.status, HelperTrackingPayloadStatus.TRACKING)

        for status in (
            FaceCandidateObservationStatus.NO_FACE,
            FaceCandidateObservationStatus.MULTIPLE_FACES,
            FaceCandidateObservationStatus.MALFORMED,
        ):
            observation = FaceCandidateObservation(
                status=status, face_rotation=None, expressions=None
            )
            payload = assemble_helper_tracking_payload(observation)
            self.assertEqual(payload.status, HelperTrackingPayloadStatus.LOST)


class AssembleHelperTrackingPayloadNumericSafetyTests(unittest.TestCase):
    def test_bool_rotation_rejected(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=FaceRotationValues(pitch=True, yaw=0.0, roll=0.0),
            expressions=_valid_expressions(),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_bool_expression_rejected(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=_valid_rotation(),
            expressions=ExpressionValues(
                left_eye_open=False, right_eye_open=0.5, mouth_open=0.5, mouth_smile=0.5
            ),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_custom_numeric_like_value_rejected(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=FaceRotationValues(
                pitch=_NumericLike(0.1), yaw=0.0, roll=0.0
            ),
            expressions=_valid_expressions(),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_nan_rotation_rejected(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=FaceRotationValues(pitch=math.nan, yaw=0.0, roll=0.0),
            expressions=_valid_expressions(),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_infinity_rotation_rejected(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=FaceRotationValues(pitch=0.0, yaw=math.inf, roll=0.0),
            expressions=_valid_expressions(),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_nan_expression_rejected(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=_valid_rotation(),
            expressions=ExpressionValues(
                left_eye_open=0.5, right_eye_open=0.5, mouth_open=math.nan, mouth_smile=0.5
            ),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_infinity_expression_rejected(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=_valid_rotation(),
            expressions=ExpressionValues(
                left_eye_open=0.5, right_eye_open=0.5, mouth_open=0.5, mouth_smile=math.inf
            ),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_rotation_below_minimum_rejected(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=FaceRotationValues(pitch=0.0, yaw=0.0, roll=-1.0001),
            expressions=_valid_expressions(),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_rotation_above_maximum_rejected(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=FaceRotationValues(pitch=1.0001, yaw=0.0, roll=0.0),
            expressions=_valid_expressions(),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_expression_below_minimum_rejected(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=_valid_rotation(),
            expressions=ExpressionValues(
                left_eye_open=-0.0001, right_eye_open=0.5, mouth_open=0.5, mouth_smile=0.5
            ),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_expression_above_maximum_rejected(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=_valid_rotation(),
            expressions=ExpressionValues(
                left_eye_open=0.5, right_eye_open=1.0001, mouth_open=0.5, mouth_smile=0.5
            ),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))


class AssembleHelperTrackingPayloadHugeIntSafetyTests(unittest.TestCase):
    _HUGE_POSITIVE_INT = 10**400
    _HUGE_NEGATIVE_INT = -(10**400)

    def test_huge_positive_int_rotation_returns_none_without_raising(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=FaceRotationValues(
                pitch=self._HUGE_POSITIVE_INT, yaw=0.0, roll=0.0
            ),
            expressions=_valid_expressions(),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_huge_negative_int_rotation_returns_none_without_raising(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=FaceRotationValues(
                pitch=0.0, yaw=self._HUGE_NEGATIVE_INT, roll=0.0
            ),
            expressions=_valid_expressions(),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_huge_int_expression_returns_none_without_raising(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=_valid_rotation(),
            expressions=ExpressionValues(
                left_eye_open=self._HUGE_POSITIVE_INT,
                right_eye_open=0.5,
                mouth_open=0.5,
                mouth_smile=0.5,
            ),
        )
        self.assertIsNone(assemble_helper_tracking_payload(observation))

    def test_in_range_integer_conversion_still_accepted_as_builtin_float(self) -> None:
        observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.VALID_FACE,
            face_rotation=FaceRotationValues(pitch=1, yaw=-1, roll=0),
            expressions=_valid_expressions(),
        )
        payload = assemble_helper_tracking_payload(observation)
        self.assertIsNotNone(payload)
        self.assertEqual(payload.face_rotation.pitch, 1.0)
        self.assertIs(type(payload.face_rotation.pitch), float)


class AssembleHelperTrackingPayloadOutputModelTests(unittest.TestCase):
    def test_all_public_output_dataclasses_are_frozen(self) -> None:
        payload = assemble_helper_tracking_payload(_valid_face_observation())
        with self.assertRaises(FrozenInstanceError):
            payload.status = HelperTrackingPayloadStatus.LOST
        with self.assertRaises(FrozenInstanceError):
            payload.face_rotation.pitch = 0.0
        with self.assertRaises(FrozenInstanceError):
            payload.eyes.left_open = 0.0
        with self.assertRaises(FrozenInstanceError):
            payload.mouth.open = 0.0

    def test_every_emitted_numeric_field_is_builtin_float(self) -> None:
        tracking_payload = assemble_helper_tracking_payload(_valid_face_observation())
        lost_observation = FaceCandidateObservation(
            status=FaceCandidateObservationStatus.NO_FACE,
            face_rotation=None,
            expressions=None,
        )
        lost_payload = assemble_helper_tracking_payload(lost_observation)

        for payload in (tracking_payload, lost_payload):
            self.assertIs(type(payload.confidence), float)
            for value in dataclasses.astuple(payload.face_rotation):
                self.assertIs(type(value), float)
            for value in dataclasses.astuple(payload.eyes):
                self.assertIs(type(value), float)
            for value in dataclasses.astuple(payload.mouth):
                self.assertIs(type(value), float)

    def test_status_enum_contains_exactly_tracking_and_lost(self) -> None:
        member_names = {member.name for member in HelperTrackingPayloadStatus}
        self.assertEqual(member_names, {"TRACKING", "LOST"})

    def test_status_enum_has_no_not_started_member(self) -> None:
        self.assertNotIn(
            "NOT_STARTED", {member.name for member in HelperTrackingPayloadStatus}
        )
        self.assertNotIn(
            "not_started", {member.value for member in HelperTrackingPayloadStatus}
        )

    def test_output_fields_exclude_transport_lifecycle_diagnostic_fields(self) -> None:
        payload_fields = {field.name for field in dataclasses.fields(HelperTrackingPayload)}
        self.assertEqual(
            payload_fields,
            {"status", "confidence", "face_rotation", "eyes", "mouth"},
        )

        rotation_fields = {
            field.name for field in dataclasses.fields(HelperFaceRotationPayload)
        }
        self.assertEqual(rotation_fields, {"pitch", "yaw", "roll"})

        eye_fields = {field.name for field in dataclasses.fields(HelperEyePayload)}
        self.assertEqual(eye_fields, {"left_open", "right_open"})

        mouth_fields = {field.name for field in dataclasses.fields(HelperMouthPayload)}
        self.assertEqual(mouth_fields, {"open", "smile"})

    def test_function_emits_no_stdout_or_stderr(self) -> None:
        out = io.StringIO()
        err = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            assemble_helper_tracking_payload(_valid_face_observation())
            assemble_helper_tracking_payload(
                FaceCandidateObservation(
                    status=FaceCandidateObservationStatus.NO_FACE,
                    face_rotation=None,
                    expressions=None,
                )
            )
            assemble_helper_tracking_payload(None)
            assemble_helper_tracking_payload("not-an-observation")
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "")


class AssembleHelperTrackingPayloadPipelineIntegrationTests(unittest.TestCase):
    def test_single_valid_face_pipeline_produces_tracking(self) -> None:
        raw_result = _FakeFaceLandmarkerResult(
            face_landmarks=[object()],
            face_blendshapes=[_full_categories()],
            facial_transformation_matrixes=[_IDENTITY_MATRIX],
        )
        selection = select_single_face_candidate(raw_result)
        observation = compose_face_candidate_observation(selection)
        payload = assemble_helper_tracking_payload(observation)
        self.assertIsNotNone(payload)
        self.assertEqual(payload.status, HelperTrackingPayloadStatus.TRACKING)

    def test_no_face_pipeline_produces_lost(self) -> None:
        raw_result = _FakeFaceLandmarkerResult(
            face_landmarks=[], face_blendshapes=[], facial_transformation_matrixes=[]
        )
        selection = select_single_face_candidate(raw_result)
        observation = compose_face_candidate_observation(selection)
        payload = assemble_helper_tracking_payload(observation)
        self.assertEqual(payload.status, HelperTrackingPayloadStatus.LOST)

    def test_malformed_candidate_pipeline_produces_lost(self) -> None:
        raw_result = _FakeFaceLandmarkerResult(
            face_landmarks=[object()],
            face_blendshapes=[_full_categories()],
            facial_transformation_matrixes=[_MALFORMED_MATRIX],
        )
        selection = select_single_face_candidate(raw_result)
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        payload = assemble_helper_tracking_payload(observation)
        self.assertEqual(payload.status, HelperTrackingPayloadStatus.LOST)


if __name__ == "__main__":
    unittest.main()
