#!/usr/bin/env node
// Native MediaPipe Face Landmarker helper route checker (v0.13.0, #572).
//
// Replaces the retired permanent-unsupported candidate checker
// (check-native-mediapipe-candidate-boundary.mjs): the mediapipe-face-landmarker
// backend is now a real, opt-in development route composed from the already
// merged #568-#571 boundaries, gated on OpenCV camera build support instead
// of the permanently-disabled native-integration candidate macro.
//
// Two responsibilities:
//   A. Capability contract (always runs when the binary is available): bare
//      vs. configured capability queries, never launching Python/opening a
//      camera/emitting MotionFrame.
//   B. CLI/runtime boundary (always runs when the binary is available):
//      presence/scoping/camera-source/invalid-value rejection, all fully
//      generic and path-free; plus, only when this build actually has
//      OpenCV camera support, one real deliberate helper-launch-failure run
//      proving pre-camera/pre-MotionFrame fail-closed behavior end to end.
//
// Uses only synthetic, non-existent, lexically-absolute path fixtures
// (createMediaPipeHelperRouteConfig() never touches the filesystem beyond a
// lexical parse), so no real Python/MediaPipe/model installation is
// required. Never prints the executable path, fixture path text, subprocess
// stdout/stderr, or which assertion failed.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const fail = () => {
  console.error("Native MediaPipe helper route check failed.");
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

const executablePath = resolveExecutable();

if (!executablePath) {
  console.log(
    "Native MediaPipe helper route check skipped: native binary not found. " +
      "Build the native tracker first with cmake -S native/tracker-core -B native/tracker-core/build && cmake --build native/tracker-core/build, " +
      "or pass the binary path as the first argument.",
  );
  process.exit(0);
}

// --- synthetic, non-existent, lexically-absolute path fixtures -------------
//
// createMediaPipeHelperRouteConfig() only performs a lexical
// std::filesystem::path::is_absolute() check plus byte-bound/control-byte
// rejection; it never touches the filesystem. These fixture strings never
// need to exist on disk, and are treated as PRIVATE markers by this checker:
// none of them may ever appear in any subprocess stdout/stderr.
const isWindows = process.platform === "win32";
function fakeAbsolutePath(name) {
  return isWindows
    ? `C:\\lvk-mediapipe-route-fixture-572\\${name}`
    : `/lvk-mediapipe-route-fixture-572/${name}`;
}

const fixturePythonPath = fakeAbsolutePath("python-marker-572001.exe");
const fixtureHelperScriptPath = fakeAbsolutePath("script-marker-572002.py");
const fixtureModelAssetPath = fakeAbsolutePath("model-marker-572003.task");
const fixtureRelativePath = "relative-marker-572004.exe";
const fixtureControlBytePath = `${fakeAbsolutePath("control")}marker-572005.exe`;
const fixtureHelperExecutablePath = fakeAbsolutePath(
  "helper-marker-572006.exe",
);
const fixtureLaunchFailurePythonPath = fakeAbsolutePath(
  "nonexistent-python-marker-572007.exe",
);

const privateMarkers = [
  fixturePythonPath,
  fixtureHelperScriptPath,
  fixtureModelAssetPath,
  fixtureRelativePath,
  fixtureControlBytePath,
  fixtureHelperExecutablePath,
  fixtureLaunchFailurePythonPath,
];

function run(args) {
  return spawnSync(executablePath, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function assertRunCompleted(result) {
  if (result.error) {
    fail();
  }
}

function assertNoMotionFrameLines(stdout) {
  const stdoutLines = (stdout ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (stdoutLines.some((line) => line.startsWith("{"))) {
    fail();
  }
}

function assertNoCameraDiagnostics(stderr) {
  if ((stderr ?? "").includes("[camera]")) {
    fail();
  }
}

function assertNoCapabilityOutput(stdout) {
  if ((stdout ?? "").includes("LVK native runtime capabilities")) {
    fail();
  }
}

function assertNoPrivateMarkers(result) {
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  for (const marker of privateMarkers) {
    if (combined.includes(marker)) {
      fail();
    }
  }
}

function extractCapabilityValue(stdout, key) {
  const match = (stdout ?? "").match(new RegExp(`^${key}=(.+)$`, "mu"));
  return match ? match[1] : null;
}

// --- A. Capability contract --------------------------------------------------

// A1. Bare capability query: no route flags at all.
const bareResult = run(["--print-runtime-capabilities"]);
assertRunCompleted(bareResult);
if (bareResult.status !== 0) {
  fail();
}
assertNoMotionFrameLines(bareResult.stdout);
assertNoPrivateMarkers(bareResult);

const opencvCameraSupport = extractCapabilityValue(
  bareResult.stdout,
  "opencvCameraSupport",
);
const bareRouteSupport = extractCapabilityValue(
  bareResult.stdout,
  "mediapipeFaceLandmarkerHelperRouteSupport",
);
const bareRouteConfigured = extractCapabilityValue(
  bareResult.stdout,
  "mediapipeFaceLandmarkerHelperRouteConfigured",
);
const bareNativeSupport = extractCapabilityValue(
  bareResult.stdout,
  "mediapipeFaceLandmarkerSupport",
);

if (
  opencvCameraSupport === null ||
  bareRouteSupport === null ||
  opencvCameraSupport !== bareRouteSupport
) {
  fail();
}
if (bareRouteConfigured !== "false") {
  fail();
}
if (bareNativeSupport !== "false") {
  fail();
}

const routeSupportEnabled = bareRouteSupport === "true";

const bareSupportedBackends = (
  extractCapabilityValue(bareResult.stdout, "supportedTrackingBackends") ?? ""
)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const bareIncludesRoute = bareSupportedBackends.includes(
  "mediapipe-face-landmarker",
);
if (routeSupportEnabled !== bareIncludesRoute) {
  fail();
}

// A2. Configured capability query: the strict five-condition set from the
// route contract. Must succeed (configured=true) even when route support is
// false, and must never launch Python, open a camera, or emit MotionFrame.
const configuredResult = run([
  "--print-runtime-capabilities",
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "opencv",
  "--mediapipe-python",
  fixturePythonPath,
  "--mediapipe-helper-script",
  fixtureHelperScriptPath,
  "--mediapipe-model-asset",
  fixtureModelAssetPath,
]);
assertRunCompleted(configuredResult);
if (configuredResult.status !== 0) {
  fail();
}
assertNoMotionFrameLines(configuredResult.stdout);
assertNoCameraDiagnostics(configuredResult.stderr);
assertNoPrivateMarkers(configuredResult);

if (
  extractCapabilityValue(
    configuredResult.stdout,
    "mediapipeFaceLandmarkerHelperRouteConfigured",
  ) !== "true"
) {
  fail();
}
if (
  extractCapabilityValue(
    configuredResult.stdout,
    "mediapipeFaceLandmarkerSupport",
  ) !== "false"
) {
  fail();
}
if (
  extractCapabilityValue(
    configuredResult.stdout,
    "mediapipeFaceLandmarkerHelperRouteSupport",
  ) !== bareRouteSupport
) {
  fail();
}

// A3. Invalid route-selected capability queries: selecting the route via
// --tracking-backend mediapipe-face-landmarker (unlike the bare query in A1,
// which never selects the route at all) obligates the invocation to supply
// a fully valid configuration -- an invalid configuration must be rejected
// with a non-zero exit and zero public/capability stdout, even though
// --print-runtime-capabilities is present. This guards the ordering fix:
// config-validity rejection must run before the capability-query early
// return, not after it.
function assertRejectedCapabilityQuery(args) {
  const result = run(args);
  assertRunCompleted(result);
  if (result.status === 0) {
    fail();
  }
  assertNoMotionFrameLines(result.stdout);
  assertNoCapabilityOutput(result.stdout);
  assertNoCameraDiagnostics(result.stderr);
  assertNoPrivateMarkers(result);
}

// A3a. Route selected, camera-source opencv, all three private flags
// omitted.
assertRejectedCapabilityQuery([
  "--print-runtime-capabilities",
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "opencv",
]);

// A3b. Each explicitly empty private flag, independently, in an otherwise
// fully-supplied capability query.
assertRejectedCapabilityQuery([
  "--print-runtime-capabilities",
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "opencv",
  "--mediapipe-python",
  "",
  "--mediapipe-helper-script",
  fixtureHelperScriptPath,
  "--mediapipe-model-asset",
  fixtureModelAssetPath,
]);
assertRejectedCapabilityQuery([
  "--print-runtime-capabilities",
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "opencv",
  "--mediapipe-python",
  fixturePythonPath,
  "--mediapipe-helper-script",
  "",
  "--mediapipe-model-asset",
  fixtureModelAssetPath,
]);
assertRejectedCapabilityQuery([
  "--print-runtime-capabilities",
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "opencv",
  "--mediapipe-python",
  fixturePythonPath,
  "--mediapipe-helper-script",
  fixtureHelperScriptPath,
  "--mediapipe-model-asset",
  "",
]);

// A3c. Factory-invalid configured inputs: a relative path and a
// control-byte-containing path, each substituted for one of the three
// flags in an otherwise fully-supplied capability query.
assertRejectedCapabilityQuery([
  "--print-runtime-capabilities",
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "opencv",
  "--mediapipe-python",
  fixtureRelativePath,
  "--mediapipe-helper-script",
  fixtureHelperScriptPath,
  "--mediapipe-model-asset",
  fixtureModelAssetPath,
]);
assertRejectedCapabilityQuery([
  "--print-runtime-capabilities",
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "opencv",
  "--mediapipe-python",
  fixturePythonPath,
  "--mediapipe-helper-script",
  fixtureControlBytePath,
  "--mediapipe-model-asset",
  fixtureModelAssetPath,
]);

// --- B. CLI/runtime boundary -------------------------------------------------

function assertRejectedBeforeMotionFrame(args) {
  const result = run(args);
  assertRunCompleted(result);
  if (result.status === 0) {
    fail();
  }
  assertNoMotionFrameLines(result.stdout);
  assertNoCameraDiagnostics(result.stderr);
  assertNoPrivateMarkers(result);
}

const validFullArgs = [
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "opencv",
  "--mediapipe-python",
  fixturePythonPath,
  "--mediapipe-helper-script",
  fixtureHelperScriptPath,
  "--mediapipe-model-asset",
  fixtureModelAssetPath,
  "--frames",
  "1",
];

// B1. Each missing private flag rejected independently (partial
// configuration).
assertRejectedBeforeMotionFrame([
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "opencv",
  "--mediapipe-helper-script",
  fixtureHelperScriptPath,
  "--mediapipe-model-asset",
  fixtureModelAssetPath,
  "--frames",
  "1",
]);
assertRejectedBeforeMotionFrame([
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "opencv",
  "--mediapipe-python",
  fixturePythonPath,
  "--mediapipe-model-asset",
  fixtureModelAssetPath,
  "--frames",
  "1",
]);
assertRejectedBeforeMotionFrame([
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "opencv",
  "--mediapipe-python",
  fixturePythonPath,
  "--mediapipe-helper-script",
  fixtureHelperScriptPath,
  "--frames",
  "1",
]);

// B2. Each explicitly empty private flag rejected independently (distinct
// from omitted).
assertRejectedBeforeMotionFrame([
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "opencv",
  "--mediapipe-python",
  "",
  "--mediapipe-helper-script",
  fixtureHelperScriptPath,
  "--mediapipe-model-asset",
  fixtureModelAssetPath,
  "--frames",
  "1",
]);
assertRejectedBeforeMotionFrame([
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "opencv",
  "--mediapipe-python",
  fixturePythonPath,
  "--mediapipe-helper-script",
  "",
  "--mediapipe-model-asset",
  fixtureModelAssetPath,
  "--frames",
  "1",
]);
assertRejectedBeforeMotionFrame([
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "opencv",
  "--mediapipe-python",
  fixturePythonPath,
  "--mediapipe-helper-script",
  fixtureHelperScriptPath,
  "--mediapipe-model-asset",
  "",
  "--frames",
  "1",
]);

// B3. Route flags rejected outside the MediaPipe backend (default
// face-pipeline; scoping applies regardless of which private flag is used).
assertRejectedBeforeMotionFrame([
  "--mediapipe-python",
  fixturePythonPath,
  "--frames",
  "1",
]);
assertRejectedBeforeMotionFrame([
  "--tracking-backend",
  "synthetic-helper",
  "--mediapipe-model-asset",
  fixtureModelAssetPath,
  "--frames",
  "1",
]);

// B4. --helper-executable and --helper-arg remain unavailable to this route.
assertRejectedBeforeMotionFrame([
  ...validFullArgs,
  "--helper-executable",
  fixtureHelperExecutablePath,
]);
assertRejectedBeforeMotionFrame([...validFullArgs, "--helper-arg", "x"]);

// B5. Wrong camera source rejected.
assertRejectedBeforeMotionFrame([
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "dummy",
  "--mediapipe-python",
  fixturePythonPath,
  "--mediapipe-helper-script",
  fixtureHelperScriptPath,
  "--mediapipe-model-asset",
  fixtureModelAssetPath,
  "--frames",
  "1",
]);

// B6. Invalid path values rejected without value echo: a relative path and a
// control-byte-containing path, each substituted for one of the three
// flags in turn.
assertRejectedBeforeMotionFrame([
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "opencv",
  "--mediapipe-python",
  fixtureRelativePath,
  "--mediapipe-helper-script",
  fixtureHelperScriptPath,
  "--mediapipe-model-asset",
  fixtureModelAssetPath,
  "--frames",
  "1",
]);
assertRejectedBeforeMotionFrame([
  "--tracking-backend",
  "mediapipe-face-landmarker",
  "--camera-source",
  "opencv",
  "--mediapipe-python",
  fixturePythonPath,
  "--mediapipe-helper-script",
  fixtureControlBytePath,
  "--mediapipe-model-asset",
  fixtureModelAssetPath,
  "--frames",
  "1",
]);

// B7. Route-support/launch-boundary evidence. Honestly conditioned on
// whether this build actually has OpenCV camera support -- never converts
// an unavailable branch into a pass.
if (!routeSupportEnabled) {
  // Unsupported OpenCV runtime selection fails before camera/MotionFrame.
  assertRejectedBeforeMotionFrame(validFullArgs);
  console.log(
    "Native MediaPipe helper route check: OpenCV-enabled runtime evidence skipped (this build has no OpenCV camera support).",
  );
} else {
  // A deliberate startup launch failure (a syntactically valid but
  // non-existent interpreter path) must also produce zero MotionFrame lines
  // and no camera-open diagnostic, proving the real end-to-end path through
  // HelperProcessSession::start() fails closed before the camera opens.
  assertRejectedBeforeMotionFrame([
    "--tracking-backend",
    "mediapipe-face-landmarker",
    "--camera-source",
    "opencv",
    "--mediapipe-python",
    fixtureLaunchFailurePythonPath,
    "--mediapipe-helper-script",
    fixtureHelperScriptPath,
    "--mediapipe-model-asset",
    fixtureModelAssetPath,
    "--frames",
    "1",
  ]);
  console.log(
    "Native MediaPipe helper route check: OpenCV-enabled deliberate launch-failure evidence exercised.",
  );
}

console.log("Native MediaPipe helper route check passed.");
