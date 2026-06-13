import { useEffect, useRef, useState } from "react";
import { parseNativeMotionFrameJson } from "@lvk/motion-protocol";
import type { MotionFrame } from "@lvk/motion-protocol";

const NATIVE_MOTION_WS_URL = "ws://127.0.0.1:45731/motion";
const RECONNECT_DELAY_MS = 1000;

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
    let resetFrameTimer: number | undefined;
    let isUnmounted = false;
    let hasAttemptedConnection = false;

    const clearReconnectTimer = () => {
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
    };

    const clearResetFrameTimer = () => {
      if (resetFrameTimer !== undefined) {
        window.clearTimeout(resetFrameTimer);
        resetFrameTimer = undefined;
      }
    };

    const clearNativeFrame = () => {
      setLatestFrame(null);
    };

    resetFrameTimer = window.setTimeout(() => {
      resetFrameTimer = undefined;

      if (!isUnmounted && latestTimestampRef.current === -Infinity) {
        clearNativeFrame();
      }
    }, 0);

    if (!enabled) {
      return () => {
        isUnmounted = true;
        clearResetFrameTimer();
      };
    }

    const scheduleReconnect = () => {
      if (isUnmounted || reconnectTimer !== undefined) {
        return;
      }

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

      latestTimestampRef.current = -Infinity;
      setConnectionStatus(
        hasAttemptedConnection ? "reconnecting" : "connecting",
      );
      hasAttemptedConnection = true;
      websocket = new WebSocket(NATIVE_MOTION_WS_URL);

      websocket.onopen = () => {
        if (!isUnmounted && latestTimestampRef.current === -Infinity) {
          setConnectionStatus("fallback");
        }
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
      clearResetFrameTimer();
      websocket?.close();
      websocket = null;
    };
  }, [enabled]);

  return {
    latestFrame: enabled ? latestFrame : null,
    connectionStatus: enabled ? connectionStatus : "disabled",
  };
}
