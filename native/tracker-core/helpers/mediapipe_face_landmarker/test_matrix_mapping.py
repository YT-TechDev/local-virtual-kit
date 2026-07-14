"""Standard-library tests for matrix_mapping.py.

Run directly: python -B test_matrix_mapping.py
"""

import math
import unittest

from matrix_mapping import (
    MATRIX_TOLERANCE,
    NormalizedRotationMatrix,
    normalize_facial_transform_matrix,
)


class UnsupportedValue:
    """A placeholder object that is not a valid numeric matrix element."""


def _affine(
    rotation: list[list[float]],
    translation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> list[list[float]]:
    """Builds a 4x4 affine matrix from a 3x3 upper-left block and translation."""
    return [
        [rotation[0][0], rotation[0][1], rotation[0][2], translation[0]],
        [rotation[1][0], rotation[1][1], rotation[1][2], translation[1]],
        [rotation[2][0], rotation[2][1], rotation[2][2], translation[2]],
        [0.0, 0.0, 0.0, 1.0],
    ]


IDENTITY_3X3 = [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
]

# 90-degree rotation about X: [[1,0,0],[0,cos,-sin],[0,sin,cos]]
ROTATE_X_90 = [
    [1.0, 0.0, 0.0],
    [0.0, 0.0, -1.0],
    [0.0, 1.0, 0.0],
]

# 90-degree rotation about Y: [[cos,0,sin],[0,1,0],[-sin,0,cos]]
ROTATE_Y_90 = [
    [0.0, 0.0, 1.0],
    [0.0, 1.0, 0.0],
    [-1.0, 0.0, 0.0],
]

# 90-degree rotation about Z: [[cos,-sin,0],[sin,cos,0],[0,0,1]]
ROTATE_Z_90 = [
    [0.0, -1.0, 0.0],
    [1.0, 0.0, 0.0],
    [0.0, 0.0, 1.0],
]


def _scale_columns(rotation: list[list[float]], scale: float) -> list[list[float]]:
    return [[value * scale for value in row] for row in rotation]


class NormalizeFacialTransformMatrixTests(unittest.TestCase):
    def test_identity_matrix(self) -> None:
        result = normalize_facial_transform_matrix(_affine(IDENTITY_3X3))
        self.assertEqual(
            result,
            NormalizedRotationMatrix(
                rows=(
                    (1.0, 0.0, 0.0),
                    (0.0, 1.0, 0.0),
                    (0.0, 0.0, 1.0),
                )
            ),
        )

    def test_translation_only_matrix(self) -> None:
        result = normalize_facial_transform_matrix(
            _affine(IDENTITY_3X3, translation=(10.0, -5.0, 2.5))
        )
        self.assertEqual(
            result,
            NormalizedRotationMatrix(
                rows=(
                    (1.0, 0.0, 0.0),
                    (0.0, 1.0, 0.0),
                    (0.0, 0.0, 1.0),
                )
            ),
        )

    def test_uniform_scale_of_identity(self) -> None:
        result = normalize_facial_transform_matrix(
            _affine(_scale_columns(IDENTITY_3X3, 3.0))
        )
        self.assertEqual(
            result,
            NormalizedRotationMatrix(
                rows=(
                    (1.0, 0.0, 0.0),
                    (0.0, 1.0, 0.0),
                    (0.0, 0.0, 1.0),
                )
            ),
        )

    def test_known_rotation_about_x(self) -> None:
        result = normalize_facial_transform_matrix(_affine(ROTATE_X_90))
        self.assertIsNotNone(result)
        for actual_row, expected_row in zip(result.rows, ROTATE_X_90):
            for actual, expected in zip(actual_row, expected_row):
                self.assertAlmostEqual(actual, expected)

    def test_known_rotation_about_y(self) -> None:
        result = normalize_facial_transform_matrix(_affine(ROTATE_Y_90))
        self.assertIsNotNone(result)
        for actual_row, expected_row in zip(result.rows, ROTATE_Y_90):
            for actual, expected in zip(actual_row, expected_row):
                self.assertAlmostEqual(actual, expected)

    def test_known_rotation_about_z(self) -> None:
        result = normalize_facial_transform_matrix(_affine(ROTATE_Z_90))
        self.assertIsNotNone(result)
        for actual_row, expected_row in zip(result.rows, ROTATE_Z_90):
            for actual, expected in zip(actual_row, expected_row):
                self.assertAlmostEqual(actual, expected)

    def test_scaled_known_rotation(self) -> None:
        scaled = _scale_columns(ROTATE_Z_90, 4.0)
        result = normalize_facial_transform_matrix(_affine(scaled))
        self.assertIsNotNone(result)
        for actual_row, expected_row in zip(result.rows, ROTATE_Z_90):
            for actual, expected in zip(actual_row, expected_row):
                self.assertAlmostEqual(actual, expected)

    def test_too_few_rows_is_rejected(self) -> None:
        matrix = _affine(IDENTITY_3X3)[:3]
        self.assertIsNone(normalize_facial_transform_matrix(matrix))

    def test_too_many_rows_is_rejected(self) -> None:
        matrix = _affine(IDENTITY_3X3) + [[0.0, 0.0, 0.0, 1.0]]
        self.assertIsNone(normalize_facial_transform_matrix(matrix))

    def test_too_few_columns_is_rejected(self) -> None:
        matrix = [row[:3] for row in _affine(IDENTITY_3X3)]
        self.assertIsNone(normalize_facial_transform_matrix(matrix))

    def test_too_many_columns_is_rejected(self) -> None:
        matrix = [row + [0.0] for row in _affine(IDENTITY_3X3)]
        self.assertIsNone(normalize_facial_transform_matrix(matrix))

    def test_jagged_rows_are_rejected(self) -> None:
        matrix = _affine(IDENTITY_3X3)
        matrix[1] = matrix[1][:2]
        self.assertIsNone(normalize_facial_transform_matrix(matrix))

    def test_none_input_is_rejected(self) -> None:
        self.assertIsNone(normalize_facial_transform_matrix(None))

    def test_string_input_is_rejected(self) -> None:
        self.assertIsNone(normalize_facial_transform_matrix("not-a-matrix"))

    def test_bool_element_is_rejected(self) -> None:
        matrix = _affine(IDENTITY_3X3)
        matrix[0][0] = True
        self.assertIsNone(normalize_facial_transform_matrix(matrix))

    def test_unsupported_element_type_is_rejected(self) -> None:
        matrix = _affine(IDENTITY_3X3)
        matrix[0][0] = UnsupportedValue()
        self.assertIsNone(normalize_facial_transform_matrix(matrix))

    def test_nan_element_is_rejected(self) -> None:
        matrix = _affine(IDENTITY_3X3)
        matrix[0][0] = math.nan
        self.assertIsNone(normalize_facial_transform_matrix(matrix))

    def test_positive_infinity_element_is_rejected(self) -> None:
        matrix = _affine(IDENTITY_3X3)
        matrix[0][3] = math.inf
        self.assertIsNone(normalize_facial_transform_matrix(matrix))

    def test_negative_infinity_element_is_rejected(self) -> None:
        matrix = _affine(IDENTITY_3X3)
        matrix[1][3] = -math.inf
        self.assertIsNone(normalize_facial_transform_matrix(matrix))

    def test_invalid_last_row_is_rejected(self) -> None:
        matrix = _affine(IDENTITY_3X3)
        matrix[3] = [0.1, 0.0, 0.0, 1.0]
        self.assertIsNone(normalize_facial_transform_matrix(matrix))

    def test_zero_scale_is_rejected(self) -> None:
        zero_scaled = _scale_columns(IDENTITY_3X3, 0.0)
        self.assertIsNone(normalize_facial_transform_matrix(_affine(zero_scaled)))

    def test_near_zero_scale_is_rejected(self) -> None:
        near_zero = _scale_columns(IDENTITY_3X3, 1e-6)
        self.assertIsNone(normalize_facial_transform_matrix(_affine(near_zero)))

    def test_non_uniform_scale_is_rejected(self) -> None:
        matrix = _affine(
            [
                [2.0, 0.0, 0.0],
                [0.0, 3.0, 0.0],
                [0.0, 0.0, 4.0],
            ]
        )
        self.assertIsNone(normalize_facial_transform_matrix(matrix))

    def test_shear_is_rejected(self) -> None:
        matrix = _affine(
            [
                [1.0, 0.5, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
            ]
        )
        self.assertIsNone(normalize_facial_transform_matrix(matrix))

    def test_reflection_is_rejected(self) -> None:
        matrix = _affine(
            [
                [-1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
            ]
        )
        self.assertIsNone(normalize_facial_transform_matrix(matrix))

    def test_input_matrix_is_not_mutated(self) -> None:
        matrix = _affine(ROTATE_X_90, translation=(1.0, 2.0, 3.0))
        original = [list(row) for row in matrix]
        normalize_facial_transform_matrix(matrix)
        self.assertEqual(matrix, original)

    def test_result_entries_are_finite(self) -> None:
        result = normalize_facial_transform_matrix(_affine(ROTATE_Y_90))
        self.assertIsNotNone(result)
        for row in result.rows:
            for value in row:
                self.assertTrue(math.isfinite(value))

    def test_result_columns_are_unit_length_and_orthogonal(self) -> None:
        result = normalize_facial_transform_matrix(
            _affine(_scale_columns(ROTATE_X_90, 2.5))
        )
        self.assertIsNotNone(result)
        columns = [
            (result.rows[0][col], result.rows[1][col], result.rows[2][col])
            for col in range(3)
        ]
        for col in columns:
            length = math.sqrt(sum(component * component for component in col))
            self.assertAlmostEqual(length, 1.0)

        for i, j in ((0, 1), (0, 2), (1, 2)):
            dot = sum(a * b for a, b in zip(columns[i], columns[j]))
            self.assertAlmostEqual(dot, 0.0, delta=MATRIX_TOLERANCE * 10)

    def test_result_determinant_is_one(self) -> None:
        result = normalize_facial_transform_matrix(
            _affine(_scale_columns(ROTATE_Z_90, 1.5))
        )
        self.assertIsNotNone(result)
        columns = [
            (result.rows[0][col], result.rows[1][col], result.rows[2][col])
            for col in range(3)
        ]
        a, b, c = columns
        determinant = (
            a[0] * (b[1] * c[2] - b[2] * c[1])
            - a[1] * (b[0] * c[2] - b[2] * c[0])
            + a[2] * (b[0] * c[1] - b[1] * c[0])
        )
        self.assertAlmostEqual(determinant, 1.0)


if __name__ == "__main__":
    unittest.main()
