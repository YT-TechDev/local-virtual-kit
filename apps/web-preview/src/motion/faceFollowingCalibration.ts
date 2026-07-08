import type { Vector3 } from "@lvk/motion-protocol";

// --- Local face-following calibration baseline ------------------------------
//
// The native OpenCV face-following path emits a normalized `face.position` per
// frame. The renderer maps that position onto the avatar root offset. This
// module holds the small, explicit calibration/sensitivity model applied during
// that mapping so the v0.2 face-following MVP becomes tunable without touching
// MotionFrame, Native Core, or the protocol schema.
//
// Two knobs, both per axis and both deterministic:
//
//   center       A neutral-pose offset in normalized face.position space. It is
//                subtracted from the incoming position before scaling, so a user
//                can capture their resting head position and have the avatar sit
//                centered around it instead of around the raw camera origin.
//   sensitivity  A multiplier applied after centering. Larger values move the
//                avatar root further for the same head movement.
//
// The defaults reproduce the previous hard-coded mapping exactly (center 0 on
// every axis, the original per-axis sensitivity multipliers), so dummy and
// native behavior is unchanged until a caller supplies a different calibration.
//
// This is renderer-only consumer behavior. It reads only existing MotionFrame
// `face.position` values, adds no MotionFrame fields, changes no schema, and
// introduces no runtime dependency, tracking backend, or network behavior.

export type FaceFollowingAxisCalibration = {
  x: number;
  y: number;
  z: number;
};

export type FaceFollowingCalibration = {
  /** Neutral-pose offset subtracted from `face.position` before scaling. */
  center: FaceFollowingAxisCalibration;
  /** Per-axis multiplier applied to the centered face position. */
  sensitivity: FaceFollowingAxisCalibration;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

// The incoming `face.position` domain the mapping treats as valid; values are
// clamped into this range before scaling. Kept here so both the calibration and
// the mapping agree on the same face-following input bounds.
export const FACE_POSITION_INPUT_MIN = -1;
export const FACE_POSITION_INPUT_MAX = 1;

// Default per-axis sensitivity multipliers. These match the original hard-coded
// mapping so the baseline calibration is a no-op change in behavior.
export const DEFAULT_FACE_POSITION_X_SENSITIVITY = 3.2;
export const DEFAULT_FACE_POSITION_Y_SENSITIVITY = 2.4;
export const DEFAULT_FACE_POSITION_Z_SENSITIVITY = 0.9;

// Safe bounds for user/config-supplied calibration values. Sensitivity stays
// non-negative and capped so a bad value cannot fling the avatar off-screen;
// center stays inside the same normalized domain as the input position.
export const FACE_FOLLOWING_MIN_SENSITIVITY = 0;
export const FACE_FOLLOWING_MAX_SENSITIVITY = 8;
export const FACE_FOLLOWING_MIN_CENTER = FACE_POSITION_INPUT_MIN;
export const FACE_FOLLOWING_MAX_CENTER = FACE_POSITION_INPUT_MAX;

export const DEFAULT_FACE_FOLLOWING_CALIBRATION: FaceFollowingCalibration = {
  center: { x: 0, y: 0, z: 0 },
  sensitivity: {
    x: DEFAULT_FACE_POSITION_X_SENSITIVITY,
    y: DEFAULT_FACE_POSITION_Y_SENSITIVITY,
    z: DEFAULT_FACE_POSITION_Z_SENSITIVITY,
  },
};

/**
 * Fresh, mutable copy of the default calibration. Use this as the reset-to-
 * default action so callers never accidentally mutate the shared constant.
 */
export const createDefaultFaceFollowingCalibration =
  (): FaceFollowingCalibration => ({
    center: { ...DEFAULT_FACE_FOLLOWING_CALIBRATION.center },
    sensitivity: { ...DEFAULT_FACE_FOLLOWING_CALIBRATION.sensitivity },
  });

const resolveNumber = (value: unknown, fallback: number): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

/**
 * Clamp a calibration into safe ranges, filling any missing/non-finite value
 * from the default. The result is a fresh object; the input is not mutated.
 */
export const clampFaceFollowingCalibration = (
  calibration: FaceFollowingCalibration = DEFAULT_FACE_FOLLOWING_CALIBRATION,
): FaceFollowingCalibration => {
  const clampCenter = (value: unknown, fallback: number): number =>
    clamp(
      resolveNumber(value, fallback),
      FACE_FOLLOWING_MIN_CENTER,
      FACE_FOLLOWING_MAX_CENTER,
    );
  const clampSensitivity = (value: unknown, fallback: number): number =>
    clamp(
      resolveNumber(value, fallback),
      FACE_FOLLOWING_MIN_SENSITIVITY,
      FACE_FOLLOWING_MAX_SENSITIVITY,
    );

  const center =
    calibration.center ?? DEFAULT_FACE_FOLLOWING_CALIBRATION.center;
  const sensitivity =
    calibration.sensitivity ?? DEFAULT_FACE_FOLLOWING_CALIBRATION.sensitivity;
  const defaults = DEFAULT_FACE_FOLLOWING_CALIBRATION;

  return {
    center: {
      x: clampCenter(center.x, defaults.center.x),
      y: clampCenter(center.y, defaults.center.y),
      z: clampCenter(center.z, defaults.center.z),
    },
    sensitivity: {
      x: clampSensitivity(sensitivity.x, defaults.sensitivity.x),
      y: clampSensitivity(sensitivity.y, defaults.sensitivity.y),
      z: clampSensitivity(sensitivity.z, defaults.sensitivity.z),
    },
  };
};

/**
 * Build a calibration that recenters face-following on the given resting
 * position (typically a captured neutral `face.position`) while keeping the
 * supplied base sensitivity. This is the "calibrate to my current pose" action:
 * the captured position becomes the new zero point for the avatar root.
 */
export const createFaceFollowingCalibrationFromCenter = (
  restingPosition: Vector3,
  baseCalibration: FaceFollowingCalibration = DEFAULT_FACE_FOLLOWING_CALIBRATION,
): FaceFollowingCalibration => {
  return clampFaceFollowingCalibration({
    center: {
      x: restingPosition.x,
      y: restingPosition.y,
      z: restingPosition.z,
    },
    sensitivity: baseCalibration.sensitivity,
  });
};

const calibrateAxis = (
  value: number,
  center: number,
  sensitivity: number,
): number => {
  const centered = clamp(
    value - center,
    FACE_POSITION_INPUT_MIN,
    FACE_POSITION_INPUT_MAX,
  );

  return centered * sensitivity;
};

/**
 * Apply a face-following calibration to a normalized `face.position`, returning
 * the avatar root offset as an `[x, y, z]` tuple.
 *
 * Deterministic and pure: it centers the position (subtract calibrated center,
 * clamp back into the input domain) then scales by the calibrated per-axis
 * sensitivity. The calibration is clamped to safe ranges first, so out-of-range
 * inputs cannot produce an unbounded offset. With the default calibration this
 * is identical to the previous hard-coded position mapping.
 */
export const applyFaceFollowingCalibration = (
  position: Vector3,
  calibration: FaceFollowingCalibration = DEFAULT_FACE_FOLLOWING_CALIBRATION,
): [number, number, number] => {
  const resolved = clampFaceFollowingCalibration(calibration);

  return [
    calibrateAxis(position.x, resolved.center.x, resolved.sensitivity.x),
    calibrateAxis(position.y, resolved.center.y, resolved.sensitivity.y),
    calibrateAxis(position.z, resolved.center.z, resolved.sensitivity.z),
  ];
};
