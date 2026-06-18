#!/usr/bin/env node
// Helper runtime integration smoke checker (H1d).
//
// Runs lvk-tracker-core with the explicit --helper-runtime-smoke path and
// validates that stdout contains only existing MotionFrame JSON while helper
// stdout/stderr stay private to Native Core.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const trackerPath = process.argv[2] ? resolve(process.argv[2]) : undefined;
const helperPath = process.argv[3] ? resolve(process.argv[3]) : undefined;

const fail = (message, result) => {
  console.error(`Helper runtime integration smoke check failed: ${message}`);
  if (result) {
    const snippet = (value) => {
      const trimmed = (value ?? "").trim();
      if (trimmed.length === 0) return "(empty)";
      return trimmed.length > 800 ? `${trimmed.slice(0, 800)}...` : trimmed;
    };
    console.error(`Exit status: ${result.status ?? "unknown"}`);
    console.error(`stderr: ${snippet(result.stderr)}`);
    console.error(`stdout: ${snippet(result.stdout)}`);
  }
  process.exit(1);
};

if (!trackerPath || !helperPath) {
  fail(
    "expected two arguments: <lvk-tracker-core-path> <lvk-synthetic-helper-path>",
  );
}

const result = spawnSync(
  trackerPath,
  ["--helper-runtime-smoke", helperPath, "--frames", "3"],
  { encoding: "utf8", maxBuffer: 1024 * 1024 },
);

if (result.error) {
  fail(`could not run ${trackerPath}: ${result.error.message}`, result);
}
if (result.status !== 0) {
  fail("expected exit status 0", result);
}

const stdout = result.stdout ?? "";
const stdoutLines = stdout
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

if (stdoutLines.length !== 3) {
  fail(
    `expected exactly 3 non-empty stdout lines, got ${stdoutLines.length}`,
    result,
  );
}

const forbiddenStdoutMarkers = [
  '"type"',
  '"diag"',
  '"inferenceMs"',
  '"faceRotation"',
  '"source":"synthetic-helper"',
  "raw pixels",
  "image dump",
  "screenshot",
  "frame dump",
  "model contents",
  "secret",
];

for (const marker of forbiddenStdoutMarkers) {
  if (stdout.includes(marker)) {
    fail(`stdout leaked forbidden marker ${JSON.stringify(marker)}`, result);
  }
}

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

stdoutLines.forEach((line, index) => {
  let frame;
  try {
    frame = JSON.parse(line);
  } catch (error) {
    fail(
      `stdout line ${index + 1} is not valid JSON: ${error.message}`,
      result,
    );
  }

  if (frame.schemaVersion !== 1)
    fail(`line ${index + 1}: schemaVersion !== 1`, result);
  if (frame.source !== "native")
    fail(`line ${index + 1}: source is not native`, result);
  if (!frame.tracking || typeof frame.tracking.status !== "string") {
    fail(`line ${index + 1}: tracking.status missing`, result);
  }
  if (
    !isNumber(frame.tracking.confidence) ||
    frame.tracking.confidence < 0 ||
    frame.tracking.confidence > 1
  ) {
    fail(`line ${index + 1}: tracking.confidence out of range`, result);
  }
  if (!frame.face?.position || !frame.face?.rotation) {
    fail(`line ${index + 1}: face position/rotation missing`, result);
  }
  if (
    !frame.eyes ||
    !isNumber(frame.eyes.leftOpen) ||
    !isNumber(frame.eyes.rightOpen) ||
    !frame.eyes.gaze
  ) {
    fail(`line ${index + 1}: eyes shape missing`, result);
  }
  if (
    !frame.mouth ||
    !isNumber(frame.mouth.open) ||
    !isNumber(frame.mouth.smile)
  ) {
    fail(`line ${index + 1}: mouth shape missing`, result);
  }
});

const stderrLines = (result.stderr ?? "")
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

stderrLines.forEach((line) => {
  if (!line.startsWith("[helper-runtime-smoke] ")) {
    fail(`unexpected stderr line without safe prefix: ${line}`, result);
  }
  const forbidden = [
    "raw pixels",
    "images",
    "screenshots",
    "frame dumps",
    "model contents",
    "secret",
  ];
  for (const marker of forbidden) {
    if (line.toLowerCase().includes(marker)) {
      fail(
        `stderr contains forbidden diagnostic marker ${JSON.stringify(marker)}`,
        result,
      );
    }
  }
});

console.log(
  "Helper runtime integration smoke OK: MotionFrame-only stdout and safe diagnostics.",
);
