#!/usr/bin/env node
/**
 * Local-only OpenCV camera smoke helper.
 *
 * Run manually on a machine with an OpenCV-enabled native build, webcam
 * hardware, and OS camera permission. Never wired into CI or pnpm test.
 *
 * Usage:
 *   node tools/check-native-opencv-camera-smoke.mjs [path-to-lvk-tracker-core]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const skip = (reason) => {
  console.log(`OpenCV camera smoke skipped: ${reason}`);
  process.exit(0);
};

const fail = (message) => {
  console.error(`OpenCV camera smoke failed: ${message}`);
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
  skip(
    "native binary not found. " +
      "Build the native tracker first with: " +
      "cmake -S native/tracker-core -B native/tracker-core/build && " +
      "cmake --build native/tracker-core/build, " +
      "or pass the binary path as the first argument.",
  );
}

// Step 1: check runtime capabilities to determine OpenCV support.
const capResult = spawnSync(executablePath, ["--print-runtime-capabilities"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
});

if (capResult.error) {
  fail(`could not run ${executablePath}: ${capResult.error.message}`);
}

if (capResult.status !== 0) {
  const stderr = capResult.stderr.trim();
  fail(
    `${executablePath} --print-runtime-capabilities exited with status ${capResult.status}` +
      (stderr ? `; stderr: ${stderr}` : ""),
  );
}

const capStdout = capResult.stdout;

if (!capStdout.includes("opencvCameraSupport=true")) {
  skip(
    "opencvCameraSupport=false reported by --print-runtime-capabilities. " +
      "Rebuild the native tracker with OpenCV available to enable the camera smoke.",
  );
}

console.log("OpenCV camera support detected. Running finite camera smoke...");

// Step 2: run finite OpenCV camera smoke — 3 frames, local camera diagnostics.
const smokeResult = spawnSync(
  executablePath,
  ["--camera-source", "opencv", "--frames", "3", "--log-camera-status"],
  {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  },
);

if (smokeResult.error) {
  fail(`could not run smoke command: ${smokeResult.error.message}`);
}

if (smokeResult.status !== 0) {
  const stderr = smokeResult.stderr.trim();
  fail(
    `smoke command exited with status ${smokeResult.status}` +
      (stderr ? `\nstderr: ${stderr}` : ""),
  );
}

const smokeStdout = smokeResult.stdout;
const smokeStderr = smokeResult.stderr;

// Verify stdout contains MotionFrame-shaped JSON lines.
const motionFramePattern = /^\{"schemaVersion":/m;
if (!motionFramePattern.test(smokeStdout)) {
  fail(
    `expected stdout to contain MotionFrame JSON lines matching {"schemaVersion":...}\nActual stdout:\n${smokeStdout}`,
  );
}

// Verify stdout does not contain OpenCV log contamination.
const opencvLogMarkers = ["[ INFO:", "[ WARN:", "[ ERROR:", "[ FATAL:"];
for (const marker of opencvLogMarkers) {
  if (smokeStdout.includes(marker)) {
    fail(
      `stdout must not contain OpenCV log output; found ${JSON.stringify(marker)}.\n` +
        `OpenCV logs contaminate the MotionFrame JSON stream. ` +
        `Ensure cv::utils::logging::setLogLevel(LOG_LEVEL_WARNING) is called before camera open.\n` +
        `Actual stdout:\n${smokeStdout}`,
    );
  }
}

// Verify stdout does not contain raw image data markers.
const rawImageMarkers = ["data:image", "base64,", "PNG", "JFIF", "BM\x00"];
for (const marker of rawImageMarkers) {
  if (smokeStdout.includes(marker)) {
    fail(
      `stdout must not contain raw image data; found marker ${JSON.stringify(marker)}`,
    );
  }
}

// Verify stderr contains safe camera diagnostics.
if (!smokeStderr.includes("[camera]")) {
  fail(
    `expected stderr to contain "[camera]" diagnostics from --log-camera-status\nActual stderr:\n${smokeStderr}`,
  );
}

console.log("OpenCV camera smoke passed.");
console.log("stdout (MotionFrame lines):");
process.stdout.write(smokeStdout);
console.log("stderr (camera diagnostics):");
process.stderr.write(smokeStderr);
