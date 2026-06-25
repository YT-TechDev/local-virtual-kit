export type NativeMotionFrameRuntime = {
  createWebSocket: (url: string) => WebSocket;
  setTimeout: typeof window.setTimeout;
  clearTimeout: typeof window.clearTimeout;
};

export const createBrowserNativeMotionFrameRuntime =
  (): NativeMotionFrameRuntime => ({
    createWebSocket: (url) => new WebSocket(url),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  });
