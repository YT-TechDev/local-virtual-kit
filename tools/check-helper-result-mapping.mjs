#!/usr/bin/env node
// Helper result mapping smoke checker (H1b).
//
// Runs lvk-helper-result-mapping-smoke and validates that the mapped output is
// valid public MotionFrame JSON (source=native, schemaVersion=1), that values
// are clamped/finite, and that no helper-only fields leak into MotionFrame. The
// helper internal contract itself was validated in PR #125; this checks the
// Native Core mapping side. See docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md.
//
// Dependency-free: Node built-ins only.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const executablePath = process.argv[2] ? resolve(process.argv[2]) : undefined;

const fail = (message, result) => {
  console.error(`Helper result mapping smoke check failed: ${message}`);
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
  fail("expected mapping smoke executable path as the first argument");
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

const lines = result.stdout
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

if (lines.length < 1) {
  fail("expected at least one MotionFrame JSON line on stdout", result);
}

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "timestampMs",
  "source",
  "tracking",
  "face",
  "eyes",
  "mouth",
]);

// Keys that would indicate a helper-only field (or unsupported rich output)
// leaking into MotionFrame, checked recursively at any depth.
const FORBIDDEN_KEYS_ANYWHERE = new Set([
  "diag",
  "inferenceMs",
  "faceRotation",
  "landmarks",
  "blendshapes",
  "type",
]);

const collectKeys = (value, keys) => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
};

const inUnitRange = (value) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

lines.forEach((line, index) => {
  const lineNumber = index + 1;
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    fail(`stdout line ${lineNumber} is not valid JSON: ${line}`);
  }

  if (frame.schemaVersion !== 1) {
    fail(`stdout line ${lineNumber} must have schemaVersion=1`);
  }
  if (frame.source !== "native") {
    fail(`stdout line ${lineNumber} must have source="native"`);
  }

  // Top-level keys must be exactly the MotionFrame set (no helper-only leak).
  for (const key of Object.keys(frame)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      fail(`stdout line ${lineNumber} has unexpected top-level key "${key}"`);
    }
  }

  // No helper-only / unsupported-rich-output keys at any depth.
  const allKeys = collectKeys(frame, new Set());
  for (const forbidden of FORBIDDEN_KEYS_ANYWHERE) {
    if (allKeys.has(forbidden)) {
      fail(`stdout line ${lineNumber} leaks forbidden key "${forbidden}"`);
    }
  }

  // Required MotionFrame shape.
  if (!frame.tracking || typeof frame.tracking.status !== "string") {
    fail(`stdout line ${lineNumber} is missing tracking.status`);
  }
  if (!frame.face || !frame.face.position || !frame.face.rotation) {
    fail(`stdout line ${lineNumber} is missing face.position/face.rotation`);
  }

  // Values must be clamped and finite (proves the mapping sanitized inputs).
  if (!inUnitRange(frame.tracking.confidence)) {
    fail(`stdout line ${lineNumber} tracking.confidence is not within [0,1]`);
  }
  if (!inUnitRange(frame.eyes.leftOpen) || !inUnitRange(frame.eyes.rightOpen)) {
    fail(`stdout line ${lineNumber} eye openness is not within [0,1]`);
  }
  if (!inUnitRange(frame.mouth.open) || !inUnitRange(frame.mouth.smile)) {
    fail(`stdout line ${lineNumber} mouth values are not within [0,1]`);
  }
  for (const axis of ["pitch", "yaw", "roll"]) {
    if (!isFiniteNumber(frame.face.rotation[axis])) {
      fail(`stdout line ${lineNumber} face.rotation.${axis} is not finite`);
    }
  }
});

// stderr must contain only safe mapping-smoke diagnostics (or be empty).
const stderrLines = result.stderr
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);
stderrLines.forEach((line) => {
  if (!line.startsWith("[mapping-smoke] ")) {
    fail(`unexpected non-mapping-smoke stderr line: ${line}`, result);
  }
});

console.log(
  `Helper result mapping smoke OK: ${lines.length} mapped MotionFrame lines, ` +
    `clamped/finite values, no helper-only fields leaked.`,
);
