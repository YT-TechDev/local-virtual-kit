#!/usr/bin/env node
/**
 * Verifies the MediaPipe Face Landmarker candidate backend scaffold stays
 * fail-closed behind the Native Core TrackingBackend boundary. Safe for
 * CI/headless: it never opens a camera and never enables MediaPipe. No
 * MediaPipe dependency, task/model file, or runtime download is exercised by
 * this checker.
 *
 * Usage:
 *   node tools/check-native-mediapipe-candidate-boundary.mjs [path-to-lvk-tracker-core]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

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

// Step 1: --print-runtime-capabilities must report the candidate as
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

// Step 2: selecting the candidate backend without support must fail closed
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
  "Native MediaPipe candidate boundary check passed (mediapipeFaceLandmarkerSupport=false; " +
    "verified the build fails closed before camera open and MotionFrame emission).",
);
