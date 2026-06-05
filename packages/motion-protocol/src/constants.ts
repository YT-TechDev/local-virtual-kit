import type { MotionFrame } from "./motion-frame";

export const MOTION_FRAME_SCHEMA_VERSION = 1 as const;

export const createNeutralMotionFrame = (
  timestampMs: number = Date.now(),
): MotionFrame => ({
  schemaVersion: MOTION_FRAME_SCHEMA_VERSION,
  timestampMs,
  source: "dummy",
  tracking: {
    status: "tracking",
    confidence: 1,
  },
  face: {
    position: {
      x: 0,
      y: 0,
      z: 0,
    },
    rotation: {
      pitch: 0,
      yaw: 0,
      roll: 0,
    },
  },
  eyes: {
    leftOpen: 1,
    rightOpen: 1,
    gaze: {
      x: 0,
      y: 0,
    },
  },
  mouth: {
    open: 0,
    smile: 0,
  },
});
