export type NativeMotionConnectionStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "connected_waiting_for_frame"
  | "reconnecting"
  | "fallback";

export const getNativeMotionConnectingStatus = (
  hasAttemptedConnection: boolean,
): NativeMotionConnectionStatus =>
  hasAttemptedConnection ? "reconnecting" : "connecting";

export const getNativeMotionReconnectStatus = (
  isUnmounted: boolean,
  reconnectTimerActive: boolean,
): NativeMotionConnectionStatus | null => {
  if (isUnmounted || reconnectTimerActive) {
    return null;
  }
  return "reconnecting";
};
