import { useEffect, useRef, useState } from "react";
import { parseNativeMotionFrameJson } from "@lvk/motion-protocol";
import type { MotionFrame } from "@lvk/motion-protocol";

const NATIVE_MOTION_WS_URL = "ws://127.0.0.1:45731/motion";
const RECONNECT_DELAY_MS = 1000;
const NATIVE_FRAME_STALE_TIMEOUT_MS = 1800;

export type NativeMotionConnectionStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "fallback";

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

    let websocket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let staleFrameTimer: number | undefined;
    let isUnmounted = false;
    let hasAttemptedConnection = false;

    const clearReconnectTimer = () => {
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
    };

    const clearStaleFrameTimer = () => {
      if (staleFrameTimer !== undefined) {
        window.clearTimeout(staleFrameTimer);
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
      if (isUnmounted || websocket?.readyState !== WebSocket.OPEN) {
        return;
      }

      clearNativeFrame();
      setConnectionStatus("fallback");
    };

    const resetStaleFrameTimer = () => {
      clearStaleFrameTimer();
      staleFrameTimer = window.setTimeout(() => {
        staleFrameTimer = undefined;
        markFallbackIfSocketIsOpen();
      }, NATIVE_FRAME_STALE_TIMEOUT_MS);
    };

    const scheduleReconnect = () => {
      if (isUnmounted || reconnectTimer !== undefined) {
        return;
      }

      clearStaleFrameTimer();
      clearNativeFrame();
      setConnectionStatus("reconnecting");
      reconnectTimer = window.setTimeout(() => {
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
        hasAttemptedConnection ? "reconnecting" : "connecting",
      );
      hasAttemptedConnection = true;
      websocket = new WebSocket(NATIVE_MOTION_WS_URL);

      websocket.onopen = () => {
        markFallbackIfSocketIsOpen();
      };

      websocket.onmessage = (event: MessageEvent<unknown>) => {
        const frame = parseNativeMotionFrameJson(event.data);

        if (frame === null) {
          return;
        }

        if (frame.timestampMs <= latestTimestampRef.current) {
          return;
        }

        latestTimestampRef.current = frame.timestampMs;
        setLatestFrame(frame);
        setConnectionStatus("connected");
        resetStaleFrameTimer();
      };

      websocket.onerror = () => {
        websocket?.close();
      };

      websocket.onclose = () => {
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
