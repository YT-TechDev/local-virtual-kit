#!/usr/bin/env node
// Bounded MediaPipe Face Landmarker helper session process checker (#558).
//
// Runs the fake-runtime process-level fixture exposed by
// test_face_landmarker_helper_session.py (--process-fixture <scenario>) for
// all four deterministic scenarios (frame-stop, clean-eof, startup-failure,
// input-failure), and strictly validates each scenario's exact stdout/stderr
// shape: the approved lifecycle/result JSON line count and fields, the exact
// deterministic canonical LOST result (including request/timestamp/payload/
// checksum/frameAck correlation against the fixture's known fixed values),
// the exact stopping/stopped reason values, and the fixed safe stderr
// diagnostic. Never launches Native Core or a C++ binary: this is a
// Python-process-only, fake-runtime, no-real-MediaPipe/model check.
//
// Every validation failure and every unexpected checker exception is
// funneled through one sanitized, fixed-text failure path: no child
// stdout/stderr, scenario payload, executable/script path, stack trace, or
// exception class/message ever reaches the console.
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

// Deterministic frame-stop fixture values (native/tracker-core/helpers/
// mediapipe_face_landmarker/test_face_landmarker_helper_session.py,
// _make_valid_frame_input()/_frame_outcome()): a fixed synthetic 2x2 BGR24
// frame (request_id=7, frame_timestamp_ms=1000, payload=bytes(range(12)))
// whose FNV-1a32 checksum is the fixed constant below. These are the
// fixture's own known-fixed values, never derived from captured child
// output.
const kExpectedRequestId = 7;
const kExpectedFrameTimestampMs = 1000;
const kExpectedPayloadBytes = 12;
const kExpectedChecksum = 1246796121;

class CheckFailure extends Error {}

function fail() {
  throw new CheckFailure();
}

function isPlainJsonObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
      fail();
    }
    return result;
  }
  fail();
  return undefined;
}

function splitLines(text) {
  if (text === "") {
    return [];
  }
  if (text.includes("\r")) {
    fail();
  }
  if (!text.endsWith("\n")) {
    fail();
  }
  return text.slice(0, -1).split("\n");
}

function parseJsonLine(line) {
  if (typeof line !== "string" || line.includes("\r")) {
    fail();
  }
  let document;
  try {
    document = JSON.parse(line);
  } catch {
    fail();
  }
  if (!isPlainJsonObject(document)) {
    fail();
  }
  for (const value of Object.values(document)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      fail();
    }
  }
  return document;
}

// Requires `value` to be a plain JSON object (never null, an array, or a
// primitive) with exactly `expectedKeys` before any Object.keys()/property
// access is attempted, so a malformed nested value (e.g. a null
// faceRotation/frameAck) is rejected through the controlled failure path
// instead of throwing an uncaught JavaScript exception.
function requireExactKeys(value, expectedKeys) {
  if (!isPlainJsonObject(value)) {
    fail();
  }
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length ||
    !actualKeys.every((key, index) => key === sortedExpected[index])
  ) {
    fail();
  }
}

function assertNoSyntheticMarker(text) {
  if (text.includes(kSyntheticModelMarker)) {
    fail();
  }
}

function validateReadyLine(line) {
  const document = parseJsonLine(line);
  requireExactKeys(document, ["type", "schemaVersion", "source"]);
  if (document.type !== "ready") fail();
  if (document.schemaVersion !== 1) fail();
  if (document.source !== "mediapipe-face-landmarker") fail();
}

function validateStoppingLine(line) {
  const document = parseJsonLine(line);
  requireExactKeys(document, ["type", "schemaVersion", "reason"]);
  if (document.type !== "stopping") fail();
  if (document.schemaVersion !== 1) fail();
  if (document.reason !== "session-stop") fail();
}

function validateStoppedLine(line, expectedReason) {
  const document = parseJsonLine(line);
  requireExactKeys(document, ["type", "schemaVersion", "reason"]);
  if (document.type !== "stopped") fail();
  if (document.schemaVersion !== 1) fail();
  if (document.reason !== expectedReason) fail();
}

// Validates one "result" line against the exact deterministic frame-stop
// fixture shape: canonical LOST field values plus exact request/timestamp/
// payload/checksum/frameAck correlation against the fixture's known-fixed
// values (never derived from the line being validated).
function validateCanonicalLostResultLine(line) {
  const document = parseJsonLine(line);
  requireExactKeys(document, [
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
  ]);

  if (document.type !== "result") fail();
  if (document.schemaVersion !== 1) fail();
  if (document.status !== "lost") fail();

  if (document.requestId !== kExpectedRequestId) fail();
  if (document.frameTimestampMs !== kExpectedFrameTimestampMs) fail();

  requireExactKeys(document.faceRotation, ["pitch", "yaw", "roll"]);
  requireExactKeys(document.eyes, ["leftOpen", "rightOpen"]);
  requireExactKeys(document.mouth, ["open", "smile"]);
  requireExactKeys(document.diag, ["inferenceMs"]);
  requireExactKeys(document.frameAck, ["sequence", "payloadBytes", "checksum"]);

  if (document.confidence !== 0) fail();
  if (
    document.faceRotation.pitch !== 0 ||
    document.faceRotation.yaw !== 0 ||
    document.faceRotation.roll !== 0
  ) {
    fail();
  }
  if (document.eyes.leftOpen !== 1 || document.eyes.rightOpen !== 1) fail();
  if (document.mouth.open !== 0 || document.mouth.smile !== 0) fail();

  if (typeof document.diag.inferenceMs !== "number") fail();
  if (!Number.isFinite(document.diag.inferenceMs)) fail();
  if (document.diag.inferenceMs < 0) fail();

  if (document.frameAck.sequence !== kExpectedRequestId) fail();
  if (document.frameAck.payloadBytes !== kExpectedPayloadBytes) fail();
  if (document.frameAck.checksum !== kExpectedChecksum) fail();
}

function validateSafeStderr(stderr, expectedCode) {
  const expected = `[helper] session: failed (code=${expectedCode})\n`;
  if (stderr !== expected) {
    fail();
  }
}

function runScenario(scenario) {
  const result = runFixture(scenario);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  assertNoSyntheticMarker(stdout);
  assertNoSyntheticMarker(stderr);

  if (scenario === "frame-stop") {
    if (result.status !== 0) fail();
    if (stderr !== "") fail();
    const lines = splitLines(stdout);
    if (lines.length !== 4) fail();
    validateReadyLine(lines[0]);
    validateCanonicalLostResultLine(lines[1]);
    validateStoppingLine(lines[2]);
    validateStoppedLine(lines[3], "session-stop");
    return;
  }

  if (scenario === "clean-eof") {
    if (result.status !== 0) fail();
    if (stderr !== "") fail();
    const lines = splitLines(stdout);
    if (lines.length !== 2) fail();
    validateReadyLine(lines[0]);
    validateStoppedLine(lines[1], "session-eof");
    return;
  }

  if (scenario === "startup-failure") {
    if (result.status !== 1) fail();
    if (stdout !== "") fail();
    validateSafeStderr(stderr, "startup_failed");
    return;
  }

  if (scenario === "input-failure") {
    if (result.status !== 1) fail();
    const lines = splitLines(stdout);
    if (lines.length !== 1) fail();
    validateReadyLine(lines[0]);
    validateSafeStderr(stderr, "input_failed");
    return;
  }

  fail();
}

// --- Internal validator regression checks -----------------------------
//
// Bounded, in-process assertions (no child process) proving that
// validateCanonicalLostResultLine() actually rejects malformed/incorrect
// result shapes, run before any process fixture is spawned. Built from raw
// JSON text (not JSON.stringify of a JS object) so a non-JSON-standard but
// JS-parseable numeric token (e.g. "1e400", which JSON.parse evaluates to
// the non-finite double Infinity) can be injected for the non-finite case;
// JSON.stringify would otherwise coerce NaN/Infinity to null and silently
// defeat that case. Prints nothing on success.

function buildFrameStopResultLine({
  requestId = String(kExpectedRequestId),
  frameTimestampMs = String(kExpectedFrameTimestampMs),
  faceRotation = '{"pitch":0,"yaw":0,"roll":0}',
  frameAck = `{"sequence":${kExpectedRequestId},"payloadBytes":${kExpectedPayloadBytes},"checksum":${kExpectedChecksum}}`,
  inferenceMs = "0.0",
} = {}) {
  return (
    `{"type":"result","schemaVersion":1,"requestId":${requestId},` +
    `"frameTimestampMs":${frameTimestampMs},"status":"lost","confidence":0,` +
    `"faceRotation":${faceRotation},"eyes":{"leftOpen":1,"rightOpen":1},` +
    `"mouth":{"open":0,"smile":0},"diag":{"inferenceMs":${inferenceMs}},` +
    `"frameAck":${frameAck}}`
  );
}

// Asserts that validateCanonicalLostResultLine() rejects the fixture built
// from `overrides` via CheckFailure. Any other (unexpected) exception is
// not swallowed here: it propagates to the top-level sanitized handler,
// same as every other checker failure. Not rejecting at all is itself a
// checker regression and fails the whole run.
function expectRejected(overrides) {
  let rejected = false;
  try {
    validateCanonicalLostResultLine(buildFrameStopResultLine(overrides));
  } catch (error) {
    if (error instanceof CheckFailure) {
      rejected = true;
    } else {
      throw error;
    }
  }
  if (!rejected) {
    fail();
  }
}

function runInternalValidatorRegressionChecks() {
  // Sanity: the baseline fixture shape itself must validate cleanly.
  validateCanonicalLostResultLine(buildFrameStopResultLine());

  expectRejected({ faceRotation: "null" });
  expectRejected({ frameAck: "null" });
  expectRejected({ requestId: String(kExpectedRequestId + 1) });
  expectRejected({
    frameTimestampMs: String(kExpectedFrameTimestampMs + 1),
  });
  expectRejected({
    frameAck: `{"sequence":${kExpectedRequestId},"payloadBytes":${
      kExpectedPayloadBytes + 1
    },"checksum":${kExpectedChecksum}}`,
  });
  expectRejected({
    frameAck: `{"sequence":${kExpectedRequestId},"payloadBytes":${kExpectedPayloadBytes},"checksum":${
      kExpectedChecksum + 1
    }}`,
  });
  expectRejected({ inferenceMs: "1e400" });
  expectRejected({ inferenceMs: "-1" });
}

try {
  runInternalValidatorRegressionChecks();

  for (const scenario of [
    "frame-stop",
    "clean-eof",
    "startup-failure",
    "input-failure",
  ]) {
    runScenario(scenario);
  }

  console.log("MediaPipe Face Landmarker helper session process check passed.");
} catch {
  console.error("MediaPipe Face Landmarker helper session check failed.");
  process.exit(1);
}
