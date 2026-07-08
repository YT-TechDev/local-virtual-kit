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
const CALIBRATION_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/faceFollowingCalibration.ts",
  import.meta.url,
);

const requireFromWebPreview = createRequire(WEB_PREVIEW_PACKAGE_URL);
const ts = requireFromWebPreview("typescript");

const fail = (message) => {
  throw new Error(
    `Web Preview face-following calibration check failed: ${message}`,
  );
};

const assertClose = (actual, expected, label, tolerance = 1e-9) => {
  if (typeof actual !== "number" || Math.abs(actual - expected) > tolerance) {
    fail(`${label}: expected ~${expected}, received ${actual}`);
  }
};

const assertTupleClose = (actual, expected, label, tolerance = 1e-9) => {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    fail(`${label}: expected tuple ${JSON.stringify(expected)}`);
  }
  expected.forEach((value, index) => {
    assertClose(actual[index], value, `${label}[${index}]`, tolerance);
  });
};

const loadModule = async (sourceUrl, fileName) => {
  const source = await readFile(sourceUrl, "utf8");

  // Strip the `@lvk/motion-protocol` type-only import; it carries no runtime
  // value and is not resolvable from a standalone transpiled module.
  const runtimeSource = source.replace(
    /^import type \{[^}]*\} from "@lvk\/motion-protocol";\s*$/m,
    "",
  );

  const output = ts.transpileModule(runtimeSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName,
  });

  const tempDir = await mkdtemp(join(tmpdir(), "lvk-face-calibration-"));
  const tempModulePath = join(tempDir, fileName.replace(/\.ts$/, ".mjs"));
  await writeFile(tempModulePath, output.outputText, "utf8");

  try {
    return await import(pathToFileURL(tempModulePath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const runCheck = async () => {
  const {
    DEFAULT_FACE_FOLLOWING_CALIBRATION,
    FACE_FOLLOWING_MAX_SENSITIVITY,
    applyFaceFollowingCalibration,
    clampFaceFollowingCalibration,
    createDefaultFaceFollowingCalibration,
    createFaceFollowingCalibrationFromCenter,
  } = await loadModule(CALIBRATION_SOURCE_URL, "faceFollowingCalibration.ts");

  // Default calibration reproduces the previous hard-coded mapping exactly.
  assertTupleClose(
    applyFaceFollowingCalibration({ x: 0.5, y: -0.5, z: 1 }),
    [0.5 * 3.2, -0.5 * 2.4, 1 * 0.9],
    "default calibration scales by the original per-axis sensitivity",
  );

  // Out-of-range position is clamped into the input domain before scaling.
  assertTupleClose(
    applyFaceFollowingCalibration({ x: 2, y: -2, z: 0.75 }),
    [3.2, -2.4, 0.675],
    "default calibration clamps out-of-range face.position before scaling",
  );

  // Center offset recenters the mapping: a position equal to the center maps to
  // the origin regardless of sensitivity.
  const centered = createFaceFollowingCalibrationFromCenter({
    x: 0.4,
    y: -0.3,
    z: 0.2,
  });
  assertTupleClose(
    applyFaceFollowingCalibration({ x: 0.4, y: -0.3, z: 0.2 }, centered),
    [0, 0, 0],
    "capturing a resting position maps that position to the avatar origin",
  );
  assertClose(
    centered.center.x,
    0.4,
    "createFaceFollowingCalibrationFromCenter stores the captured center",
  );
  assertClose(
    centered.sensitivity.x,
    DEFAULT_FACE_FOLLOWING_CALIBRATION.sensitivity.x,
    "createFaceFollowingCalibrationFromCenter keeps the base sensitivity",
  );

  // Centered movement above the resting point scales by sensitivity, still
  // clamped into the input domain.
  assertTupleClose(
    applyFaceFollowingCalibration({ x: 0.9, y: -0.3, z: 0.2 }, centered),
    [(0.9 - 0.4) * 3.2, 0, 0],
    "centered movement scales the offset from the resting position",
  );

  // Sensitivity is clamped to safe bounds; a wild value cannot fling the avatar.
  const clampedHigh = clampFaceFollowingCalibration({
    center: { x: 0, y: 0, z: 0 },
    sensitivity: { x: 1000, y: -5, z: 2 },
  });
  assertClose(
    clampedHigh.sensitivity.x,
    FACE_FOLLOWING_MAX_SENSITIVITY,
    "sensitivity is clamped to the maximum",
  );
  assertClose(
    clampedHigh.sensitivity.y,
    0,
    "negative sensitivity is clamped to zero",
  );

  // Non-finite / missing values fall back to defaults instead of producing NaN.
  const clampedBad = clampFaceFollowingCalibration({
    center: { x: Number.NaN, y: 5, z: 0 },
    sensitivity: { x: Number.POSITIVE_INFINITY, y: 2.4, z: 0.9 },
  });
  assertClose(
    clampedBad.center.x,
    0,
    "non-finite center falls back to the default center",
  );
  assertClose(clampedBad.center.y, 1, "out-of-range center is clamped");
  assertClose(
    clampedBad.sensitivity.x,
    DEFAULT_FACE_FOLLOWING_CALIBRATION.sensitivity.x,
    "non-finite sensitivity falls back to the default sensitivity",
  );

  // Reset-to-default returns a fresh, independent copy of the baseline.
  const reset = createDefaultFaceFollowingCalibration();
  reset.sensitivity.x = 99;
  reset.center.y = 1;
  assertClose(
    DEFAULT_FACE_FOLLOWING_CALIBRATION.sensitivity.x,
    3.2,
    "createDefaultFaceFollowingCalibration does not mutate the shared default",
  );
  assertClose(
    DEFAULT_FACE_FOLLOWING_CALIBRATION.center.y,
    0,
    "createDefaultFaceFollowingCalibration center is independent of the default",
  );

  console.log("Web Preview face-following calibration check passed.");
};

runCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
