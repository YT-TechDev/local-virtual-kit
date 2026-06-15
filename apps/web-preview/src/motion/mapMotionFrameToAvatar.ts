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

export const createNeutralAvatarMotionState = (
  status: TrackingStatus = "not_started",
): AvatarMotionState => {
  return {
    trackingStatus: status,
    confidence: 0,
    rootPosition: [0, 0, 0],
    headRotation: [0, 0, 0],
    eyeOpen: {
      left: 1,
      right: 1,
    },
    gaze: [0, 0],
    mouth: {
      open: 0,
      smile: 0,
    },
  };
};

export const lerpNumber = (
  from: number,
  to: number,
  amount: number,
): number => {
  return from + (to - from) * clamp01(amount);
};

export const lerpTuple3 = (
  from: [number, number, number],
  to: [number, number, number],
  amount: number,
): [number, number, number] => {
  return [
    lerpNumber(from[0], to[0], amount),
    lerpNumber(from[1], to[1], amount),
    lerpNumber(from[2], to[2], amount),
  ];
};

export const lerpTuple2 = (
  from: [number, number],
  to: [number, number],
  amount: number,
): [number, number] => {
  return [
    lerpNumber(from[0], to[0], amount),
    lerpNumber(from[1], to[1], amount),
  ];
};

export const lerpAvatarMotionState = (
  from: AvatarMotionState,
  to: AvatarMotionState,
  amount: number,
): AvatarMotionState => {
  return {
    trackingStatus: to.trackingStatus,
    confidence: lerpNumber(from.confidence, to.confidence, amount),
    rootPosition: lerpTuple3(from.rootPosition, to.rootPosition, amount),
    headRotation: lerpTuple3(from.headRotation, to.headRotation, amount),
    eyeOpen: {
      left: lerpNumber(from.eyeOpen.left, to.eyeOpen.left, amount),
      right: lerpNumber(from.eyeOpen.right, to.eyeOpen.right, amount),
    },
    gaze: lerpTuple2(from.gaze, to.gaze, amount),
    mouth: {
      open: lerpNumber(from.mouth.open, to.mouth.open, amount),
      smile: lerpNumber(from.mouth.smile, to.mouth.smile, amount),
    },
  };
};

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
