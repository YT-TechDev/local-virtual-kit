import type { FaceFollowingCalibration } from "./faceFollowingCalibration";
import type { TrackingSmoothingOptions } from "./trackingSmoothing";

export type FaceFollowingPresetId = "balanced" | "steady" | "responsive";

export type FaceFollowingPreset = {
  id: FaceFollowingPresetId;
  label: string;
  summary: string;
  calibration: FaceFollowingCalibration;
  smoothing: TrackingSmoothingOptions;
};

const createCalibration = (
  sensitivityScale: number,
  deadzone: number,
): FaceFollowingCalibration => ({
  center: { x: 0, y: 0, z: 0 },
  sensitivity: {
    x: 3.2 * sensitivityScale,
    y: 2.4 * sensitivityScale,
    z: 0.9 * sensitivityScale,
  },
  deadzone: { x: deadzone, y: deadzone, z: deadzone / 2 },
});

export const FACE_FOLLOWING_PRESETS: readonly FaceFollowingPreset[] = [
  {
    id: "balanced",
    label: "Balanced",
    summary: "Default renderer-side calibration for a familiar motion feel.",
    calibration: createCalibration(1, 0),
    smoothing: { positionTauSeconds: 0.12, rotationTauSeconds: 0.12 },
  },
  {
    id: "steady",
    label: "Steady",
    summary:
      "Adds a small deadzone and more smoothing for calmer face-following.",
    calibration: createCalibration(0.82, 0.045),
    smoothing: { positionTauSeconds: 0.18, rotationTauSeconds: 0.16 },
  },
  {
    id: "responsive",
    label: "Responsive",
    summary:
      "Raises sensitivity and reduces smoothing for quicker renderer motion.",
    calibration: createCalibration(1.18, 0.015),
    smoothing: { positionTauSeconds: 0.08, rotationTauSeconds: 0.08 },
  },
] as const;

export const DEFAULT_FACE_FOLLOWING_PRESET_ID: FaceFollowingPresetId =
  "balanced";

export const getFaceFollowingPresetById = (
  id: FaceFollowingPresetId,
): FaceFollowingPreset => {
  return (
    FACE_FOLLOWING_PRESETS.find((preset) => preset.id === id) ??
    FACE_FOLLOWING_PRESETS[0]
  );
};
