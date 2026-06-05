import type { MotionFrame } from "./motion-frame";
import { createNeutralMotionFrame } from "./constants";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const createDummyMotionFrame = (
  timestampMs: number = Date.now(),
): MotionFrame => {
  const seconds = timestampMs / 1000;
  const frame = createNeutralMotionFrame(timestampMs);

  return {
    ...frame,
    source: "dummy",
    face: {
      position: {
        x: Math.sin(seconds * 0.8) * 0.05,
        y: Math.sin(seconds * 0.6) * 0.04,
        z: 0,
      },
      rotation: {
        pitch: Math.sin(seconds * 0.7) * 0.12,
        yaw: Math.sin(seconds * 0.9) * 0.18,
        roll: Math.sin(seconds * 0.5) * 0.08,
      },
    },
    eyes: {
      leftOpen: clamp01(0.85 + Math.sin(seconds * 3) * 0.15),
      rightOpen: clamp01(0.85 + Math.sin(seconds * 3 + 0.2) * 0.15),
      gaze: {
        x: Math.sin(seconds * 0.9) * 0.25,
        y: Math.sin(seconds * 0.7) * 0.15,
      },
    },
    mouth: {
      open: clamp01(0.25 + Math.sin(seconds * 4) * 0.2),
      smile: clamp01(0.35 + Math.sin(seconds * 0.8) * 0.15),
    },
  };
};
