import { useMemo } from "react";
import { createDummyMotionFrame, type MotionFrame } from "@lvk/motion-protocol";
import type { PreviewSource } from "../preview/previewSource";

export function usePreviewMotionFrame(
  source: PreviewSource,
  timestampMs: number,
  nativeFrame: MotionFrame | null,
): MotionFrame {
  const stableNativeFallbackFrame = useMemo(
    () => createDummyMotionFrame(0),
    [],
  );

  switch (source) {
    case "native":
      return nativeFrame ?? stableNativeFallbackFrame;
    case "dummy":
      return createDummyMotionFrame(timestampMs);
  }
}
