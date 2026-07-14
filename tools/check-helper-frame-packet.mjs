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
//
// v0.13.0 (#535): after the default smoke passes, also runs an actual
// C++-encoder-to-Python-decoder cross-runtime parity check. This is test
// tooling only: it asks the same smoke executable to emit one tiny synthetic
// request/header/payload fixture built from the real
// encodeFramePacketHeader()/fnv1a32() (--emit-python-frame-input-fixture),
// then feeds it into helper_frame_input.py's real
// parse_helper_control_line()/decode_helper_frame_packet_header()/
// assemble_validated_helper_frame_input() through
// test_helper_frame_input.py's --consume-cpp-frame-input-fixture mode.
// Fixture contents (request JSON, packet hex, checksum) are never printed by
// this checker.
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

// Generic failure for the parity path: never includes subprocess stdout/
// stderr, executable paths, or any fixture content (request JSON, packet
// hex, checksum, payload bytes).
const failParity = (message) => {
  console.error(`Helper frame packet smoke check failed: ${message}`);
  process.exit(1);
};

const kFrameHeaderBytes = 48;
const kFramePayloadBytes = 12;
const kPacketHexLength = (kFrameHeaderBytes + kFramePayloadBytes) * 2;
const kMaxRequestLineBytes = 2048;
const kMaxChecksumDigits = 10; // uint32 max ("4294967295") is 10 digits.

// Resolution order for the Python interpreter used to consume the parity
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

function isLowerHex(value) {
  return /^[0-9a-f]+$/.test(value);
}

function isDecimalDigits(value) {
  return /^[0-9]+$/.test(value);
}

// Asks the smoke executable to emit the synthetic fixture and validates its
// framing WITHOUT ever printing the fixture content. Returns
// { requestLine, packetHex, checksumDecimal } on success.
function generateAndValidateFixture(executablePath) {
  const result = spawnSync(
    executablePath,
    ["--emit-python-frame-input-fixture"],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );

  if (result.error) {
    failParity("frame-input fixture generation failed");
  }
  if (result.status !== 0) {
    failParity("frame-input fixture generation failed");
  }
  if ((result.stderr ?? "") !== "") {
    failParity("frame-input fixture generation failed");
  }

  const stdout = result.stdout ?? "";
  if (stdout.includes("\r")) {
    failParity("malformed frame-input fixture");
  }
  if (!stdout.endsWith("\n")) {
    failParity("malformed frame-input fixture");
  }
  const content = stdout.slice(0, -1);
  const lines = content.split("\n");
  if (lines.length !== 3) {
    failParity("malformed frame-input fixture");
  }

  const [requestLine, packetHex, checksumDecimal] = lines;

  if (requestLine.length === 0) {
    failParity("malformed frame-input fixture");
  }
  if (Buffer.byteLength(requestLine, "utf8") > kMaxRequestLineBytes) {
    failParity("malformed frame-input fixture");
  }
  if (!isLowerHex(packetHex) || packetHex.length !== kPacketHexLength) {
    failParity("malformed frame-input fixture");
  }
  if (
    !isDecimalDigits(checksumDecimal) ||
    checksumDecimal.length > kMaxChecksumDigits
  ) {
    failParity("malformed frame-input fixture");
  }

  return { requestLine, packetHex, checksumDecimal };
}

// Spawns the Python fixture consumer against each candidate in order,
// falling back to the next candidate only when the current one could not be
// spawned at all (command not found). A candidate that actually starts and
// then fails (non-zero exit, stderr, mismatched checksum) is returned as-is
// so the failure stays visible instead of being masked by another
// interpreter.
function runPythonFixtureConsumer(fixture) {
  const testScript = join(
    repoRoot,
    "native",
    "tracker-core",
    "helpers",
    "mediapipe_face_landmarker",
    "test_helper_frame_input.py",
  );

  const candidates = resolvePythonCandidates();
  for (let i = 0; i < candidates.length; i += 1) {
    const isLastCandidate = i === candidates.length - 1;
    const result = spawnSync(
      candidates[i],
      [
        "-B",
        testScript,
        "--consume-cpp-frame-input-fixture",
        fixture.requestLine,
        fixture.packetHex,
        fixture.checksumDecimal,
      ],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    if (result.error) {
      if (!isLastCandidate && isCommandNotFound(result.error)) {
        continue;
      }
      failParity("Python executable unavailable");
    }
    return result;
  }
  failParity("Python executable unavailable");
  return undefined;
}

function runCrossRuntimeParityCheck(executablePath) {
  const fixture = generateAndValidateFixture(executablePath);
  const pythonResult = runPythonFixtureConsumer(fixture);

  if (pythonResult.status !== 0) {
    failParity("Python frame-input parity failed");
  }
  if ((pythonResult.stderr ?? "") !== "") {
    failParity("Python frame-input parity failed");
  }
  if ((pythonResult.stdout ?? "") !== "helper-frame-input parity OK\n") {
    failParity("Python frame-input parity failed");
  }

  console.log("Helper frame input cross-runtime parity check passed.");
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

runCrossRuntimeParityCheck(executablePath);
