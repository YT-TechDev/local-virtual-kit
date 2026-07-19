#!/usr/bin/env node
// Owner-local Windows execution gate for #603: proves that a Windows
// OpenCV-enabled Native Core development build can run
// --print-runtime-capabilities purely through Windows DLL search-order
// adjacency (its own output directory), with no vcpkg/OpenCV runtime
// directory present on the child process PATH. This is a real-execution
// proof, not a source-marker or build-output check, and it never prints an
// executable/dependency path, PATH contents, argv beyond a fixed label, or
// raw child stderr/OS error text.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const KNOWN_CONFIGS = ["", "Debug", "Release", "RelWithDebInfo", "MinSizeRel"];

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
  const allowed = KNOWN_CONFIGS.filter((entry) => entry !== "");
  if (!value || !allowed.includes(value)) {
    console.error(
      `native-dev-runtime-adjacency: invalid --config value; expected one of ${allowed.join(", ")}`,
    );
    process.exit(1);
  }
  return value;
}

function candidateConfigs() {
  const requested = parseConfigArg();
  return requested === null ? KNOWN_CONFIGS : [requested];
}

function resolveExecutable() {
  const executableName =
    process.platform === "win32" ? "lvk-tracker-core.exe" : "lvk-tracker-core";
  const buildDir = join(repoRoot, "native", "tracker-core", "build");

  for (const configDir of candidateConfigs()) {
    const candidatePath = configDir
      ? join(buildDir, configDir, executableName)
      : join(buildDir, executableName);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
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
