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
  throw new Error(`Web Preview native reconnect loop check failed: ${message}`);
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
  const tempDir = await mkdtemp(join(tmpdir(), "lvk-motion-reconnect-loop-"));
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

    // Case 1: onclose clears the stale timer, clears the native frame, and reports "reconnecting"
    {
      const wsRef = { current: null };
      const timers = makeFakeTimers();
      const frameUpdates = [];
      const statusUpdates = [];
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
      // handle 1 is the stale timer scheduled by onopen
      const staleHandle = 1;
      assertTrue(timers.has(staleHandle), "stale timer is active after onopen");

      wsRef.current.onclose();

      assertTrue(!timers.has(staleHandle), "onclose clears the stale timer");
      assertTrue(
        frameUpdates.includes(null),
        "onclose clears the native frame via setLatestFrame(null)",
      );
      assertTrue(
        statusUpdates.includes("reconnecting"),
        "onclose reports reconnecting status",
      );
    }

    // Case 2: onclose schedules a reconnect timer
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
      wsRef.current.readyState = FakeWebSocket.OPEN;
      wsRef.current.onopen();
      wsRef.current.onclose();
      // handle 1 was the stale timer (cleared by onclose); handle 2 is the reconnect timer
      const reconnectHandle = 2;
      assertTrue(
        timers.has(reconnectHandle),
        "onclose schedules a reconnect timer",
      );
    }

    // Case 3: reconnect timer fires → creates second WebSocket with same URL, reports "reconnecting"
    {
      const wsRef = { current: null };
      const wsCreatedUrls = [];
      const timers = makeFakeTimers();
      const statusUpdates = [];
      const runtime = {
        createWebSocket: (url) => {
          wsCreatedUrls.push(url);
          const ws = new FakeWebSocket(url);
          wsRef.current = ws;
          return ws;
        },
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
      };
      const conn = createNativeMotionFrameConnection({
        runtime,
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
      wsRef.current.onclose();
      // trigger the reconnect timer (handle 2; handle 1 was the stale timer)
      timers.trigger(2);

      assertEqual(
        wsCreatedUrls.length,
        2,
        "reconnect timer fires and creates a second WebSocket",
      );
      assertEqual(
        wsCreatedUrls[1],
        "ws://127.0.0.1:45731/motion",
        "reconnect WebSocket uses the same URL",
      );
      // hasAttemptedConnection is already true, so connect() reports "reconnecting" not "connecting"
      assertEqual(
        statusUpdates[statusUpdates.length - 1],
        "reconnecting",
        "reconnect connect path reports reconnecting rather than connecting",
      );
    }

    // Case 4: repeated onclose while reconnect timer is active → no duplicate reconnect timer
    {
      const wsRef = { current: null };
      let scheduledCount = 0;
      const scheduled = new Map();
      let nextHandle = 1;
      const timers = {
        setTimeout: (cb) => {
          scheduledCount++;
          const handle = nextHandle++;
          scheduled.set(handle, cb);
          return handle;
        },
        clearTimeout: (handle) => {
          scheduled.delete(handle);
        },
      };
      const runtime = {
        createWebSocket: (url) => {
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
      wsRef.current.readyState = FakeWebSocket.OPEN;
      wsRef.current.onopen();
      wsRef.current.onclose();
      const countAfterFirstClose = scheduledCount;

      wsRef.current.onclose();

      assertEqual(
        scheduledCount,
        countAfterFirstClose,
        "repeated onclose while reconnect timer is active does not schedule a duplicate reconnect timer",
      );
    }

    // Case 5: after stop(), a captured reconnect timer fires → no new WebSocket, no state updates
    {
      const wsRef = { current: null };
      let wsCreatedCount = 0;
      let capturedReconnectCb = null;
      let timerSeq = 0;
      const timers = {
        setTimeout: (cb) => {
          timerSeq++;
          // the reconnect timer is the second timer scheduled (first is the stale timer from onopen)
          if (timerSeq === 2) {
            capturedReconnectCb = cb;
          }
          return timerSeq;
        },
        clearTimeout: () => {},
      };
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
      const statusUpdates = [];
      const frameUpdates = [];
      const conn = createNativeMotionFrameConnection({
        runtime,
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
      wsRef.current.onclose();

      conn.stop();
      const wsCountBefore = wsCreatedCount;
      const updateCountBefore = statusUpdates.length + frameUpdates.length;

      if (capturedReconnectCb !== null) {
        capturedReconnectCb();
      }

      assertEqual(
        wsCreatedCount,
        wsCountBefore,
        "after stop(), firing the reconnect timer does not create a new WebSocket",
      );
      assertEqual(
        statusUpdates.length + frameUpdates.length,
        updateCountBefore,
        "after stop(), firing the reconnect timer does not update frame or status",
      );
    }

    console.log("Web Preview native reconnect loop check passed.");
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
