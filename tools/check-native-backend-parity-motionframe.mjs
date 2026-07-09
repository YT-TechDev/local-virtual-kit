#!/usr/bin/env node
/**
 * Verifies Native Core backend-boundary MotionFrame stdout compatibility
 * without comparing tracking quality or requiring camera hardware. The
 * OpenCV branch is dependency-aware: unsupported and missing-cascade builds
 * are validated as clean skip paths, while cascade-backed output is only
 * checked when LVK_TEST_FACE_CASCADE_PATH points at a local cascade file.
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
  console.error(`Native backend parity MotionFrame check failed: ${message}`);
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

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function runNative(args) {
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

function createSchemaSignature(parsedJson) {
  return requiredSignaturePaths
    .map((path) => {
      const target = path.reduce((value, key) => value?.[key], parsedJson);
      const keys = Object.keys(target).sort().join(",");
      return `${path.join(".") || "<top>"}:${keys}`;
    })
    .join("|");
}

function assertSameSchemaSignature(left, right, label) {
  if (left !== right) {
    fail(`${label}: MotionFrame schema signature mismatch`);
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

function requireCleanFailure(result, label) {
  assertRunCompleted(result, label);

  if (result.status === 0) {
    fail(`${label}: expected a non-zero exit status, got 0`);
  }
}

const executablePath = resolveExecutable();

if (!executablePath) {
  console.log(
    "Native backend parity MotionFrame check skipped: native binary not found. " +
      "Build the native tracker first with cmake -S native/tracker-core -B native/tracker-core/build && cmake --build native/tracker-core/build, " +
      "or pass the binary path as the first argument.",
  );
  process.exit(0);
}

const verifiedBranches = [];
const skippedBranches = [];

const dummyResult = runNative([
  "--camera-source",
  "dummy",
  "--face-detector",
  "noop",
  "--frames",
  "3",
]);
assertExitStatus(dummyResult, 0, "dummy/noop backend parity");
const dummyFrames = parseStdoutFrames(
  dummyResult.stdout,
  "dummy/noop backend parity",
);
const dummySignature = createSchemaSignature(dummyFrames[0].parsedJson);

dummyFrames.forEach(({ parsedJson }, index) => {
  assertSameSchemaSignature(
    dummySignature,
    createSchemaSignature(parsedJson),
    `dummy/noop backend parity stdout line ${index + 1}`,
  );
});
verifiedBranches.push("dummy/noop MotionFrame stdout schema");

const capResult = runNative(["--print-runtime-capabilities"]);
assertExitStatus(capResult, 0, "runtime capabilities");

const requiredCapabilityKeys = [
  "opencvFaceDetectorSupport=",
  "supportedFaceDetectors=",
  "localOnly=true",
  "cameraOpened=false",
  "motionFramesEmitted=false",
];

for (const key of requiredCapabilityKeys) {
  if (!capResult.stdout.includes(key)) {
    fail(
      `runtime capabilities: expected stdout to include ${JSON.stringify(key)}\nActual stdout:\n${capResult.stdout}`,
    );
  }
}
verifiedBranches.push("runtime capabilities local-only contract");

const opencvFaceDetectorSupported = capResult.stdout.includes(
  "opencvFaceDetectorSupport=true",
);

if (!opencvFaceDetectorSupported) {
  const unsupportedResult = runNative([
    "--camera-source",
    "dummy",
    "--face-detector",
    "opencv",
    "--frames",
    "1",
  ]);
  requireCleanFailure(unsupportedResult, "unsupported OpenCV face detector");

  if (
    !unsupportedResult.stderr.includes(
      "OpenCV face detector is not enabled in this build",
    )
  ) {
    fail(
      `unsupported OpenCV face detector: expected stderr to include the unsupported OpenCV face detector message\nActual stderr:\n${unsupportedResult.stderr}`,
    );
  }

  assertNoMotionFrameLines(
    unsupportedResult.stdout,
    "unsupported OpenCV face detector",
  );
  verifiedBranches.push("unsupported OpenCV detector fails closed");
  skippedBranches.push(
    "OpenCV MotionFrame parity output (opencvFaceDetectorSupport=false)",
  );
} else if (!process.env.LVK_TEST_FACE_CASCADE_PATH) {
  const missingCascadeResult = runNative([
    "--camera-source",
    "dummy",
    "--face-detector",
    "opencv",
    "--frames",
    "1",
  ]);
  requireCleanFailure(missingCascadeResult, "missing --face-cascade");

  if (
    !missingCascadeResult.stderr.includes(
      "--face-detector opencv requires --face-cascade PATH",
    )
  ) {
    fail(
      `missing --face-cascade: expected stderr to include the missing --face-cascade message\nActual stderr:\n${missingCascadeResult.stderr}`,
    );
  }

  assertNoMotionFrameLines(
    missingCascadeResult.stdout,
    "missing --face-cascade",
  );
  verifiedBranches.push("OpenCV detector missing-cascade path fails closed");
  skippedBranches.push(
    "cascade-backed OpenCV MotionFrame parity output (LVK_TEST_FACE_CASCADE_PATH is not set)",
  );
} else {
  const cascadePath = process.env.LVK_TEST_FACE_CASCADE_PATH;
  if (!existsSync(cascadePath)) {
    fail("LVK_TEST_FACE_CASCADE_PATH is set, but that file does not exist");
  }

  const cascadeResult = runNative([
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
  assertExitStatus(cascadeResult, 0, "cascade-backed OpenCV parity");

  const cascadeFrames = parseStdoutFrames(
    cascadeResult.stdout,
    "cascade-backed OpenCV parity",
  );

  cascadeFrames.forEach(({ frame, parsedJson }, index) => {
    if (!validTrackingStatuses.has(frame.tracking.status)) {
      fail(
        `cascade-backed OpenCV parity stdout line ${
          index + 1
        } has invalid tracking.status: ${frame.tracking.status}`,
      );
    }

    assertSameSchemaSignature(
      dummySignature,
      createSchemaSignature(parsedJson),
      `cascade-backed OpenCV parity stdout line ${index + 1}`,
    );
  });

  if (!cascadeResult.stderr.includes("detectorName=opencv")) {
    fail(
      `cascade-backed OpenCV parity: expected stderr to include detectorName=opencv\nActual stderr:\n${cascadeResult.stderr}`,
    );
  }

  verifiedBranches.push("cascade-backed OpenCV MotionFrame parity schema");
}

console.log(
  `Native backend parity MotionFrame check passed. Verified: ${verifiedBranches.join(
    "; ",
  )}.${
    skippedBranches.length > 0 ? ` Skipped: ${skippedBranches.join("; ")}.` : ""
  }`,
);
