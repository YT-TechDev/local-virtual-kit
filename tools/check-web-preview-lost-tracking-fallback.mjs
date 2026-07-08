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
const FALLBACK_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/lostTrackingFallback.ts",
  import.meta.url,
);
const CALIBRATION_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/faceFollowingCalibration.ts",
  import.meta.url,
);

const requireFromWebPreview = createRequire(WEB_PREVIEW_PACKAGE_URL);
const ts = requireFromWebPreview("typescript");

const fail = (message) => {
  throw new Error(
    `Web Preview lost tracking fallback check failed: ${message}`,
  );
};

const assertEqual = (actual, expected, label) => {
  if (!Object.is(actual, expected)) {
    fail(`${label}: expected ${String(expected)}, received ${String(actual)}`);
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

const transpileSource = (source, fileName) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName,
  }).outputText;

const loadModules = async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "lvk-lost-tracking-fallback-"));

  try {
    const calibrationSource = await readFile(CALIBRATION_SOURCE_URL, "utf8");
    await writeFile(
      join(tempDir, "faceFollowingCalibration.mjs"),
      transpileSource(calibrationSource, "faceFollowingCalibration.ts"),
      "utf8",
    );

    const mapSource = await readFile(MAP_SOURCE_URL, "utf8");
    await writeFile(
      join(tempDir, "mapMotionFrameToAvatar.mjs"),
      transpileSource(mapSource, "mapMotionFrameToAvatar.ts").replace(
        'from "./faceFollowingCalibration"',
        'from "./faceFollowingCalibration.mjs"',
      ),
      "utf8",
    );

    const fallbackSource = await readFile(FALLBACK_SOURCE_URL, "utf8");
    await writeFile(
      join(tempDir, "lostTrackingFallback.mjs"),
      transpileSource(fallbackSource, "lostTrackingFallback.ts").replace(
        'from "./mapMotionFrameToAvatar"',
        'from "./mapMotionFrameToAvatar.mjs"',
      ),
      "utf8",
    );

    const mapModule = await import(
      pathToFileURL(join(tempDir, "mapMotionFrameToAvatar.mjs")).href
    );
    const fallbackModule = await import(
      pathToFileURL(join(tempDir, "lostTrackingFallback.mjs")).href
    );

    return { mapModule, fallbackModule };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const createTrackingMotion = (overrides = {}) => ({
  trackingStatus: "tracking",
  confidence: 0.9,
  rootPosition: [1.5, -0.8, 0.4],
  headRotation: [0.3, -0.2, 0.1],
  eyeOpen: { left: 0.5, right: 0.6 },
  gaze: [0.4, -0.3],
  mouth: { open: 0.7, smile: 0.2 },
  ...overrides,
});

const runCheck = async () => {
  const { mapModule, fallbackModule } = await loadModules();
  const { createNeutralAvatarMotionState } = mapModule;
  const {
    computeLostTrackingFallbackMotion,
    LOST_TRACKING_ROOT_HOLD_MS,
    LOST_TRACKING_ROOT_RETURN_AMOUNT,
    LOST_TRACKING_FEATURE_RESET_AMOUNT,
  } = fallbackModule;

  const neutralLost = createNeutralAvatarMotionState("lost");

  // Case 1: short lost flicker within the hold window preserves the last valid
  // root position exactly, while features relax toward neutral.
  {
    const lastTracking = createTrackingMotion();
    const result = computeLostTrackingFallbackMotion({
      lastTrackingMotion: lastTracking,
      lastTrackingTimestampMs: 1000,
      previousLostFallbackMotion: lastTracking,
      currentTimestampMs: 1000 + LOST_TRACKING_ROOT_HOLD_MS, // still within hold
    });

    assertEqual(
      result.trackingStatus,
      "lost",
      "held frame reports lost status",
    );
    assertDeepEqual(
      result.rootPosition,
      lastTracking.rootPosition,
      "root position is held exactly at the last valid tracking pose during flicker",
    );

    // Features relaxed toward neutral by the feature reset amount.
    assertClose(
      result.headRotation[0],
      lastTracking.headRotation[0] +
        (neutralLost.headRotation[0] - lastTracking.headRotation[0]) *
          LOST_TRACKING_FEATURE_RESET_AMOUNT,
      "head rotation relaxes toward neutral while root is held",
    );
    assertClose(
      result.mouth.open,
      lastTracking.mouth.open +
        (neutralLost.mouth.open - lastTracking.mouth.open) *
          LOST_TRACKING_FEATURE_RESET_AMOUNT,
      "mouth openness relaxes toward neutral while root is held",
    );
    assertClose(
      result.eyeOpen.left,
      lastTracking.eyeOpen.left +
        (neutralLost.eyeOpen.left - lastTracking.eyeOpen.left) *
          LOST_TRACKING_FEATURE_RESET_AMOUNT,
      "eye openness relaxes toward neutral while root is held",
    );

    // Root held, but a feature (mouth open) must have moved: proves the split.
    if (result.mouth.open === lastTracking.mouth.open) {
      fail("features should relax even while root position is held");
    }
  }

  // Case 2: persistent lost past the hold window returns root toward neutral
  // gradually (a small step), not a snap to zero.
  {
    const lastTracking = createTrackingMotion();
    const previousLost = {
      ...neutralLost,
      rootPosition: [...lastTracking.rootPosition],
    };
    const result = computeLostTrackingFallbackMotion({
      lastTrackingMotion: lastTracking,
      lastTrackingTimestampMs: 1000,
      previousLostFallbackMotion: previousLost,
      currentTimestampMs: 1000 + LOST_TRACKING_ROOT_HOLD_MS + 1, // just past hold
    });

    const expectedRoot = previousLost.rootPosition.map(
      (value) => value + (0 - value) * LOST_TRACKING_ROOT_RETURN_AMOUNT,
    );
    assertDeepEqual(
      result.rootPosition,
      expectedRoot,
      "root position returns toward neutral gradually after hold window",
    );

    // The return is gradual, not a snap: still meaningfully away from neutral.
    if (
      Math.abs(result.rootPosition[0]) <
      Math.abs(lastTracking.rootPosition[0]) * 0.5
    ) {
      fail("root return should be gradual, not a fast snap to neutral");
    }
    if (result.rootPosition[0] === lastTracking.rootPosition[0]) {
      fail(
        "root should move at least slightly toward neutral after hold window",
      );
    }
  }

  // Case 3: repeated lost frames past the hold window keep decaying the root
  // smoothly toward neutral (monotonic magnitude decrease, never overshoot).
  {
    const lastTracking = createTrackingMotion();
    let previousLost = {
      ...neutralLost,
      rootPosition: [...lastTracking.rootPosition],
    };
    let lastMagnitude = Math.abs(previousLost.rootPosition[0]);

    for (let step = 1; step <= 5; step += 1) {
      const result = computeLostTrackingFallbackMotion({
        lastTrackingMotion: lastTracking,
        lastTrackingTimestampMs: 1000,
        previousLostFallbackMotion: previousLost,
        currentTimestampMs: 1000 + LOST_TRACKING_ROOT_HOLD_MS + step,
      });
      const magnitude = Math.abs(result.rootPosition[0]);
      if (magnitude >= lastMagnitude) {
        fail(
          "root magnitude should decrease smoothly across repeated lost frames",
        );
      }
      lastMagnitude = magnitude;
      previousLost = result;
    }
  }

  // Case 4: no prior tracking pose falls back to neutral lost without throwing.
  {
    const result = computeLostTrackingFallbackMotion({
      lastTrackingMotion: null,
      lastTrackingTimestampMs: null,
      previousLostFallbackMotion: null,
      currentTimestampMs: 5000,
    });
    assertEqual(
      result.trackingStatus,
      "lost",
      "lost with no prior tracking reports lost status",
    );
    assertDeepEqual(
      result.rootPosition,
      neutralLost.rootPosition,
      "lost with no prior tracking keeps root at neutral",
    );
  }

  // Case 5: deterministic for fixed inputs.
  {
    const input = {
      lastTrackingMotion: createTrackingMotion(),
      lastTrackingTimestampMs: 1000,
      previousLostFallbackMotion: createTrackingMotion(),
      currentTimestampMs: 1500,
    };
    assertDeepEqual(
      computeLostTrackingFallbackMotion(input),
      computeLostTrackingFallbackMotion(input),
      "computeLostTrackingFallbackMotion is deterministic for fixed inputs",
    );
  }

  console.log("Web Preview lost tracking fallback check passed.");
};

runCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
