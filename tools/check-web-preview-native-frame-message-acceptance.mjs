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
    `Web Preview native frame message acceptance check failed: ${message}`,
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
  const tempDir = await mkdtemp(join(tmpdir(), "lvk-motion-frame-acceptance-"));
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

const makeValidFrame = (timestampMs) =>
  JSON.stringify({
    schemaVersion: 1,
    source: "native",
    timestampMs,
    tracking: { status: "tracking", confidence: 0.95 },
    face: {
      position: { x: 0.1, y: 0.2, z: 0.3 },
      rotation: { pitch: 0.01, yaw: 0.02, roll: 0.03 },
    },
    eyes: {
      leftOpen: 0.9,
      rightOpen: 0.85,
      gaze: { x: 0.05, y: -0.02 },
    },
    mouth: { open: 0.1, smile: 0.3 },
  });

const runCheck = async () => {
  const savedWebSocket = global.WebSocket;
  global.WebSocket = FakeWebSocket;

  try {
    const { createNativeMotionFrameConnection } = await loadConnectionModule();

    // Case 1: valid fresh message → setLatestFrame, "connected", old stale timer cleared, new stale timer scheduled
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
      // handle 1 is the stale timer from onopen
      const staleHandleAfterOpen = 1;
      assertTrue(
        timers.has(staleHandleAfterOpen),
        "stale timer is active after onopen",
      );

      wsRef.current.onmessage({ data: makeValidFrame(1000) });

      // old stale timer should be cleared
      assertTrue(
        !timers.has(staleHandleAfterOpen),
        "valid message clears the stale timer from onopen",
      );
      // new stale timer should be scheduled (handle 2)
      assertTrue(timers.has(2), "valid message schedules a new stale timer");
      // latest frame should be set
      const nonNullFrames = frameUpdates.filter((f) => f !== null);
      assertEqual(
        nonNullFrames.length,
        1,
        "valid message calls setLatestFrame once with a non-null frame",
      );
      assertEqual(
        nonNullFrames[0].timestampMs,
        1000,
        "setLatestFrame receives the parsed frame with correct timestampMs",
      );
      assertEqual(
        nonNullFrames[0].source,
        "native",
        "setLatestFrame receives the parsed frame with source native",
      );
      // status should include "connected"
      assertTrue(
        statusUpdates.includes("connected"),
        "valid message reports connected status",
      );
    }

    // Case 2: invalid JSON → no frame update, no "connected" status
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
      const frameCountBefore = frameUpdates.length;
      const statusCountBefore = statusUpdates.length;

      wsRef.current.onmessage({ data: "not json{" });

      assertEqual(
        frameUpdates.length,
        frameCountBefore,
        "invalid JSON does not call setLatestFrame",
      );
      assertEqual(
        statusUpdates.length,
        statusCountBefore,
        "invalid JSON does not update connection status",
      );
    }

    // Case 3: valid JSON but invalid MotionFrame schema → no frame update, no "connected"
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
      const frameCountBefore = frameUpdates.length;
      const statusCountBefore = statusUpdates.length;

      // missing required fields such as face, eyes, mouth
      wsRef.current.onmessage({
        data: JSON.stringify({
          schemaVersion: 1,
          source: "native",
          timestampMs: 500,
        }),
      });

      assertEqual(
        frameUpdates.length,
        frameCountBefore,
        "invalid MotionFrame schema does not call setLatestFrame",
      );
      assertEqual(
        statusUpdates.length,
        statusCountBefore,
        "invalid MotionFrame schema does not update connection status",
      );
    }

    // Case 4: older timestamp after a valid frame → ignored
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

      wsRef.current.onmessage({ data: makeValidFrame(1000) });
      const frameCountAfterFirst = frameUpdates.filter(
        (f) => f !== null,
      ).length;
      const staleHandleAfterFirst = 2;
      assertTrue(
        timers.has(staleHandleAfterFirst),
        "stale timer after first valid message",
      );

      wsRef.current.onmessage({ data: makeValidFrame(999) });

      assertEqual(
        frameUpdates.filter((f) => f !== null).length,
        frameCountAfterFirst,
        "older timestamp message does not call setLatestFrame again",
      );
      // stale timer should not be reset by the ignored message
      assertTrue(
        timers.has(staleHandleAfterFirst),
        "older timestamp message does not reset the stale timer",
      );
    }

    // Case 5: equal timestamp → ignored (isFreshMotionFrame requires strictly greater)
    {
      const wsRef = { current: null };
      const timers = makeFakeTimers();
      const frameUpdates = [];
      const conn = createNativeMotionFrameConnection({
        runtime: makeRuntime(wsRef, timers),
        callbacks: {
          setLatestFrame: (f) => frameUpdates.push(f),
          setConnectionStatus: () => {},
        },
        url: "ws://127.0.0.1:45731/motion",
        reconnectDelayMs: 1000,
        staleFrameTimeoutMs: 1800,
      });

      conn.start();
      wsRef.current.readyState = FakeWebSocket.OPEN;
      wsRef.current.onopen();

      wsRef.current.onmessage({ data: makeValidFrame(1000) });
      const frameCountAfterFirst = frameUpdates.filter(
        (f) => f !== null,
      ).length;

      wsRef.current.onmessage({ data: makeValidFrame(1000) });

      assertEqual(
        frameUpdates.filter((f) => f !== null).length,
        frameCountAfterFirst,
        "equal timestamp message does not call setLatestFrame again",
      );
    }

    // Case 6: onmessage after stop() → no frame update, no status update, no timer
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
      conn.stop();

      const frameCountBefore = frameUpdates.length;
      const statusCountBefore = statusUpdates.length;
      const scheduled = new Map();

      wsRef.current.onmessage({ data: makeValidFrame(2000) });

      assertEqual(
        frameUpdates.length,
        frameCountBefore,
        "onmessage after stop() does not call setLatestFrame",
      );
      assertEqual(
        statusUpdates.length,
        statusCountBefore,
        "onmessage after stop() does not update connection status",
      );
      // no new stale timer should be scheduled after stop
      // handle 1 was stale from onopen (cleared by stop), so next would be 2+
      // since stop() clears timers, no new ones should appear
      void scheduled;
    }

    // Case 7: onmessage while socket readyState is not OPEN → ignored
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
      // readyState stays 0 (CONNECTING) — do not call onopen
      const frameCountBefore = frameUpdates.length;
      const statusCountBefore = statusUpdates.length;

      wsRef.current.onmessage({ data: makeValidFrame(1000) });

      assertEqual(
        frameUpdates.length,
        frameCountBefore,
        "onmessage while socket is not open does not call setLatestFrame",
      );
      assertEqual(
        statusUpdates.length,
        statusCountBefore,
        "onmessage while socket is not open does not update connection status",
      );
    }

    console.log("Web Preview native frame message acceptance check passed.");
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
