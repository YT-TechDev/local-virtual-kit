#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const WEB_PREVIEW_PACKAGE_URL = new URL(
  "../apps/web-preview/package.json",
  import.meta.url,
);
const CONNECTION_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/nativeMotionFrameConnection.ts",
  import.meta.url,
);
const ACCEPTANCE_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/nativeMotionFrameAcceptance.ts",
  import.meta.url,
);
const FRESHNESS_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/nativeMotionFrameFreshness.ts",
  import.meta.url,
);
const FALLBACK_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/nativeMotionFrameFallback.ts",
  import.meta.url,
);
const LIFECYCLE_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/nativeMotionFrameLifecycle.ts",
  import.meta.url,
);
const MOTION_FRAME_VALIDATION_URL = new URL(
  "../packages/motion-protocol/src/motion-frame-validation.js",
  import.meta.url,
);

const requireFromWebPreview = createRequire(WEB_PREVIEW_PACKAGE_URL);
const ts = requireFromWebPreview("typescript");

const fail = (message) => {
  throw new Error(
    `Web Preview native connection controller check failed: ${message}`,
  );
};

const assertEqual = (actual, expected, label) => {
  if (!Object.is(actual, expected)) {
    fail(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
};

const assertTrue = (value, label) => {
  if (!value) {
    fail(`${label}: expected truthy, received ${String(value)}`);
  }
};

const transpileSource = (source, fileName) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName,
  }).outputText;

const loadConnectionModule = async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "lvk-motion-connection-"));
  const tempProtocolDir = join(
    tempDir,
    "node_modules",
    "@lvk",
    "motion-protocol",
  );

  try {
    await mkdir(tempProtocolDir, { recursive: true });
    await writeFile(
      join(tempProtocolDir, "package.json"),
      JSON.stringify({ type: "module", exports: "./index.mjs" }),
      "utf8",
    );
    await writeFile(
      join(tempProtocolDir, "index.mjs"),
      `export { parseNativeMotionFrameJson } from ${JSON.stringify(
        MOTION_FRAME_VALIDATION_URL.href,
      )};\n`,
      "utf8",
    );

    const freshnessSource = await readFile(FRESHNESS_SOURCE_URL, "utf8");
    await writeFile(
      join(tempDir, "nativeMotionFrameFreshness.mjs"),
      transpileSource(freshnessSource, "nativeMotionFrameFreshness.ts"),
      "utf8",
    );

    const fallbackSource = await readFile(FALLBACK_SOURCE_URL, "utf8");
    await writeFile(
      join(tempDir, "nativeMotionFrameFallback.mjs"),
      transpileSource(fallbackSource, "nativeMotionFrameFallback.ts"),
      "utf8",
    );

    const lifecycleSource = await readFile(LIFECYCLE_SOURCE_URL, "utf8");
    await writeFile(
      join(tempDir, "nativeMotionFrameLifecycle.mjs"),
      transpileSource(lifecycleSource, "nativeMotionFrameLifecycle.ts"),
      "utf8",
    );

    const acceptanceSource = await readFile(ACCEPTANCE_SOURCE_URL, "utf8");
    await writeFile(
      join(tempDir, "nativeMotionFrameAcceptance.mjs"),
      transpileSource(
        acceptanceSource,
        "nativeMotionFrameAcceptance.ts",
      ).replace(
        'from "./nativeMotionFrameFreshness"',
        'from "./nativeMotionFrameFreshness.mjs"',
      ),
      "utf8",
    );

    const connectionSource = await readFile(CONNECTION_SOURCE_URL, "utf8");
    const connectionOutput = transpileSource(
      connectionSource,
      "nativeMotionFrameConnection.ts",
    )
      .replace(
        'from "./nativeMotionFrameAcceptance"',
        'from "./nativeMotionFrameAcceptance.mjs"',
      )
      .replace(
        'from "./nativeMotionFrameFallback"',
        'from "./nativeMotionFrameFallback.mjs"',
      )
      .replace(
        'from "./nativeMotionFrameLifecycle"',
        'from "./nativeMotionFrameLifecycle.mjs"',
      );
    await writeFile(
      join(tempDir, "nativeMotionFrameConnection.mjs"),
      connectionOutput,
      "utf8",
    );

    return await import(
      pathToFileURL(join(tempDir, "nativeMotionFrameConnection.mjs")).href
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.closeCalled = false;
  }
  close() {
    this.closeCalled = true;
    this.readyState = 3;
  }
}
FakeWebSocket.OPEN = 1;

const makeFakeTimers = () => {
  const scheduled = new Map();
  let nextHandle = 1;
  return {
    setTimeout: (cb) => {
      const handle = nextHandle++;
      scheduled.set(handle, cb);
      return handle;
    },
    clearTimeout: (handle) => {
      scheduled.delete(handle);
    },
    has: (handle) => scheduled.has(handle),
    trigger: (handle) => {
      const cb = scheduled.get(handle);
      if (cb !== undefined) {
        scheduled.delete(handle);
        cb();
      }
    },
  };
};

const makeRuntime = (fakeWsRef, timers) => ({
  createWebSocket: (url) => {
    const ws = new FakeWebSocket(url);
    fakeWsRef.current = ws;
    return ws;
  },
  setTimeout: timers.setTimeout,
  clearTimeout: timers.clearTimeout,
});

const runCheck = async () => {
  const savedWebSocket = global.WebSocket;
  global.WebSocket = FakeWebSocket;

  try {
    const { createNativeMotionFrameConnection } = await loadConnectionModule();

    // Case 1: start() creates exactly one WebSocket with the correct URL
    {
      const wsRef = { current: null };
      let wsCreatedCount = 0;
      const timers = makeFakeTimers();
      const runtime = {
        createWebSocket: (url) => {
          wsCreatedCount++;
          const ws = new FakeWebSocket(url);
          wsRef.current = ws;
          return ws;
        },
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
      };
      const conn = createNativeMotionFrameConnection({
        runtime,
        callbacks: { setLatestFrame: () => {}, setConnectionStatus: () => {} },
        url: "ws://127.0.0.1:45731/motion",
        reconnectDelayMs: 1000,
        staleFrameTimeoutMs: 1800,
      });

      conn.start();

      assertEqual(wsCreatedCount, 1, "start() creates exactly one WebSocket");
      assertEqual(
        wsRef.current?.url,
        "ws://127.0.0.1:45731/motion",
        "start() passes the correct URL to WebSocket",
      );
    }

    // Case 2: start() immediately reports "connecting"
    {
      const timers = makeFakeTimers();
      const statusUpdates = [];
      const conn = createNativeMotionFrameConnection({
        runtime: makeRuntime({ current: null }, timers),
        callbacks: {
          setLatestFrame: () => {},
          setConnectionStatus: (s) => statusUpdates.push(s),
        },
        url: "ws://127.0.0.1:45731/motion",
        reconnectDelayMs: 1000,
        staleFrameTimeoutMs: 1800,
      });

      conn.start();

      assertTrue(
        statusUpdates.includes("connecting"),
        "start() immediately reports connecting",
      );
    }

    // Case 3: triggering fake socket onopen reports "connected_waiting_for_frame"
    {
      const wsRef = { current: null };
      const timers = makeFakeTimers();
      const statusUpdates = [];
      const conn = createNativeMotionFrameConnection({
        runtime: makeRuntime(wsRef, timers),
        callbacks: {
          setLatestFrame: () => {},
          setConnectionStatus: (s) => statusUpdates.push(s),
        },
        url: "ws://127.0.0.1:45731/motion",
        reconnectDelayMs: 1000,
        staleFrameTimeoutMs: 1800,
      });

      conn.start();
      wsRef.current.readyState = FakeWebSocket.OPEN;
      wsRef.current.onopen();

      assertTrue(
        statusUpdates.includes("connected_waiting_for_frame"),
        "onopen reports connected_waiting_for_frame",
      );
    }

    // Case 4: stop() closes the fake socket
    {
      const wsRef = { current: null };
      const timers = makeFakeTimers();
      const conn = createNativeMotionFrameConnection({
        runtime: makeRuntime(wsRef, timers),
        callbacks: { setLatestFrame: () => {}, setConnectionStatus: () => {} },
        url: "ws://127.0.0.1:45731/motion",
        reconnectDelayMs: 1000,
        staleFrameTimeoutMs: 1800,
      });

      conn.start();
      conn.stop();

      assertTrue(wsRef.current.closeCalled, "stop() closes the fake socket");
    }

    // Case 5: stop() clears any scheduled stale timer
    {
      const wsRef = { current: null };
      const clearedHandles = [];
      let nextHandle = 1;
      const scheduledHandles = [];
      const timers = {
        setTimeout: (cb) => {
          const handle = nextHandle++;
          scheduledHandles.push(handle);
          return handle;
        },
        clearTimeout: (handle) => {
          clearedHandles.push(handle);
        },
      };
      const conn = createNativeMotionFrameConnection({
        runtime: makeRuntime(wsRef, timers),
        callbacks: { setLatestFrame: () => {}, setConnectionStatus: () => {} },
        url: "ws://127.0.0.1:45731/motion",
        reconnectDelayMs: 1000,
        staleFrameTimeoutMs: 1800,
      });

      conn.start();
      wsRef.current.readyState = FakeWebSocket.OPEN;
      wsRef.current.onopen();

      const staleHandle = scheduledHandles[0];
      assertTrue(
        staleHandle !== undefined,
        "stale timer was scheduled after onopen",
      );

      conn.stop();

      assertTrue(
        clearedHandles.includes(staleHandle),
        "stop() clears the scheduled stale timer",
      );
    }

    // Case 6: no state updates happen after stop()
    {
      const wsRef = { current: null };
      let capturedStaleCb = null;
      const timers = {
        setTimeout: (cb) => {
          capturedStaleCb = cb;
          return 1;
        },
        clearTimeout: () => {},
      };
      const statusUpdates = [];
      const frameUpdates = [];
      const conn = createNativeMotionFrameConnection({
        runtime: makeRuntime(wsRef, timers),
        callbacks: {
          setLatestFrame: (f) => frameUpdates.push(f),
          setConnectionStatus: (s) => statusUpdates.push(s),
        },
        url: "ws://127.0.0.1:45731/motion",
        reconnectDelayMs: 1000,
        staleFrameTimeoutMs: 1800,
      });

      conn.start();
      wsRef.current.readyState = FakeWebSocket.OPEN;
      wsRef.current.onopen();

      conn.stop();
      const countBeforeTimerFire = statusUpdates.length + frameUpdates.length;

      if (capturedStaleCb !== null) {
        capturedStaleCb();
      }

      assertEqual(
        statusUpdates.length + frameUpdates.length,
        countBeforeTimerFire,
        "no state updates happen after stop()",
      );
    }
  } finally {
    if (savedWebSocket === undefined) {
      delete global.WebSocket;
    } else {
      global.WebSocket = savedWebSocket;
    }
  }
};

runCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
