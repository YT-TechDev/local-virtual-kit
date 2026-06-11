import { useMemo } from "react";
import { createDummyMotionFrame, type MotionFrame } from "@lvk/motion-protocol";
import { useNativeMotionFrame } from "./useNativeMotionFrame";
import type { PreviewSource } from "../preview/previewSource";

export function usePreviewMotionFrame(
  source: PreviewSource,
  timestampMs: number,
): MotionFrame {
  const nativeFrame = useNativeMotionFrame(source === "native");
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
