#!/usr/bin/env node
// MediaPipe helper route configuration checker (v0.13.0, #570).
//
// Two responsibilities:
//   A. Static source guard (always runs): confirms the new configuration
//      header/source/smoke files and CMake wiring hold the required
//      contract markers and never call a forbidden process/filesystem/
//      network operation.
//   B. Runtime smoke (runs when the dedicated smoke binary is available):
//      spawns lvk-mediapipe-helper-route-config-smoke with no arguments and
//      requires its exact success stdout/stderr contract.
//
// Never prints executable paths, source snippets, subprocess stdout/stderr,
// which assertion failed, synthetic path fixtures, or exception text.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// Always prints the same generic line: never the executable path, source
// snippets, subprocess stdout/stderr, which assertion failed, synthetic path
// fixtures, or exception text.
const fail = () => {
  console.error("Native MediaPipe helper route configuration check failed.");
  process.exit(1);
};

const headerPath = join(
  repoRoot,
  "native",
  "tracker-core",
  "src",
  "mediapipe_helper_route_config.h",
);
const sourcePath = join(
  repoRoot,
  "native",
  "tracker-core",
  "src",
  "mediapipe_helper_route_config.cpp",
);
const smokePath = join(
  repoRoot,
  "native",
  "tracker-core",
  "src",
  "mediapipe_helper_route_config_smoke.cpp",
);
const cmakePath = join(repoRoot, "native", "tracker-core", "CMakeLists.txt");

function readRequired(path) {
  if (!existsSync(path)) {
    fail("missing required source file");
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    fail("could not read required source file");
    return "";
  }
}

function stripCppComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const headerText = readRequired(headerPath);
const sourceText = readRequired(sourcePath);
const smokeText = readRequired(smokePath);
const cmakeText = readRequired(cmakePath);

const headerStripped = stripCppComments(headerText);
const sourceStripped = stripCppComments(sourceText);
const smokeStripped = stripCppComments(smokeText);

// --- A1: required contract markers -----------------------------------------

const requiredInHeader = [
  "kMediaPipeHelperRoutePathMaxBytes",
  "4096",
  "MediaPipeHelperRouteConfigInput",
  "createMediaPipeHelperRouteConfig",
  "HelperSessionConfig",
];
for (const marker of requiredInHeader) {
  if (!headerStripped.includes(marker)) {
    fail("missing required header contract marker");
  }
}

const requiredInSource = [
  "createMediaPipeHelperRouteConfig",
  "HelperInvocationMode::ExactArguments",
  '"-B"',
  '"--model-asset-path"',
  "kMediaPipeFaceLandmarkerReadySource",
  "enableFrameTransport = true",
];
for (const marker of requiredInSource) {
  if (!sourceStripped.includes(marker)) {
    fail("missing required production source contract marker");
  }
}

const requiredInSmoke = [
  "createMediaPipeHelperRouteConfig",
  "mediapipe-helper-route-config smoke OK",
  "mediapipe-helper-route-config smoke failed.",
];
for (const marker of requiredInSmoke) {
  if (!smokeStripped.includes(marker)) {
    fail("missing required smoke contract marker");
  }
}

// --- A2: forbidden production/smoke operations -----------------------------

const forbiddenPatterns = [
  // Process / environment.
  /\bsystem\s*\(/,
  /\bpopen\s*\(/,
  /\bfork\s*\(/,
  /\bexec[lv][pe]?\s*\(/,
  /\bexecve\s*\(/,
  /\bposix_spawn\w*\s*\(/,
  /\bspawn[lv][pe]?\s*\(/,
  /\bCreateProcess\w*\s*\(/,
  /\bShellExecute\w*\s*\(/,
  /\bgetenv\s*\(/,
  /\bsecure_getenv\s*\(/,
  /\bcurrent_path\s*\(/,
  // Filesystem operations (is_absolute is explicitly allowed; note the
  // patterns below require a preceding word boundary, so "is_absolute("
  // never matches "\babsolute\s*\(").
  /\bfstream\b/,
  /\bifstream\b/,
  /\bofstream\b/,
  /\bfopen\s*\(/,
  /\bfreopen\s*\(/,
  /\bopen\s*\(/,
  /\bfread\s*\(/,
  /\bfwrite\s*\(/,
  /\bstat\s*\(/,
  /\baccess\s*\(/,
  /\babsolute\s*\(/,
  /\bcanonical\s*\(/,
  /\bweakly_canonical\s*\(/,
  /\bexists\s*\(/,
  /\bstatus\s*\(/,
  /\bpermissions\s*\(/,
  /\bfile_size\s*\(/,
  /\bis_regular_file\s*\(/,
  /\bis_directory\s*\(/,
  /\bdirectory_iterator\b/,
  /\brecursive_directory_iterator\b/,
  /\bremove\s*\(/,
  /\brename\s*\(/,
  /\bcreate_directory\w*\s*\(/,
  /\btemp_directory_path\s*\(/,
  /\btmpfile\s*\(/,
  // Network.
  /\bsocket\s*\(/,
  /\bconnect\s*\(/,
  /\bbind\s*\(/,
  /\blisten\s*\(/,
  /\baccept\s*\(/,
  /\bWinHTTP\w*/,
  /\bWinsock\w*/,
  /\bcurl_easy_\w*/,
  /\bCURL\b/,
];

function assertNoForbiddenOperations(strippedText) {
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(strippedText)) {
      fail("forbidden production/smoke operation detected");
    }
  }
}

assertNoForbiddenOperations(headerStripped);
assertNoForbiddenOperations(sourceStripped);
assertNoForbiddenOperations(smokeStripped);

// Explicitly confirm the allowed lexical query is actually how the
// absolute-path check is implemented (never a broad substring rule that
// would also match the forbidden filesystem::absolute()).
if (!sourceStripped.includes(".is_absolute()")) {
  fail("missing required lexical is_absolute() usage");
}

// --- A3: CMake wiring --------------------------------------------------

if (
  !new RegExp(
    "add_executable\\(lvk-tracker-core[\\s\\S]*?src/mediapipe_helper_route_config\\.cpp[\\s\\S]*?\\)",
  ).test(cmakeText)
) {
  fail("production source missing from lvk-tracker-core sources");
}

const smokeTargetMatch = cmakeText.match(
  /add_executable\(lvk-mediapipe-helper-route-config-smoke\s*([\s\S]*?)\)/,
);
if (!smokeTargetMatch) {
  fail("missing dedicated CMake smoke target");
}
const smokeTargetSources = smokeTargetMatch[1]
  .split(/\s+/)
  .map((entry) => entry.trim())
  .filter(Boolean);
if (smokeTargetSources.length !== 2) {
  fail("dedicated CMake smoke target has unexpected source count");
}
if (
  !smokeTargetSources.includes("src/mediapipe_helper_route_config.cpp") ||
  !smokeTargetSources.includes("src/mediapipe_helper_route_config_smoke.cpp")
) {
  fail("dedicated CMake smoke target has unexpected sources");
}
if (
  /target_link_libraries\(\s*lvk-mediapipe-helper-route-config-smoke\b/.test(
    cmakeText,
  )
) {
  fail("dedicated CMake smoke target must not link any library");
}
if (
  !new RegExp(
    "target_compile_features\\(\\s*lvk-mediapipe-helper-route-config-smoke\\s+PRIVATE\\s+cxx_std_17\\s*\\)",
  ).test(cmakeText)
) {
  fail("missing cxx_std_17 requirement on the dedicated smoke target");
}

// --- B: runtime smoke --------------------------------------------------

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
      "lvk-mediapipe-helper-route-config-smoke.exe",
    ),
    join(
      repoRoot,
      "native",
      "tracker-core",
      "build",
      "Release",
      "lvk-mediapipe-helper-route-config-smoke.exe",
    ),
    join(
      repoRoot,
      "native",
      "tracker-core",
      "build",
      "lvk-mediapipe-helper-route-config-smoke",
    ),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const executablePath = resolveExecutable();

if (!executablePath) {
  console.log(
    "Native MediaPipe helper route configuration check skipped: native binary not found. " +
      "Build the native tracker first, or pass the binary path as the first argument.",
  );
  process.exit(0);
}

const result = spawnSync(executablePath, [], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
});

if (result.error) {
  fail("could not run smoke executable");
}
if (result.status !== 0) {
  fail("smoke executable exited non-zero");
}
if ((result.stderr ?? "") !== "") {
  fail("smoke executable wrote to stderr");
}
if ((result.stdout ?? "") !== "mediapipe-helper-route-config smoke OK\n") {
  fail("smoke executable stdout did not match the expected contract");
}

console.log("Native MediaPipe helper route configuration check passed.");
