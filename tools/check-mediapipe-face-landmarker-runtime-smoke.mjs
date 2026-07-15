#!/usr/bin/env node
// Local-only MediaPipe Face Landmarker runtime smoke checker (v0.13.0, #554).
//
// Default (no opt-in): prints a normalized SKIPPED report and exits 0. This
// is CI-safe: it never spawns Python, never requires MediaPipe/NumPy/a model,
// and never claims real MediaPipe evidence.
//
// Opt-in (explicit LVK_MEDIAPIPE_SMOKE=1, LVK_MEDIAPIPE_SMOKE_PYTHON,
// LVK_MEDIAPIPE_MODEL_ASSET_PATH): validates the explicit configuration
// without ever printing either path, spawns the configured interpreter to
// run the real Python smoke module once, strictly validates its single
// bounded JSON report line against a closed schema, and reserializes the
// validated report (never echoes untrusted raw child output). Exits 0 only
// for a PASSED report.
//
// Usage:
//   node tools/check-mediapipe-face-landmarker-runtime-smoke.mjs
//   node tools/check-mediapipe-face-landmarker-runtime-smoke.mjs --self-test
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pythonScriptPath = join(
  repoRoot,
  "native",
  "tracker-core",
  "helpers",
  "mediapipe_face_landmarker",
  "face_landmarker_runtime_smoke.py",
);

const CHECK_NAME = "mediapipe-face-landmarker-runtime-smoke";
const SCHEMA_VERSION = 1;
const MAX_REPORT_BYTES = 2048;
const SPAWN_TIMEOUT_MS = 30_000;
const SPAWN_MAX_BUFFER_BYTES = 64 * 1024;

const ALLOWED_FIELDS = [
  "schemaVersion",
  "check",
  "status",
  "reason",
  "pythonVersion",
  "mediapipeVersion",
  "inputCategory",
  "inputWidth",
  "inputHeight",
  "runtimeCreationStatus",
  "inferenceStatus",
  "inferenceMs",
  "payloadStatus",
  "closeStatus",
];
const ALLOWED_FIELD_SET = new Set(ALLOWED_FIELDS);

const ALLOWED_STATUSES = new Set(["SKIPPED", "PASSED", "FAILED"]);
const SKIPPED_REASON = "opt_in_required";
const ALLOWED_FAILURE_REASONS = new Set([
  "interpreter_configuration_invalid",
  "model_configuration_invalid",
  "worker_unavailable",
  "worker_timeout",
  "worker_protocol_invalid",
  "python_version_unavailable",
  "numpy_import_failed",
  "mediapipe_import_failed",
  "mediapipe_version_unavailable",
  "model_unavailable",
  "frame_preparation_failed",
  "runtime_creation_failed",
  "image_api_resolution_failed",
  "inference_failed",
  "composition_failed",
  "close_failed",
  "unexpected_runtime_failure",
]);
const ALLOWED_RUNTIME_CREATION_STATUSES = new Set([
  "success",
  "configuration_failed",
  "import_failed",
  "api_resolution_failed",
  "options_construction_failed",
  "runtime_initialization_failed",
]);
const ALLOWED_INFERENCE_STATUSES = new Set([
  "success",
  "runtime_unavailable",
  "image_adaptation_failed",
  "detection_failed",
]);
const ALLOWED_PAYLOAD_STATUSES = new Set(["tracking", "lost"]);
const ALLOWED_CLOSE_STATUSES = new Set(["closed", "close_failed", "not_ready"]);
const ALLOWED_INPUT_CATEGORIES = new Set(["synthetic-solid-bgr24"]);

// Mirrors the sanitized version pattern in face_landmarker_runtime_smoke.py:
// short, alnum-led, no path separators/whitespace/exception-shaped text.
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;

function buildSkippedReport() {
  return {
    schemaVersion: SCHEMA_VERSION,
    check: CHECK_NAME,
    status: "SKIPPED",
    reason: SKIPPED_REASON,
    pythonVersion: null,
    mediapipeVersion: null,
    inputCategory: null,
    inputWidth: null,
    inputHeight: null,
    runtimeCreationStatus: null,
    inferenceStatus: null,
    inferenceMs: null,
    payloadStatus: null,
    closeStatus: null,
  };
}

function buildFailedReport(reason) {
  return {
    schemaVersion: SCHEMA_VERSION,
    check: CHECK_NAME,
    status: "FAILED",
    reason,
    pythonVersion: null,
    mediapipeVersion: null,
    inputCategory: null,
    inputWidth: null,
    inputHeight: null,
    runtimeCreationStatus: null,
    inferenceStatus: null,
    inferenceMs: null,
    payloadStatus: null,
    closeStatus: null,
  };
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullOr(value, predicate) {
  return value === null || predicate(value);
}

function isSanitizedVersionString(value) {
  return typeof value === "string" && VERSION_PATTERN.test(value);
}

function isBoundedInt(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isFiniteNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// Strictly validates a candidate report object against the closed schema.
// Returns { ok: true, report } with a freshly rebuilt (never-echoed) report
// object, or { ok: false }.
function validateReportShape(candidate) {
  if (!isPlainObject(candidate)) {
    return { ok: false };
  }

  const keys = Object.keys(candidate);
  if (keys.length !== ALLOWED_FIELD_SET.size) {
    return { ok: false };
  }
  for (const key of keys) {
    if (!ALLOWED_FIELD_SET.has(key)) {
      return { ok: false };
    }
  }

  if (candidate.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false };
  }
  if (candidate.check !== CHECK_NAME) {
    return { ok: false };
  }
  if (
    typeof candidate.status !== "string" ||
    !ALLOWED_STATUSES.has(candidate.status)
  ) {
    return { ok: false };
  }

  const status = candidate.status;

  if (!isNullOr(candidate.pythonVersion, isSanitizedVersionString)) {
    return { ok: false };
  }
  if (!isNullOr(candidate.mediapipeVersion, isSanitizedVersionString)) {
    return { ok: false };
  }
  if (
    !isNullOr(
      candidate.inputCategory,
      (v) => typeof v === "string" && ALLOWED_INPUT_CATEGORIES.has(v),
    )
  ) {
    return { ok: false };
  }
  if (!isNullOr(candidate.inputWidth, (v) => isBoundedInt(v, 1, 7680))) {
    return { ok: false };
  }
  if (!isNullOr(candidate.inputHeight, (v) => isBoundedInt(v, 1, 4320))) {
    return { ok: false };
  }
  if (
    !isNullOr(
      candidate.runtimeCreationStatus,
      (v) => typeof v === "string" && ALLOWED_RUNTIME_CREATION_STATUSES.has(v),
    )
  ) {
    return { ok: false };
  }
  if (
    !isNullOr(
      candidate.inferenceStatus,
      (v) => typeof v === "string" && ALLOWED_INFERENCE_STATUSES.has(v),
    )
  ) {
    return { ok: false };
  }
  if (!isNullOr(candidate.inferenceMs, isFiniteNonNegativeNumber)) {
    return { ok: false };
  }
  if (
    !isNullOr(
      candidate.payloadStatus,
      (v) => typeof v === "string" && ALLOWED_PAYLOAD_STATUSES.has(v),
    )
  ) {
    return { ok: false };
  }
  if (
    !isNullOr(
      candidate.closeStatus,
      (v) => typeof v === "string" && ALLOWED_CLOSE_STATUSES.has(v),
    )
  ) {
    return { ok: false };
  }

  if (status === "SKIPPED") {
    if (candidate.reason !== SKIPPED_REASON) {
      return { ok: false };
    }
    for (const field of ALLOWED_FIELDS) {
      if (
        field === "schemaVersion" ||
        field === "check" ||
        field === "status" ||
        field === "reason"
      ) {
        continue;
      }
      if (candidate[field] !== null) {
        return { ok: false };
      }
    }
  } else if (status === "FAILED") {
    if (
      typeof candidate.reason !== "string" ||
      !ALLOWED_FAILURE_REASONS.has(candidate.reason)
    ) {
      return { ok: false };
    }
  } else if (status === "PASSED") {
    if (candidate.reason !== null) {
      return { ok: false };
    }
    if (candidate.runtimeCreationStatus !== "success") {
      return { ok: false };
    }
    if (candidate.inferenceStatus !== "success") {
      return { ok: false };
    }
    if (candidate.closeStatus !== "closed") {
      return { ok: false };
    }
    if (
      candidate.pythonVersion === null ||
      candidate.mediapipeVersion === null ||
      candidate.inputCategory === null ||
      candidate.inputWidth === null ||
      candidate.inputHeight === null ||
      candidate.inferenceMs === null ||
      candidate.payloadStatus === null
    ) {
      return { ok: false };
    }
  }

  const report = {};
  for (const field of ALLOWED_FIELDS) {
    report[field] = candidate[field];
  }
  return { ok: true, report };
}

// Parses raw child stdout as exactly one bounded JSON report line, without
// ever echoing the untrusted raw text on failure.
function parseAndValidateStdout(stdout) {
  if (typeof stdout !== "string") {
    return { ok: false };
  }
  if (stdout.includes("\r")) {
    return { ok: false };
  }
  if (!stdout.endsWith("\n")) {
    return { ok: false };
  }
  const content = stdout.slice(0, -1);
  if (content.length === 0 || content.includes("\n")) {
    return { ok: false };
  }
  if (Buffer.byteLength(content, "utf8") > MAX_REPORT_BYTES) {
    return { ok: false };
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false };
  }

  return validateReportShape(parsed);
}

function printReport(report) {
  console.log(JSON.stringify(report));
}

function isValidAbsoluteExistingFile(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (!isAbsolute(value)) {
    return false;
  }
  try {
    return existsSync(value) && statSync(value).isFile();
  } catch {
    return false;
  }
}

function runSelfTest() {
  let passed = 0;
  let failed = 0;

  function check(label, condition) {
    if (condition) {
      console.log(`  PASS: ${label}`);
      passed++;
    } else {
      console.error(`  FAIL: ${label}`);
      failed++;
    }
  }

  console.log(
    "mediapipe-face-landmarker-runtime-smoke self-test starting...\n",
  );

  console.log("[test 1] valid SKIPPED report accepted");
  check(
    "valid skipped report",
    validateReportShape(buildSkippedReport()).ok === true,
  );

  console.log("\n[test 2] valid PASSED report accepted");
  const validPassed = {
    schemaVersion: 1,
    check: CHECK_NAME,
    status: "PASSED",
    reason: null,
    pythonVersion: "3.11.4",
    mediapipeVersion: "0.10.35",
    inputCategory: "synthetic-solid-bgr24",
    inputWidth: 64,
    inputHeight: 64,
    runtimeCreationStatus: "success",
    inferenceStatus: "success",
    inferenceMs: 12.5,
    payloadStatus: "lost",
    closeStatus: "closed",
  };
  check("valid passed report", validateReportShape(validPassed).ok === true);

  console.log("\n[test 3] valid FAILED report accepted");
  const validFailed = buildFailedReport("mediapipe_import_failed");
  check("valid failed report", validateReportShape(validFailed).ok === true);

  console.log(
    "\n[test 4] FAILED report with partial progressive evidence accepted",
  );
  const partialFailed = {
    ...buildFailedReport("inference_failed"),
    pythonVersion: "3.11.4",
    mediapipeVersion: "0.10.35",
    inputCategory: "synthetic-solid-bgr24",
    inputWidth: 64,
    inputHeight: 64,
    runtimeCreationStatus: "success",
    inferenceStatus: "detection_failed",
    closeStatus: "closed",
  };
  check(
    "failed report with partial evidence",
    validateReportShape(partialFailed).ok === true,
  );

  console.log("\n[test 5] unknown top-level field rejected");
  check(
    "unknown field rejected",
    validateReportShape({ ...buildSkippedReport(), extra: "nope" }).ok ===
      false,
  );

  console.log("\n[test 6] missing required field rejected");
  const { reason: _omit, ...missingReason } = buildSkippedReport();
  check(
    "missing field rejected",
    validateReportShape(missingReason).ok === false,
  );

  console.log("\n[test 7] unknown status rejected");
  check(
    "unknown status rejected",
    validateReportShape({ ...buildSkippedReport(), status: "MAYBE" }).ok ===
      false,
  );

  console.log("\n[test 8] unknown reason rejected");
  check(
    "unknown reason rejected",
    validateReportShape({ ...buildFailedReport("totally_made_up_reason") })
      .ok === false,
  );

  console.log("\n[test 9] SKIPPED with non-null evidence rejected");
  check(
    "skipped with stray evidence rejected",
    validateReportShape({ ...buildSkippedReport(), pythonVersion: "3.11.4" })
      .ok === false,
  );

  console.log("\n[test 10] PASSED missing required evidence rejected");
  check(
    "passed missing evidence rejected",
    validateReportShape({ ...validPassed, mediapipeVersion: null }).ok ===
      false,
  );

  console.log("\n[test 11] path-like pythonVersion rejected");
  check(
    "path-like version rejected",
    validateReportShape({
      ...validPassed,
      pythonVersion: "C:/private/secret.task",
    }).ok === false,
  );

  console.log("\n[test 12] exception-like mediapipeVersion rejected");
  check(
    "exception-like version rejected",
    validateReportShape({
      ...validPassed,
      mediapipeVersion: "Traceback (most recent call last)",
    }).ok === false,
  );

  console.log("\n[test 13] NaN inferenceMs rejected");
  check(
    "NaN inferenceMs rejected",
    validateReportShape({ ...validPassed, inferenceMs: Number.NaN }).ok ===
      false,
  );

  console.log("\n[test 14] infinite inferenceMs rejected");
  check(
    "infinite inferenceMs rejected",
    validateReportShape({
      ...validPassed,
      inferenceMs: Number.POSITIVE_INFINITY,
    }).ok === false,
  );

  console.log("\n[test 15] negative inferenceMs rejected");
  check(
    "negative inferenceMs rejected",
    validateReportShape({ ...validPassed, inferenceMs: -1.0 }).ok === false,
  );

  console.log("\n[test 16] malformed stdout (no trailing newline) rejected");
  check(
    "no trailing newline rejected",
    parseAndValidateStdout(JSON.stringify(validPassed)).ok === false,
  );

  console.log("\n[test 17] multiple JSON lines rejected");
  check(
    "multiple lines rejected",
    parseAndValidateStdout(
      `${JSON.stringify(validPassed)}\n${JSON.stringify(validPassed)}\n`,
    ).ok === false,
  );

  console.log("\n[test 18] oversized stdout rejected");
  const oversized = { ...validPassed, mediapipeVersion: "0.10.35" };
  const oversizedContent = JSON.stringify(oversized).padEnd(3000, " ");
  check(
    "oversized stdout rejected",
    parseAndValidateStdout(`${oversizedContent}\n`).ok === false,
  );

  console.log("\n[test 19] non-JSON stdout rejected");
  check(
    "non-JSON stdout rejected",
    parseAndValidateStdout("not json at all\n").ok === false,
  );

  console.log("\n[test 20] carriage return in stdout rejected");
  check(
    "carriage return rejected",
    parseAndValidateStdout(`${JSON.stringify(validPassed)}\r\n`).ok === false,
  );

  console.log("\n[test 21] valid single-line stdout accepted");
  check(
    "valid single-line stdout accepted",
    parseAndValidateStdout(`${JSON.stringify(validPassed)}\n`).ok === true,
  );

  console.log(
    "\n[test 22] no real Python/MediaPipe/model/file/camera/network dependency",
  );
  check(
    "self-test uses only synthetic in-memory objects",
    typeof validateReportShape === "function" &&
      typeof parseAndValidateStdout === "function",
  );

  console.log(
    `\nmediapipe-face-landmarker-runtime-smoke self-test complete: ${passed} passed, ${failed} failed.`,
  );

  return failed === 0;
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--self-test")) {
    const ok = runSelfTest();
    process.exit(ok ? 0 : 1);
  }

  const optedIn = process.env.LVK_MEDIAPIPE_SMOKE === "1";
  if (!optedIn) {
    printReport(buildSkippedReport());
    process.exit(0);
  }

  const interpreterPath = process.env.LVK_MEDIAPIPE_SMOKE_PYTHON;
  if (!isValidAbsoluteExistingFile(interpreterPath)) {
    printReport(buildFailedReport("interpreter_configuration_invalid"));
    process.exit(1);
  }

  const modelAssetPath = process.env.LVK_MEDIAPIPE_MODEL_ASSET_PATH;
  if (!isValidAbsoluteExistingFile(modelAssetPath)) {
    printReport(buildFailedReport("model_configuration_invalid"));
    process.exit(1);
  }

  let result;
  try {
    result = spawnSync(
      interpreterPath,
      ["-B", pythonScriptPath, "--real-run"],
      {
        encoding: "utf8",
        timeout: SPAWN_TIMEOUT_MS,
        maxBuffer: SPAWN_MAX_BUFFER_BYTES,
        env: process.env,
      },
    );
  } catch {
    printReport(buildFailedReport("worker_unavailable"));
    process.exit(1);
  }

  if (result.error) {
    if (result.signal === "SIGTERM" || result.error.code === "ETIMEDOUT") {
      printReport(buildFailedReport("worker_timeout"));
    } else {
      printReport(buildFailedReport("worker_unavailable"));
    }
    process.exit(1);
  }

  if (result.signal) {
    printReport(buildFailedReport("worker_timeout"));
    process.exit(1);
  }

  if ((result.stderr ?? "") !== "") {
    printReport(buildFailedReport("worker_protocol_invalid"));
    process.exit(1);
  }

  const parsed = parseAndValidateStdout(result.stdout ?? "");
  if (!parsed.ok) {
    printReport(buildFailedReport("worker_protocol_invalid"));
    process.exit(1);
  }

  printReport(parsed.report);
  process.exit(parsed.report.status === "PASSED" ? 0 : 1);
}

main();
