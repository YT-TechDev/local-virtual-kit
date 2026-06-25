export const isNativeFallbackReady = (
  isUnmounted: boolean,
  socketReadyState: number | null,
  openReadyState: number,
): boolean => {
  return (
    !isUnmounted &&
    socketReadyState !== null &&
    socketReadyState === openReadyState
  );
};
