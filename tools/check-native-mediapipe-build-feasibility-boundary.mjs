#!/usr/bin/env node
/**
 * Verifies the v0.7.0 MediaPipe Face Landmarker build feasibility boundary.
 * Safe for CI/headless: this checker performs static CMake checks and, when
 * CMake is available, runs only configure-time fail-fast validation in a temp
 * build directory. It does not build or run Native Core, access a camera,
 * download assets, run inference, or access the network.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cmakePath = join(repoRoot, "native", "tracker-core", "CMakeLists.txt");
const optionName = "LVK_ENABLE_MEDIAPIPE_FACE_LANDMARKER_PROBE";

const fail = (message) => {
  console.error(
    `Native MediaPipe build feasibility boundary check failed: ${message}`,
  );
  process.exit(1);
};

const cmakeSource = readFileSync(cmakePath, "utf8");

function requirePattern(pattern, message) {
  if (!pattern.test(cmakeSource)) {
    fail(message);
  }
}

function rejectPattern(pattern, message) {
  if (pattern.test(cmakeSource)) {
    fail(message);
  }
}

function stripComments(source) {
  return source
    .split(/\r?\n/u)
    .map((line) => line.replace(/#.*/u, ""))
    .join("\n");
}

const cmakeWithoutComments = stripComments(cmakeSource);

requirePattern(
  new RegExp(`\\b${optionName}\\b`, "u"),
  `${optionName} is missing`,
);
requirePattern(
  new RegExp(`option\\s*\\(\\s*${optionName}\\b[\\s\\S]*?\\bOFF\\s*\\)`, "u"),
  `${optionName} option must default to OFF`,
);

const guardMatch = cmakeSource.match(
  new RegExp(
    `if\\s*\\(\\s*${optionName}\\s*\\)([\\s\\S]*?)endif\\s*\\(\\s*\\)`,
    "u",
  ),
);
if (!guardMatch) {
  fail(`${optionName} guard is missing`);
}

const guardBody = guardMatch[1];
if (!/message\s*\(\s*FATAL_ERROR\b/iu.test(guardBody)) {
  fail(`${optionName} guard must fail fast with message(FATAL_ERROR ...)`);
}

for (const requiredText of [
  optionName,
  "v0.7.0",
  "#480",
  "MediaPipe dependency",
  "task/model assets",
  "runtime downloads",
  "production backend selection",
]) {
  if (!guardBody.includes(requiredText)) {
    fail(
      `${optionName} fail-fast message is missing required text: ${requiredText}`,
    );
  }
}

// Run targeted integration rejection without comments so explanatory notes
// can mention forbidden commands without being mistaken for real integration.
for (const [pattern, message] of [
  [/find_package\s*\(\s*MediaPipe\b/iu, "MediaPipe find_package"],
  [
    /LVK_HAS_MEDIAPIPE_FACE_LANDMARKER\s*=\s*1/u,
    "LVK_HAS_MEDIAPIPE_FACE_LANDMARKER=1",
  ],
  [
    /target_link_libraries\s*\([^)]*mediapipe/iu,
    "MediaPipe target_link_libraries",
  ],
  [
    /target_include_directories\s*\([^)]*mediapipe/iu,
    "MediaPipe target_include_directories",
  ],
  [/target_sources\s*\([^)]*mediapipe/iu, "MediaPipe target_sources"],
  [
    /FetchContent_Declare\s*\([^)]*mediapipe/iu,
    "MediaPipe FetchContent_Declare",
  ],
  [/ExternalProject_Add\s*\([^)]*mediapipe/iu, "MediaPipe ExternalProject_Add"],
]) {
  if (pattern.test(cmakeWithoutComments)) {
    fail(`${message} must not be introduced`);
  }
}

const cmakeVersion = spawnSync("cmake", ["--version"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
});

if (cmakeVersion.error?.code === "ENOENT") {
  console.log(
    "Native MediaPipe build feasibility boundary runtime check skipped: cmake was not found. Static CMake boundary checks passed.",
  );
  process.exit(0);
}

if (cmakeVersion.error || cmakeVersion.status !== 0) {
  fail(
    `cmake --version failed before runtime boundary validation: ${
      cmakeVersion.error?.message ??
      cmakeVersion.stderr.trim() ??
      "unknown error"
    }`,
  );
}

const tempRoot = mkdtempSync(join(tmpdir(), "lvk-mediapipe-feasibility-"));
try {
  const buildDir = join(tempRoot, "build");
  const configure = spawnSync(
    "cmake",
    [
      "-S",
      join(repoRoot, "native", "tracker-core"),
      "-B",
      buildDir,
      `-D${optionName}=ON`,
    ],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );

  if (configure.error) {
    fail(`could not run cmake configure: ${configure.error.message}`);
  }

  const combinedOutput = `${configure.stdout}\n${configure.stderr}`;
  const normalizedOutput = combinedOutput.replace(/\s+/gu, " ");

  if (configure.status === 0) {
    fail(`enabling ${optionName} must fail at CMake configure time`);
  }

  for (const requiredText of [
    optionName,
    "not implemented in v0.7.0",
    "#480",
    "MediaPipe dependency",
    "task/model assets",
    "runtime downloads",
    "production backend selection",
  ]) {
    if (!normalizedOutput.includes(requiredText)) {
      fail(`CMake fail-fast output is missing required text: ${requiredText}`);
    }
  }

  if (
    /MediaPipe[^\r\n]*(found|linked|downloaded|enabled)/iu.test(combinedOutput)
  ) {
    fail(
      "CMake output must not claim MediaPipe was found, linked, downloaded, or enabled",
    );
  }

  console.log(
    "Native MediaPipe build feasibility boundary check passed (probe defaults OFF; enabling it fails fast before dependency, asset, download, inference, or production backend integration).",
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
