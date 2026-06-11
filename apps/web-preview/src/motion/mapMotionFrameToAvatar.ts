import type { MotionFrame, TrackingStatus } from "@lvk/motion-protocol";

export type AvatarMotionState = {
  trackingStatus: TrackingStatus;
  confidence: number;
  rootPosition: [number, number, number];
  headRotation: [number, number, number];
  eyeOpen: {
    left: number;
    right: number;
  };
  gaze: [number, number];
  mouth: {
    open: number;
    smile: number;
  };
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const clamp01 = (value: number): number => clamp(value, 0, 1);

export const mapMotionFrameToAvatar = (
  frame: MotionFrame,
): AvatarMotionState => {
  return {
    trackingStatus: frame.tracking.status,
    confidence: clamp01(frame.tracking.confidence),
    rootPosition: [
      clamp(frame.face.position.x, -1, 1) * 2,
      clamp(frame.face.position.y, -1, 1) * 1.5,
      clamp(frame.face.position.z, -1, 1) * 0.5,
    ],
    headRotation: [
      clamp(frame.face.rotation.pitch, -1, 1),
      clamp(frame.face.rotation.yaw, -1, 1),
      clamp(frame.face.rotation.roll, -1, 1),
    ],
    eyeOpen: {
      left: clamp01(frame.eyes.leftOpen),
      right: clamp01(frame.eyes.rightOpen),
    },
    gaze: [clamp(frame.eyes.gaze.x, -1, 1), clamp(frame.eyes.gaze.y, -1, 1)],
    mouth: {
      open: clamp01(frame.mouth.open),
      smile: clamp01(frame.mouth.smile),
    },
  };
};
