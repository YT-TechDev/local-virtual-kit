#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNativeMotionFrameJson } from "../packages/motion-protocol/src/motion-frame-validation.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const fail = (message) => {
  console.error(`Native dummy backend boundary check failed: ${message}`);
  process.exit(1);
};

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
      "lvk-tracker-core.exe",
    ),
    join(
      repoRoot,
      "native",
      "tracker-core",
      "build",
      "Release",
      "lvk-tracker-core.exe",
    ),
    join(repoRoot, "native", "tracker-core", "build", "lvk-tracker-core"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

const executablePath = resolveExecutable();

if (!executablePath) {
  console.log(
    "Native dummy backend boundary check skipped: native binary not found. " +
      "Build the native tracker first with cmake -S native/tracker-core -B native/tracker-core/build && cmake --build native/tracker-core/build, " +
      "or pass the binary path as the first argument.",
  );
  process.exit(0);
}

const result = spawnSync(
  executablePath,
  [
    "--camera-source",
    "dummy",
    "--face-detector",
    "noop",
    "--frames",
    "3",
    "--log-face-status",
    "--face-status-interval",
    "1",
  ],
  {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  },
);

if (result.error) {
  fail(`could not run ${executablePath}: ${result.error.message}`);
}

if (result.status !== 0) {
  const stderr = result.stderr.trim();
  fail(
    `${executablePath} exited with status ${result.status}${
      stderr ? `; stderr: ${stderr}` : ""
    }`,
  );
}

const stdoutLines = result.stdout
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

if (stdoutLines.length !== 3) {
  fail(
    `expected exactly 3 non-empty stdout lines, received ${stdoutLines.length}\nActual stdout:\n${result.stdout}`,
  );
}

stdoutLines.forEach((line, index) => {
  const lineNumber = index + 1;
  let parsedJson;

  try {
    parsedJson = JSON.parse(line);
  } catch {
    fail(`stdout line ${lineNumber} is not valid JSON: ${line}`);
  }

  const frame = parseNativeMotionFrameJson(line);
  if (frame === null) {
    fail(
      `stdout line ${lineNumber} is not a valid native MotionFrame: ${line}`,
    );
  }

  if (frame.schemaVersion !== 1) {
    fail(`stdout line ${lineNumber} has unexpected schemaVersion`);
  }

  if (frame.source !== "native") {
    fail(`stdout line ${lineNumber} has unexpected source`);
  }

  if (frame.tracking.status !== "tracking") {
    fail(
      `stdout line ${lineNumber} expected tracking.status "tracking" for the dummy/noop path, got ${frame.tracking.status}`,
    );
  }

  if (!Number.isFinite(frame.tracking.confidence)) {
    fail(`stdout line ${lineNumber} has a non-finite tracking.confidence`);
  }

  if (
    parsedJson.face?.position === undefined ||
    parsedJson.face?.rotation === undefined
  ) {
    fail(`stdout line ${lineNumber} is missing face.position or face.rotation`);
  }

  if (
    parsedJson.eyes?.leftOpen === undefined ||
    parsedJson.eyes?.rightOpen === undefined ||
    parsedJson.eyes?.gaze === undefined
  ) {
    fail(`stdout line ${lineNumber} is missing eyes.leftOpen/rightOpen/gaze`);
  }

  if (
    parsedJson.mouth?.open === undefined ||
    parsedJson.mouth?.smile === undefined
  ) {
    fail(`stdout line ${lineNumber} is missing mouth.open or mouth.smile`);
  }
});

const nonJsonStdoutLines = stdoutLines.filter((line) => !line.startsWith("{"));
if (nonJsonStdoutLines.length > 0) {
  fail(
    `stdout must contain only newline-delimited MotionFrame JSON, found non-JSON line(s): ${nonJsonStdoutLines.join(", ")}`,
  );
}

const stderr = result.stderr;

const requiredStderrTerms = [
  "[face] startup:",
  "detectorName=noop",
  "usedFallbackTracking=true",
];

for (const term of requiredStderrTerms) {
  if (!stderr.includes(term)) {
    fail(
      `expected stderr to include ${JSON.stringify(term)}\nActual stderr:\n${stderr}`,
    );
  }
}

console.log("Native dummy backend boundary check passed.");
