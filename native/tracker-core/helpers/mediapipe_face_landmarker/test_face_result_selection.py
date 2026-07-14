"""Standard-library tests for face_result_selection.py.

Run directly: python -B test_face_result_selection.py
"""

import dataclasses
import unittest
from collections.abc import Sequence as SequenceABC
from dataclasses import FrozenInstanceError, dataclass

from blendshape_category_adapter import extract_expression_blendshape_scores
from expression_mapping import ExpressionValues, map_blendshape_scores
from face_result_selection import (
    FaceCandidateSelection,
    FaceCandidateSelectionStatus,
    SelectedFaceCandidate,
    select_single_face_candidate,
)
from matrix_mapping import normalize_facial_transform_matrix
from rotation_mapping import map_normalized_rotation_to_face_rotation

_OUTER_FIELD_NAMES = (
    "face_landmarks",
    "face_blendshapes",
    "facial_transformation_matrixes",
)


@dataclass
class FakeFaceLandmarkerResult:
    """Synthetic stand-in for a MediaPipe FaceLandmarkerResult, not imported here."""

    face_landmarks: object
    face_blendshapes: object
    facial_transformation_matrixes: object


@dataclass
class _FakeCategory:
    """Minimal category-like object matching blendshape_category_adapter's Protocol."""

    category_name: str | None
    score: float | None


def _make_result(face_count: int) -> FakeFaceLandmarkerResult:
    return FakeFaceLandmarkerResult(
        face_landmarks=[object() for _ in range(face_count)],
        face_blendshapes=[object() for _ in range(face_count)],
        facial_transformation_matrixes=[object() for _ in range(face_count)],
    )


def _make_result_with_counts(
    landmark_count: int, blendshape_count: int, matrix_count: int
) -> FakeFaceLandmarkerResult:
    return FakeFaceLandmarkerResult(
        face_landmarks=[object() for _ in range(landmark_count)],
        face_blendshapes=[object() for _ in range(blendshape_count)],
        facial_transformation_matrixes=[object() for _ in range(matrix_count)],
    )


def _make_result_with_outer_override(field_name: str, value: object):
    kwargs = {name: [object()] for name in _OUTER_FIELD_NAMES}
    kwargs[field_name] = value
    return FakeFaceLandmarkerResult(**kwargs)


class _LenRaisesSequence(SequenceABC):
    """Reports Sequence membership but raises when its length is read."""

    def __getitem__(self, index):
        return object()

    def __len__(self):
        raise RuntimeError("len failed")


class _IndexRaisesSequence(SequenceABC):
    """Reports length 1 but raises on index access."""

    def __len__(self):
        return 1

    def __getitem__(self, index):
        raise RuntimeError("getitem failed")


class _NonSequence:
    """Plain object with no Sequence protocol support."""


class _MissingFaceLandmarksResult:
    face_blendshapes: object = []
    facial_transformation_matrixes: object = []


class _MissingFaceBlendshapesResult:
    face_landmarks: object = []
    facial_transformation_matrixes: object = []


class _MissingMatrixesResult:
    face_landmarks: object = []
    face_blendshapes: object = []


class _RaisingFaceLandmarksResult:
    face_blendshapes: object = []
    facial_transformation_matrixes: object = []

    @property
    def face_landmarks(self):
        raise RuntimeError("face_landmarks access failed")


class _RaisingFaceBlendshapesResult:
    face_landmarks: object = []
    facial_transformation_matrixes: object = []

    @property
    def face_blendshapes(self):
        raise RuntimeError("face_blendshapes access failed")


class _RaisingMatrixesResult:
    face_landmarks: object = []
    face_blendshapes: object = []

    @property
    def facial_transformation_matrixes(self):
        raise RuntimeError("facial_transformation_matrixes access failed")


class SelectSingleFaceCandidateTests(unittest.TestCase):
    def test_all_empty_returns_no_face(self) -> None:
        selection = select_single_face_candidate(_make_result(0))
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.NO_FACE)
        self.assertIsNone(selection.selected_face)

    def test_one_aligned_face_returns_single_face(self) -> None:
        selection = select_single_face_candidate(_make_result(1))
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.SINGLE_FACE)
        self.assertIsNotNone(selection.selected_face)

    def test_two_aligned_faces_returns_multiple_faces(self) -> None:
        selection = select_single_face_candidate(_make_result(2))
        self.assertEqual(
            selection.status, FaceCandidateSelectionStatus.MULTIPLE_FACES
        )
        self.assertIsNone(selection.selected_face)

    def test_three_aligned_faces_returns_multiple_faces(self) -> None:
        selection = select_single_face_candidate(_make_result(3))
        self.assertEqual(
            selection.status, FaceCandidateSelectionStatus.MULTIPLE_FACES
        )
        self.assertIsNone(selection.selected_face)

    def test_multiple_faces_never_selects_first_face(self) -> None:
        first_blendshape = object()
        first_matrix = object()
        result = FakeFaceLandmarkerResult(
            face_landmarks=[object(), object()],
            face_blendshapes=[first_blendshape, object()],
            facial_transformation_matrixes=[first_matrix, object()],
        )
        selection = select_single_face_candidate(result)
        self.assertEqual(
            selection.status, FaceCandidateSelectionStatus.MULTIPLE_FACES
        )
        self.assertIsNone(selection.selected_face)

    def test_mismatch_1_0_0_returns_malformed(self) -> None:
        selection = select_single_face_candidate(_make_result_with_counts(1, 0, 0))
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.MALFORMED)
        self.assertIsNone(selection.selected_face)

    def test_mismatch_1_1_0_returns_malformed(self) -> None:
        selection = select_single_face_candidate(_make_result_with_counts(1, 1, 0))
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.MALFORMED)
        self.assertIsNone(selection.selected_face)

    def test_mismatch_0_1_1_returns_malformed(self) -> None:
        selection = select_single_face_candidate(_make_result_with_counts(0, 1, 1))
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.MALFORMED)
        self.assertIsNone(selection.selected_face)

    def test_mismatch_2_1_2_returns_malformed(self) -> None:
        selection = select_single_face_candidate(_make_result_with_counts(2, 1, 2))
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.MALFORMED)
        self.assertIsNone(selection.selected_face)

    def test_result_none_returns_malformed(self) -> None:
        selection = select_single_face_candidate(None)
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.MALFORMED)
        self.assertIsNone(selection.selected_face)

    def test_missing_face_landmarks_returns_malformed(self) -> None:
        selection = select_single_face_candidate(_MissingFaceLandmarksResult())
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.MALFORMED)

    def test_missing_face_blendshapes_returns_malformed(self) -> None:
        selection = select_single_face_candidate(_MissingFaceBlendshapesResult())
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.MALFORMED)

    def test_missing_facial_transformation_matrixes_returns_malformed(self) -> None:
        selection = select_single_face_candidate(_MissingMatrixesResult())
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.MALFORMED)

    def test_raising_face_landmarks_returns_malformed(self) -> None:
        selection = select_single_face_candidate(_RaisingFaceLandmarksResult())
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.MALFORMED)

    def test_raising_face_blendshapes_returns_malformed(self) -> None:
        selection = select_single_face_candidate(_RaisingFaceBlendshapesResult())
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.MALFORMED)

    def test_raising_facial_transformation_matrixes_returns_malformed(self) -> None:
        selection = select_single_face_candidate(_RaisingMatrixesResult())
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.MALFORMED)

    def test_outer_none_returns_malformed(self) -> None:
        for field_name in _OUTER_FIELD_NAMES:
            with self.subTest(field=field_name):
                result = _make_result_with_outer_override(field_name, None)
                selection = select_single_face_candidate(result)
                self.assertEqual(
                    selection.status, FaceCandidateSelectionStatus.MALFORMED
                )

    def test_outer_str_returns_malformed(self) -> None:
        for field_name in _OUTER_FIELD_NAMES:
            with self.subTest(field=field_name):
                result = _make_result_with_outer_override(field_name, "a")
                selection = select_single_face_candidate(result)
                self.assertEqual(
                    selection.status, FaceCandidateSelectionStatus.MALFORMED
                )

    def test_outer_bytes_returns_malformed(self) -> None:
        for field_name in _OUTER_FIELD_NAMES:
            with self.subTest(field=field_name):
                result = _make_result_with_outer_override(field_name, b"a")
                selection = select_single_face_candidate(result)
                self.assertEqual(
                    selection.status, FaceCandidateSelectionStatus.MALFORMED
                )

    def test_outer_bytearray_returns_malformed(self) -> None:
        for field_name in _OUTER_FIELD_NAMES:
            with self.subTest(field=field_name):
                result = _make_result_with_outer_override(field_name, bytearray(b"a"))
                selection = select_single_face_candidate(result)
                self.assertEqual(
                    selection.status, FaceCandidateSelectionStatus.MALFORMED
                )

    def test_outer_generator_returns_malformed(self) -> None:
        for field_name in _OUTER_FIELD_NAMES:
            with self.subTest(field=field_name):
                result = _make_result_with_outer_override(
                    field_name, (x for x in range(1))
                )
                selection = select_single_face_candidate(result)
                self.assertEqual(
                    selection.status, FaceCandidateSelectionStatus.MALFORMED
                )

    def test_outer_non_sequence_returns_malformed(self) -> None:
        for field_name in _OUTER_FIELD_NAMES:
            with self.subTest(field=field_name):
                result = _make_result_with_outer_override(field_name, _NonSequence())
                selection = select_single_face_candidate(result)
                self.assertEqual(
                    selection.status, FaceCandidateSelectionStatus.MALFORMED
                )

    def test_outer_len_raises_returns_malformed(self) -> None:
        for field_name in _OUTER_FIELD_NAMES:
            with self.subTest(field=field_name):
                result = _make_result_with_outer_override(
                    field_name, _LenRaisesSequence()
                )
                selection = select_single_face_candidate(result)
                self.assertEqual(
                    selection.status, FaceCandidateSelectionStatus.MALFORMED
                )

    def test_index_access_raises_despite_reported_length_returns_malformed(
        self,
    ) -> None:
        for field_name in _OUTER_FIELD_NAMES:
            with self.subTest(field=field_name):
                result = _make_result_with_outer_override(
                    field_name, _IndexRaisesSequence()
                )
                selection = select_single_face_candidate(result)
                self.assertEqual(
                    selection.status, FaceCandidateSelectionStatus.MALFORMED
                )

    def test_selected_blendshape_payload_is_exact_original_object(self) -> None:
        sentinel_blendshapes = object()
        result = FakeFaceLandmarkerResult(
            face_landmarks=[object()],
            face_blendshapes=[sentinel_blendshapes],
            facial_transformation_matrixes=[object()],
        )
        selection = select_single_face_candidate(result)
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.SINGLE_FACE)
        self.assertIs(
            selection.selected_face.blendshape_categories, sentinel_blendshapes
        )

    def test_selected_matrix_payload_is_exact_original_object(self) -> None:
        sentinel_matrix = object()
        result = FakeFaceLandmarkerResult(
            face_landmarks=[object()],
            face_blendshapes=[object()],
            facial_transformation_matrixes=[sentinel_matrix],
        )
        selection = select_single_face_candidate(result)
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.SINGLE_FACE)
        self.assertIs(
            selection.selected_face.facial_transformation_matrix, sentinel_matrix
        )

    def test_landmarks_are_not_present_in_selected_face_candidate(self) -> None:
        field_names = {field.name for field in dataclasses.fields(SelectedFaceCandidate)}
        self.assertEqual(field_names, {"blendshape_categories", "facial_transformation_matrix"})

    def test_input_is_not_mutated(self) -> None:
        landmarks = [object()]
        blendshapes = [object()]
        matrixes = [object()]
        result = FakeFaceLandmarkerResult(
            face_landmarks=landmarks,
            face_blendshapes=blendshapes,
            facial_transformation_matrixes=matrixes,
        )
        select_single_face_candidate(result)
        self.assertEqual(result.face_landmarks, landmarks)
        self.assertEqual(result.face_blendshapes, blendshapes)
        self.assertEqual(result.facial_transformation_matrixes, matrixes)
        self.assertEqual(len(landmarks), 1)
        self.assertEqual(len(blendshapes), 1)
        self.assertEqual(len(matrixes), 1)

    def test_face_candidate_selection_is_frozen(self) -> None:
        selection = select_single_face_candidate(_make_result(0))
        with self.assertRaises(FrozenInstanceError):
            selection.status = FaceCandidateSelectionStatus.SINGLE_FACE

    def test_selected_face_candidate_is_frozen(self) -> None:
        selection = select_single_face_candidate(_make_result(1))
        with self.assertRaises(FrozenInstanceError):
            selection.selected_face.blendshape_categories = object()

    def test_invalid_inner_blendshape_payload_still_classifies_as_single_face(
        self,
    ) -> None:
        opaque_blendshapes = "not a valid categories sequence"
        result = FakeFaceLandmarkerResult(
            face_landmarks=[object()],
            face_blendshapes=[opaque_blendshapes],
            facial_transformation_matrixes=[object()],
        )
        selection = select_single_face_candidate(result)
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.SINGLE_FACE)
        self.assertIs(
            selection.selected_face.blendshape_categories, opaque_blendshapes
        )

    def test_invalid_inner_matrix_payload_still_classifies_as_single_face(
        self,
    ) -> None:
        opaque_matrix = None
        result = FakeFaceLandmarkerResult(
            face_landmarks=[object()],
            face_blendshapes=[object()],
            facial_transformation_matrixes=[opaque_matrix],
        )
        selection = select_single_face_candidate(result)
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.SINGLE_FACE)
        self.assertIs(
            selection.selected_face.facial_transformation_matrix, opaque_matrix
        )

    def test_status_and_selected_face_invariants_for_all_statuses(self) -> None:
        no_face = select_single_face_candidate(_make_result(0))
        single_face = select_single_face_candidate(_make_result(1))
        multiple_faces = select_single_face_candidate(_make_result(2))
        malformed = select_single_face_candidate(None)

        self.assertEqual(no_face.status, FaceCandidateSelectionStatus.NO_FACE)
        self.assertIsNone(no_face.selected_face)

        self.assertEqual(single_face.status, FaceCandidateSelectionStatus.SINGLE_FACE)
        self.assertIsInstance(single_face.selected_face, SelectedFaceCandidate)

        self.assertEqual(
            multiple_faces.status, FaceCandidateSelectionStatus.MULTIPLE_FACES
        )
        self.assertIsNone(multiple_faces.selected_face)

        self.assertEqual(malformed.status, FaceCandidateSelectionStatus.MALFORMED)
        self.assertIsNone(malformed.selected_face)

    def test_integration_selection_to_expression_mapping(self) -> None:
        categories = [
            _FakeCategory("eyeBlinkLeft", 0.25),
            _FakeCategory("jawOpen", 0.6),
        ]
        result = FakeFaceLandmarkerResult(
            face_landmarks=[object()],
            face_blendshapes=[categories],
            facial_transformation_matrixes=[object()],
        )
        selection = select_single_face_candidate(result)
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.SINGLE_FACE)

        scores = extract_expression_blendshape_scores(
            selection.selected_face.blendshape_categories
        )
        self.assertIsNotNone(scores)

        expression = map_blendshape_scores(scores)
        self.assertIsInstance(expression, ExpressionValues)
        self.assertAlmostEqual(expression.mouth_open, 0.6)
        self.assertAlmostEqual(expression.left_eye_open, 0.75)

    def test_integration_selection_to_rotation_mapping(self) -> None:
        identity_matrix = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ]
        result = FakeFaceLandmarkerResult(
            face_landmarks=[object()],
            face_blendshapes=[object()],
            facial_transformation_matrixes=[identity_matrix],
        )
        selection = select_single_face_candidate(result)
        self.assertEqual(selection.status, FaceCandidateSelectionStatus.SINGLE_FACE)

        normalized = normalize_facial_transform_matrix(
            selection.selected_face.facial_transformation_matrix
        )
        self.assertIsNotNone(normalized)

        rotation = map_normalized_rotation_to_face_rotation(normalized)
        self.assertAlmostEqual(rotation.pitch, 0.0)
        self.assertAlmostEqual(rotation.yaw, 0.0)
        self.assertAlmostEqual(rotation.roll, 0.0)


if __name__ == "__main__":
    unittest.main()
