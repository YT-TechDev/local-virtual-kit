#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const executablePath = process.argv[2];

const checks = [
  {
    name: "help output",
    args: ["--help"],
    expectStatus: "success",
    stdoutIncludes: "Usage: lvk-tracker-core",
  },
  {
    name: "dummy source single frame",
    args: ["--camera-source", "dummy", "--frames", "1"],
    expectStatus: "success",
  },
  {
    name: "dummy source camera FPS",
    args: ["--camera-source", "dummy", "--frames", "1", "--camera-fps", "60"],
    expectStatus: "success",
  },
  {
    name: "dummy source dimensions",
    args: [
      "--camera-source",
      "dummy",
      "--frames",
      "1",
      "--camera-width",
      "640",
      "--camera-height",
      "480",
    ],
    expectStatus: "success",
  },
  {
    name: "noop face detector",
    args: [
      "--camera-source",
      "dummy",
      "--frames",
      "1",
      "--face-detector",
      "noop",
    ],
    expectStatus: "success",
  },
  {
    name: "pipeline status interval",
    args: [
      "--camera-source",
      "dummy",
      "--frames",
      "1",
      "--log-pipeline-status",
      "--pipeline-status-interval",
      "1",
    ],
    expectStatus: "success",
    stderrIncludes: "[pipeline] periodic:",
  },
  {
    name: "reject negative camera index",
    args: ["--camera-index", "-1"],
    expectStatus: "failure",
    stderrIncludes: "Invalid value for --camera-index",
  },
  {
    name: "reject zero camera width",
    args: ["--camera-width", "0"],
    expectStatus: "failure",
    stderrIncludes: "Invalid value for --camera-width",
  },
  {
    name: "reject zero camera height",
    args: ["--camera-height", "0"],
    expectStatus: "failure",
    stderrIncludes: "Invalid value for --camera-height",
  },
  {
    name: "reject zero camera FPS",
    args: ["--camera-fps", "0"],
    expectStatus: "failure",
    stderrIncludes: "Invalid value for --camera-fps",
  },
  {
    name: "reject unknown face detector",
    args: ["--face-detector", "unknown"],
    expectStatus: "failure",
    stderrIncludes: "Unsupported face detector",
  },
];

const fail = (message) => {
  console.error(`Native tracker option smoke check failed: ${message}`);
  process.exit(1);
};

const snippet = (value) => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "(empty)";
  }

  return trimmed.length > 800 ? `${trimmed.slice(0, 800)}...` : trimmed;
};

const reportCheckFailure = (check, result, reason) => {
  console.error("Native tracker option smoke check failed.");
  console.error(`Check: ${check.name}`);
  console.error(`Command args: ${check.args.join(" ")}`);
  console.error(`Reason: ${reason}`);

  if (result) {
    console.error(`Exit status: ${result.status ?? "unknown"}`);
    console.error(`stderr: ${snippet(result.stderr ?? "")}`);
    console.error(`stdout: ${snippet(result.stdout ?? "")}`);
  }

  process.exit(1);
};

if (!executablePath) {
  fail("expected native tracker executable path as the first argument");
}

for (const check of checks) {
  console.log(`Running: ${check.name}`);

  const result = spawnSync(executablePath, check.args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  if (result.error) {
    reportCheckFailure(
      check,
      result,
      `could not run ${executablePath}: ${result.error.message}`,
    );
  }

  const succeeded = result.status === 0;
  if (check.expectStatus === "success" && !succeeded) {
    reportCheckFailure(check, result, "expected exit status 0");
  }

  if (check.expectStatus === "failure" && succeeded) {
    reportCheckFailure(check, result, "expected non-zero exit status");
  }

  if (check.stdoutIncludes && !result.stdout.includes(check.stdoutIncludes)) {
    reportCheckFailure(
      check,
      result,
      `expected stdout to include ${JSON.stringify(check.stdoutIncludes)}`,
    );
  }

  if (check.stderrIncludes && !result.stderr.includes(check.stderrIncludes)) {
    reportCheckFailure(
      check,
      result,
      `expected stderr to include ${JSON.stringify(check.stderrIncludes)}`,
    );
  }
}

console.log("Native tracker option smoke checks passed.");
