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
    `Web Preview native stale fallback check failed: ${message}`,
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

const assertFalse = (value, label) => {
  if (value) {
    fail(`${label}: expected falsy, received ${String(value)}`);
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
  const tempDir = await mkdtemp(join(tmpdir(), "lvk-motion-stale-fallback-"));
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

    // Case 1: stale timer fires while socket is open → clears frame and reports "fallback"
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

      // onopen schedules the stale timer as the first (and only) timer at this point
      const staleHandle = 1;
      assertTrue(
        timers.has(staleHandle),
        "stale timer was scheduled after onopen",
      );

      timers.trigger(staleHandle);

      assertTrue(
        frameUpdates.includes(null),
        "stale timer clears the latest frame via setLatestFrame(null)",
      );
      assertTrue(
        statusUpdates.includes("fallback"),
        "stale timer reports fallback status",
      );
    }

    // Case 2: socket is not open when stale timer fires → fallback is not reported
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

      // close the socket before firing the timer
      wsRef.current.readyState = 3;

      const countBefore = statusUpdates.length + frameUpdates.length;
      if (capturedStaleCb !== null) {
        capturedStaleCb();
      }

      assertFalse(
        statusUpdates.includes("fallback"),
        "stale timer does not report fallback when socket is not open",
      );
      assertEqual(
        statusUpdates.length + frameUpdates.length,
        countBefore,
        "no new state updates when socket is closed at stale timer fire",
      );
    }

    // Case 3: after stop(), a captured stale timer does not update frame or status
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

      const countBefore = statusUpdates.length + frameUpdates.length;
      if (capturedStaleCb !== null) {
        capturedStaleCb();
      }

      assertEqual(
        statusUpdates.length + frameUpdates.length,
        countBefore,
        "no state updates after stop() when stale timer fires",
      );
    }

    console.log("Web Preview native stale fallback check passed.");
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
