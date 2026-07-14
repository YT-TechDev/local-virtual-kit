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

// Resolution order for the Python interpreter used to generate the parity
// fixture:
//   1. an explicit CLI argument (used exactly, no fallback),
//   2. otherwise a non-empty LVK_TEST_PYTHON (used exactly, no fallback),
//   3. otherwise "python3" then "python", falling back from python3 to
//      python ONLY when spawning python3 itself fails because the command is
//      unavailable (ENOENT) -- never because it ran and failed.
function resolvePythonCandidates() {
  const provided = process.argv[3];
  if (provided) {
    return [provided];
  }
  if (process.env.LVK_TEST_PYTHON) {
    return [process.env.LVK_TEST_PYTHON];
  }
  return ["python3", "python"];
}

function isCommandNotFound(spawnError) {
  return Boolean(spawnError) && spawnError.code === "ENOENT";
}

// Spawns the parity fixture generator against each candidate in order,
// falling back to the next candidate only when the current one could not be
// spawned at all (command not found). A candidate that actually starts and
// then fails (non-zero exit, stderr, malformed output) is returned as-is so
// the failure stays visible instead of being masked by another interpreter.
function runPythonFixtureGenerator(fixtureScript) {
  const candidates = resolvePythonCandidates();
  for (let i = 0; i < candidates.length; i += 1) {
    const isLastCandidate = i === candidates.length - 1;
    const result = spawnSync(
      candidates[i],
      ["-B", fixtureScript, "--emit-cpp-parity-line"],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    if (result.error) {
      if (!isLastCandidate && isCommandNotFound(result.error)) {
        continue;
      }
      fail("fixture generation failed: Python executable unavailable");
    }
    return result;
  }
  fail("fixture generation failed: Python executable unavailable");
  return undefined;
}

function runCrossRuntimeParityCheck(executablePath) {
  const fixtureScript = join(
    repoRoot,
    "native",
    "tracker-core",
    "helpers",
    "mediapipe_face_landmarker",
    "test_helper_result_json.py",
  );

  const pythonResult = runPythonFixtureGenerator(fixtureScript);

  if (pythonResult.status !== 0) {
    fail("fixture generation failed: non-zero exit status");
  }
  if ((pythonResult.stderr ?? "") !== "") {
    fail("fixture generation failed: unexpected stderr output");
  }

  const stdout = pythonResult.stdout ?? "";
  if (!stdout.endsWith("\n")) {
    fail("malformed fixture framing");
  }
  const content = stdout.slice(0, -1);
  if (content.length === 0) {
    fail("malformed fixture framing");
  }
  if (content.includes("\r") || content.includes("\n")) {
    fail("malformed fixture framing");
  }
  if (Buffer.byteLength(content, "utf8") > kMaxParityLineBytes) {
    fail("malformed fixture framing");
  }

  const parserResult = spawnSync(
    executablePath,
    ["--parse-result-frame-line", content],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );

  if (parserResult.error) {
    fail("C++ parser parity failed: parser process unavailable");
  }
  if (parserResult.status !== 0) {
    fail("C++ parser parity failed");
  }
  if (
    !(parserResult.stdout ?? "").includes("helper-message serializer parity OK")
  ) {
    fail("C++ parser parity failed");
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
