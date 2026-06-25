import { parseNativeMotionFrameJson } from "@lvk/motion-protocol";
import type { MotionFrame } from "@lvk/motion-protocol";
import { isFreshMotionFrame } from "./nativeMotionFrameFreshness";

export const parseFreshNativeMotionFrame = (
  data: unknown,
  latestTimestampMs: number,
): MotionFrame | null => {
  const frame = parseNativeMotionFrameJson(data);

  return isFreshMotionFrame(frame, latestTimestampMs) ? frame : null;
};
