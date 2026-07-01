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

const assertClose = (actual, expected, label, tolerance = 1e-9) => {
  if (typeof actual !== "number" || Math.abs(actual - expected) > tolerance) {
    fail(`${label}: expected ~${expected}, received ${actual}`);
  }
};

const assertInRange = (actual, min, max, label) => {
  if (typeof actual !== "number" || actual < min || actual > max) {
    fail(`${label}: expected within [${min}, ${max}], received ${actual}`);
  }
};

const createTrackingMotion = (overrides = {}) => ({
  trackingStatus: "tracking",
  confidence: 0.5,
  rootPosition: [1, 2, 3],
  headRotation: [0.1, -0.2, 0.3],
  eyeOpen: { left: 1, right: 1 },
  gaze: [0, 0],
  mouth: { open: 0, smile: 0 },
  ...overrides,
});

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
    applyRendererIdleApproximation,
    createNeutralAvatarMotionState,
    lerpAvatarMotionState,
    mapMotionFrameToAvatar,
  } = await loadMappingModule();

  const mapped = mapMotionFrameToAvatar(createOutOfRangeFrame());

  assertEqual(mapped.trackingStatus, "lost", "tracking.status is preserved");
  assertEqual(mapped.confidence, 1, "tracking.confidence is clamped to 0..1");
  assertDeepEqual(
    mapped.rootPosition,
    [3.2, -2.4, 0.675],
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
  assertDeepEqual(mapped.gaze, [1, -1], "eyes.gaze.x/y are clamped to -1..1");
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

  // --- Renderer-side idle approximation ---
  // A timestamp mid-blink (half of the 160ms blink window) so eye openness dips
  // to a known value while gaze/mouth idle motion is also active.
  const IDLE_MID_BLINK_TIMESTAMP_MS = 80;

  const neutralTracking = createTrackingMotion();
  const idle = applyRendererIdleApproximation(
    neutralTracking,
    IDLE_MID_BLINK_TIMESTAMP_MS,
  );

  assertDeepEqual(
    idle.rootPosition,
    neutralTracking.rootPosition,
    "idle approximation does not change rootPosition",
  );
  assertDeepEqual(
    idle.headRotation,
    neutralTracking.headRotation,
    "idle approximation does not change headRotation",
  );
  assertEqual(
    idle.confidence,
    neutralTracking.confidence,
    "idle approximation does not change confidence",
  );
  assertEqual(
    idle.trackingStatus,
    "tracking",
    "idle approximation preserves tracking status",
  );

  // Mid-blink dip: eyeOpen = 1 - sin(pi/2) * 0.85 = 0.15 on both eyes.
  assertClose(
    idle.eyeOpen.left,
    0.15,
    "idle approximation dips left eye openness mid-blink",
    1e-9,
  );
  assertClose(
    idle.eyeOpen.right,
    0.15,
    "idle approximation dips right eye openness mid-blink",
    1e-9,
  );
  assertInRange(
    idle.eyeOpen.left,
    0,
    1,
    "idle approximation keeps left eye openness clamped 0..1",
  );

  assertInRange(
    idle.gaze[0],
    -1,
    1,
    "idle approximation clamps gaze.x to -1..1",
  );
  assertInRange(
    idle.gaze[1],
    -1,
    1,
    "idle approximation clamps gaze.y to -1..1",
  );
  if (idle.gaze[0] === 0 && idle.gaze[1] === 0) {
    fail(
      "idle approximation should add non-neutral gaze drift when gaze is neutral",
    );
  }

  assertInRange(
    idle.mouth.open,
    0,
    1,
    "idle approximation clamps mouth.open to 0..1",
  );
  if (idle.mouth.open <= 0) {
    fail(
      "idle approximation should add subtle mouth idle when mouth is neutral",
    );
  }
  assertEqual(
    idle.mouth.smile,
    0,
    "idle approximation leaves neutral mouth.smile untouched",
  );

  // Deterministic for a given timestamp.
  assertDeepEqual(
    applyRendererIdleApproximation(
      createTrackingMotion(),
      IDLE_MID_BLINK_TIMESTAMP_MS,
    ),
    idle,
    "idle approximation is deterministic for a given timestamp",
  );

  // Only applies while tracking: lost / not_started are returned untouched.
  const lostNeutral = createNeutralAvatarMotionState("lost");
  assertDeepEqual(
    applyRendererIdleApproximation(lostNeutral, IDLE_MID_BLINK_TIMESTAMP_MS),
    lostNeutral,
    "idle approximation leaves lost state untouched",
  );
  const notStartedNeutral = createNeutralAvatarMotionState("not_started");
  assertDeepEqual(
    applyRendererIdleApproximation(
      notStartedNeutral,
      IDLE_MID_BLINK_TIMESTAMP_MS,
    ),
    notStartedNeutral,
    "idle approximation leaves not_started state untouched",
  );

  // Preserves non-neutral (real) eye/gaze/mouth values instead of overriding.
  const nonNeutralTracking = createTrackingMotion({
    eyeOpen: { left: 0.3, right: 0.4 },
    gaze: [0.5, -0.5],
    mouth: { open: 0.6, smile: 0.2 },
  });
  assertDeepEqual(
    applyRendererIdleApproximation(
      nonNeutralTracking,
      IDLE_MID_BLINK_TIMESTAMP_MS,
    ),
    nonNeutralTracking,
    "idle approximation preserves non-neutral eye/gaze/mouth values",
  );

  // Per-channel independence: non-neutral eyes are preserved while still-neutral
  // gaze and mouth receive idle motion.
  const mixedTracking = createTrackingMotion({
    eyeOpen: { left: 0.3, right: 0.4 },
  });
  const mixedIdle = applyRendererIdleApproximation(
    mixedTracking,
    IDLE_MID_BLINK_TIMESTAMP_MS,
  );
  assertDeepEqual(
    mixedIdle.eyeOpen,
    mixedTracking.eyeOpen,
    "idle approximation preserves non-neutral eyes while other channels are neutral",
  );
  if (mixedIdle.gaze[0] === 0 && mixedIdle.gaze[1] === 0) {
    fail(
      "idle approximation should still add gaze drift when only eyes are non-neutral",
    );
  }
  if (mixedIdle.mouth.open <= 0) {
    fail(
      "idle approximation should still add mouth idle when only eyes are non-neutral",
    );
  }
};

runCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
