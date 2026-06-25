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
const LIFECYCLE_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/nativeMotionFrameLifecycle.ts",
  import.meta.url,
);

const requireFromWebPreview = createRequire(WEB_PREVIEW_PACKAGE_URL);
const ts = requireFromWebPreview("typescript");

const fail = (message) => {
  throw new Error(
    `Web Preview native lifecycle transitions check failed: ${message}`,
  );
};

const assertEqual = (actual, expected, label) => {
  if (!Object.is(actual, expected)) {
    fail(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
};

const loadLifecycleModule = async () => {
  const source = await readFile(LIFECYCLE_SOURCE_URL, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: "nativeMotionFrameLifecycle.ts",
  });

  const tempDir = await mkdtemp(join(tmpdir(), "lvk-motion-lifecycle-"));
  const tempModulePath = join(tempDir, "nativeMotionFrameLifecycle.mjs");
  await writeFile(tempModulePath, output.outputText, "utf8");

  try {
    return await import(pathToFileURL(tempModulePath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const runCheck = async () => {
  const { getNativeMotionConnectingStatus, getNativeMotionReconnectStatus } =
    await loadLifecycleModule();

  assertEqual(
    getNativeMotionConnectingStatus(false),
    "connecting",
    "first connect returns connecting",
  );
  assertEqual(
    getNativeMotionConnectingStatus(true),
    "reconnecting",
    "subsequent connect returns reconnecting",
  );

  assertEqual(
    getNativeMotionReconnectStatus(true, false),
    null,
    "schedule reconnect when unmounted returns null",
  );
  assertEqual(
    getNativeMotionReconnectStatus(false, true),
    null,
    "schedule reconnect when reconnect timer is already active returns null",
  );
  assertEqual(
    getNativeMotionReconnectStatus(false, false),
    "reconnecting",
    "schedule reconnect when mounted and no reconnect timer active returns reconnecting",
  );
};

runCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
