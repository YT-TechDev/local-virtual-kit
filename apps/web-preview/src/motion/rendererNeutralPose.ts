import type { MotionFrame } from "@lvk/motion-protocol";
import type { NativeMotionConnectionStatus } from "./nativeMotionFrameLifecycle";
import {
  createFaceFollowingCalibrationFromCenter,
  type FaceFollowingCalibration,
} from "./faceFollowingCalibration";
import type { FaceFollowingPreset } from "./faceFollowingPresets";
import type { RendererCalibrationState } from "./rendererCalibrationStorage";
import type { PreviewSource } from "../preview/previewSource";

export const canCaptureNativeNeutralPose = ({
  nativeFrame,
  nativeStatus,
  source,
}: {
  nativeFrame: MotionFrame | null;
  nativeStatus: NativeMotionConnectionStatus;
  source: PreviewSource;
}): boolean => {
  return (
    source === "native" &&
    nativeStatus === "connected" &&
    nativeFrame !== null &&
    nativeFrame.tracking.status === "tracking"
  );
};

export const resolveRendererFaceFollowingCalibration = (
  preset: FaceFollowingPreset,
  state: RendererCalibrationState,
): FaceFollowingCalibration => {
  return state.neutralCenter === null
    ? preset.calibration
    : createFaceFollowingCalibrationFromCenter(
        state.neutralCenter,
        preset.calibration,
      );
};
