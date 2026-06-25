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
const MAP_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/mapMotionFrameToAvatar.ts",
  import.meta.url,
);

const requireFromWebPreview = createRequire(WEB_PREVIEW_PACKAGE_URL);
const ts = requireFromWebPreview("typescript");

const fail = (message) => {
  throw new Error(`Web Preview MotionFrame mapping check failed: ${message}`);
};

const assertEqual = (actual, expected, label) => {
  if (!Object.is(actual, expected)) {
    fail(`${label}: expected ${expected}, received ${actual}`);
  }
};

const assertDeepEqual = (actual, expected, label) => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  if (actualJson !== expectedJson) {
    fail(`${label}: expected ${expectedJson}, received ${actualJson}`);
  }
};

const createOutOfRangeFrame = () => ({
  schemaVersion: 1,
  timestampMs: 1000,
  source: "native",
  tracking: {
    status: "lost",
    confidence: 1.25,
  },
  face: {
    position: { x: 2, y: -2, z: 0.75 },
    rotation: { pitch: 2, yaw: -2, roll: 0.5 },
  },
  eyes: {
    leftOpen: -0.5,
    rightOpen: 1.5,
    gaze: { x: 2, y: -2 },
  },
  mouth: {
    open: 1.5,
    smile: -0.5,
  },
});

const loadMappingModule = async () => {
  const source = await readFile(MAP_SOURCE_URL, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: "mapMotionFrameToAvatar.ts",
  });

  const tempDir = await mkdtemp(join(tmpdir(), "lvk-motion-mapping-"));
  const tempModulePath = join(tempDir, "mapMotionFrameToAvatar.mjs");
  await writeFile(tempModulePath, output.outputText, "utf8");

  try {
    return await import(pathToFileURL(tempModulePath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const runCheck = async () => {
  const {
    createNeutralAvatarMotionState,
    lerpAvatarMotionState,
    mapMotionFrameToAvatar,
  } = await loadMappingModule();

  const mapped = mapMotionFrameToAvatar(createOutOfRangeFrame());

  assertEqual(mapped.trackingStatus, "lost", "tracking.status is preserved");
  assertEqual(mapped.confidence, 1, "tracking.confidence is clamped to 0..1");
  assertDeepEqual(
    mapped.rootPosition,
    [2, -1.5, 0.375],
    "face.position is clamped to -1..1 and scaled",
  );
  assertDeepEqual(
    mapped.headRotation,
    [1, -1, 0.5],
    "face.rotation is clamped to -1..1 and mapped to headRotation",
  );
  assertDeepEqual(
    mapped.eyeOpen,
    { left: 0, right: 1 },
    "eyes.leftOpen and eyes.rightOpen are clamped to 0..1",
  );
  assertDeepEqual(
    mapped.gaze,
    [1, -1],
    "eyes.gaze.x/y are clamped to -1..1",
  );
  assertDeepEqual(
    mapped.mouth,
    { open: 1, smile: 0 },
    "mouth.open and mouth.smile are clamped to 0..1",
  );

  assertDeepEqual(
    createNeutralAvatarMotionState(),
    {
      trackingStatus: "not_started",
      confidence: 0,
      rootPosition: [0, 0, 0],
      headRotation: [0, 0, 0],
      eyeOpen: { left: 1, right: 1 },
      gaze: [0, 0],
      mouth: { open: 0, smile: 0 },
    },
    "createNeutralAvatarMotionState returns not_started neutral values",
  );
  assertEqual(
    createNeutralAvatarMotionState("lost").trackingStatus,
    "lost",
    "createNeutralAvatarMotionState accepts an explicit status",
  );

  const from = createNeutralAvatarMotionState("tracking");
  const to = {
    trackingStatus: "lost",
    confidence: 1,
    rootPosition: [2, -2, 1],
    headRotation: [1, -1, 0.5],
    eyeOpen: { left: 0, right: 0.5 },
    gaze: [1, -1],
    mouth: { open: 1, smile: 0.5 },
  };

  assertDeepEqual(
    lerpAvatarMotionState(from, to, 0.25),
    {
      trackingStatus: "lost",
      confidence: 0.25,
      rootPosition: [0.5, -0.5, 0.25],
      headRotation: [0.25, -0.25, 0.125],
      eyeOpen: { left: 0.75, right: 0.875 },
      gaze: [0.25, -0.25],
      mouth: { open: 0.25, smile: 0.125 },
    },
    "lerpAvatarMotionState preserves target status and interpolates numeric fields",
  );
  assertDeepEqual(
    lerpAvatarMotionState(from, to, 2),
    to,
    "lerpAvatarMotionState clamps interpolation amount above 1",
  );
  assertDeepEqual(
    lerpAvatarMotionState(from, to, -1),
    { ...from, trackingStatus: "lost" },
    "lerpAvatarMotionState clamps interpolation amount below 0 while preserving target status",
  );
};

runCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
