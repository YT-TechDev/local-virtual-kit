import { createDummyMotionFrame } from "@lvk/motion-protocol";

export function useDummyMotionFrame(timestampMs: number) {
  return createDummyMotionFrame(timestampMs);
}
