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
const SMOOTHING_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/trackingSmoothing.ts",
  import.meta.url,
);
const CALIBRATION_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/faceFollowingCalibration.ts",
  import.meta.url,
);

const requireFromWebPreview = createRequire(WEB_PREVIEW_PACKAGE_URL);
const ts = requireFromWebPreview("typescript");

const fail = (message) => {
  throw new Error(`Web Preview tracking smoothing check failed: ${message}`);
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

const assertInRange = (actual, min, max, label) => {
  if (typeof actual !== "number" || actual < min || actual > max) {
    fail(`${label}: expected within [${min}, ${max}], received ${actual}`);
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
  const tempDir = await mkdtemp(join(tmpdir(), "lvk-tracking-smoothing-"));

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

    const smoothingSource = await readFile(SMOOTHING_SOURCE_URL, "utf8");
    await writeFile(
      join(tempDir, "trackingSmoothing.mjs"),
      transpileSource(smoothingSource, "trackingSmoothing.ts").replace(
        'from "./mapMotionFrameToAvatar"',
        'from "./mapMotionFrameToAvatar.mjs"',
      ),
      "utf8",
    );

    const mapModule = await import(
      pathToFileURL(join(tempDir, "mapMotionFrameToAvatar.mjs")).href
    );
    const smoothingModule = await import(
      pathToFileURL(join(tempDir, "trackingSmoothing.mjs")).href
    );

    return { mapModule, smoothingModule };
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
  const { smoothingModule } = await loadModules();
  const {
    computeExponentialSmoothingAlpha,
    smoothTrackingMotion,
    TRACKING_POSITION_SMOOTHING_TAU_SECONDS,
    TRACKING_ROTATION_SMOOTHING_TAU_SECONDS,
  } = smoothingModule;

  // Case 1: exponential smoothing alpha matches 1 - exp(-dt / tau) and stays in
  // [0, 1].
  {
    const dt = 1 / 60;
    const tau = TRACKING_POSITION_SMOOTHING_TAU_SECONDS;
    const alpha = computeExponentialSmoothingAlpha(dt, tau);
    assertClose(
      alpha,
      1 - Math.exp(-dt / tau),
      "alpha follows 1 - exp(-dt / tau)",
    );
    assertInRange(alpha, 0, 1, "alpha stays within [0, 1]");
  }

  // Case 2: degenerate inputs snap directly to the target (alpha = 1).
  {
    assertEqual(
      computeExponentialSmoothingAlpha(0, 0.12),
      1,
      "non-positive delta snaps (alpha = 1)",
    );
    assertEqual(
      computeExponentialSmoothingAlpha(-0.5, 0.12),
      1,
      "negative delta snaps (alpha = 1)",
    );
    assertEqual(
      computeExponentialSmoothingAlpha(0.016, 0),
      1,
      "non-positive tau snaps (alpha = 1)",
    );
  }

  // Case 3: a very large delta yields an alpha near 1 (catch up, do not drift).
  {
    const alpha = computeExponentialSmoothingAlpha(
      10,
      TRACKING_POSITION_SMOOTHING_TAU_SECONDS,
    );
    if (alpha <= 0.999) {
      fail("a very large delta should produce an alpha near 1");
    }
  }

  // Case 4: smoothing eases root/head partway toward the target and leaves the
  // feature channels (status, confidence, eyes, gaze, mouth) equal to target.
  {
    const previous = createTrackingMotion({
      rootPosition: [0, 0, 0],
      headRotation: [0, 0, 0],
    });
    const target = createTrackingMotion();
    const dt = 1 / 60;
    const result = smoothTrackingMotion(previous, target, dt);

    const positionAlpha = computeExponentialSmoothingAlpha(
      dt,
      TRACKING_POSITION_SMOOTHING_TAU_SECONDS,
    );
    const rotationAlpha = computeExponentialSmoothingAlpha(
      dt,
      TRACKING_ROTATION_SMOOTHING_TAU_SECONDS,
    );

    assertClose(
      result.rootPosition[0],
      previous.rootPosition[0] +
        (target.rootPosition[0] - previous.rootPosition[0]) * positionAlpha,
      "root position eases toward the target by the position alpha",
    );
    assertClose(
      result.headRotation[0],
      previous.headRotation[0] +
        (target.headRotation[0] - previous.headRotation[0]) * rotationAlpha,
      "head rotation eases toward the target by the rotation alpha",
    );

    // Eased partway, not snapped: still short of the target this frame.
    if (Math.abs(result.rootPosition[0] - target.rootPosition[0]) < 1e-6) {
      fail("root position should ease gradually, not snap to the target");
    }
    if (result.rootPosition[0] === previous.rootPosition[0]) {
      fail("root position should move at least slightly toward the target");
    }

    // Feature channels pass through from the target untouched (crisp blink).
    assertEqual(
      result.trackingStatus,
      target.trackingStatus,
      "smoothing preserves the target tracking status",
    );
    assertEqual(
      result.confidence,
      target.confidence,
      "smoothing passes confidence through from the target",
    );
    assertDeepEqual(
      result.eyeOpen,
      target.eyeOpen,
      "smoothing passes eye openness through from the target",
    );
    assertDeepEqual(
      result.gaze,
      target.gaze,
      "smoothing passes gaze through from the target",
    );
    assertDeepEqual(
      result.mouth,
      target.mouth,
      "smoothing passes mouth through from the target",
    );
  }

  // Case 5: previous === target is a no-op (already settled pose stays put).
  {
    const target = createTrackingMotion();
    const result = smoothTrackingMotion(target, target, 1 / 60);
    assertDeepEqual(
      result.rootPosition,
      target.rootPosition,
      "settled root position stays put when previous equals target",
    );
    assertDeepEqual(
      result.headRotation,
      target.headRotation,
      "settled head rotation stays put when previous equals target",
    );
  }

  // Case 6: repeated frames converge monotonically toward the target root
  // position without overshooting.
  {
    const target = createTrackingMotion();
    let previous = createTrackingMotion({
      rootPosition: [0, 0, 0],
      headRotation: [0, 0, 0],
    });
    let lastDistance = Math.abs(
      target.rootPosition[0] - previous.rootPosition[0],
    );

    for (let step = 0; step < 8; step += 1) {
      const result = smoothTrackingMotion(previous, target, 1 / 60);
      const distance = Math.abs(
        target.rootPosition[0] - result.rootPosition[0],
      );
      if (distance >= lastDistance) {
        fail("root position should converge toward the target each frame");
      }
      // Never overshoot past the target.
      if (result.rootPosition[0] > target.rootPosition[0]) {
        fail("root position should not overshoot the target");
      }
      lastDistance = distance;
      previous = result;
    }
  }

  // Case 7: a zero delta snaps rendered pose directly to the target.
  {
    const previous = createTrackingMotion({
      rootPosition: [0, 0, 0],
      headRotation: [0, 0, 0],
    });
    const target = createTrackingMotion();
    const result = smoothTrackingMotion(previous, target, 0);
    assertDeepEqual(
      result.rootPosition,
      target.rootPosition,
      "zero delta snaps root position to the target",
    );
    assertDeepEqual(
      result.headRotation,
      target.headRotation,
      "zero delta snaps head rotation to the target",
    );
  }

  // Case 8: deterministic for fixed inputs.
  {
    const previous = createTrackingMotion({ rootPosition: [0, 0, 0] });
    const target = createTrackingMotion();
    assertDeepEqual(
      smoothTrackingMotion(previous, target, 1 / 60),
      smoothTrackingMotion(previous, target, 1 / 60),
      "smoothTrackingMotion is deterministic for fixed inputs",
    );
  }

  console.log("Web Preview tracking smoothing check passed.");
};

runCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
