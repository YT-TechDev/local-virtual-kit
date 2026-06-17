#!/usr/bin/env node
// Synthetic helper contract smoke checker (H1a).
//
// Validates the internal helper stdout JSON contract and safe stderr
// diagnostics of the lvk-synthetic-helper executable. This contract is
// intentionally distinct from MotionFrame and is Native Core-internal only.
// See docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md.
//
// Dependency-free: Node built-ins only.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Resolve to an absolute path: the normal-mode run sets cwd to a temp directory
// (to verify the helper creates no files), so a relative path would not resolve.
const executablePath = process.argv[2] ? resolve(process.argv[2]) : undefined;

const fail = (message, result) => {
  console.error(`Synthetic helper contract smoke check failed: ${message}`);
  if (result) {
    const snippet = (value) => {
      const trimmed = (value ?? "").trim();
      if (trimmed.length === 0) {
        return "(empty)";
      }
      return trimmed.length > 800 ? `${trimmed.slice(0, 800)}...` : trimmed;
    };
    console.error(`Exit status: ${result.status ?? "unknown"}`);
    console.error(`stderr: ${snippet(result.stderr)}`);
    console.error(`stdout: ${snippet(result.stdout)}`);
  }
  process.exit(1);
};

if (!executablePath) {
  fail("expected synthetic helper executable path as the first argument");
}

const runHelper = (args, cwd) =>
  spawnSync(executablePath, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    cwd,
  });

const nonEmptyLines = (stdout) =>
  stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const parseJsonLines = (lines) =>
  lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      return fail(`stdout line ${index + 1} is not valid JSON: ${line}`);
    }
  });

// Forbidden keys/values that would make a result line look like a MotionFrame.
const assertNotMotionFrame = (message, lineNumber) => {
  if (Object.prototype.hasOwnProperty.call(message, "face")) {
    fail(`result line ${lineNumber} must not include a "face" object`);
  }
  if (Object.prototype.hasOwnProperty.call(message, "tracking")) {
    fail(
      `result line ${lineNumber} must not include a public "tracking" object`,
    );
  }
  if (message.source === "native") {
    fail(`result line ${lineNumber} must not use source="native"`);
  }
};

// --- Normal mode: --frames 3 -----------------------------------------------
const normalDir = mkdtempSync(join(tmpdir(), "lvk-synthetic-helper-"));
let createdFiles = [];
try {
  const result = runHelper(["--frames", "3"], normalDir);

  if (result.error) {
    fail(`could not run ${executablePath}: ${result.error.message}`, result);
  }
  if (result.status !== 0) {
    fail("expected exit status 0 for normal mode", result);
  }

  const lines = nonEmptyLines(result.stdout);
  if (lines.length < 3) {
    fail(
      `expected at least 3 stdout lines (ready + result + stopped), received ${lines.length}`,
      result,
    );
  }

  const messages = parseJsonLines(lines);

  messages.forEach((message, index) => {
    if (message.schemaVersion !== 1) {
      fail(`stdout line ${index + 1} must have schemaVersion=1`, result);
    }
  });

  const first = messages[0];
  if (first.type !== "ready") {
    fail(`first stdout line must be type=ready, received type=${first.type}`);
  }
  if (first.source !== "synthetic-helper") {
    fail('ready line must have source="synthetic-helper"');
  }

  const last = messages[messages.length - 1];
  if (last.type !== "stopped") {
    fail(`final stdout line must be type=stopped, received type=${last.type}`);
  }

  const resultMessages = messages.filter(
    (message) => message.type === "result",
  );
  if (resultMessages.length < 1) {
    fail("expected at least one type=result line");
  }

  resultMessages.forEach((message, index) => {
    assertNotMotionFrame(message, index + 1);
    if (message.status === undefined || message.confidence === undefined) {
      fail(`result line ${index + 1} is missing status/confidence`);
    }
  });

  // Any unexpected message type is a contract violation.
  const allowedTypes = new Set(["ready", "result", "stopped"]);
  messages.forEach((message, index) => {
    if (!allowedTypes.has(message.type)) {
      fail(`stdout line ${index + 1} has unexpected type=${message.type}`);
    }
  });

  // stderr must only contain safe [helper] diagnostics.
  const stderrLines = nonEmptyLines(result.stderr);
  stderrLines.forEach((line) => {
    if (!line.startsWith("[helper] ")) {
      fail(`unexpected non-helper stderr line: ${line}`, result);
    }
  });

  // The helper must not create files in its working directory.
  createdFiles = readdirSync(normalDir);
  if (createdFiles.length !== 0) {
    fail(
      `helper created files in its working directory: ${createdFiles.join(", ")}`,
    );
  }

  console.log(
    `Synthetic helper normal mode OK: ${messages.length} stdout lines (` +
      `${resultMessages.length} result), safe stderr, no files created.`,
  );
} finally {
  rmSync(normalDir, { recursive: true, force: true });
}

// --- Failure mode: --fail-after --------------------------------------------
const failResult = runHelper(["--frames", "5", "--fail-after", "2"]);

if (failResult.error) {
  fail(
    `could not run ${executablePath}: ${failResult.error.message}`,
    failResult,
  );
}
if (failResult.status === 0) {
  fail("expected non-zero exit status for --fail-after mode", failResult);
}

const failLines = nonEmptyLines(failResult.stdout);
const failMessages = parseJsonLines(failLines);

// No stopped line should be emitted on simulated failure.
if (failMessages.some((message) => message.type === "stopped")) {
  fail("failure mode must not emit a type=stopped line", failResult);
}

// Failure stderr must be a safe [helper] diagnostic and must not leak raw data.
const failStderrLines = nonEmptyLines(failResult.stderr);
if (!failStderrLines.some((line) => line.startsWith("[helper] error:"))) {
  fail("failure mode must report a safe [helper] error diagnostic", failResult);
}
failStderrLines.forEach((line) => {
  if (!line.startsWith("[helper] ")) {
    fail(
      `unexpected non-helper stderr line in failure mode: ${line}`,
      failResult,
    );
  }
});

// Any stdout in failure mode must still be valid contract JSON (no raw data).
failMessages.forEach((message, index) => {
  if (message.schemaVersion !== 1) {
    fail(`failure-mode stdout line ${index + 1} must have schemaVersion=1`);
  }
  if (message.type === "result") {
    assertNotMotionFrame(message, index + 1);
  }
});

// --- Invalid arguments ------------------------------------------------------
const invalidResult = runHelper(["--frames", "-1"]);
if (invalidResult.status === 0) {
  fail("expected non-zero exit status for invalid --frames", invalidResult);
}
if (!invalidResult.stderr.includes("Invalid value for --frames")) {
  fail(
    "invalid --frames should print a usage/error message to stderr",
    invalidResult,
  );
}

console.log("Synthetic helper failure and invalid-argument modes OK.");
console.log("Synthetic helper contract smoke checks passed.");
