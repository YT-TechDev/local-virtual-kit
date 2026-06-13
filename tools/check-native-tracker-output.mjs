#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { parseNativeMotionFrameJson } from "../packages/motion-protocol/src/motion-frame-validation.js";

const executablePath = process.argv[2];

const fail = (message) => {
  console.error(`Native tracker MotionFrame stdout check failed: ${message}`);
  process.exit(1);
};

if (!executablePath) {
  fail("expected native tracker executable path as the first argument");
}

const result = spawnSync(executablePath, ["--frames", "3"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
});

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

const lines = result.stdout
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

if (lines.length !== 3) {
  fail(`expected exactly 3 non-empty stdout lines, received ${lines.length}`);
}

let previousTimestampMs = null;

lines.forEach((line, index) => {
  const frame = parseNativeMotionFrameJson(line);
  const lineNumber = index + 1;

  if (frame === null) {
    fail(
      `stdout line ${lineNumber} is not valid native MotionFrame JSON: ${line}`,
    );
  }

  if (!Number.isFinite(frame.timestampMs)) {
    fail(`stdout line ${lineNumber} has a non-finite timestampMs`);
  }

  if (previousTimestampMs !== null && frame.timestampMs < previousTimestampMs) {
    fail(
      `stdout line ${lineNumber} timestampMs ${frame.timestampMs} is earlier than previous timestampMs ${previousTimestampMs}`,
    );
  }

  previousTimestampMs = frame.timestampMs;
});

console.log("Native tracker emitted 3 valid MotionFrame JSON lines.");
