"""Standard-library tests for face_candidate_observation.py.

Run directly: python -B test_face_candidate_observation.py
"""

import dataclasses
import math
import unittest
from dataclasses import FrozenInstanceError, dataclass
from unittest import mock

from face_candidate_observation import (
    FaceCandidateObservation,
    FaceCandidateObservationStatus,
    compose_face_candidate_observation,
)
from expression_mapping import ExpressionValues
from face_result_selection import (
    FaceCandidateSelection,
    FaceCandidateSelectionStatus,
    SelectedFaceCandidate,
    select_single_face_candidate,
)
from rotation_mapping import FACE_ROTATION_LIMIT_RADIANS, FaceRotationValues


@dataclass
class _FakeCategory:
    """Minimal category-like object matching blendshape_category_adapter's Protocol."""

    category_name: str | None
    score: float | None


class _RaisingCategoryNameCategory:
    """Category-like object whose `category_name` access raises an ordinary exception."""

    score = 0.5

    @property
    def category_name(self):
        raise RuntimeError("category_name access failed")


class _LenRaisesMatrix:
    """Matrix-like object that raises an ordinary exception when its length is read."""

    def __len__(self):
        raise RuntimeError("len failed")


class _FakeRuntimeMatrix:
    """Minimal ndarray-like fake exposing shape/ndim/tolist, without importing NumPy."""

    def __init__(self, shape, ndim, rows):
        self.shape = shape
        self.ndim = ndim
        self._rows = rows
        self.tolist_calls = 0

    def tolist(self):
        self.tolist_calls += 1
        return self._rows


class _RuntimeMatrixWrongShape:
    """Fake ndarray-like object exposing a non-4x4 shape."""

    shape = (3, 4)
    ndim = 2

    def tolist(self):
        return [[0.0] * 4 for _ in range(3)]


class _RuntimeMatrixTolistRaises:
    """Fake ndarray-like object whose tolist() raises an ordinary exception."""

    shape = (4, 4)
    ndim = 2

    def tolist(self):
        raise RuntimeError("tolist failed")


@dataclass
class FakeFaceLandmarkerResult:
    """Synthetic stand-in for a MediaPipe FaceLandmarkerResult, not imported here."""

    face_landmarks: object
    face_blendshapes: object
    facial_transformation_matrixes: object


def _affine(
    rotation: tuple, translation: tuple[float, float, float] = (0.0, 0.0, 0.0)
) -> list[list[float]]:
    return [
        [rotation[0][0], rotation[0][1], rotation[0][2], translation[0]],
        [rotation[1][0], rotation[1][1], rotation[1][2], translation[1]],
        [rotation[2][0], rotation[2][1], rotation[2][2], translation[2]],
        [0.0, 0.0, 0.0, 1.0],
    ]


def _scale_columns(rotation: tuple, scale: float) -> tuple:
    return tuple(tuple(value * scale for value in row) for row in rotation)


def _rotation_x(angle: float) -> tuple:
    c, s = math.cos(angle), math.sin(angle)
    return ((1.0, 0.0, 0.0), (0.0, c, -s), (0.0, s, c))


def _rotation_y(angle: float) -> tuple:
    c, s = math.cos(angle), math.sin(angle)
    return ((c, 0.0, s), (0.0, 1.0, 0.0), (-s, 0.0, c))


def _rotation_z(angle: float) -> tuple:
    c, s = math.cos(angle), math.sin(angle)
    return ((c, -s, 0.0), (s, c, 0.0), (0.0, 0.0, 1.0))


def _multiply(a: tuple, b: tuple) -> tuple:
    return tuple(
        tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3))
        for i in range(3)
    )


def _compose_xyz(pitch: float, yaw: float, roll: float) -> tuple:
    return _multiply(_multiply(_rotation_x(pitch), _rotation_y(yaw)), _rotation_z(roll))


IDENTITY_3X3 = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
IDENTITY_MATRIX = _affine(IDENTITY_3X3)

_ROTATED_SCALED_MATRIX = _affine(
    _scale_columns(_compose_xyz(0.2, 0.3, 0.1), 2.0)
)

_MALFORMED_MATRIX = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]

_NON_FINITE_MATRIX = _affine(IDENTITY_3X3)
_NON_FINITE_MATRIX[0][0] = math.nan


def _full_categories() -> list[_FakeCategory]:
    return [
        _FakeCategory("eyeBlinkLeft", 0.25),
        _FakeCategory("eyeBlinkRight", 0.1),
        _FakeCategory("jawOpen", 0.5),
        _FakeCategory("mouthSmileLeft", 0.6),
        _FakeCategory("mouthSmileRight", 0.4),
    ]


def _partial_categories() -> list[_FakeCategory]:
    return [
        _FakeCategory("eyeBlinkLeft", 0.25),
        _FakeCategory("jawOpen", 0.5),
        _FakeCategory("mouthSmileLeft", 0.6),
    ]


def _duplicate_categories() -> list[_FakeCategory]:
    return [
        _FakeCategory("jawOpen", 0.4),
        _FakeCategory("jawOpen", 0.6),
    ]


def _non_finite_score_categories() -> list[_FakeCategory]:
    return [_FakeCategory("jawOpen", math.nan)]


def _selected_face(categories: object, matrix: object) -> SelectedFaceCandidate:
    return SelectedFaceCandidate(
        blendshape_categories=categories, facial_transformation_matrix=matrix
    )


def _single_face_selection(categories: object, matrix: object) -> FaceCandidateSelection:
    return FaceCandidateSelection(
        status=FaceCandidateSelectionStatus.SINGLE_FACE,
        selected_face=_selected_face(categories, matrix),
    )


class ComposeFaceCandidateObservationTests(unittest.TestCase):
    def test_no_face_selection_returns_no_face_observation(self) -> None:
        selection = FaceCandidateSelection(
            status=FaceCandidateSelectionStatus.NO_FACE, selected_face=None
        )
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.NO_FACE)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_multiple_faces_selection_returns_multiple_faces_observation(self) -> None:
        selection = FaceCandidateSelection(
            status=FaceCandidateSelectionStatus.MULTIPLE_FACES, selected_face=None
        )
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(
            observation.status, FaceCandidateObservationStatus.MULTIPLE_FACES
        )
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_malformed_selection_returns_malformed_observation(self) -> None:
        selection = FaceCandidateSelection(
            status=FaceCandidateSelectionStatus.MALFORMED, selected_face=None
        )
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_single_face_identity_matrix_full_categories_is_valid(self) -> None:
        selection = _single_face_selection(_full_categories(), IDENTITY_MATRIX)
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.VALID_FACE)
        self.assertIsInstance(observation.face_rotation, FaceRotationValues)
        self.assertIsInstance(observation.expressions, ExpressionValues)
        self.assertAlmostEqual(observation.face_rotation.pitch, 0.0)
        self.assertAlmostEqual(observation.face_rotation.yaw, 0.0)
        self.assertAlmostEqual(observation.face_rotation.roll, 0.0)

    def test_rotated_and_uniformly_scaled_matrix_is_valid(self) -> None:
        selection = _single_face_selection(_full_categories(), _ROTATED_SCALED_MATRIX)
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.VALID_FACE)
        self.assertAlmostEqual(observation.face_rotation.pitch, 0.2, places=9)
        self.assertAlmostEqual(observation.face_rotation.yaw, 0.3, places=9)
        self.assertAlmostEqual(observation.face_rotation.roll, 0.1, places=9)

    def test_empty_categories_produce_neutral_expressions_and_valid_face(self) -> None:
        selection = _single_face_selection([], IDENTITY_MATRIX)
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.VALID_FACE)
        self.assertEqual(
            observation.expressions,
            ExpressionValues(
                left_eye_open=1.0, right_eye_open=1.0, mouth_open=0.0, mouth_smile=0.0
            ),
        )

    def test_partial_categories_use_neutral_values_for_missing_fields(self) -> None:
        selection = _single_face_selection(_partial_categories(), IDENTITY_MATRIX)
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.VALID_FACE)
        self.assertAlmostEqual(observation.expressions.right_eye_open, 1.0)
        self.assertAlmostEqual(observation.expressions.mouth_smile, 0.3)

    def test_finite_out_of_range_score_is_clamped(self) -> None:
        categories = [_FakeCategory("eyeBlinkLeft", 1.5)]
        selection = _single_face_selection(categories, IDENTITY_MATRIX)
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.VALID_FACE)
        self.assertEqual(observation.expressions.left_eye_open, 0.0)

    def test_duplicate_required_category_returns_malformed(self) -> None:
        selection = _single_face_selection(_duplicate_categories(), IDENTITY_MATRIX)
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_non_finite_required_score_returns_malformed(self) -> None:
        selection = _single_face_selection(
            _non_finite_score_categories(), IDENTITY_MATRIX
        )
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_category_property_access_exception_returns_malformed(self) -> None:
        selection = _single_face_selection(
            [_RaisingCategoryNameCategory()], IDENTITY_MATRIX
        )
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_malformed_matrix_shape_returns_malformed(self) -> None:
        selection = _single_face_selection(_full_categories(), _MALFORMED_MATRIX)
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_non_finite_matrix_returns_malformed(self) -> None:
        selection = _single_face_selection(_full_categories(), _NON_FINITE_MATRIX)
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_matrix_len_exception_returns_malformed(self) -> None:
        selection = _single_face_selection(_full_categories(), _LenRaisesMatrix())
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_valid_expressions_with_invalid_matrix_yields_no_partial_payload(
        self,
    ) -> None:
        selection = _single_face_selection(_full_categories(), _MALFORMED_MATRIX)
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_invalid_expressions_with_valid_matrix_yields_no_partial_payload(
        self,
    ) -> None:
        selection = _single_face_selection(_duplicate_categories(), IDENTITY_MATRIX)
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_both_inner_payloads_invalid_yields_no_partial_payload(self) -> None:
        selection = _single_face_selection(_duplicate_categories(), _MALFORMED_MATRIX)
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_runtime_like_matrix_produces_valid_face(self) -> None:
        matrix = _FakeRuntimeMatrix((4, 4), 2, [list(row) for row in IDENTITY_MATRIX])
        selection = _single_face_selection(_full_categories(), matrix)
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.VALID_FACE)
        self.assertIsInstance(observation.face_rotation, FaceRotationValues)
        self.assertIsInstance(observation.expressions, ExpressionValues)

    def test_runtime_like_tolist_called_exactly_once(self) -> None:
        matrix = _FakeRuntimeMatrix((4, 4), 2, [list(row) for row in IDENTITY_MATRIX])
        selection = _single_face_selection(_full_categories(), matrix)
        compose_face_candidate_observation(selection)
        self.assertEqual(matrix.tolist_calls, 1)

    def test_runtime_like_wrong_shape_returns_malformed_with_no_partial_payload(
        self,
    ) -> None:
        selection = _single_face_selection(_full_categories(), _RuntimeMatrixWrongShape())
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_runtime_like_tolist_exception_returns_malformed_with_no_partial_payload(
        self,
    ) -> None:
        selection = _single_face_selection(
            _full_categories(), _RuntimeMatrixTolistRaises()
        )
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_runtime_like_malformed_converted_matrix_returns_malformed(self) -> None:
        rows = [list(row) for row in IDENTITY_MATRIX]
        rows[0][0] = True
        matrix = _FakeRuntimeMatrix((4, 4), 2, rows)
        selection = _single_face_selection(_full_categories(), matrix)
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_runtime_like_affine_invalid_converted_matrix_returns_malformed(
        self,
    ) -> None:
        non_uniform_scale_rows = [
            [2.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ]
        matrix = _FakeRuntimeMatrix((4, 4), 2, non_uniform_scale_rows)
        selection = _single_face_selection(_full_categories(), matrix)
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_valid_expressions_with_failed_runtime_matrix_adaptation_yields_no_partial_payload(
        self,
    ) -> None:
        selection = _single_face_selection(_full_categories(), _RuntimeMatrixWrongShape())
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_unexpected_normalize_exception_is_not_swallowed(self) -> None:
        selection = _single_face_selection(_full_categories(), IDENTITY_MATRIX)

        def _raise_unexpected(_matrix):
            raise RuntimeError("unexpected programming error")

        with mock.patch(
            "face_candidate_observation.normalize_facial_transform_matrix",
            side_effect=_raise_unexpected,
        ):
            with self.assertRaises(RuntimeError):
                compose_face_candidate_observation(selection)

    def test_single_face_with_selected_face_none_returns_malformed(self) -> None:
        selection = FaceCandidateSelection(
            status=FaceCandidateSelectionStatus.SINGLE_FACE, selected_face=None
        )
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_no_face_with_selected_face_populated_returns_malformed(self) -> None:
        selection = FaceCandidateSelection(
            status=FaceCandidateSelectionStatus.NO_FACE,
            selected_face=_selected_face(_full_categories(), IDENTITY_MATRIX),
        )
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_multiple_faces_with_selected_face_populated_returns_malformed(
        self,
    ) -> None:
        selection = FaceCandidateSelection(
            status=FaceCandidateSelectionStatus.MULTIPLE_FACES,
            selected_face=_selected_face(_full_categories(), IDENTITY_MATRIX),
        )
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_malformed_with_selected_face_populated_returns_malformed(self) -> None:
        selection = FaceCandidateSelection(
            status=FaceCandidateSelectionStatus.MALFORMED,
            selected_face=_selected_face(_full_categories(), IDENTITY_MATRIX),
        )
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_unexpected_status_value_returns_malformed(self) -> None:
        selection = FaceCandidateSelection(status="unexpected", selected_face=None)
        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_none_input_returns_malformed(self) -> None:
        observation = compose_face_candidate_observation(None)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_wrong_input_type_returns_malformed(self) -> None:
        for bad_input in ("not-a-selection", 42, {"status": "single_face"}):
            with self.subTest(bad_input=bad_input):
                observation = compose_face_candidate_observation(bad_input)
                self.assertEqual(
                    observation.status, FaceCandidateObservationStatus.MALFORMED
                )
                self.assertIsNone(observation.face_rotation)
                self.assertIsNone(observation.expressions)

    def test_selected_face_candidate_input_directly_returns_malformed(self) -> None:
        bare_selected_face = _selected_face(_full_categories(), IDENTITY_MATRIX)
        observation = compose_face_candidate_observation(bare_selected_face)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(observation.face_rotation)
        self.assertIsNone(observation.expressions)

    def test_status_and_payload_invariants_for_all_statuses(self) -> None:
        no_face = compose_face_candidate_observation(
            FaceCandidateSelection(
                status=FaceCandidateSelectionStatus.NO_FACE, selected_face=None
            )
        )
        multiple_faces = compose_face_candidate_observation(
            FaceCandidateSelection(
                status=FaceCandidateSelectionStatus.MULTIPLE_FACES, selected_face=None
            )
        )
        malformed = compose_face_candidate_observation(
            FaceCandidateSelection(
                status=FaceCandidateSelectionStatus.MALFORMED, selected_face=None
            )
        )
        valid_face = compose_face_candidate_observation(
            _single_face_selection(_full_categories(), IDENTITY_MATRIX)
        )

        self.assertEqual(no_face.status, FaceCandidateObservationStatus.NO_FACE)
        self.assertIsNone(no_face.face_rotation)
        self.assertIsNone(no_face.expressions)

        self.assertEqual(
            multiple_faces.status, FaceCandidateObservationStatus.MULTIPLE_FACES
        )
        self.assertIsNone(multiple_faces.face_rotation)
        self.assertIsNone(multiple_faces.expressions)

        self.assertEqual(malformed.status, FaceCandidateObservationStatus.MALFORMED)
        self.assertIsNone(malformed.face_rotation)
        self.assertIsNone(malformed.expressions)

        self.assertEqual(valid_face.status, FaceCandidateObservationStatus.VALID_FACE)
        self.assertIsInstance(valid_face.face_rotation, FaceRotationValues)
        self.assertIsInstance(valid_face.expressions, ExpressionValues)

    def test_output_expression_values_are_finite_and_bounded(self) -> None:
        selection = _single_face_selection(_full_categories(), IDENTITY_MATRIX)
        observation = compose_face_candidate_observation(selection)
        for value in dataclasses.astuple(observation.expressions):
            self.assertTrue(math.isfinite(value))
            self.assertGreaterEqual(value, 0.0)
            self.assertLessEqual(value, 1.0)

    def test_output_rotation_values_are_finite_and_bounded(self) -> None:
        selection = _single_face_selection(_full_categories(), _ROTATED_SCALED_MATRIX)
        observation = compose_face_candidate_observation(selection)
        for value in dataclasses.astuple(observation.face_rotation):
            self.assertTrue(math.isfinite(value))
            self.assertGreaterEqual(value, -FACE_ROTATION_LIMIT_RADIANS)
            self.assertLessEqual(value, FACE_ROTATION_LIMIT_RADIANS)

    def test_input_selection_and_inner_payloads_are_not_mutated(self) -> None:
        categories = _full_categories()
        matrix = _affine(IDENTITY_3X3)
        selection = _single_face_selection(categories, matrix)

        categories_before = list(categories)
        matrix_before = [list(row) for row in matrix]

        compose_face_candidate_observation(selection)

        self.assertEqual(categories, categories_before)
        self.assertEqual(matrix, matrix_before)
        self.assertIs(selection.selected_face.blendshape_categories, categories)
        self.assertIs(selection.selected_face.facial_transformation_matrix, matrix)

    def test_face_candidate_observation_is_frozen(self) -> None:
        selection = FaceCandidateSelection(
            status=FaceCandidateSelectionStatus.NO_FACE, selected_face=None
        )
        observation = compose_face_candidate_observation(selection)
        with self.assertRaises(FrozenInstanceError):
            observation.status = FaceCandidateObservationStatus.VALID_FACE

    def test_dataclass_fields_exclude_forbidden_fields(self) -> None:
        field_names = {
            field.name for field in dataclasses.fields(FaceCandidateObservation)
        }
        self.assertEqual(field_names, {"status", "face_rotation", "expressions"})

    def test_end_to_end_raw_result_through_selection_and_composition(self) -> None:
        categories = _full_categories()
        matrix = _affine(IDENTITY_3X3)
        result = FakeFaceLandmarkerResult(
            face_landmarks=[object()],
            face_blendshapes=[categories],
            facial_transformation_matrixes=[matrix],
        )

        selection = select_single_face_candidate(result)
        self.assertEqual(
            selection.status, FaceCandidateSelectionStatus.SINGLE_FACE
        )

        observation = compose_face_candidate_observation(selection)
        self.assertEqual(observation.status, FaceCandidateObservationStatus.VALID_FACE)
        self.assertIsInstance(observation.expressions, ExpressionValues)
        self.assertIsInstance(observation.face_rotation, FaceRotationValues)
        self.assertAlmostEqual(observation.face_rotation.pitch, 0.0)
        self.assertAlmostEqual(observation.face_rotation.yaw, 0.0)
        self.assertAlmostEqual(observation.face_rotation.roll, 0.0)


if __name__ == "__main__":
    unittest.main()
