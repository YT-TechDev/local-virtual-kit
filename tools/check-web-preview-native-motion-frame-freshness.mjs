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
const FRESHNESS_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/nativeMotionFrameFreshness.ts",
  import.meta.url,
);

const requireFromWebPreview = createRequire(WEB_PREVIEW_PACKAGE_URL);
const ts = requireFromWebPreview("typescript");

const fail = (message) => {
  throw new Error(
    `Web Preview native MotionFrame freshness check failed: ${message}`,
  );
};

const assertEqual = (actual, expected, label) => {
  if (!Object.is(actual, expected)) {
    fail(`${label}: expected ${expected}, received ${actual}`);
  }
};

const createFrame = (timestampMs) => ({
  schemaVersion: 1,
  timestampMs,
  source: "native",
  tracking: {
    status: "tracking",
    confidence: 1,
  },
  face: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { pitch: 0, yaw: 0, roll: 0 },
  },
  eyes: {
    leftOpen: 1,
    rightOpen: 1,
    gaze: { x: 0, y: 0 },
  },
  mouth: {
    open: 0,
    smile: 0,
  },
});

const loadFreshnessModule = async () => {
  const source = await readFile(FRESHNESS_SOURCE_URL, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: "nativeMotionFrameFreshness.ts",
  });

  const tempDir = await mkdtemp(join(tmpdir(), "lvk-motion-freshness-"));
  const tempModulePath = join(tempDir, "nativeMotionFrameFreshness.mjs");
  await writeFile(tempModulePath, output.outputText, "utf8");

  try {
    return await import(pathToFileURL(tempModulePath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const runCheck = async () => {
  const { isFreshMotionFrame } = await loadFreshnessModule();

  assertEqual(isFreshMotionFrame(null, 1000), false, "null frames are stale");
  assertEqual(
    isFreshMotionFrame(createFrame(999), 1000),
    false,
    "older timestamps are stale",
  );
  assertEqual(
    isFreshMotionFrame(createFrame(1000), 1000),
    false,
    "equal timestamps are stale",
  );
  assertEqual(
    isFreshMotionFrame(createFrame(1001), 1000),
    true,
    "newer timestamps are fresh",
  );
};

runCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
