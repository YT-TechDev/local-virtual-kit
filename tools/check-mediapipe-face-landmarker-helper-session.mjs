#!/usr/bin/env node
// Bounded MediaPipe Face Landmarker helper session process checker (#558).
//
// Runs the fake-runtime process-level fixture exposed by
// test_face_landmarker_helper_session.py (--process-fixture <scenario>) for
// all four deterministic scenarios (frame-stop, clean-eof, startup-failure,
// input-failure), and strictly validates each scenario's exact stdout/stderr
// shape: the approved lifecycle/result JSON line count and fields, the
// canonical LOST result and its request/timestamp/payload/checksum/frameAck
// correlation, the exact stopping/stopped reason values, and the fixed safe
// stderr diagnostic. Never launches Native Core or a C++ binary: this is a
// Python-process-only, fake-runtime, no-real-MediaPipe/model check.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const testScript = join(
  repoRoot,
  "native",
  "tracker-core",
  "helpers",
  "mediapipe_face_landmarker",
  "test_face_landmarker_helper_session.py",
);

// Synthetic model marker used by the Python fixture (never a real model
// path); must never appear in any captured stdout/stderr.
const kSyntheticModelMarker = "lvk-synthetic-fixture-model-marker.task";

const kMaxBuffer = 1024 * 1024;

function fail(message) {
  console.error(
    `MediaPipe Face Landmarker helper session check failed: ${message}`,
  );
  process.exit(1);
}

// Resolution order for the Python interpreter:
//   1. an explicit CLI argument (used exactly, no fallback),
//   2. otherwise a non-empty LVK_TEST_PYTHON (used exactly, no fallback),
//   3. otherwise "python3" then "python", falling back from python3 to
//      python ONLY when spawning python3 itself fails because the command is
//      unavailable (ENOENT) -- never because it ran and failed.
function resolvePythonCandidates() {
  const provided = process.argv[2];
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

function runFixture(scenario) {
  const candidates = resolvePythonCandidates();
  for (let i = 0; i < candidates.length; i += 1) {
    const isLastCandidate = i === candidates.length - 1;
    const result = spawnSync(
      candidates[i],
      ["-B", testScript, "--process-fixture", scenario],
      { encoding: "utf8", maxBuffer: kMaxBuffer },
    );
    if (result.error) {
      if (!isLastCandidate && isCommandNotFound(result.error)) {
        continue;
      }
      fail(`Python executable unavailable for scenario "${scenario}"`);
    }
    return result;
  }
  fail(`Python executable unavailable for scenario "${scenario}"`);
  return undefined;
}

function splitLines(text) {
  if (text === "") {
    return [];
  }
  if (text.includes("\r")) {
    fail("output contains a carriage return");
  }
  if (!text.endsWith("\n")) {
    fail("output is missing a trailing newline");
  }
  return text.slice(0, -1).split("\n");
}

function parseJsonLine(line, scenario) {
  if (line.includes("\r")) {
    fail(`malformed JSON line in scenario "${scenario}"`);
  }
  let document;
  try {
    document = JSON.parse(line);
  } catch {
    fail(`malformed JSON line in scenario "${scenario}"`);
  }
  if (
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document)
  ) {
    fail(`malformed JSON line in scenario "${scenario}"`);
  }
  for (const value of Object.values(document)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      fail(`non-finite numeric value in scenario "${scenario}"`);
    }
  }
  return document;
}

function requireExactKeys(document, expectedKeys, context) {
  const actualKeys = Object.keys(document).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length ||
    !actualKeys.every((key, index) => key === sortedExpected[index])
  ) {
    fail(`unexpected key set in ${context}`);
  }
}

function assertNoSyntheticMarker(text, scenario) {
  if (text.includes(kSyntheticModelMarker)) {
    fail(`synthetic model marker leaked in scenario "${scenario}"`);
  }
}

function validateReadyLine(line, scenario) {
  const document = parseJsonLine(line, scenario);
  requireExactKeys(
    document,
    ["type", "schemaVersion", "source"],
    `ready line (${scenario})`,
  );
  if (document.type !== "ready")
    fail(`ready line has wrong type (${scenario})`);
  if (document.schemaVersion !== 1)
    fail(`ready line has wrong schemaVersion (${scenario})`);
  if (document.source !== "mediapipe-face-landmarker") {
    fail(`ready line has wrong source (${scenario})`);
  }
}

function validateStoppingLine(line, scenario) {
  const document = parseJsonLine(line, scenario);
  requireExactKeys(
    document,
    ["type", "schemaVersion", "reason"],
    `stopping line (${scenario})`,
  );
  if (document.type !== "stopping")
    fail(`stopping line has wrong type (${scenario})`);
  if (document.schemaVersion !== 1)
    fail(`stopping line has wrong schemaVersion (${scenario})`);
  if (document.reason !== "session-stop")
    fail(`stopping line has wrong reason (${scenario})`);
}

function validateStoppedLine(line, scenario, expectedReason) {
  const document = parseJsonLine(line, scenario);
  requireExactKeys(
    document,
    ["type", "schemaVersion", "reason"],
    `stopped line (${scenario})`,
  );
  if (document.type !== "stopped")
    fail(`stopped line has wrong type (${scenario})`);
  if (document.schemaVersion !== 1)
    fail(`stopped line has wrong schemaVersion (${scenario})`);
  if (document.reason !== expectedReason)
    fail(`stopped line has wrong reason (${scenario})`);
}

function validateCanonicalLostResultLine(line, scenario) {
  const document = parseJsonLine(line, scenario);
  requireExactKeys(
    document,
    [
      "type",
      "schemaVersion",
      "requestId",
      "frameTimestampMs",
      "status",
      "confidence",
      "faceRotation",
      "eyes",
      "mouth",
      "diag",
      "frameAck",
    ],
    `result line (${scenario})`,
  );

  if (document.type !== "result")
    fail(`result line has wrong type (${scenario})`);
  if (document.schemaVersion !== 1)
    fail(`result line has wrong schemaVersion (${scenario})`);
  if (document.status !== "lost")
    fail(`result line status is not canonical lost (${scenario})`);

  if (!Number.isInteger(document.requestId) || document.requestId < 0) {
    fail(`result line has invalid requestId (${scenario})`);
  }
  if (!Number.isInteger(document.frameTimestampMs)) {
    fail(`result line has invalid frameTimestampMs (${scenario})`);
  }

  requireExactKeys(
    document.faceRotation,
    ["pitch", "yaw", "roll"],
    `faceRotation (${scenario})`,
  );
  requireExactKeys(
    document.eyes,
    ["leftOpen", "rightOpen"],
    `eyes (${scenario})`,
  );
  requireExactKeys(document.mouth, ["open", "smile"], `mouth (${scenario})`);
  requireExactKeys(document.diag, ["inferenceMs"], `diag (${scenario})`);
  requireExactKeys(
    document.frameAck,
    ["sequence", "payloadBytes", "checksum"],
    `frameAck (${scenario})`,
  );

  if (document.confidence !== 0)
    fail(`canonical lost confidence mismatch (${scenario})`);
  if (
    document.faceRotation.pitch !== 0 ||
    document.faceRotation.yaw !== 0 ||
    document.faceRotation.roll !== 0
  ) {
    fail(`canonical lost faceRotation mismatch (${scenario})`);
  }
  if (document.eyes.leftOpen !== 1 || document.eyes.rightOpen !== 1) {
    fail(`canonical lost eyes mismatch (${scenario})`);
  }
  if (document.mouth.open !== 0 || document.mouth.smile !== 0) {
    fail(`canonical lost mouth mismatch (${scenario})`);
  }

  if (
    !Number.isInteger(document.frameAck.sequence) ||
    document.frameAck.sequence < 0
  ) {
    fail(`frameAck.sequence invalid (${scenario})`);
  }
  if (
    !Number.isInteger(document.frameAck.payloadBytes) ||
    document.frameAck.payloadBytes < 0
  ) {
    fail(`frameAck.payloadBytes invalid (${scenario})`);
  }
  if (
    !Number.isInteger(document.frameAck.checksum) ||
    document.frameAck.checksum < 0 ||
    document.frameAck.checksum > 0xffffffff
  ) {
    fail(`frameAck.checksum invalid (${scenario})`);
  }
  if (document.frameAck.sequence !== document.requestId) {
    fail(`frameAck.sequence does not correlate with requestId (${scenario})`);
  }
}

function validateSafeStderr(stderr, scenario, expectedCode) {
  const expected = `[helper] session: failed (code=${expectedCode})\n`;
  if (stderr !== expected) {
    fail(`unexpected stderr shape for scenario "${scenario}"`);
  }
}

function runScenario(scenario) {
  const result = runFixture(scenario);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  assertNoSyntheticMarker(stdout, scenario);
  assertNoSyntheticMarker(stderr, scenario);

  if (scenario === "frame-stop") {
    if (result.status !== 0) fail(`expected exit 0 for scenario "${scenario}"`);
    if (stderr !== "") fail(`expected empty stderr for scenario "${scenario}"`);
    const lines = splitLines(stdout);
    if (lines.length !== 4)
      fail(`expected 4 stdout lines for scenario "${scenario}"`);
    validateReadyLine(lines[0], scenario);
    validateCanonicalLostResultLine(lines[1], scenario);
    validateStoppingLine(lines[2], scenario);
    validateStoppedLine(lines[3], scenario, "session-stop");
    return;
  }

  if (scenario === "clean-eof") {
    if (result.status !== 0) fail(`expected exit 0 for scenario "${scenario}"`);
    if (stderr !== "") fail(`expected empty stderr for scenario "${scenario}"`);
    const lines = splitLines(stdout);
    if (lines.length !== 2)
      fail(`expected 2 stdout lines for scenario "${scenario}"`);
    validateReadyLine(lines[0], scenario);
    validateStoppedLine(lines[1], scenario, "session-eof");
    return;
  }

  if (scenario === "startup-failure") {
    if (result.status !== 1) fail(`expected exit 1 for scenario "${scenario}"`);
    if (stdout !== "") fail(`expected empty stdout for scenario "${scenario}"`);
    validateSafeStderr(stderr, scenario, "startup_failed");
    return;
  }

  if (scenario === "input-failure") {
    if (result.status !== 1) fail(`expected exit 1 for scenario "${scenario}"`);
    const lines = splitLines(stdout);
    if (lines.length !== 1)
      fail(`expected exactly one stdout line for scenario "${scenario}"`);
    validateReadyLine(lines[0], scenario);
    validateSafeStderr(stderr, scenario, "input_failed");
    return;
  }

  fail(`unknown scenario "${scenario}"`);
}

for (const scenario of [
  "frame-stop",
  "clean-eof",
  "startup-failure",
  "input-failure",
]) {
  runScenario(scenario);
}

console.log("MediaPipe Face Landmarker helper session process check passed.");
