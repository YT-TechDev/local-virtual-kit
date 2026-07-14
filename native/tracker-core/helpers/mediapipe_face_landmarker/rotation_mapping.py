"""Maps a validated NormalizedRotationMatrix to LVK pitch/yaw/roll values.

Input boundary: this module only accepts a `NormalizedRotationMatrix` that
was already produced by `matrix_mapping.normalize_facial_transform_matrix`.
It does not accept raw nested 4x4 matrices and does not duplicate any shape,
scale, orthogonality, determinant, reflection, or finite-value validation
performed by `matrix_mapping.py`.

Euler convention: decomposition uses the Three.js r184-compatible XYZ Euler
order (`R = Rx(pitch) * Ry(yaw) * Rz(roll)`) in a right-handed coordinate
system, where pitch is a positive rotation about +X, yaw is a positive
rotation about +Y, and roll is a positive rotation about +Z. No axis is
swapped and no sign is inverted.

Units and bounds: output values are in radians (never degrees). Each axis is
clamped independently to [-FACE_ROTATION_LIMIT_RADIANS,
FACE_ROTATION_LIMIT_RADIANS]. Near the XYZ gimbal singularity, roll is
deterministically set to zero.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from matrix_mapping import NormalizedRotationMatrix

FACE_ROTATION_LIMIT_RADIANS = 1.0

_XYZ_SINGULARITY_THRESHOLD = 0.9999999


@dataclass(frozen=True)
class FaceRotationValues:
    pitch: float
    yaw: float
    roll: float


def map_normalized_rotation_to_face_rotation(
    rotation: NormalizedRotationMatrix,
) -> FaceRotationValues:
    """Converts a validated NormalizedRotationMatrix into face rotation values.

    Input boundary: `rotation` must be a successful `NormalizedRotationMatrix`
    produced by `matrix_mapping.normalize_facial_transform_matrix`. This
    function does not re-validate shape, scale, orthogonality, determinant,
    reflection, or finiteness.

    Decomposition uses the Three.js r184-compatible XYZ Euler order in a
    right-handed coordinate system: pitch is positive rotation about +X, yaw
    is positive rotation about +Y, and roll is positive rotation about +Z. No
    axis is swapped and no sign is inverted.

    Output values are in radians and each axis is clamped independently to
    [-FACE_ROTATION_LIMIT_RADIANS, FACE_ROTATION_LIMIT_RADIANS]. Near the XYZ
    gimbal singularity, roll is deterministically set to zero.
    """
    m11, m12, m13 = rotation.rows[0]
    m21, m22, m23 = rotation.rows[1]
    m31, m32, m33 = rotation.rows[2]

    yaw = math.asin(_clamp(m13, -1.0, 1.0))

    if abs(m13) < _XYZ_SINGULARITY_THRESHOLD:
        pitch = math.atan2(-m23, m33)
        roll = math.atan2(-m12, m11)
    else:
        pitch = math.atan2(m32, m22)
        roll = 0.0

    return FaceRotationValues(
        pitch=_clamp(pitch, -FACE_ROTATION_LIMIT_RADIANS, FACE_ROTATION_LIMIT_RADIANS),
        yaw=_clamp(yaw, -FACE_ROTATION_LIMIT_RADIANS, FACE_ROTATION_LIMIT_RADIANS),
        roll=_clamp(roll, -FACE_ROTATION_LIMIT_RADIANS, FACE_ROTATION_LIMIT_RADIANS),
    )


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))
