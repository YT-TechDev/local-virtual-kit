#!/usr/bin/env node
// Reusable Native Core landmark helper session checker (v0.13.0, #533).
//
// Exercises the opt-in synthetic-helper tracking backend through the normal
// lvk-tracker-core frame loop: successful request/result exchanges mapped to
// MotionFrame v1, configuration fail-closed rules, lifecycle failures (launch,
// ready, result timeout, child exit, forced shutdown), message failures
// (malformed/unknown/oversized/non-finite/stale correlation), unsafe-stderr
// fail-closed, and public stream privacy. Synthetic-only, no camera frame data
// is sent to the helper (that is #534). CI-safe.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNativeMotionFrameJson } from "../packages/motion-protocol/src/motion-frame-validation.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const fail = (message, result) => {
  console.error(`Native landmark helper session check failed: ${message}`);
  if (result) {
    const snippet = (value) => {
      const trimmed = (value ?? "").trim();
      if (trimmed.length === 0) return "(empty)";
      return trimmed.length > 800 ? `${trimmed.slice(0, 800)}...` : trimmed;
    };
    console.error(`Exit status: ${result.status ?? "unknown"}`);
    console.error(`stderr: ${snippet(result.stderr)}`);
    console.error(`stdout: ${snippet(result.stdout)}`);
  }
  process.exit(1);
};

function resolveBinary(explicit, baseName) {
  if (explicit) {
    return resolve(explicit);
  }
  const candidates = [
    join(
      repoRoot,
      "native",
      "tracker-core",
      "build",
      "Debug",
      `${baseName}.exe`,
    ),
    join(
      repoRoot,
      "native",
      "tracker-core",
      "build",
      "Release",
      `${baseName}.exe`,
    ),
    join(repoRoot, "native", "tracker-core", "build", baseName),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const trackerPath = resolveBinary(process.argv[2], "lvk-tracker-core");
const helperPath = resolveBinary(process.argv[3], "lvk-synthetic-helper");

if (!trackerPath || !helperPath) {
  console.log(
    "Native landmark helper session check skipped: native binaries not found. " +
      "Build the native tracker first, or pass <lvk-tracker-core> <lvk-synthetic-helper> paths.",
  );
  process.exit(0);
}

// Markers that must never appear on any public stream (helper contract lines,
// transport-only fields, raw child stderr, unsafe child output, private reasons).
const forbiddenMarkers = [
  '"type":"ready"',
  '"type":"result"',
  '"type":"stopped"',
  '"type":"stopping"',
  '"type":"request"',
  '"source":"synthetic-helper"',
  '"requestId"',
  '"frameTimestampMs"',
  '"inferenceMs"',
  "[helper]",
  "unsafe-synthetic-session-diagnostic",
  "modeled-policy-violation",
  "session-stop",
  "session-eof",
];

const nonEmptyLines = (text) =>
  (text ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const runTracker = (args) =>
  spawnSync(trackerPath, args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 20000,
  });

const backendArgs = (extra = []) => [
  "--tracking-backend",
  "synthetic-helper",
  "--helper-executable",
  helperPath,
  ...extra,
];

function assertStreamsClean(result, label) {
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  for (const marker of forbiddenMarkers) {
    if (combined.includes(marker)) {
      fail(`${label}: leaked private marker ${JSON.stringify(marker)}`, result);
    }
  }
}

const inRange = (value, lo, hi) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= lo &&
  value <= hi;

// Validates exactly `expectedCount` native MotionFrame lines, their value
// ranges, and (optionally) tracking status, plus public-stream cleanliness.
function assertMotionFrames(result, expectedCount, label, { status } = {}) {
  if (result.error) {
    fail(`${label}: could not run tracker: ${result.error.message}`, result);
  }
  if (result.status !== 0) {
    fail(`${label}: expected exit status 0`, result);
  }
  const lines = nonEmptyLines(result.stdout);
  if (lines.length !== expectedCount) {
    fail(
      `${label}: expected ${expectedCount} public stdout lines, got ${lines.length}`,
      result,
    );
  }
  lines.forEach((line, index) => {
    const frame = parseNativeMotionFrameJson(line);
    if (frame === null) {
      fail(
        `${label}: stdout line ${index + 1} is not native MotionFrame: ${line}`,
        result,
      );
    }
    if (frame.schemaVersion !== 1)
      fail(`${label}: line ${index + 1} schemaVersion !== 1`, result);
    if (frame.source !== "native")
      fail(`${label}: line ${index + 1} source !== native`, result);
    if (!inRange(frame.tracking.confidence, 0, 1)) {
      fail(`${label}: line ${index + 1} confidence out of [0,1]`, result);
    }
    if (
      !inRange(frame.eyes.leftOpen, 0, 1) ||
      !inRange(frame.eyes.rightOpen, 0, 1)
    ) {
      fail(`${label}: line ${index + 1} eye openness out of [0,1]`, result);
    }
    if (!inRange(frame.mouth.open, 0, 1) || !inRange(frame.mouth.smile, 0, 1)) {
      fail(`${label}: line ${index + 1} mouth values out of [0,1]`, result);
    }
    const rotation = frame.face.rotation;
    if (
      !inRange(rotation.pitch, -1, 1) ||
      !inRange(rotation.yaw, -1, 1) ||
      !inRange(rotation.roll, -1, 1)
    ) {
      fail(`${label}: line ${index + 1} rotation out of [-1,1]`, result);
    }
    if (status && frame.tracking.status !== status) {
      fail(
        `${label}: line ${index + 1} expected tracking.status ${JSON.stringify(status)}, got ${JSON.stringify(frame.tracking.status)}`,
        result,
      );
    }
  });
  assertStreamsClean(result, label);
}

function assertFailClosedNoStdout(result, label, expectedStderr) {
  if (result.error) {
    fail(`${label}: could not run tracker: ${result.error.message}`, result);
  }
  if (result.status === 0) {
    fail(`${label}: expected a non-zero exit status`, result);
  }
  const lines = nonEmptyLines(result.stdout);
  if (lines.length !== 0) {
    fail(
      `${label}: expected zero public stdout lines, got ${lines.length}`,
      result,
    );
  }
  if (expectedStderr && !(result.stderr ?? "").includes(expectedStderr)) {
    fail(
      `${label}: expected stderr to include ${JSON.stringify(expectedStderr)}`,
      result,
    );
  }
  assertStreamsClean(result, label);
}

// --- Success paths ----------------------------------------------------------
for (const frames of [1, 3, 5]) {
  assertMotionFrames(
    runTracker(backendArgs(["--frames", String(frames)])),
    frames,
    `success --frames ${frames}`,
    { status: "tracking" },
  );
}

// Zero-frame: clean ready -> stop -> stopped with no public output.
assertMotionFrames(
  runTracker(backendArgs(["--frames", "0"])),
  0,
  "success --frames 0",
);
console.log(
  "Success guard OK: N MotionFrame v1 lines, clamped values, clean shutdown, private helper streams.",
);

// --- Configuration fail-closed rules ---------------------------------------
assertFailClosedNoStdout(
  runTracker(["--tracking-backend", "synthetic-helper", "--frames", "3"]),
  "config missing helper executable",
  "requires --helper-executable",
);
assertFailClosedNoStdout(
  runTracker(["--helper-executable", helperPath, "--frames", "3"]),
  "config helper-executable without backend",
  "requires --tracking-backend synthetic-helper",
);
assertFailClosedNoStdout(
  runTracker(["--helper-arg", "--session", "--frames", "3"]),
  "config helper-arg without backend",
  "--helper-arg requires --tracking-backend synthetic-helper",
);
assertFailClosedNoStdout(
  runTracker(
    backendArgs(["--helper-runtime-smoke", helperPath, "--frames", "3"]),
  ),
  "config ambiguous smoke+backend",
  "cannot be combined",
);
assertFailClosedNoStdout(
  runTracker([
    "--tracking-backend",
    "synthetic-helper",
    "--helper-executable",
    `${helperPath}.does-not-exist-lvk533`,
    "--frames",
    "3",
  ]),
  "config invalid helper path",
  "Failed to start tracking backend",
);
console.log(
  "Configuration guard OK: missing path, orphan flags, ambiguous mode, and invalid path all fail closed before camera.",
);

// Default invocation stays face-pipeline (no helper markers, valid MotionFrames).
{
  const defaultResult = runTracker(["--frames", "3"]);
  if (defaultResult.status !== 0)
    fail("default face-pipeline: expected exit 0", defaultResult);
  const lines = nonEmptyLines(defaultResult.stdout);
  if (lines.length !== 3)
    fail("default face-pipeline: expected 3 MotionFrame lines", defaultResult);
  lines.forEach((line, index) => {
    if (parseNativeMotionFrameJson(line) === null) {
      fail(
        `default face-pipeline: line ${index + 1} not native MotionFrame`,
        defaultResult,
      );
    }
  });
  assertStreamsClean(defaultResult, "default face-pipeline");
}

// Capabilities: no camera, no helper, honest report, no helper path leaked.
{
  const caps = runTracker(["--print-runtime-capabilities"]);
  if (caps.status !== 0) fail("capabilities: expected exit 0", caps);
  const requiredKeys = [
    "syntheticHelperBackendSupport=true",
    "helperLaunched=false",
    "cameraOpened=false",
    "motionFramesEmitted=false",
    "localOnly=true",
  ];
  for (const key of requiredKeys) {
    if (!caps.stdout.includes(key))
      fail(`capabilities: missing ${JSON.stringify(key)}`, caps);
  }
  if (!caps.stdout.includes("synthetic-helper")) {
    fail(
      "capabilities: supportedTrackingBackends should include synthetic-helper",
      caps,
    );
  }
  if (caps.stdout.includes(helperPath)) {
    fail("capabilities: must not print the helper executable path", caps);
  }
  if (nonEmptyLines(caps.stdout).some((line) => line.startsWith("{"))) {
    fail("capabilities: must not emit MotionFrame JSON", caps);
  }
}
console.log(
  "Default + capabilities guard OK: default stays face-pipeline; capabilities launch neither camera nor helper.",
);

// --- Lifecycle failures (via development-only --helper-arg pass-through) -----
assertFailClosedNoStdout(
  runTracker(
    backendArgs(["--helper-arg", "--session-skip-ready", "--frames", "3"]),
  ),
  "lifecycle missing-ready",
  "Failed to start tracking backend",
);
assertFailClosedNoStdout(
  runTracker(
    backendArgs([
      "--helper-arg",
      "--session-exit-before-ready",
      "--frames",
      "3",
    ]),
  ),
  "lifecycle exit-before-ready",
  "Failed to start tracking backend",
);
// Post-ready runtime failures fall back to safe lost tracking and keep running.
assertMotionFrames(
  runTracker(
    backendArgs(["--helper-arg", "--session-hang-result", "--frames", "3"]),
  ),
  3,
  "lifecycle result-timeout",
  { status: "lost" },
);
assertMotionFrames(
  runTracker(
    backendArgs(["--helper-arg", "--session-exit-on-request", "--frames", "3"]),
  ),
  3,
  "lifecycle child-exit",
  { status: "lost" },
);
// Ignore-stop: normal results, then a bounded forced termination at shutdown.
assertMotionFrames(
  runTracker(
    backendArgs(["--helper-arg", "--session-ignore-stop", "--frames", "2"]),
  ),
  2,
  "lifecycle forced-shutdown",
  { status: "tracking" },
);
console.log(
  "Lifecycle guard OK: launch/ready failures fail closed before camera; runtime failures return safe lost tracking; forced shutdown is bounded.",
);

// --- Message failures: each returns safe lost tracking, streams stay clean ---
for (const [faultFlag, label] of [
  ["--session-malformed-result", "message malformed-result"],
  ["--session-unknown-result", "message unknown-type"],
  ["--session-oversized-result", "message oversized-line"],
  ["--session-nonfinite-result", "message non-finite"],
  ["--session-stale-request-id", "message stale-correlation"],
  ["--session-unsafe-stderr", "message unsafe-stderr"],
]) {
  assertMotionFrames(
    runTracker(backendArgs(["--helper-arg", faultFlag, "--frames", "3"])),
    3,
    label,
    { status: "lost" },
  );
}
console.log(
  "Message guard OK: malformed/unknown/oversized/non-finite/stale/unsafe-stderr each fall back to safe lost tracking with private helper streams.",
);

console.log("Native landmark helper session check passed.");
