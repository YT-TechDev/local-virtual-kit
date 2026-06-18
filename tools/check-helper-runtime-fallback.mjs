#!/usr/bin/env node
// Helper runtime fallback smoke checker (H1e).
//
// Runs lvk-tracker-core with explicit smoke-only failure cases and validates
// that expected helper failures emit one safe fallback MotionFrame JSON line
// while helper stdout/stderr remain private to Native Core.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const trackerPath = process.argv[2] ? resolve(process.argv[2]) : undefined;
const helperPath = process.argv[3] ? resolve(process.argv[3]) : undefined;

const fail = (message, result) => {
  console.error(`Helper runtime fallback smoke check failed: ${message}`);
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

const cases = [
  {
    name: "launch-failure",
    helper: `${helperPath}.missing`,
    smokeCase: "launch-failure",
  },
  { name: "nonzero-exit", helper: helperPath, smokeCase: "nonzero-exit" },
  { name: "timeout", helper: helperPath, smokeCase: "timeout" },
];

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

const forbiddenStderrMarkers = [
  "raw pixels",
  "images",
  "screenshots",
  "frame dumps",
  "model contents",
  "secret",
  helperPath.toLowerCase(),
];

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

const assertVector = (value, keys, label, result) => {
  if (!value || keys.some((key) => !isNumber(value[key]))) {
    fail(`${label} shape missing`, result);
  }
};

for (const smoke of cases) {
  const result = spawnSync(
    trackerPath,
    [
      "--helper-runtime-smoke",
      smoke.helper,
      "--frames",
      "3",
      "--helper-runtime-smoke-case",
      smoke.smokeCase,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );

  if (result.error) {
    fail(
      `${smoke.name}: could not run ${trackerPath}: ${result.error.message}`,
      result,
    );
  }
  if (result.status !== 0) {
    fail(`${smoke.name}: expected exit status 0`, result);
  }

  const stdout = result.stdout ?? "";
  const stdoutLines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (stdoutLines.length !== 1) {
    fail(
      `${smoke.name}: expected exactly 1 non-empty stdout line, got ${stdoutLines.length}`,
      result,
    );
  }

  for (const marker of forbiddenStdoutMarkers) {
    if (stdout.includes(marker)) {
      fail(
        `${smoke.name}: stdout leaked forbidden marker ${JSON.stringify(marker)}`,
        result,
      );
    }
  }

  let frame;
  try {
    frame = JSON.parse(stdoutLines[0]);
  } catch (error) {
    fail(
      `${smoke.name}: stdout line is not valid JSON: ${error.message}`,
      result,
    );
  }

  if (frame.schemaVersion !== 1)
    fail(`${smoke.name}: schemaVersion !== 1`, result);
  if (frame.source !== "native")
    fail(`${smoke.name}: source is not native`, result);
  if (frame.tracking?.status !== "lost")
    fail(`${smoke.name}: tracking.status is not lost`, result);
  if (frame.tracking.confidence !== 0)
    fail(`${smoke.name}: tracking.confidence is not 0`, result);
  assertVector(
    frame.face?.position,
    ["x", "y", "z"],
    `${smoke.name}: face.position`,
    result,
  );
  assertVector(
    frame.face?.rotation,
    ["pitch", "yaw", "roll"],
    `${smoke.name}: face.rotation`,
    result,
  );
  if (!isNumber(frame.eyes?.leftOpen) || !isNumber(frame.eyes?.rightOpen)) {
    fail(`${smoke.name}: eyes openness missing`, result);
  }
  assertVector(
    frame.eyes?.gaze,
    ["x", "y"],
    `${smoke.name}: eyes.gaze`,
    result,
  );
  if (!isNumber(frame.mouth?.open) || !isNumber(frame.mouth?.smile)) {
    fail(`${smoke.name}: mouth shape missing`, result);
  }

  const stderrLines = (result.stderr ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  stderrLines.forEach((line) => {
    if (!line.startsWith("[helper-runtime-smoke] ")) {
      fail(
        `${smoke.name}: unexpected stderr line without safe prefix: ${line}`,
        result,
      );
    }
    const lower = line.toLowerCase();
    for (const marker of forbiddenStderrMarkers) {
      if (lower.includes(marker)) {
        fail(
          `${smoke.name}: stderr contains forbidden marker ${JSON.stringify(marker)}`,
          result,
        );
      }
    }
  });
}

console.log(
  "Helper runtime fallback smoke OK: expected failures emit safe fallback MotionFrame JSON.",
);
