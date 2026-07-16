#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const windowsOpenCvDllPathGuidance = `
The native tracker failed to start with STATUS_DLL_NOT_FOUND / 0xC0000135.
For Windows OpenCV-enabled vcpkg builds, ensure the relevant OpenCV runtime DLL directory is available on PATH before running this checker.
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

const fail = (message) => {
  console.error(`Native runtime capabilities check failed: ${message}`);
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
    "Native runtime capabilities check skipped: native binary not found. " +
      "Build the native tracker first with cmake -S native/tracker-core -B native/tracker-core/build && cmake --build native/tracker-core/build, " +
      "or pass the binary path as the first argument.",
  );
  process.exit(0);
}

const result = spawnSync(executablePath, ["--print-runtime-capabilities"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
});

if (result.error) {
  fail(
    withWindowsOpenCvDllPathGuidance(
      `could not run ${executablePath}: ${result.error.message}`,
      result,
    ),
  );
}

if (result.status !== 0) {
  const stderr = result.stderr.trim();
  fail(
    withWindowsOpenCvDllPathGuidance(
      `${executablePath} exited with status ${result.status}${
        stderr ? `; stderr: ${stderr}` : ""
      }`,
      result,
    ),
  );
}

const stdout = result.stdout;

const requiredKeys = [
  "opencvCameraSupport=",
  "opencvFaceDetectorSupport=",
  "mediapipeFaceLandmarkerSupport=",
  "mediapipeFaceLandmarkerHelperRouteSupport=",
  "mediapipeFaceLandmarkerHelperRouteConfigured=",
  "supportedCameraSources=",
  "supportedFaceDetectors=",
  "supportedTrackingBackends=",
  "cameraOpened=false",
  "motionFramesEmitted=false",
  "localOnly=true",
];

for (const key of requiredKeys) {
  if (!stdout.includes(key)) {
    fail(
      `expected stdout to include ${JSON.stringify(key)}\nActual stdout:\n${stdout}`,
    );
  }
}

if (!stdout.includes("LVK native runtime capabilities")) {
  fail(
    `expected stdout to include header "LVK native runtime capabilities"\nActual stdout:\n${stdout}`,
  );
}

// v0.13.0 (#572): a bare capability query (no mediapipe-face-landmarker
// route flags supplied) must always report configured=false -- omitting the
// three private route values is the one tolerated incomplete state, and this
// checker never supplies any of them.
if (!stdout.includes("mediapipeFaceLandmarkerHelperRouteConfigured=false")) {
  fail(
    `expected a bare capability query to report mediapipeFaceLandmarkerHelperRouteConfigured=false\nActual stdout:\n${stdout}`,
  );
}

// mediapipeFaceLandmarkerSupport reports the old native-integration meaning
// and must remain permanently false in this route (#572 does not set
// LVK_HAS_MEDIAPIPE_FACE_LANDMARKER=1 or redefine the old CMake feasibility
// probe).
if (!stdout.includes("mediapipeFaceLandmarkerSupport=false")) {
  fail(
    `expected mediapipeFaceLandmarkerSupport=false\nActual stdout:\n${stdout}`,
  );
}

function extractCapabilityValue(source, key) {
  const match = source.match(new RegExp(`^${key}=(.+)$`, "mu"));
  return match ? match[1] : null;
}

const opencvCameraSupport = extractCapabilityValue(
  stdout,
  "opencvCameraSupport",
);
const mediaPipeHelperRouteSupport = extractCapabilityValue(
  stdout,
  "mediapipeFaceLandmarkerHelperRouteSupport",
);
const supportedTrackingBackends =
  extractCapabilityValue(stdout, "supportedTrackingBackends") ?? "";

if (
  opencvCameraSupport === null ||
  mediaPipeHelperRouteSupport === null ||
  opencvCameraSupport !== mediaPipeHelperRouteSupport
) {
  fail(
    `expected mediapipeFaceLandmarkerHelperRouteSupport to equal opencvCameraSupport\nActual stdout:\n${stdout}`,
  );
}

const supportedBackendsList = supportedTrackingBackends
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const includesMediaPipeRoute = supportedBackendsList.includes(
  "mediapipe-face-landmarker",
);

if (mediaPipeHelperRouteSupport === "true" && !includesMediaPipeRoute) {
  fail(
    `expected supportedTrackingBackends to include mediapipe-face-landmarker when route support is true\nActual stdout:\n${stdout}`,
  );
}

if (mediaPipeHelperRouteSupport === "false" && includesMediaPipeRoute) {
  fail(
    `expected supportedTrackingBackends to exclude mediapipe-face-landmarker when route support is false\nActual stdout:\n${stdout}`,
  );
}

const motionFramePattern = /^\{"type":"motion_frame"/m;
if (motionFramePattern.test(stdout)) {
  fail(
    `stdout must not contain MotionFrame JSON lines, but a MotionFrame-shaped line was found.\nActual stdout:\n${stdout}`,
  );
}

const forbiddenTerms = ["telemetry", "analytics", "upload", "cloud", "network"];
for (const term of forbiddenTerms) {
  if (stdout.toLowerCase().includes(term)) {
    fail(
      `stdout must not include the term ${JSON.stringify(term)}\nActual stdout:\n${stdout}`,
    );
  }
}

console.log("Native runtime capabilities check passed.");
console.log("Output:");
process.stdout.write(stdout);
