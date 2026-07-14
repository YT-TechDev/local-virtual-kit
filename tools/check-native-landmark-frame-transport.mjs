#!/usr/bin/env node
// Bounded private landmark frame transport checker (v0.13.0, #534).
//
// Two parts:
//   1. Drives the pure lvk-helper-frame-transport-smoke executable (no
//      OpenCV, no camera) against lvk-synthetic-helper to exercise the full
//      private frame pipe round trip, fault injection, and public-stream
//      privacy.
//   2. Drives the real lvk-tracker-core binary to assert the
//      synthetic-frame-helper runtime/source contract: OpenCV-availability
//      gating, --camera-source opencv coupling, fail-closed-before-launch
//      behavior, capabilities honesty, and that the existing face-pipeline /
//      synthetic-helper / MotionFrame v1 behavior is unaffected. Native CI
//      never installs OpenCV, so this never attempts to open a real camera;
//      camera-backed runtime execution stays out of scope here (that is
//      manual/local-only validation, not an automated check). CI-safe.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNativeMotionFrameJson } from "../packages/motion-protocol/src/motion-frame-validation.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const fail = (message, result) => {
  console.error(`Native landmark frame transport check failed: ${message}`);
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
const transportSmokePath = resolveBinary(
  process.argv[4],
  "lvk-helper-frame-transport-smoke",
);

if (!trackerPath || !helperPath || !transportSmokePath) {
  console.log(
    "Native landmark frame transport check skipped: native binaries not " +
      "found. Build the native tracker first, or pass " +
      "<lvk-tracker-core> <lvk-synthetic-helper> " +
      "<lvk-helper-frame-transport-smoke> paths.",
  );
  process.exit(0);
}

const nonEmptyLines = (text) =>
  (text ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

// Markers that must never appear on any public stream (helper contract
// lines, transport-only fields, raw child stderr, unsafe child output).
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
  '"frameAck"',
  '"sequence"',
  '"payloadBytes"',
  '"checksum"',
  "[helper]",
  "LVK_FRAME_PIPE_HANDLE",
];

function assertStreamsClean(result, label) {
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  for (const marker of forbiddenMarkers) {
    if (combined.includes(marker)) {
      fail(`${label}: leaked private marker ${JSON.stringify(marker)}`, result);
    }
  }
}

// --- Part 1: pure frame-transport smoke (no OpenCV, no camera) -------------
{
  const result = spawnSync(transportSmokePath, [helperPath], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30000,
  });
  if (result.error) {
    fail(
      `could not run ${transportSmokePath}: ${result.error.message}`,
      result,
    );
  }
  if (result.status !== 0) {
    fail("frame transport smoke: expected exit status 0", result);
  }
  if (!(result.stdout ?? "").includes("helper-frame-transport smoke OK")) {
    fail("frame transport smoke: expected success marker on stdout", result);
  }
  assertStreamsClean(result, "frame transport smoke");
}
console.log(
  "Frame transport smoke guard OK: round trip, fault injection, and " +
    "public-stream privacy all pass without OpenCV or a camera.",
);

// --- Part 2: lvk-tracker-core runtime/source contract -----------------------
const runTracker = (args) =>
  spawnSync(trackerPath, args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 20000,
  });

const caps = runTracker(["--print-runtime-capabilities"]);
if (caps.status !== 0) fail("capabilities: expected exit 0", caps);
const capsOut = caps.stdout ?? "";
if (!capsOut.includes("frameTransportBackendSupport=")) {
  fail("capabilities: missing frameTransportBackendSupport", caps);
}
if (nonEmptyLines(capsOut).some((line) => line.startsWith("{"))) {
  fail("capabilities: must not emit MotionFrame JSON", caps);
}
if (capsOut.includes(helperPath)) {
  fail("capabilities: must not print the helper executable path", caps);
}
const openCvCameraAvailable = capsOut.includes("opencvCameraSupport=true");
const frameTransportSupported = capsOut.includes(
  "frameTransportBackendSupport=true",
);
const listsFrameHelperBackend = capsOut.includes("synthetic-frame-helper");
if (openCvCameraAvailable !== frameTransportSupported) {
  fail(
    "capabilities: frameTransportBackendSupport must track opencvCameraSupport " +
      `exactly (opencvCameraSupport=${openCvCameraAvailable}, ` +
      `frameTransportBackendSupport=${frameTransportSupported})`,
    caps,
  );
}
if (frameTransportSupported !== listsFrameHelperBackend) {
  fail(
    "capabilities: supportedTrackingBackends must list synthetic-frame-helper " +
      "exactly when frameTransportBackendSupport=true",
    caps,
  );
}
console.log(
  `Capabilities guard OK: frameTransportBackendSupport honestly tracks ` +
    `OpenCV camera availability (available=${openCvCameraAvailable}); no ` +
    "helper/camera launched.",
);

if (!openCvCameraAvailable) {
  // The common CI case: OpenCV was never installed, so the backend must be
  // rejected fail-closed before any helper or camera is touched.
  const rejected = runTracker([
    "--tracking-backend",
    "synthetic-frame-helper",
    "--helper-executable",
    helperPath,
    "--camera-source",
    "opencv",
    "--frames",
    "1",
  ]);
  if (rejected.status === 0) {
    fail("unavailable backend: expected a non-zero exit status", rejected);
  }
  if (nonEmptyLines(rejected.stdout).length !== 0) {
    fail("unavailable backend: expected zero public stdout lines", rejected);
  }
  if (!(rejected.stderr ?? "").includes("not enabled in this build")) {
    fail(
      'unavailable backend: expected stderr to include "not enabled in this build"',
      rejected,
    );
  }
  assertStreamsClean(rejected, "unavailable backend");
  console.log(
    "Availability guard OK: synthetic-frame-helper is rejected fail-closed " +
      "before helper/camera launch when this build has no OpenCV camera " +
      "support.",
  );
} else {
  // OpenCV camera support is compiled in on this machine: the
  // --camera-source opencv coupling must still fail closed at parse time
  // without opening a camera, even though real camera-backed runtime
  // execution is out of scope for this automated, no-webcam check.
  const missingCameraSource = runTracker([
    "--tracking-backend",
    "synthetic-frame-helper",
    "--helper-executable",
    helperPath,
    "--frames",
    "1",
  ]);
  if (missingCameraSource.status === 0) {
    fail(
      "missing --camera-source opencv: expected a non-zero exit status",
      missingCameraSource,
    );
  }
  if (nonEmptyLines(missingCameraSource.stdout).length !== 0) {
    fail(
      "missing --camera-source opencv: expected zero public stdout lines",
      missingCameraSource,
    );
  }
  if (
    !(missingCameraSource.stderr ?? "").includes(
      "requires --camera-source opencv",
    )
  ) {
    fail(
      'missing --camera-source opencv: expected stderr to include "requires --camera-source opencv"',
      missingCameraSource,
    );
  }
  assertStreamsClean(missingCameraSource, "missing --camera-source opencv");
  console.log(
    "Camera-source coupling guard OK: synthetic-frame-helper requires " +
      "--camera-source opencv and fails closed before any launch when it " +
      "is missing (no real camera opened by this check).",
  );
}

// --- Unaffected behavior spot-checks (full coverage lives in
// check-native-landmark-helper-session.mjs) --------------------------------
{
  const defaultResult = runTracker(["--frames", "2"]);
  if (defaultResult.status !== 0) {
    fail("default face-pipeline: expected exit 0", defaultResult);
  }
  const lines = nonEmptyLines(defaultResult.stdout);
  if (lines.length !== 2) {
    fail("default face-pipeline: expected 2 MotionFrame lines", defaultResult);
  }
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
{
  const synthetic = runTracker([
    "--tracking-backend",
    "synthetic-helper",
    "--helper-executable",
    helperPath,
    "--frames",
    "1",
  ]);
  if (synthetic.status !== 0) {
    fail("existing synthetic-helper backend: expected exit 0", synthetic);
  }
  const lines = nonEmptyLines(synthetic.stdout);
  if (lines.length !== 1) {
    fail(
      "existing synthetic-helper backend: expected 1 MotionFrame line",
      synthetic,
    );
  }
  if (parseNativeMotionFrameJson(lines[0]) === null) {
    fail(
      "existing synthetic-helper backend: line 1 not native MotionFrame",
      synthetic,
    );
  }
  assertStreamsClean(synthetic, "existing synthetic-helper backend");
}
console.log(
  "Unaffected-behavior guard OK: default face-pipeline and the existing " +
    "#533 result-only synthetic-helper backend are unchanged.",
);

console.log("Native landmark frame transport check passed.");
