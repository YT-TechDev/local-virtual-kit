import { useMemo } from "react";
import { createDummyMotionFrame, type MotionFrame } from "@lvk/motion-protocol";
import {
  useNativeMotionFrame,
  type NativeMotionConnectionStatus,
} from "./useNativeMotionFrame";
import type { PreviewSource } from "../preview/previewSource";

type PreviewMotionFrameState = {
  frame: MotionFrame;
  nativeStatus: NativeMotionConnectionStatus;
};

export function usePreviewMotionFrame(
  source: PreviewSource,
  timestampMs: number,
): PreviewMotionFrameState {
  const { latestFrame: nativeFrame, connectionStatus: nativeStatus } =
    useNativeMotionFrame(source === "native");
  const stableNativeFallbackFrame = useMemo(
    () => createDummyMotionFrame(0),
    [],
  );

  switch (source) {
    case "native":
      return { frame: nativeFrame ?? stableNativeFallbackFrame, nativeStatus };
    case "dummy":
      return { frame: createDummyMotionFrame(timestampMs), nativeStatus };
  }
}
