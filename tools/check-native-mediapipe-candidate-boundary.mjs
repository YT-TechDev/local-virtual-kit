#!/usr/bin/env node
/**
 * Verifies the MediaPipe Face Landmarker candidate backend scaffold stays
 * fail-closed behind the Native Core TrackingBackend boundary, while the
 * supported face-pipeline path keeps MotionFrame stdout JSON compatible with
 * the default path. Safe for CI/headless: it uses the dummy camera source,
 * never opens a real camera, and never enables MediaPipe. No MediaPipe
 * dependency, task/model file, or runtime download is exercised by this
 * checker.
 *
 * Usage:
 *   node tools/check-native-mediapipe-candidate-boundary.mjs [path-to-lvk-tracker-core]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNativeMotionFrameJson } from "../packages/motion-protocol/src/motion-frame-validation.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const validTrackingStatuses = new Set(["not_started", "tracking", "lost"]);
const requiredSignaturePaths = [
  [],
  ["tracking"],
  ["face"],
  ["face", "position"],
  ["face", "rotation"],
  ["eyes"],
  ["eyes", "gaze"],
  ["mouth"],
];

const fail = (message) => {
  console.error(`Native MediaPipe candidate boundary check failed: ${message}`);
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
    "Native MediaPipe candidate boundary check skipped: native binary not found. " +
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

function assertRunCompleted(result, label) {
  if (result.error) {
    fail(`${label}: could not run ${executablePath}: ${result.error.message}`);
  }
}

function assertExitStatus(result, expectedStatus, label) {
  assertRunCompleted(result, label);

  if (result.status !== expectedStatus) {
    fail(
      `${label}: expected exit status ${expectedStatus}, got ${
        result.status
      }${result.stderr.trim() ? `; stderr: ${result.stderr.trim()}` : ""}`,
    );
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

function requireRecord(value, path, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} is missing required object ${path}`);
  }

  return value;
}

function requireFiniteNumber(value, path, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${label} is missing finite numeric field ${path}`);
  }
}

function assertMotionFrameShape(frame, parsedJson, label) {
  if (frame.schemaVersion !== 1) {
    fail(`${label} has unexpected schemaVersion`);
  }

  if (frame.source !== "native") {
    fail(`${label} has unexpected source`);
  }

  if (!validTrackingStatuses.has(frame.tracking.status)) {
    fail(`${label} has invalid tracking.status: ${frame.tracking.status}`);
  }

  requireFiniteNumber(frame.tracking.confidence, "tracking.confidence", label);

  const tracking = requireRecord(parsedJson.tracking, "tracking", label);
  const face = requireRecord(parsedJson.face, "face", label);
  const position = requireRecord(face.position, "face.position", label);
  const rotation = requireRecord(face.rotation, "face.rotation", label);
  const eyes = requireRecord(parsedJson.eyes, "eyes", label);
  const gaze = requireRecord(eyes.gaze, "eyes.gaze", label);
  const mouth = requireRecord(parsedJson.mouth, "mouth", label);

  if (tracking.status === undefined) {
    fail(`${label} is missing tracking.status`);
  }

  requireFiniteNumber(tracking.confidence, "tracking.confidence", label);
  requireFiniteNumber(position.x, "face.position.x", label);
  requireFiniteNumber(position.y, "face.position.y", label);
  requireFiniteNumber(position.z, "face.position.z", label);
  requireFiniteNumber(rotation.pitch, "face.rotation.pitch", label);
  requireFiniteNumber(rotation.yaw, "face.rotation.yaw", label);
  requireFiniteNumber(rotation.roll, "face.rotation.roll", label);
  requireFiniteNumber(eyes.leftOpen, "eyes.leftOpen", label);
  requireFiniteNumber(eyes.rightOpen, "eyes.rightOpen", label);
  requireFiniteNumber(gaze.x, "eyes.gaze.x", label);
  requireFiniteNumber(gaze.y, "eyes.gaze.y", label);
  requireFiniteNumber(mouth.open, "mouth.open", label);
  requireFiniteNumber(mouth.smile, "mouth.smile", label);
}

function parseStdoutFrames(stdout, label) {
  const stdoutLines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (stdoutLines.length !== 3) {
    fail(
      `${label}: expected exactly 3 non-empty stdout lines, received ${stdoutLines.length}\nActual stdout:\n${stdout}`,
    );
  }

  return stdoutLines.map((line, index) => {
    const lineLabel = `${label} stdout line ${index + 1}`;
    let parsedJson;

    try {
      parsedJson = JSON.parse(line);
    } catch {
      fail(`${lineLabel} is not valid JSON: ${line}`);
    }

    const frame = parseNativeMotionFrameJson(line);
    if (frame === null) {
      fail(`${lineLabel} is not a valid native MotionFrame: ${line}`);
    }

    assertMotionFrameShape(frame, parsedJson, lineLabel);
    return { frame, parsedJson };
  });
}

function createSchemaSignature(parsedJson) {
  return requiredSignaturePaths
    .map((path) => {
      const target = path.reduce((value, key) => value?.[key], parsedJson);
      const keys = Object.keys(target).sort().join(",");
      return `${path.join(".") || "<top>"}:${keys}`;
    })
    .join("|");
}

function assertSameSchemaSignatures(leftFrames, rightFrames, label) {
  const leftSignatures = leftFrames.map(({ parsedJson }) =>
    createSchemaSignature(parsedJson),
  );
  const rightSignatures = rightFrames.map(({ parsedJson }) =>
    createSchemaSignature(parsedJson),
  );

  for (const [index, leftSignature] of leftSignatures.entries()) {
    const rightSignature = rightSignatures[index];
    if (leftSignature !== rightSignature) {
      fail(
        `${label}: MotionFrame schema signature mismatch on frame ${index + 1}`,
      );
    }
  }
}

// Step 1: the default supported path and explicit face-pipeline path must
// emit native MotionFrame stdout JSON with the same schema signature.
const defaultResult = run([
  "--camera-source",
  "dummy",
  "--face-detector",
  "noop",
  "--frames",
  "3",
]);
assertExitStatus(defaultResult, 0, "default face-pipeline MotionFrame path");
const defaultFrames = parseStdoutFrames(
  defaultResult.stdout,
  "default face-pipeline MotionFrame path",
);

const explicitFacePipelineResult = run([
  "--tracking-backend",
  "face-pipeline",
  "--camera-source",
  "dummy",
  "--face-detector",
  "noop",
  "--frames",
  "3",
]);
assertExitStatus(
  explicitFacePipelineResult,
  0,
  "explicit face-pipeline MotionFrame path",
);
const explicitFacePipelineFrames = parseStdoutFrames(
  explicitFacePipelineResult.stdout,
  "explicit face-pipeline MotionFrame path",
);
assertSameSchemaSignatures(
  defaultFrames,
  explicitFacePipelineFrames,
  "explicit face-pipeline vs default path",
);

// Step 2: --print-runtime-capabilities must report the candidate as
// unsupported without opening a camera or emitting MotionFrame JSON.
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
  "mediapipeFaceLandmarkerSupport=false",
  "supportedTrackingBackends=face-pipeline",
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

assertNoMotionFrameLines(capStdout, "--print-runtime-capabilities");

// Step 3: selecting the candidate backend without support must fail closed
// before any camera source is opened or MotionFrame JSON is emitted.
const candidateResult = run([
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "dummy",
  "--frames",
  "3",
  "--log-camera-status",
  "--log-face-status",
]);

if (candidateResult.error) {
  fail(`could not run candidate selection: ${candidateResult.error.message}`);
}

if (candidateResult.status === 0) {
  fail(
    `expected --tracking-backend mediapipe-face-landmarker to exit non-zero in an unsupported build, got 0`,
  );
}

assertNoMotionFrameLines(candidateResult.stdout, "candidate selection");

if (
  !candidateResult.stderr.includes(
    "MediaPipe Face Landmarker candidate backend is not enabled in this build",
  )
) {
  fail(
    `expected stderr to state the MediaPipe candidate backend is not enabled\nActual stderr:\n${candidateResult.stderr}`,
  );
}

if (
  !candidateResult.stderr.includes(
    "does not add MediaPipe runtime, task/model files, runtime downloads, or production backend selection",
  )
) {
  fail(
    `expected stderr to make clear this is not dependency/model/runtime approval\nActual stderr:\n${candidateResult.stderr}`,
  );
}

if (candidateResult.stderr.includes("[camera]")) {
  fail(
    `expected no camera diagnostics before the fail-closed candidate check\nActual stderr:\n${candidateResult.stderr}`,
  );
}

console.log(
  "Native MediaPipe candidate boundary check passed (face-pipeline MotionFrame schema verified; " +
    "unsupported MediaPipe candidate fails closed before camera open and MotionFrame emission).",
);
