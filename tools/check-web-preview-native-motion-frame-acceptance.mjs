#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const WEB_PREVIEW_PACKAGE_URL = new URL(
  "../apps/web-preview/package.json",
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
const MOTION_FRAME_VALIDATION_URL = new URL(
  "../packages/motion-protocol/src/motion-frame-validation.js",
  import.meta.url,
);

const requireFromWebPreview = createRequire(WEB_PREVIEW_PACKAGE_URL);
const ts = requireFromWebPreview("typescript");

const fail = (message) => {
  throw new Error(
    `Web Preview native MotionFrame acceptance check failed: ${message}`,
  );
};

const assertEqual = (actual, expected, label) => {
  if (!Object.is(actual, expected)) {
    fail(`${label}: expected ${expected}, received ${actual}`);
  }
};

const createFrame = (timestampMs, source = "native") => ({
  schemaVersion: 1,
  timestampMs,
  source,
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

const transpileSource = (source, fileName) => {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName,
  }).outputText;
};

const loadAcceptanceModule = async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "lvk-motion-acceptance-"));
  const tempProtocolDir = join(
    tempDir,
    "node_modules",
    "@lvk",
    "motion-protocol",
  );
  const tempFreshnessPath = join(tempDir, "nativeMotionFrameFreshness.mjs");
  const tempAcceptancePath = join(tempDir, "nativeMotionFrameAcceptance.mjs");

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
      tempFreshnessPath,
      transpileSource(freshnessSource, "nativeMotionFrameFreshness.ts"),
      "utf8",
    );

    const acceptanceSource = await readFile(ACCEPTANCE_SOURCE_URL, "utf8");
    const acceptanceOutput = transpileSource(
      acceptanceSource,
      "nativeMotionFrameAcceptance.ts",
    ).replace(
      'from "./nativeMotionFrameFreshness"',
      'from "./nativeMotionFrameFreshness.mjs"',
    );
    await mkdir(dirname(tempAcceptancePath), { recursive: true });
    await writeFile(tempAcceptancePath, acceptanceOutput, "utf8");

    return await import(pathToFileURL(tempAcceptancePath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const runCheck = async () => {
  const { parseFreshNativeMotionFrame } = await loadAcceptanceModule();
  const latestTimestampMs = 1000;

  assertEqual(
    parseFreshNativeMotionFrame("{not-json", latestTimestampMs),
    null,
    "invalid JSON returns null",
  );
  assertEqual(
    parseFreshNativeMotionFrame(createFrame(1001), latestTimestampMs),
    null,
    "non-string payload returns null",
  );
  assertEqual(
    parseFreshNativeMotionFrame(
      JSON.stringify(createFrame(1001, "dummy")),
      latestTimestampMs,
    ),
    null,
    "dummy MotionFrame JSON returns null",
  );
  assertEqual(
    parseFreshNativeMotionFrame(
      JSON.stringify(createFrame(999)),
      latestTimestampMs,
    ),
    null,
    "older native timestamps return null",
  );
  assertEqual(
    parseFreshNativeMotionFrame(
      JSON.stringify(createFrame(1000)),
      latestTimestampMs,
    ),
    null,
    "equal native timestamps return null",
  );

  const freshFrame = createFrame(1001);
  const parsedFrame = parseFreshNativeMotionFrame(
    JSON.stringify(freshFrame),
    latestTimestampMs,
  );
  assertEqual(
    JSON.stringify(parsedFrame),
    JSON.stringify(freshFrame),
    "newer native timestamps return the parsed frame",
  );
};

runCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
