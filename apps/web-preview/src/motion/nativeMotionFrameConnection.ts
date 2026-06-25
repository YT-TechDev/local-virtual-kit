import type { MotionFrame } from "@lvk/motion-protocol";
import type { NativeMotionFrameRuntime } from "./nativeMotionFrameRuntime";
import type { NativeMotionConnectionStatus } from "./nativeMotionFrameLifecycle";
import { parseFreshNativeMotionFrame } from "./nativeMotionFrameAcceptance";
import { isNativeFallbackReady } from "./nativeMotionFrameFallback";
import {
  getNativeMotionConnectingStatus,
  getNativeMotionReconnectStatus,
} from "./nativeMotionFrameLifecycle";

export type NativeMotionFrameConnectionCallbacks = {
  setLatestFrame: (frame: MotionFrame | null) => void;
  setConnectionStatus: (status: NativeMotionConnectionStatus) => void;
};

export type NativeMotionFrameConnection = {
  start: () => void;
  stop: () => void;
};

export const createNativeMotionFrameConnection = (options: {
  runtime: NativeMotionFrameRuntime;
  callbacks: NativeMotionFrameConnectionCallbacks;
  url: string;
  reconnectDelayMs: number;
  staleFrameTimeoutMs: number;
}): NativeMotionFrameConnection => {
  const { runtime, callbacks, url, reconnectDelayMs, staleFrameTimeoutMs } =
    options;

  let websocket: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let staleFrameTimer: number | undefined;
  let isStopped = false;
  let hasAttemptedConnection = false;
  let latestTimestamp = -Infinity;

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
    callbacks.setLatestFrame(null);
  };

  const markFallbackIfSocketIsOpen = () => {
    if (
      !isNativeFallbackReady(
        isStopped,
        websocket?.readyState ?? null,
        WebSocket.OPEN,
      )
    ) {
      return;
    }

    clearNativeFrame();
    callbacks.setConnectionStatus("fallback");
  };

  const resetStaleFrameTimer = () => {
    clearStaleFrameTimer();
    staleFrameTimer = runtime.setTimeout(() => {
      staleFrameTimer = undefined;
      markFallbackIfSocketIsOpen();
    }, staleFrameTimeoutMs);
  };

  const scheduleReconnect = () => {
    const reconnectStatus = getNativeMotionReconnectStatus(
      isStopped,
      reconnectTimer !== undefined,
    );
    if (reconnectStatus === null) {
      return;
    }

    clearStaleFrameTimer();
    clearNativeFrame();
    callbacks.setConnectionStatus(reconnectStatus);
    reconnectTimer = runtime.setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, reconnectDelayMs);
  };

  function connect() {
    if (isStopped) {
      return;
    }

    clearStaleFrameTimer();
    latestTimestamp = -Infinity;
    clearNativeFrame();
    callbacks.setConnectionStatus(
      getNativeMotionConnectingStatus(hasAttemptedConnection),
    );
    hasAttemptedConnection = true;
    const activeWebSocket = runtime.createWebSocket(url);
    websocket = activeWebSocket;

    const isActiveWebSocketOpen = () =>
      !isStopped &&
      websocket === activeWebSocket &&
      activeWebSocket.readyState === WebSocket.OPEN;

    activeWebSocket.onopen = () => {
      if (!isActiveWebSocketOpen()) {
        return;
      }

      callbacks.setConnectionStatus("connected_waiting_for_frame");
      resetStaleFrameTimer();
    };

    activeWebSocket.onmessage = (event: MessageEvent<unknown>) => {
      if (!isActiveWebSocketOpen()) {
        return;
      }

      const frame = parseFreshNativeMotionFrame(event.data, latestTimestamp);

      if (frame === null) {
        return;
      }

      latestTimestamp = frame.timestampMs;
      callbacks.setLatestFrame(frame);
      callbacks.setConnectionStatus("connected");
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

  return {
    start: () => {
      connect();
    },
    stop: () => {
      isStopped = true;
      clearReconnectTimer();
      clearStaleFrameTimer();
      websocket?.close();
      websocket = null;
    },
  };
};
