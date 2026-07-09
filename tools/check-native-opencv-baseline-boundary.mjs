#!/usr/bin/env node
/**
 * Verifies the optional OpenCV Haar-style baseline face detector remains
 * routed through the Native Core TrackingBackend seam and preserves the
 * existing CLI/MotionFrame contract. Safe for CI/headless: it never opens a
 * camera and only exercises the cascade-backed detection path when
 * LVK_TEST_FACE_CASCADE_PATH is set to a trusted local Haar cascade XML.
 *
 * Usage:
 *   node tools/check-native-opencv-baseline-boundary.mjs [path-to-lvk-tracker-core]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNativeMotionFrameJson } from "../packages/motion-protocol/src/motion-frame-validation.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const fail = (message) => {
  console.error(`Native OpenCV baseline boundary check failed: ${message}`);
  process.exit(1);
};

function resolveExecutable() {
  const provided = process.argv[2];
  if (provided) {
    return provided;
  }

  const candidates = [
    join(
      repoRoot,
      "native",
      "tracker-core",
      "build",
      "Debug",
      "lvk-tracker-core.exe",
    ),
    join(
      repoRoot,
      "native",
      "tracker-core",
      "build",
      "Release",
      "lvk-tracker-core.exe",
    ),
    join(repoRoot, "native", "tracker-core", "build", "lvk-tracker-core"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

const executablePath = resolveExecutable();

if (!executablePath) {
  console.log(
    "Native OpenCV baseline boundary check skipped: native binary not found. " +
      "Build the native tracker first with cmake -S native/tracker-core -B native/tracker-core/build && cmake --build native/tracker-core/build, " +
      "or pass the binary path as the first argument.",
  );
  process.exit(0);
}

function run(args) {
  return spawnSync(executablePath, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function requireCleanExitFailure(result, label) {
  if (result.error) {
    fail(`${label}: could not run ${executablePath}: ${result.error.message}`);
  }

  if (result.status === 0) {
    fail(`${label}: expected a non-zero exit status, got 0`);
  }
}

function assertNoMotionFrameLines(stdout, label) {
  const stdoutLines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (stdoutLines.some((line) => line.startsWith("{"))) {
    fail(
      `${label}: stdout must contain no MotionFrame JSON lines\nActual stdout:\n${stdout}`,
    );
  }
}

// Step 1: read runtime capabilities to determine OpenCV face detector support.
const capResult = run(["--print-runtime-capabilities"]);

if (capResult.error) {
  fail(`could not run ${executablePath}: ${capResult.error.message}`);
}

if (capResult.status !== 0) {
  const stderr = capResult.stderr.trim();
  fail(
    `${executablePath} --print-runtime-capabilities exited with status ${capResult.status}${
      stderr ? `; stderr: ${stderr}` : ""
    }`,
  );
}

const capStdout = capResult.stdout;

const requiredCapabilityKeys = [
  "opencvFaceDetectorSupport=",
  "supportedFaceDetectors=",
  "localOnly=true",
  "cameraOpened=false",
  "motionFramesEmitted=false",
];

for (const key of requiredCapabilityKeys) {
  if (!capStdout.includes(key)) {
    fail(
      `expected --print-runtime-capabilities stdout to include ${JSON.stringify(key)}\nActual stdout:\n${capStdout}`,
    );
  }
}

const supportedFaceDetectorsMatch = capStdout.match(
  /supportedFaceDetectors=(\S+)/u,
);
const supportedFaceDetectors = supportedFaceDetectorsMatch
  ? supportedFaceDetectorsMatch[1].split(",")
  : [];

if (!supportedFaceDetectors.includes("noop")) {
  fail(
    `expected supportedFaceDetectors to always include "noop"\nActual stdout:\n${capStdout}`,
  );
}

const opencvFaceDetectorSupported = capStdout.includes(
  "opencvFaceDetectorSupport=true",
);

// Step 2: exercise the --face-detector opencv selection contract without
// requiring camera hardware. The exact failure mode differs by build.
if (!opencvFaceDetectorSupported) {
  const unsupportedResult = run([
    "--camera-source",
    "dummy",
    "--face-detector",
    "opencv",
    "--frames",
    "1",
  ]);

  requireCleanExitFailure(
    unsupportedResult,
    "unsupported opencv face detector",
  );

  if (
    !unsupportedResult.stderr.includes(
      "OpenCV face detector is not enabled in this build",
    )
  ) {
    fail(
      `expected stderr to include the unsupported OpenCV face detector message\nActual stderr:\n${unsupportedResult.stderr}`,
    );
  }

  assertNoMotionFrameLines(
    unsupportedResult.stdout,
    "unsupported opencv face detector",
  );

  console.log(
    "Native OpenCV baseline boundary check passed (opencvFaceDetectorSupport=false; " +
      "verified the build fails closed with the existing unsupported-detector message).",
  );
  process.exit(0);
}

const missingCascadeResult = run([
  "--camera-source",
  "dummy",
  "--face-detector",
  "opencv",
  "--frames",
  "1",
]);

requireCleanExitFailure(missingCascadeResult, "missing --face-cascade");

if (
  !missingCascadeResult.stderr.includes(
    "--face-detector opencv requires --face-cascade PATH",
  )
) {
  fail(
    `expected stderr to include the missing --face-cascade message\nActual stderr:\n${missingCascadeResult.stderr}`,
  );
}

assertNoMotionFrameLines(missingCascadeResult.stdout, "missing --face-cascade");

console.log(
  "Native OpenCV baseline boundary check: opencvFaceDetectorSupport=true; " +
    "verified the build fails closed without --face-cascade PATH.",
);

// Step 3: optional cascade-backed smoke. Only runs when the project owner
// points LVK_TEST_FACE_CASCADE_PATH at a trusted local Haar cascade XML
// outside the repository. No cascade assets are bundled or downloaded here.
const cascadePath = process.env.LVK_TEST_FACE_CASCADE_PATH;

if (!cascadePath) {
  console.log(
    "Native OpenCV baseline boundary check passed (cascade-backed smoke skipped: " +
      "LVK_TEST_FACE_CASCADE_PATH is not set).",
  );
  process.exit(0);
}

if (!existsSync(cascadePath)) {
  fail(
    `LVK_TEST_FACE_CASCADE_PATH is set to ${cascadePath}, but that file does not exist`,
  );
}

const cascadeResult = run([
  "--camera-source",
  "dummy",
  "--face-detector",
  "opencv",
  "--face-cascade",
  cascadePath,
  "--frames",
  "3",
  "--log-face-status",
  "--face-status-interval",
  "1",
]);

if (cascadeResult.error) {
  fail(`could not run cascade-backed smoke: ${cascadeResult.error.message}`);
}

if (cascadeResult.status !== 0) {
  const stderr = cascadeResult.stderr.trim();
  fail(
    `cascade-backed smoke exited with status ${cascadeResult.status}${
      stderr ? `; stderr: ${stderr}` : ""
    }`,
  );
}

const cascadeStdoutLines = cascadeResult.stdout
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

if (cascadeStdoutLines.length !== 3) {
  fail(
    `expected exactly 3 non-empty stdout lines from the cascade-backed smoke, received ${cascadeStdoutLines.length}\nActual stdout:\n${cascadeResult.stdout}`,
  );
}

cascadeStdoutLines.forEach((line, index) => {
  const lineNumber = index + 1;
  const frame = parseNativeMotionFrameJson(line);

  if (frame === null) {
    fail(
      `cascade-backed smoke stdout line ${lineNumber} is not a valid native MotionFrame: ${line}`,
    );
  }

  if (frame.schemaVersion !== 1) {
    fail(
      `cascade-backed smoke stdout line ${lineNumber} has unexpected schemaVersion`,
    );
  }

  if (frame.source !== "native") {
    fail(
      `cascade-backed smoke stdout line ${lineNumber} has unexpected source`,
    );
  }

  const validStatuses = new Set(["not_started", "tracking", "lost"]);
  if (!validStatuses.has(frame.tracking.status)) {
    fail(
      `cascade-backed smoke stdout line ${lineNumber} has invalid tracking.status: ${frame.tracking.status}`,
    );
  }
});

const nonJsonCascadeLines = cascadeStdoutLines.filter(
  (line) => !line.startsWith("{"),
);
if (nonJsonCascadeLines.length > 0) {
  fail(
    `cascade-backed smoke stdout must contain only newline-delimited MotionFrame JSON, found non-JSON line(s): ${nonJsonCascadeLines.join(", ")}`,
  );
}

if (!cascadeResult.stderr.includes("detectorName=opencv")) {
  fail(
    `expected cascade-backed smoke stderr to include safe face diagnostics with detectorName=opencv\nActual stderr:\n${cascadeResult.stderr}`,
  );
}

console.log(
  "Native OpenCV baseline boundary check passed, including the cascade-backed smoke.",
);
