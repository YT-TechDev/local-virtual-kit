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
  receivedFrameCount: number;
  lastFrameReceivedAtMs: number | null;
};

export function useNativeMotionFrame(enabled: boolean): NativeMotionFrameState {
  const [latestFrame, setLatestFrame] = useState<MotionFrame | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<NativeMotionConnectionStatus>("disabled");
  const [receivedFrameCount, setReceivedFrameCount] = useState(0);
  const [lastFrameReceivedAtMs, setLastFrameReceivedAtMs] = useState<
    number | null
  >(null);

  useEffect(() => {
    const resetNativeFrameState = () => {
      setLatestFrame(null);
      setConnectionStatus("disabled");
      setReceivedFrameCount(0);
      setLastFrameReceivedAtMs(null);
    };

    if (!enabled) {
      resetNativeFrameState();
      return;
    }

    const setReceivedNativeFrame = (frame: MotionFrame | null) => {
      setLatestFrame(frame);

      if (frame === null) {
        return;
      }

      setReceivedFrameCount((count) => count + 1);
      setLastFrameReceivedAtMs(Date.now());
    };

    const runtime = createBrowserNativeMotionFrameRuntime();
    const connection = createNativeMotionFrameConnection({
      runtime,
      callbacks: {
        setLatestFrame: setReceivedNativeFrame,
        setConnectionStatus,
      },
      url: NATIVE_MOTION_WS_URL,
      reconnectDelayMs: RECONNECT_DELAY_MS,
      staleFrameTimeoutMs: NATIVE_FRAME_STALE_TIMEOUT_MS,
    });
    connection.start();

    return () => {
      connection.stop();
      resetNativeFrameState();
    };
  }, [enabled]);

  return {
    latestFrame: enabled ? latestFrame : null,
    connectionStatus: enabled ? connectionStatus : "disabled",
    receivedFrameCount: enabled ? receivedFrameCount : 0,
    lastFrameReceivedAtMs: enabled ? lastFrameReceivedAtMs : null,
  };
}
