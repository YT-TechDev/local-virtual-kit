import { useEffect, useRef, useState } from "react";
import type { MotionFrame } from "@lvk/motion-protocol";
import { parseFreshNativeMotionFrame } from "../motion/nativeMotionFrameAcceptance";
import { isNativeFallbackReady } from "../motion/nativeMotionFrameFallback";
import {
  getNativeMotionConnectingStatus,
  getNativeMotionReconnectStatus,
} from "../motion/nativeMotionFrameLifecycle";
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
  const latestTimestampRef = useRef(-Infinity);

  useEffect(() => {
    latestTimestampRef.current = -Infinity;

    const runtime = createBrowserNativeMotionFrameRuntime();
    let websocket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let staleFrameTimer: number | undefined;
    let isUnmounted = false;
    let hasAttemptedConnection = false;

    const clearReconnectTimer = () => {
      if (reconnectTimer !== undefined) {
        runtime.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
    };

    const clearStaleFrameTimer = () => {
      if (staleFrameTimer !== undefined) {
        runtime.clearTimeout(staleFrameTimer);
        staleFrameTimer = undefined;
      }
    };

    const clearNativeFrame = () => {
      setLatestFrame(null);
    };

    if (!enabled) {
      return () => {
        isUnmounted = true;
        clearReconnectTimer();
        clearStaleFrameTimer();
      };
    }

    const markFallbackIfSocketIsOpen = () => {
      if (
        !isNativeFallbackReady(
          isUnmounted,
          websocket?.readyState ?? null,
          WebSocket.OPEN,
        )
      ) {
        return;
      }

      clearNativeFrame();
      setConnectionStatus("fallback");
    };

    const resetStaleFrameTimer = () => {
      clearStaleFrameTimer();
      staleFrameTimer = runtime.setTimeout(() => {
        staleFrameTimer = undefined;
        markFallbackIfSocketIsOpen();
      }, NATIVE_FRAME_STALE_TIMEOUT_MS);
    };

    const scheduleReconnect = () => {
      const reconnectStatus = getNativeMotionReconnectStatus(
        isUnmounted,
        reconnectTimer !== undefined,
      );
      if (reconnectStatus === null) {
        return;
      }

      clearStaleFrameTimer();
      clearNativeFrame();
      setConnectionStatus(reconnectStatus);
      reconnectTimer = runtime.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, RECONNECT_DELAY_MS);
    };

    function connect() {
      if (isUnmounted) {
        return;
      }

      clearStaleFrameTimer();
      latestTimestampRef.current = -Infinity;
      clearNativeFrame();
      setConnectionStatus(
        getNativeMotionConnectingStatus(hasAttemptedConnection),
      );
      hasAttemptedConnection = true;
      const activeWebSocket = runtime.createWebSocket(NATIVE_MOTION_WS_URL);
      websocket = activeWebSocket;

      const isActiveWebSocketOpen = () =>
        !isUnmounted &&
        websocket === activeWebSocket &&
        activeWebSocket.readyState === WebSocket.OPEN;

      activeWebSocket.onopen = () => {
        if (!isActiveWebSocketOpen()) {
          return;
        }

        setConnectionStatus("connected_waiting_for_frame");
        resetStaleFrameTimer();
      };

      activeWebSocket.onmessage = (event: MessageEvent<unknown>) => {
        if (!isActiveWebSocketOpen()) {
          return;
        }

        const frame = parseFreshNativeMotionFrame(
          event.data,
          latestTimestampRef.current,
        );

        if (frame === null) {
          return;
        }

        latestTimestampRef.current = frame.timestampMs;
        setLatestFrame(frame);
        setConnectionStatus("connected");
        resetStaleFrameTimer();
      };

      activeWebSocket.onerror = () => {
        if (websocket !== activeWebSocket) {
          return;
        }

        activeWebSocket.close();
      };

      activeWebSocket.onclose = () => {
        if (websocket !== activeWebSocket) {
          return;
        }

        scheduleReconnect();
      };
    }

    connect();

    return () => {
      isUnmounted = true;
      clearReconnectTimer();
      clearStaleFrameTimer();
      websocket?.close();
      websocket = null;
    };
  }, [enabled]);

  return {
    latestFrame: enabled ? latestFrame : null,
    connectionStatus: enabled ? connectionStatus : "disabled",
  };
}
