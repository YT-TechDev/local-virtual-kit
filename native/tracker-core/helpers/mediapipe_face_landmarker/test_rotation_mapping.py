"""Standard-library tests for rotation_mapping.py.

Run directly: python -B test_rotation_mapping.py
"""

import dataclasses
import math
import unittest

from matrix_mapping import NormalizedRotationMatrix, normalize_facial_transform_matrix
from rotation_mapping import (
    FACE_ROTATION_LIMIT_RADIANS,
    FaceRotationValues,
    map_normalized_rotation_to_face_rotation,
)

Matrix3 = tuple[
    tuple[float, float, float],
    tuple[float, float, float],
    tuple[float, float, float],
]


def _multiply(a: Matrix3, b: Matrix3) -> Matrix3:
    """Multiplies two 3x3 matrices (row-major, a * b)."""
    return tuple(
        tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3))
        for i in range(3)
    )


def _rotation_x(angle: float) -> Matrix3:
    """Right-handed rotation matrix about +X."""
    c, s = math.cos(angle), math.sin(angle)
    return (
        (1.0, 0.0, 0.0),
        (0.0, c, -s),
        (0.0, s, c),
    )


def _rotation_y(angle: float) -> Matrix3:
    """Right-handed rotation matrix about +Y."""
    c, s = math.cos(angle), math.sin(angle)
    return (
        (c, 0.0, s),
        (0.0, 1.0, 0.0),
        (-s, 0.0, c),
    )


def _rotation_z(angle: float) -> Matrix3:
    """Right-handed rotation matrix about +Z."""
    c, s = math.cos(angle), math.sin(angle)
    return (
        (c, -s, 0.0),
        (s, c, 0.0),
        (0.0, 0.0, 1.0),
    )


def _compose_xyz(pitch: float, yaw: float, roll: float) -> Matrix3:
    """Builds R = Rx(pitch) * Ry(yaw) * Rz(roll), matching Three.js XYZ order."""
    return _multiply(_multiply(_rotation_x(pitch), _rotation_y(yaw)), _rotation_z(roll))


def _rotation(pitch: float, yaw: float, roll: float) -> NormalizedRotationMatrix:
    return NormalizedRotationMatrix(rows=_compose_xyz(pitch, yaw, roll))


def _affine(rotation: Matrix3, scale: float = 1.0) -> list[list[float]]:
    """Builds a uniformly scaled 4x4 affine matrix from a 3x3 rotation block."""
    return [
        [rotation[0][0] * scale, rotation[0][1] * scale, rotation[0][2] * scale, 0.0],
        [rotation[1][0] * scale, rotation[1][1] * scale, rotation[1][2] * scale, 0.0],
        [rotation[2][0] * scale, rotation[2][1] * scale, rotation[2][2] * scale, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


IDENTITY = NormalizedRotationMatrix(
    rows=((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
)


class MapNormalizedRotationToFaceRotationTests(unittest.TestCase):
    def test_identity_is_neutral(self) -> None:
        result = map_normalized_rotation_to_face_rotation(IDENTITY)
        self.assertEqual(result, FaceRotationValues(pitch=0.0, yaw=0.0, roll=0.0))

    def test_positive_pure_x_rotation(self) -> None:
        result = map_normalized_rotation_to_face_rotation(_rotation(0.3, 0.0, 0.0))
        self.assertAlmostEqual(result.pitch, 0.3, places=9)
        self.assertAlmostEqual(result.yaw, 0.0, places=9)
        self.assertAlmostEqual(result.roll, 0.0, places=9)

    def test_negative_pure_x_rotation(self) -> None:
        result = map_normalized_rotation_to_face_rotation(_rotation(-0.3, 0.0, 0.0))
        self.assertAlmostEqual(result.pitch, -0.3, places=9)
        self.assertAlmostEqual(result.yaw, 0.0, places=9)
        self.assertAlmostEqual(result.roll, 0.0, places=9)

    def test_positive_pure_y_rotation(self) -> None:
        result = map_normalized_rotation_to_face_rotation(_rotation(0.0, 0.3, 0.0))
        self.assertAlmostEqual(result.pitch, 0.0, places=9)
        self.assertAlmostEqual(result.yaw, 0.3, places=9)
        self.assertAlmostEqual(result.roll, 0.0, places=9)

    def test_negative_pure_y_rotation(self) -> None:
        result = map_normalized_rotation_to_face_rotation(_rotation(0.0, -0.3, 0.0))
        self.assertAlmostEqual(result.pitch, 0.0, places=9)
        self.assertAlmostEqual(result.yaw, -0.3, places=9)
        self.assertAlmostEqual(result.roll, 0.0, places=9)

    def test_positive_pure_z_rotation(self) -> None:
        result = map_normalized_rotation_to_face_rotation(_rotation(0.0, 0.0, 0.3))
        self.assertAlmostEqual(result.pitch, 0.0, places=9)
        self.assertAlmostEqual(result.yaw, 0.0, places=9)
        self.assertAlmostEqual(result.roll, 0.3, places=9)

    def test_negative_pure_z_rotation(self) -> None:
        result = map_normalized_rotation_to_face_rotation(_rotation(0.0, 0.0, -0.3))
        self.assertAlmostEqual(result.pitch, 0.0, places=9)
        self.assertAlmostEqual(result.yaw, 0.0, places=9)
        self.assertAlmostEqual(result.roll, -0.3, places=9)

    def test_combined_non_singular_rotation(self) -> None:
        result = map_normalized_rotation_to_face_rotation(_rotation(0.2, 0.3, 0.1))
        self.assertAlmostEqual(result.pitch, 0.2, places=9)
        self.assertAlmostEqual(result.yaw, 0.3, places=9)
        self.assertAlmostEqual(result.roll, 0.1, places=9)

    def test_output_is_in_radians_not_degrees(self) -> None:
        angle_radians = math.pi / 6
        result = map_normalized_rotation_to_face_rotation(_rotation(0.0, angle_radians, 0.0))
        self.assertAlmostEqual(result.yaw, angle_radians, places=9)
        self.assertNotAlmostEqual(result.yaw, 30.0, places=1)

    def test_positive_value_above_limit_clamps_to_positive_limit(self) -> None:
        result = map_normalized_rotation_to_face_rotation(_rotation(1.4, 0.0, 0.0))
        self.assertEqual(result.pitch, FACE_ROTATION_LIMIT_RADIANS)

    def test_negative_value_below_limit_clamps_to_negative_limit(self) -> None:
        result = map_normalized_rotation_to_face_rotation(_rotation(-1.4, 0.0, 0.0))
        self.assertEqual(result.pitch, -FACE_ROTATION_LIMIT_RADIANS)

    def test_exact_positive_yaw_singularity(self) -> None:
        result = map_normalized_rotation_to_face_rotation(_rotation(0.0, math.pi / 2, 0.0))
        self.assertEqual(result.yaw, FACE_ROTATION_LIMIT_RADIANS)
        self.assertAlmostEqual(result.pitch, 0.0, places=9)
        self.assertEqual(result.roll, 0.0)

    def test_exact_negative_yaw_singularity(self) -> None:
        result = map_normalized_rotation_to_face_rotation(_rotation(0.0, -math.pi / 2, 0.0))
        self.assertEqual(result.yaw, -FACE_ROTATION_LIMIT_RADIANS)
        self.assertAlmostEqual(result.pitch, 0.0, places=9)
        self.assertEqual(result.roll, 0.0)

    def test_combined_positive_singularity_has_deterministic_zero_roll(self) -> None:
        result = map_normalized_rotation_to_face_rotation(
            _rotation(0.3, math.pi / 2, 0.2)
        )
        self.assertEqual(result.yaw, FACE_ROTATION_LIMIT_RADIANS)
        self.assertAlmostEqual(result.pitch, 0.5, places=9)
        self.assertEqual(result.roll, 0.0)

    def test_combined_negative_singularity_has_deterministic_zero_roll(self) -> None:
        result = map_normalized_rotation_to_face_rotation(
            _rotation(0.3, -math.pi / 2, 0.2)
        )
        self.assertEqual(result.yaw, -FACE_ROTATION_LIMIT_RADIANS)
        self.assertAlmostEqual(result.pitch, 0.1, places=9)
        self.assertEqual(result.roll, 0.0)

    def test_integration_through_normalize_facial_transform_matrix(self) -> None:
        rotation_block = _compose_xyz(0.2, 0.3, 0.1)
        matrix = _affine(rotation_block, scale=2.0)

        normalized = normalize_facial_transform_matrix(matrix)
        self.assertIsNotNone(normalized)

        result = map_normalized_rotation_to_face_rotation(normalized)
        self.assertAlmostEqual(result.pitch, 0.2, places=9)
        self.assertAlmostEqual(result.yaw, 0.3, places=9)
        self.assertAlmostEqual(result.roll, 0.1, places=9)

    def test_output_fields_are_finite(self) -> None:
        cases = [
            IDENTITY,
            _rotation(0.2, 0.3, 0.1),
            _rotation(1.4, -1.4, 0.0),
            _rotation(0.0, math.pi / 2, 0.0),
            _rotation(0.0, -math.pi / 2, 0.0),
            _rotation(0.3, math.pi / 2, 0.2),
            _rotation(0.3, -math.pi / 2, 0.2),
        ]
        for rotation in cases:
            result = map_normalized_rotation_to_face_rotation(rotation)
            self.assertTrue(math.isfinite(result.pitch))
            self.assertTrue(math.isfinite(result.yaw))
            self.assertTrue(math.isfinite(result.roll))

    def test_output_fields_remain_within_bounds(self) -> None:
        cases = [
            IDENTITY,
            _rotation(0.2, 0.3, 0.1),
            _rotation(1.4, -1.4, 0.0),
            _rotation(0.0, math.pi / 2, 0.0),
            _rotation(0.0, -math.pi / 2, 0.0),
            _rotation(0.3, math.pi / 2, 0.2),
            _rotation(0.3, -math.pi / 2, 0.2),
        ]
        for rotation in cases:
            result = map_normalized_rotation_to_face_rotation(rotation)
            self.assertGreaterEqual(result.pitch, -FACE_ROTATION_LIMIT_RADIANS)
            self.assertLessEqual(result.pitch, FACE_ROTATION_LIMIT_RADIANS)
            self.assertGreaterEqual(result.yaw, -FACE_ROTATION_LIMIT_RADIANS)
            self.assertLessEqual(result.yaw, FACE_ROTATION_LIMIT_RADIANS)
            self.assertGreaterEqual(result.roll, -FACE_ROTATION_LIMIT_RADIANS)
            self.assertLessEqual(result.roll, FACE_ROTATION_LIMIT_RADIANS)

    def test_face_rotation_values_is_frozen(self) -> None:
        result = map_normalized_rotation_to_face_rotation(IDENTITY)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.pitch = 0.5  # type: ignore[misc]

    def test_input_normalized_rotation_matrix_is_unchanged(self) -> None:
        rotation = _rotation(0.2, 0.3, 0.1)
        before = rotation.rows
        map_normalized_rotation_to_face_rotation(rotation)
        self.assertEqual(rotation.rows, before)


if __name__ == "__main__":
    unittest.main()
