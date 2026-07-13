#!/usr/bin/env node
// Strict helper-message parser smoke checker (v0.13.0, #533).
//
// Runs the standalone lvk-helper-message-parse-smoke executable, which asserts
// the strict helper contract parser directly (missing/duplicate fields, trailing
// garbage, integer overflow, partial numeric tokens, non-finite numbers, exact
// schemaVersion matching, and finite out-of-range acceptance). No process
// spawning, camera, or MotionFrame is involved. Synthetic/smoke-only, CI-safe.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const fail = (message, result) => {
  console.error(`Helper message parse smoke check failed: ${message}`);
  if (result) {
    console.error(`Exit status: ${result.status ?? "unknown"}`);
    console.error(`stderr: ${(result.stderr ?? "").trim() || "(empty)"}`);
    console.error(`stdout: ${(result.stdout ?? "").trim() || "(empty)"}`);
  }
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
      "lvk-helper-message-parse-smoke.exe",
    ),
    join(
      repoRoot,
      "native",
      "tracker-core",
      "build",
      "Release",
      "lvk-helper-message-parse-smoke.exe",
    ),
    join(
      repoRoot,
      "native",
      "tracker-core",
      "build",
      "lvk-helper-message-parse-smoke",
    ),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const executablePath = resolveExecutable();
if (!executablePath) {
  console.log(
    "Helper message parse smoke check skipped: native binary not found. " +
      "Build the native tracker first, or pass the binary path as the first argument.",
  );
  process.exit(0);
}

const result = spawnSync(executablePath, [], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
});

if (result.error) {
  fail(`could not run ${executablePath}: ${result.error.message}`, result);
}
if (result.status !== 0) {
  fail("expected exit status 0", result);
}
if (!(result.stdout ?? "").includes("helper-message parse smoke OK")) {
  fail("expected success marker on stdout", result);
}

console.log("Helper message parse smoke check passed.");
