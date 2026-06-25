#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const WEB_PREVIEW_PACKAGE_URL = new URL(
  "../apps/web-preview/package.json",
  import.meta.url,
);
const RUNTIME_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/nativeMotionFrameRuntime.ts",
  import.meta.url,
);

const requireFromWebPreview = createRequire(WEB_PREVIEW_PACKAGE_URL);
const ts = requireFromWebPreview("typescript");

const fail = (message) => {
  throw new Error(`Web Preview native runtime deps check failed: ${message}`);
};

const assertEqual = (actual, expected, label) => {
  if (!Object.is(actual, expected)) {
    fail(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
};

const loadRuntimeModule = async () => {
  const source = await readFile(RUNTIME_SOURCE_URL, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: "nativeMotionFrameRuntime.ts",
  });

  const tempDir = await mkdtemp(join(tmpdir(), "lvk-motion-runtime-"));
  const tempModulePath = join(tempDir, "nativeMotionFrameRuntime.mjs");
  await writeFile(tempModulePath, output.outputText, "utf8");

  try {
    return await import(pathToFileURL(tempModulePath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const runCheck = async () => {
  const savedWindow = global.window;
  const savedWebSocket = global.WebSocket;

  let setTimeoutCallCount = 0;
  let clearTimeoutCallCount = 0;
  let lastWsUrl = null;

  const mockWindow = {
    setTimeout: function (...args) {
      setTimeoutCallCount++;
      return global.setTimeout(...args);
    },
    clearTimeout: function (...args) {
      clearTimeoutCallCount++;
      global.clearTimeout(...args);
    },
  };

  global.window = mockWindow;
  global.WebSocket = class MockWebSocket {
    constructor(url) {
      lastWsUrl = url;
    }
  };

  try {
    const { createBrowserNativeMotionFrameRuntime } = await loadRuntimeModule();
    const runtime = createBrowserNativeMotionFrameRuntime();

    if (typeof runtime !== "object" || runtime === null) {
      fail("createBrowserNativeMotionFrameRuntime did not return an object");
    }
    if (typeof runtime.createWebSocket !== "function") {
      fail("runtime.createWebSocket is not a function");
    }
    if (typeof runtime.setTimeout !== "function") {
      fail("runtime.setTimeout is not a function");
    }
    if (typeof runtime.clearTimeout !== "function") {
      fail("runtime.clearTimeout is not a function");
    }

    // Verify createWebSocket calls WebSocket constructor with the exact url
    const testUrl = "ws://127.0.0.1:45731/motion";
    runtime.createWebSocket(testUrl);
    assertEqual(
      lastWsUrl,
      testUrl,
      "createWebSocket passes url to WebSocket constructor",
    );

    // Verify setTimeout delegates to window.setTimeout
    const handle = runtime.setTimeout(() => {}, 9999);
    assertEqual(
      setTimeoutCallCount,
      1,
      "setTimeout delegates to window.setTimeout",
    );
    global.clearTimeout(handle);

    // Verify clearTimeout delegates to window.clearTimeout
    runtime.clearTimeout(undefined);
    assertEqual(
      clearTimeoutCallCount,
      1,
      "clearTimeout delegates to window.clearTimeout",
    );
  } finally {
    if (savedWindow === undefined) {
      delete global.window;
    } else {
      global.window = savedWindow;
    }
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
