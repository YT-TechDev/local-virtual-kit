#!/usr/bin/env node
// Strict helper-message parser smoke checker (v0.13.0, #533).
//
// Runs the standalone lvk-helper-message-parse-smoke executable, which asserts
// the strict helper contract parser directly (missing/duplicate fields, trailing
// garbage, integer overflow, partial numeric tokens, non-finite numbers, exact
// schemaVersion matching, and finite out-of-range acceptance). No process
// spawning, camera, or MotionFrame is involved. Synthetic/smoke-only, CI-safe.
//
// v0.13.0 (#535): after the default smoke passes, also runs an actual
// Python-to-C++ cross-runtime parity check. This is test tooling only: it
// generates one known synthetic result line from the real Python serializer
// (test_helper_result_json.py --emit-cpp-parity-line) and feeds it into the
// same native parser executable's --parse-result-frame-line mode, proving
// the actual production parseHelperResultEnvelope()/parseHelperFrameAck()
// accept a real Python-serialized line. Never prints the generated line.
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

const kMaxParityLineBytes = 2048;

function resolvePythonExecutable() {
  const provided = process.argv[3];
  if (provided) {
    return provided;
  }
  if (process.env.LVK_TEST_PYTHON) {
    return process.env.LVK_TEST_PYTHON;
  }
  return process.platform === "win32" ? "python" : "python3";
}

function runCrossRuntimeParityCheck(executablePath) {
  const pythonExecutable = resolvePythonExecutable();
  const fixtureScript = join(
    repoRoot,
    "native",
    "tracker-core",
    "helpers",
    "mediapipe_face_landmarker",
    "test_helper_result_json.py",
  );

  const pythonResult = spawnSync(
    pythonExecutable,
    ["-B", fixtureScript, "--emit-cpp-parity-line"],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );

  if (pythonResult.error) {
    fail(`fixture generation failed: could not run ${pythonExecutable}`);
  }
  if (pythonResult.status !== 0) {
    fail("fixture generation failed: non-zero exit status");
  }
  if ((pythonResult.stderr ?? "") !== "") {
    fail("fixture generation failed: unexpected stderr output");
  }

  const stdout = pythonResult.stdout ?? "";
  if (!stdout.endsWith("\n")) {
    fail("malformed fixture framing: missing trailing newline");
  }
  const content = stdout.slice(0, -1);
  if (content.length === 0) {
    fail("malformed fixture framing: empty content");
  }
  if (content.includes("\r") || content.includes("\n")) {
    fail("malformed fixture framing: embedded CR/LF");
  }
  if (Buffer.byteLength(content, "utf8") > kMaxParityLineBytes) {
    fail("malformed fixture framing: content exceeds bounded size");
  }

  const parserResult = spawnSync(
    executablePath,
    ["--parse-result-frame-line", content],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );

  if (parserResult.error) {
    fail(`could not run ${executablePath}`);
  }
  if (parserResult.status !== 0) {
    fail("C++ parser parity failed");
  }
  if (
    !(parserResult.stdout ?? "").includes("helper-message serializer parity OK")
  ) {
    fail("C++ parser parity failed: missing success marker");
  }

  console.log("Helper message cross-runtime parity check passed.");
}

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

runCrossRuntimeParityCheck(executablePath);
