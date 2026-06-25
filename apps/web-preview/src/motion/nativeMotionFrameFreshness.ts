import type { MotionFrame } from "@lvk/motion-protocol";

export const isFreshMotionFrame = (
  frame: MotionFrame | null,
  latestTimestampMs: number,
): frame is MotionFrame => {
  return frame !== null && frame.timestampMs > latestTimestampMs;
};
