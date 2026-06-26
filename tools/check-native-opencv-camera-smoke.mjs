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

const windowsOpenCvDllPathGuidance = `
The native tracker failed to start with STATUS_DLL_NOT_FOUND / 0xC0000135.
For Windows OpenCV-enabled vcpkg builds, ensure the relevant OpenCV runtime DLL directory is available on PATH before running this local smoke helper.
This guidance is for local/dev validation only; the checker does not modify PATH, bundle DLLs, or implement packaging behavior.
Use placeholder paths in docs and reports, for example:
- <vcpkg-root>/installed/x64-windows/bin
- <vcpkg-root>/installed/x64-windows/debug/bin
Do not commit local absolute paths.`;

const dllMissingStatusCodes = new Set([0xc0000135, 3221225781, -1073741515]);
const dllMissingPattern =
  /STATUS_DLL_NOT_FOUND|0xC0000135|3221225781|-1073741515/iu;

function isWindowsDllMissingFailure(result) {
  return (
    dllMissingStatusCodes.has(result.status) ||
    dllMissingPattern.test(result.error?.message ?? "") ||
    dllMissingPattern.test(result.stderr ?? "")
  );
}

function withWindowsOpenCvDllPathGuidance(message, result) {
  if (!isWindowsDllMissingFailure(result)) {
    return message;
  }

  return `${message}\n\n${windowsOpenCvDllPathGuidance}`;
}

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
  fail(
    withWindowsOpenCvDllPathGuidance(
      `could not run ${executablePath}: ${capResult.error.message}`,
      capResult,
    ),
  );
}

if (capResult.status !== 0) {
  const stderr = capResult.stderr.trim();
  fail(
    withWindowsOpenCvDllPathGuidance(
      `${executablePath} --print-runtime-capabilities exited with status ${capResult.status}` +
        (stderr ? `; stderr: ${stderr}` : ""),
      capResult,
    ),
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
  fail(
    withWindowsOpenCvDllPathGuidance(
      `could not run smoke command: ${smokeResult.error.message}`,
      smokeResult,
    ),
  );
}

if (smokeResult.status !== 0) {
  const stderr = smokeResult.stderr.trim();
  fail(
    withWindowsOpenCvDllPathGuidance(
      `smoke command exited with status ${smokeResult.status}` +
        (stderr ? `\nstderr: ${stderr}` : ""),
      smokeResult,
    ),
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
