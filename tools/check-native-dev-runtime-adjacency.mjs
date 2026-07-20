#!/usr/bin/env node
// Owner-local Windows execution gate for #603: proves that a Windows
// OpenCV-enabled Native Core development build can run
// --print-runtime-capabilities purely through Windows DLL search-order
// adjacency (its own output directory), with no vcpkg/OpenCV runtime
// directory present on the child process PATH. This is a real-execution
// proof, not a source-marker or build-output check, and it never prints an
// executable/dependency path, PATH contents, argv beyond a fixed label, or
// raw child stderr/OS error text.
//
// This is the required independent Route B proof: an explicit
// `cmake --build <dir> --target lvk-tracker-core --config <cfg>` build, or a
// direct IDE executable-project build, can bypass the mandatory Route A
// build-time ALL-target gate (native/tracker-core/CMakeLists.txt) by
// construction, so build success alone is INCOMPLETE / UNVERIFIED for
// runtime adjacency on those routes. Run this script with an explicit
// `--config <cfg>` matching the configuration actually built to complete
// Route B proof. The no-argument candidate search below remains only for
// testing Electron's own candidate resolution order and never completes
// Route B proof.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const KNOWN_CONFIGS = ["", "Debug", "Release", "RelWithDebInfo", "MinSizeRel"];
const EXPLICIT_CONFIGS = KNOWN_CONFIGS.filter((entry) => entry !== "");

function fail(category) {
  console.error(`native-dev-runtime-adjacency: FAIL (${category})`);
  process.exit(1);
}

function parseConfigArg() {
  const flagIndex = process.argv.indexOf("--config");
  if (flagIndex === -1) {
    return null;
  }

  const value = process.argv[flagIndex + 1];
  if (!value || !EXPLICIT_CONFIGS.includes(value)) {
    console.error(
      `native-dev-runtime-adjacency: invalid --config value; expected one of ${EXPLICIT_CONFIGS.join(", ")}`,
    );
    process.exit(1);
  }
  return value;
}

function executableName() {
  return process.platform === "win32"
    ? "lvk-tracker-core.exe"
    : "lvk-tracker-core";
}

// Reads only the non-private configuration facts required to distinguish a
// multi-config build tree from a single-config one. Never reads, compares,
// normalizes, stores, or prints CMAKE_TOOLCHAIN_FILE, a vcpkg root, an
// OpenCV path, or any other private toolchain location from the cache.
function readCMakeCacheConfigFacts(buildDir) {
  const cachePath = join(buildDir, "CMakeCache.txt");
  if (!existsSync(cachePath)) {
    return null;
  }

  const facts = { generator: null, configurationTypes: null, buildType: null };
  const content = readFileSync(cachePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+):[A-Za-z]+=(.*)$/);
    if (!match) {
      continue;
    }
    if (match[1] === "CMAKE_GENERATOR") {
      facts.generator = match[2];
    } else if (match[1] === "CMAKE_CONFIGURATION_TYPES") {
      facts.configurationTypes = match[2];
    } else if (match[1] === "CMAKE_BUILD_TYPE") {
      facts.buildType = match[2];
    }
  }
  return facts;
}

function isMultiConfigBuildTree(facts) {
  return Boolean(
    facts.configurationTypes && facts.configurationTypes.trim() !== "",
  );
}

// Deterministic Route B resolution for an explicit --config. Never falls
// back to KNOWN_CONFIGS candidate scanning and never accepts another
// existing executable as a substitute for the exact requested configuration.
function resolveExplicitConfigExecutable(requestedConfig) {
  const buildDir = join(repoRoot, "native", "tracker-core", "build");
  const facts = readCMakeCacheConfigFacts(buildDir);
  if (!facts) {
    fail("config-not-built");
  }

  let candidatePath;
  if (isMultiConfigBuildTree(facts)) {
    candidatePath = join(buildDir, requestedConfig, executableName());
  } else {
    if (facts.buildType !== requestedConfig) {
      fail("config-mismatch");
    }
    candidatePath = join(buildDir, executableName());
  }

  if (!existsSync(candidatePath)) {
    fail("config-not-built");
  }
  return candidatePath;
}

// No-argument candidate search: useful only for testing the same candidate
// order Electron's development spawn uses. It must never be described or
// accepted as completing Route B proof.
function resolveCandidateExecutable() {
  const buildDir = join(repoRoot, "native", "tracker-core", "build");

  for (const configDir of KNOWN_CONFIGS) {
    const candidatePath = configDir
      ? join(buildDir, configDir, executableName())
      : join(buildDir, executableName());
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function resolveExecutable() {
  const requestedConfig = parseConfigArg();
  if (requestedConfig !== null) {
    return resolveExplicitConfigExecutable(requestedConfig);
  }
  return resolveCandidateExecutable();
}

function buildMinimalWindowsPath() {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  return `${systemRoot}\\System32;${systemRoot}`;
}

function extractValue(stdout, key) {
  const match = stdout.match(new RegExp(`^${key}=(.+)$`, "mu"));
  return match ? match[1] : null;
}

if (process.platform !== "win32") {
  console.log(
    "native-dev-runtime-adjacency: skipped (Windows-only real-execution gate).",
  );
  process.exit(0);
}

const executablePath = resolveExecutable();
if (!executablePath) {
  fail("executable-missing");
}

const minimalEnv = {
  SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
  PATH: buildMinimalWindowsPath(),
};

const result = spawnSync(executablePath, ["--print-runtime-capabilities"], {
  encoding: "utf8",
  env: minimalEnv,
  shell: false,
  maxBuffer: 1024 * 1024,
});

if (result.error) {
  fail("spawn-error");
}

if (result.status !== 0) {
  fail("nonzero-exit");
}

const stdout = result.stdout ?? "";

if (!stdout.includes("LVK native runtime capabilities")) {
  fail("malformed-capabilities");
}

if (
  !stdout.includes("cameraOpened=false") ||
  !stdout.includes("motionFramesEmitted=false")
) {
  fail("malformed-capabilities");
}

const motionFramePattern = /^\{"type":"motion_frame"/m;
if (motionFramePattern.test(stdout)) {
  fail("motionframe-shaped-output-detected");
}

const opencvCameraSupport = extractValue(stdout, "opencvCameraSupport");
if (opencvCameraSupport !== "true") {
  fail("opencv-camera-support-not-enabled");
}

const localOnly = extractValue(stdout, "localOnly");
if (localOnly !== "true") {
  fail("local-only-missing");
}

console.log(
  "native-dev-runtime-adjacency: PASS (real execution, minimal PATH, OpenCV camera support enabled, local-only confirmed).",
);
