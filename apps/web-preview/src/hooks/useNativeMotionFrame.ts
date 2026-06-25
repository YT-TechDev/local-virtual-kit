import { useEffect, useState } from "react";
import type { MotionFrame } from "@lvk/motion-protocol";
import { createNativeMotionFrameConnection } from "../motion/nativeMotionFrameConnection";
import type { NativeMotionConnectionStatus } from "../motion/nativeMotionFrameLifecycle";
import { createBrowserNativeMotionFrameRuntime } from "../motion/nativeMotionFrameRuntime";
export type { NativeMotionConnectionStatus } from "../motion/nativeMotionFrameLifecycle";

export const NATIVE_MOTION_WS_URL = "ws://127.0.0.1:45731/motion";
export const RECONNECT_DELAY_MS = 1000;
export const NATIVE_FRAME_STALE_TIMEOUT_MS = 1800;

type NativeMotionFrameState = {
  latestFrame: MotionFrame | null;
  connectionStatus: NativeMotionConnectionStatus;
};

export function useNativeMotionFrame(enabled: boolean): NativeMotionFrameState {
  const [latestFrame, setLatestFrame] = useState<MotionFrame | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<NativeMotionConnectionStatus>("disabled");

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const runtime = createBrowserNativeMotionFrameRuntime();
    const connection = createNativeMotionFrameConnection({
      runtime,
      callbacks: { setLatestFrame, setConnectionStatus },
      url: NATIVE_MOTION_WS_URL,
      reconnectDelayMs: RECONNECT_DELAY_MS,
      staleFrameTimeoutMs: NATIVE_FRAME_STALE_TIMEOUT_MS,
    });
    connection.start();

    return () => {
      connection.stop();
    };
  }, [enabled]);

  return {
    latestFrame: enabled ? latestFrame : null,
    connectionStatus: enabled ? connectionStatus : "disabled",
  };
}
