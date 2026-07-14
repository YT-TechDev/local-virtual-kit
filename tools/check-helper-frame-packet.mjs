#!/usr/bin/env node
// Bounded frame packet smoke checker (v0.13.0, #534).
//
// Runs the standalone lvk-helper-frame-packet-smoke executable, which asserts
// the OpenCV-independent binary frame packet header codec, bounds
// validation, and BGR24 row normalization directly (valid/truncated/
// oversized/malformed headers, the corrected 32 MiB representable-payload
// boundary, overflow-safe multiplication, exact little-endian bytes, and a
// deterministic FNV-1a32 checksum). No process spawning beyond the smoke
// binary itself, no camera, no OpenCV, no MotionFrame. CI-safe.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const fail = (message, result) => {
  console.error(`Helper frame packet smoke check failed: ${message}`);
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
      "lvk-helper-frame-packet-smoke.exe",
    ),
    join(
      repoRoot,
      "native",
      "tracker-core",
      "build",
      "Release",
      "lvk-helper-frame-packet-smoke.exe",
    ),
    join(
      repoRoot,
      "native",
      "tracker-core",
      "build",
      "lvk-helper-frame-packet-smoke",
    ),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const executablePath = resolveExecutable();
if (!executablePath) {
  console.log(
    "Helper frame packet smoke check skipped: native binary not found. " +
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
if (!(result.stdout ?? "").includes("helper-frame-packet smoke OK")) {
  fail("expected success marker on stdout", result);
}

console.log("Helper frame packet smoke check passed.");
